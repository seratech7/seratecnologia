const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const automation = require('./automation');

const STATE_FILE = path.join(__dirname, '..', 'automation-state.json');
const PING_INTERVAL = process.env.AUTO_PING_INTERVAL || 6; // horas
const PROMOTE_HOUR = parseInt(process.env.AUTO_PROMOTE_HOUR || '9', 10);
const ANN_HOUR = parseInt(process.env.AUTO_ANN_HOUR || '18', 10);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { lastIndexedId: 0, lastPromote: null }; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) {}
}

// Indexa produtos novos automaticamente (Google + IndexNow)
async function autoIndexNewProducts() {
  try {
    const state = loadState();
    const since = state.lastIndexedId || 0;
    const products = db.query("SELECT id FROM products WHERE status='active' AND id > ? ORDER BY id ASC LIMIT 50", [since]);
    if (!products.length) return { indexed: 0, reason: 'nenhum produto novo' };

    const urls = products.map(p => automation.SITE_URL + '/produto/' + p.id);
    const indexNowRes = await automation.indexNow(urls);
    const googleRes = await automation.googleIndex(urls);

    saveState({ ...state, lastIndexedId: products[products.length - 1].id, lastIndex: new Date().toISOString() });
    console.log('[auto] Indexados ' + products.length + ' produtos novos (IndexNow: ' + (indexNowRes.ok ? 'ok' : indexNowRes.reason || '') + ', Google: ' + (googleRes.ok ? 'ok' : googleRes.reason || '') + ')');
    return { indexed: products.length, indexNow: indexNowRes, google: googleRes };
  } catch (e) {
    console.error('[auto] Erro indexando produtos:', e.message);
    return { indexed: 0, error: e.message };
  }
}

// Promoção completa diária
async function autoPromoteDaily() {
  try {
    const results = await automation.runPromote(db);
    const state = loadState();
    saveState({ ...state, lastPromote: new Date().toISOString() });
    console.log('[auto] Promoção diária executada:', results.join(' | '));
    return results;
  } catch (e) {
    console.error('[auto] Erro na promoção diária:', e.message);
    return [];
  }
}

// Sorteio automático (todo dia 1º do mês às 12h)
async function autoGiveaway() {
  try {
    const attraction = require('./attraction');
    const stats = attraction.getGiveawayStats();
    if (!stats.total) return { ok: false, reason: 'nenhum participante' };
    const winner = attraction.drawGiveawayWinner();
    console.log('[auto] Sorteio executado, vencedor:', winner ? winner.name : 'nenhum');
    return { ok: true, winner };
  } catch (e) {
    console.error('[auto] Erro no sorteio:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Envia notificações push de produtos novos (se VAPID configurado)
async function autoPushNewProducts() {
  try {
    const push = require('./push');
    if (!push.hasKeys()) return { ok: false, reason: 'VAPID não configurado' };
    const products = db.query("SELECT * FROM products WHERE status='active' ORDER BY created_at DESC LIMIT 3");
    if (!products.length) return { ok: false, reason: 'sem produtos' };
    const top = products[0];
    const res = await push.sendPushToAll('🆕 Novo produto no ' + process.env.SITE_NAME || 'Martplace', top.name + ' — confira agora!', '/produto/' + top.id);
    console.log('[auto] Push enviado:', JSON.stringify(res));
    return { ok: true, ...res };
  } catch (e) {
    console.error('[auto] Erro no push:', e.message);
    return { ok: false, reason: e.message };
  }
}

function startScheduler() {
  if (process.env.AUTO_DISABLED === 'true') {
    console.log('[auto] Agendador desativado (AUTO_DISABLED=true)');
    return;
  }

  // 1) Indexação de produtos novos a cada X horas
  setInterval(() => { autoIndexNewProducts().catch(() => {}); }, PING_INTERVAL * 3600 * 1000);
  setTimeout(() => { autoIndexNewProducts().catch(() => {}); }, 30000);

  // 2) Promoção diária no horário configurado
  function scheduleDaily(hour, fn, label) {
    function arm() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(hour, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next - now;
      console.log('[auto] ' + label + ' agendado para ' + next.toLocaleString());
      setTimeout(() => {
        fn().catch(() => {});
        arm();
      }, delay);
    }
    arm();
  }

  scheduleDaily(PROMOTE_HOUR, autoPromoteDaily, 'Promoção diária');

  // 3) Sorteio automático no dia 1º de cada mês às 12h
  function scheduleMonthly(day, hour, fn, label) {
    function arm() {
      const now = new Date();
      const next = new Date(now);
      next.setDate(day);
      next.setHours(hour, 0, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(day);
      }
      const delay = next - now;
      console.log('[auto] ' + label + ' agendado para ' + next.toLocaleString());
      setTimeout(() => {
        fn().catch(() => {});
        arm();
      }, delay);
    }
    arm();
  }
  scheduleMonthly(1, 12, autoGiveaway, 'Sorteio mensal');

  // 4) Push de novos produtos a cada 6h
  setInterval(() => { autoPushNewProducts().catch(() => {}); }, 6 * 3600 * 1000);
  setTimeout(() => { autoPushNewProducts().catch(() => {}); }, 90000);

  // 5) Atualização da DB periodicamente (backup já é feito no server)
  console.log('[auto] Agendador iniciado (ping a cada ' + PING_INTERVAL + 'h, promoção diária às ' + PROMOTE_HOUR + ':00, anúncio às ' + ANN_HOUR + ':00)');
}

module.exports = { startScheduler, autoIndexNewProducts, autoPromoteDaily, autoGiveaway, autoPushNewProducts, announceNewProduct: automation.announceNewProduct };