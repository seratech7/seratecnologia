require('dotenv').config();
const db = require('./database/db');
(async () => {
  await db.initDb();
  const r = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('referrals','giveaway_entries','abandoned_visits','push_subscriptions','social_proof')");
  console.log('Tabelas:', r.map(x => x.name).join(', '));
  const a = require('./utils/attraction');
  const code = a.genCode(8);
  console.log('Código referral:', code);
  a.createReferral(code, 'ip-teste');
  a.trackReferralVisit(code, 'ip-visitante', 'sessao1');
  console.log('Referral stats:', JSON.stringify(a.getReferralStats()));
  a.addGiveawayEntry('João', 'joao@x.com', '551199999', 'ip1');
  console.log('Giveaway:', JSON.stringify(a.getGiveawayStats()));
  console.log('Ticker:', JSON.stringify(a.getLiveSalesTicker()).slice(0, 200));
  console.log('attraction OK');
  process.exit(0);
})();
