const db = require('./database/db');
db.getDb().then(() => {
  const cs = db.query('SELECT id, email, password_hash FROM customers LIMIT 10');
  console.log('CLIENTES:');
  cs.forEach(c => console.log('  id=' + c.id + ' email=' + (c.email || '') + ' hash=' + ((c.password_hash || '(vazio)').slice(0, 7))));
  const n = db.get('SELECT COUNT(*) c FROM customers');
  console.log('total clientes:', n.c);
  const na = db.get("SELECT COUNT(*) c FROM users_auth WHERE uid LIKE 'customer:%'");
  console.log('users_auth de customer:', na.c);
}).catch(e => { console.error(e); process.exit(1); });
