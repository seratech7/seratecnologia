const bcrypt = require('bcryptjs');
const db = require('./database/db');
db.getDb().then(() => {
  const email = 'test_login_fix@test.com';
  let c = db.get('SELECT id FROM customers WHERE email = ?', [email]);
  if (!c) {
    const hash = bcrypt.hashSync('minhaSenha99', 10);
    db.run('INSERT INTO customers (name, email, password_hash, status, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))', ['Teste Fix', email, hash, 'active']);
    c = db.get('SELECT id FROM customers WHERE email = ?', [email]);
  }
  const uid = 'customer:' + c.id;
  let ua = db.getUserAuth(uid);
  if (!ua) {
    const fakeArgon = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    db.run('INSERT INTO users_auth (uid, user_type, argon_hash, mfa_secret_enc, pepper_ver) VALUES (?, ?, ?, ?, ?)', [uid, 'customer', fakeArgon, '', 1]);
    console.log('INSERIDO users_auth argon2 para ' + uid);
  } else {
    console.log('users_auth ja existe para ' + uid + ' argon=' + ua.argon_hash.slice(0, 9));
  }
  console.log('TEST CUSTOMER id=' + c.id + ' email=' + email);
}).catch(e => { console.error(e); process.exit(1); });
