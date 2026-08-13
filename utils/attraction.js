const crypto = require('crypto');
const db = require('../database/db');
const automation = require('./automation');

const SITE_URL = automation.SITE_URL;
const SITE_NAME = automation.SITE_NAME;

function genCode(len = 8) {
  return crypto.randomBytes(len).toString('base64').replace(/[+/=]/g, '').toUpperCase().slice(0, len);
}

// ============================================================
// 1. PROGRAMA DE INDICAÇÃO (referral)
// ============================================================
function createReferral(referrerCode, referrerIp) {
  if (!referrerCode) return null;
  db.run('INSERT INTO referrals (referrer_code, referrer_ip) VALUES (?,?)', [referrerCode, referrerIp || '']);
  return true;
}

function trackReferralVisit(referrerCode, visitorIp, sessionId) {
  if (!referrerCode || !visitorIp) return;
  // Não conta se o visitante é o próprio indicador
  const dup = db.get('SELECT COUNT(*) as c FROM referrals WHERE referrer_code = ? AND (referrer_ip = ? OR visitor_ip = ?)',
    [referrerCode, visitorIp, visitorIp]);
  if (dup && dup.c > 0) return;
  db.run('INSERT INTO referrals (referrer_code, visitor_ip, visitor_session) VALUES (?,?,?)',
    [referrerCode, visitorIp || '', sessionId || '']);
}

function getReferralStats() {
  return {
    total: (db.get('SELECT COUNT(*) as c FROM referrals') || {}).c || 0,
    converted: (db.get('SELECT COUNT(*) as c FROM referrals WHERE converted = 1') || {}).c || 0,
    top: db.query("SELECT referrer_code, COUNT(*) as visits, SUM(converted) as conv FROM referrals GROUP BY referrer_code ORDER BY visits DESC LIMIT 10")
  };
}

function countReferralsByCode(code) {
  return (db.get('SELECT COUNT(*) as c FROM referrals WHERE referrer_code = ?', [code]) || {}).c || 0;
}

// Cria cupom de boas-vindas para o convidado que chega
function welcomeCouponForVisitor(visitorIp) {
  // Só cria se ainda não tiver cupom para esse IP
  const existing = db.get('SELECT id FROM referrals WHERE visitor_ip = ? AND coupon_generated = 1', [visitorIp]);
  if (existing) return null;
  const code = 'BEMVINDO' + genCode(5);
  db.run('INSERT INTO coupons (code, type, value, min_order, max_uses, used_count, active, expires_at) VALUES (?,?,?,?,?,?,?,?)',
    [code, 'percentage', 10, 50, 1, 0, 1, new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')]);
  db.run("UPDATE referrals SET coupon_generated = 1 WHERE visitor_ip = ?", [visitorIp]);
  return code;
}

// ============================================================
// 2. SORTEIO AUTOMÁTICO (giveaway)
// ============================================================
function addGiveawayEntry(name, email, whatsapp, ip) {
  if (!email && !whatsapp) return { ok: false, error: 'Informe email ou WhatsApp' };
  const dup = db.get('SELECT id FROM giveaway_entries WHERE (email != "" AND email = ?) OR (whatsapp != "" AND whatsapp = ?)',
    [email || '---', whatsapp || '---']);
  if (dup) return { ok: false, error: 'Você já participa do sorteio!' };
  db.run('INSERT INTO giveaway_entries (name, email, whatsapp, ip) VALUES (?,?,?,?)',
    [name || '', email || '', whatsapp || '', ip || '']);
  return { ok: true };
}

function getGiveawayStats() {
  return {
    total: (db.get('SELECT COUNT(*) as c FROM giveaway_entries') || {}).c || 0,
    today: (db.get("SELECT COUNT(*) as c FROM giveaway_entries WHERE date(created_at) = date('now')") || {}).c || 0
  };
}

// Sorteia um vencedor aleatório e avisa no Discord
function drawGiveawayWinner() {
  const entries = db.query('SELECT * FROM giveaway_entries ORDER BY id DESC LIMIT 200');
  if (!entries.length) return null;
  const winner = entries[Math.floor(Math.random() * entries.length)];
  automation.sendDiscord('🏆 *SORTEIO ' + SITE_NAME + '*\n\n🎉 Vencedor: ' + (winner.name || 'Participante') +
    (winner.whatsapp ? '\n📱 WhatsApp: ' + winner.whatsapp : '') +
    (winner.email ? '\n📧 Email: ' + winner.email : '') +
    '\n\nParabéns! Entraremos em contato! 🎊').catch(() => {});
  return winner;
}

// ============================================================
// 3. RECUPERAÇÃO DE VISITAS ABANDONADAS
// ============================================================
function trackAbandonedVisit(sessionId, ip, product) {
  if (!sessionId || sessionId === 'undefined') return;
  const existing = db.get('SELECT * FROM abandoned_visits WHERE session_id = ?', [sessionId]);
  if (existing) {
    const newCount = (existing.visits_count || 1) + 1;
    db.run('UPDATE abandoned_visits SET visits_count = ?, last_product_id = ?, last_product_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newCount, product ? product.id : existing.last_product_id, product ? product.name : existing.last_product_name, existing.id]);
    return existing;
  }
  db.run('INSERT INTO abandoned_visits (session_id, ip, last_product_id, last_product_name, visits_count) VALUES (?,?,?,?,?)',
    [sessionId, ip || '', product ? product.id : 0, product ? product.name : '', 1]);
  return null;
}

// Visitante elegível para cupom de resgate? (2+ visitas no mesmo produto)
function eligibleForRescue(sessionId, productId) {
  if (!sessionId) return false;
  const v = db.get('SELECT * FROM abandoned_visits WHERE session_id = ? AND last_product_id = ? AND coupon_offered = 0 AND visits_count >= 2', [sessionId, productId]);
  return !!v;
}

function markRescueOffered(sessionId, productId) {
  db.run('UPDATE abandoned_visits SET coupon_offered = 1 WHERE session_id = ? AND last_product_id = ?', [sessionId, productId]);
}

function createRescueCoupon() {
  const code = 'VOLTE' + genCode(5);
  db.run('INSERT INTO coupons (code, type, value, min_order, max_uses, used_count, active, expires_at) VALUES (?,?,?,?,?,?,?,?)',
    [code, 'percentage', 5, 80, 1, 0, 1, new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')]);
  return code;
}

// ============================================================
// 4. NOTIFICAÇÕES PUSH (web push)
// ============================================================
function savePushSubscription(endpoint, keysJson) {
  if (!endpoint) return;
  try {
    db.run('INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?,?) ON CONFLICT(endpoint) DO NOTHING',
      [endpoint, keysJson || '{}']);
  } catch (e) {}
}

function getPushSubscriptions() {
  return db.query('SELECT * FROM push_subscriptions');
}

function deletePushSubscription(endpoint) {
  db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

// ============================================================
// 5. PROVA SOCIAL (ticker de vendas + top vendidos)
// ============================================================
function logSocialProof(type, message, meta) {
  db.run('INSERT INTO social_proof (type, message, meta) VALUES (?,?,?)', [type, message || '', meta || '']);
}

function getRecentProofs(limit) {
  return db.query('SELECT * FROM social_proof ORDER BY id DESC LIMIT ?', [limit || 10]);
}

// Gera prova social a partir de vendas reais recentes
function getLiveSalesTicker() {
  const sales = db.query("SELECT s.id, s.product_name, s.buyer_name, s.city, p.image FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.status NOT IN ('cancelled','pending') ORDER BY s.id DESC LIMIT 8");
  return sales.map(s => ({
    message: '🛒 ' + (s.buyer_name || 'Cliente') + (s.city ? ' (' + s.city + ')' : '') + ' comprou ' + (s.product_name || 'um produto'),
    product: s.product_name,
    image: s.image || ''
  }));
}

function getTopSellers(limit) {
  return db.query("SELECT p.id, p.name, p.price, p.image, COUNT(s.id) as sales_count, COALESCE(SUM(s.product_price),0) as revenue FROM products p LEFT JOIN sales s ON s.product_id = p.id AND s.status NOT IN ('cancelled','pending') WHERE p.status='active' GROUP BY p.id ORDER BY sales_count DESC, revenue DESC LIMIT ?", [limit || 5]);
}

module.exports = {
  createReferral, trackReferralVisit, getReferralStats, countReferralsByCode, welcomeCouponForVisitor,
  addGiveawayEntry, getGiveawayStats, drawGiveawayWinner,
  trackAbandonedVisit, eligibleForRescue, markRescueOffered, createRescueCoupon,
  savePushSubscription, getPushSubscriptions, deletePushSubscription,
  logSocialProof, getRecentProofs, getLiveSalesTicker, getTopSellers,
  genCode, SITE_URL, SITE_NAME
};
