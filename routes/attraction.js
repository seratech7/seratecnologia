const express = require('express');
const router = express.Router();
const db = require('../database/db');
const attraction = require('../utils/attraction');
const automation = require('../utils/automation');

// ============================================================
// 1. PROGRAMA DE INDICAÇÃO
// Rota pública: /convite/CODIGO — rastreia e redireciona
// ============================================================
router.get('/convite/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  if (!code) return res.redirect('/');
  // Marca o indicador na sessão (30 dias)
  if (req.session) {
    req.session.refCode = code;
    if (!req.session.cookie) req.session.cookie = {};
    req.session.cookie.maxAge = 30 * 24 * 3600 * 1000;
  }
  attraction.trackReferralVisit(code, req.ip || '', req.sessionID || '');
  res.redirect('/?convite=' + code + '&_welcome=1');
});

// API: dados do convite + cupom de boas-vindas
router.get('/api/convite', (req, res) => {
  const code = (req.query.code || (req.session && req.session.refCode) || '').toString().toUpperCase();
  const stats = { code };
  if (code) {
    stats.visits = attraction.countReferralsByCode(code);
  }
  res.json(stats);
});

// API: gerar cupom de boas-vindas (uma vez por visitante)
router.post('/api/convite/cupom', (req, res) => {
  const code = attraction.welcomeCouponForVisitor(req.ip || '');
  if (code) res.json({ ok: true, code });
  else res.json({ ok: false, message: 'Cupom já gerado para este visitante' });
});

// ============================================================
// 2. SORTEIO AUTOMÁTICO
// ============================================================
router.post('/api/sorteio/participar', (req, res) => {
  const { name, email, whatsapp } = req.body;
  const r = attraction.addGiveawayEntry(name, email, whatsapp, req.ip || '');
  if (!r.ok) return res.json({ ok: false, error: r.error });
  // Avisa no Discord quando alguém entra
  automation.sendDiscord('🎟️ Nova participação no sorteio: ' + (name || 'Anônimo') +
    (whatsapp ? ' • WhatsApp: ' + whatsapp : '') + ' — Total: ' + attraction.getGiveawayStats().total + ' participantes').catch(() => {});
  res.json({ ok: true, total: attraction.getGiveawayStats().total });
});

router.get('/api/sorteio/stats', (req, res) => {
  res.json(attraction.getGiveawayStats());
});

// ============================================================
// 3. RECUPERAÇÃO DE VISITAS ABANDONADAS
// API chamada pelas páginas de produto via JS
// ============================================================
router.post('/api/visita', (req, res) => {
  const { productId } = req.body;
  let product = null;
  if (productId) product = db.get('SELECT id, name FROM products WHERE id = ?', [productId]);
  attraction.trackAbandonedVisit(req.sessionID || '', req.ip || '', product);
  res.json({ ok: true });
});

// Verifica se visitante é elegível a cupom de resgate
router.get('/api/visita/resgate', (req, res) => {
  const productId = parseInt(req.query.productId || '0', 10);
  const sessionId = req.sessionID || '';
  if (attraction.eligibleForRescue(sessionId, productId)) {
    res.json({ ok: true, elegivel: true });
  } else {
    res.json({ ok: true, elegivel: false });
  }
});

// Emite o cupom de resgate
router.post('/api/visita/cupom', (req, res) => {
  const productId = parseInt(req.body.productId || '0', 10);
  const sessionId = req.sessionID || '';
  if (attraction.eligibleForRescue(sessionId, productId)) {
    const code = attraction.createRescueCoupon();
    attraction.markRescueOffered(sessionId, productId);
    res.json({ ok: true, code });
  } else {
    res.json({ ok: false, message: 'Não elegível' });
  }
});

// ============================================================
// 4. NOTIFICAÇÕES PUSH
// ============================================================
// Salvar inscrição push do navegador
router.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.json({ ok: false, error: 'endpoint ausente' });
  attraction.savePushSubscription(endpoint, JSON.stringify(keys || {}));
  res.json({ ok: true });
});

// Enviar push para todos inscritos (endpoint interno, pode exigir chave)
router.post('/api/push/send', (req, res) => {
  const secret = process.env.PUSH_SECRET;
  if (secret && req.body.secret !== secret) return res.status(403).json({ ok: false, error: 'negado' });
  const { title, body, url } = req.body;
  if (!title) return res.json({ ok: false, error: 'title ausente' });
  const subs = attraction.getPushSubscriptions();
  const { sendPushNotification } = require('../utils/push');
  let sent = 0;
  for (const s of subs) {
    sendPushNotification(s, title, body || '', url || '/').then(ok => { if (ok) sent++; }).catch(() => {});
  }
  setTimeout(() => res.json({ ok: true, sent, total: subs.length }), 800);
});

// ============================================================
// 5. PROVA SOCIAL
// ============================================================
router.get('/api/social/ticker', (req, res) => {
  res.json({ ok: true, items: attraction.getLiveSalesTicker() });
});

router.get('/api/social/top', (req, res) => {
  res.json({ ok: true, items: attraction.getTopSellers(5) });
});

module.exports = router;
