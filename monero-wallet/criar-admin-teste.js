require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database/db');

(async () => {
  await db.initDb();
  const username = 'teste';
  const password = 'TesteAdmin123!';
  const existing = db.get('SELECT * FROM admins WHERE username = ?', [username]);
  if (existing) {
    db.run('UPDATE admins SET password_hash = ?, display_name = ? WHERE id = ?', [bcrypt.hashSync(password, 12), 'Admin Teste', existing.id]);
    console.log('Admin de teste atualizado.');
  } else {
    db.run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', [username, bcrypt.hashSync(password, 12), 'Admin Teste']);
    console.log('Admin de teste criado.');
  }
  console.log('Login: ' + username + ' / ' + password);
  db.saveDb();
  process.exit(0);
})();