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

  // 3) Atualização da DB periodicamente (backup já é feito no server)
  console.log('[auto] Agendador iniciado (ping a cada ' + PING_INTERVAL + 'h, promoção diária às ' + PROMOTE_HOUR + ':00, anúncio às ' + ANN_HOUR + ':00)');
}

module.exports = { startScheduler, autoIndexNewProducts, autoPromoteDaily, announceNewProduct: automation.announceNewProduct };