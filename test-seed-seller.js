const db = require('./database/db');
const bcrypt = require('bcryptjs');

(async () => {
  await db.initDb();
  const email = 'vend_teste_completo@teste.com';
  const pw = 'venda123';
  let seller = db.get('SELECT id FROM sellers WHERE email = ?', [email]);
  let sellerId;
  if (seller) {
    sellerId = seller.id;
    db.run('UPDATE sellers SET password_hash = ?, status = ? WHERE id = ?', [bcrypt.hashSync(pw, 10), 'active', sellerId]);
  } else {
    db.run('INSERT INTO sellers (name, email, password_hash, status) VALUES (?, ?, ?, ?)',
      ['Vendedor Teste Completo', email, bcrypt.hashSync(pw, 10), 'active']);
    sellerId = db.lastRowId();
  }
  const uid = 'seller:' + sellerId;
  const ua = db.get('SELECT * FROM users_auth WHERE uid = ?', [uid]);
  if (!ua) {
    db.createUserAuth(uid, 'seller', bcrypt.hashSync(pw, 10), '', 1);
  }
  console.log('SELLER_EMAIL=' + email + ' SELLER_PW=' + pw + ' SELLER_ID=' + sellerId);
  await db.saveDb();
  process.exit(0);
})().catch(e => { console.error('SEED ERROR', e); process.exit(1); });
