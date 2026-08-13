require('dotenv').config();
const db = require('./database/db');
(async () => {
  await db.initDb();
  // Testa todos os módulos
  require('./utils/automation');
  require('./utils/attraction');
  require('./utils/scheduler');
  require('./utils/push');
  require('./routes/attraction');
  require('./routes/marketing');
  const a = require('./utils/attraction');
  const push = require('./utils/push');
  console.log('Todos os módulos carregam OK');
  console.log('Push VAPID configurado:', push.hasKeys());
  console.log('Push public key:', push.getPublicKey().slice(0, 20) + '...');
  console.log('Top sellers:', a.getTopSellers(3).length);
  console.log('Ticker:', a.getLiveSalesTicker().length);
  process.exit(0);
})();