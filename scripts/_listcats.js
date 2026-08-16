const db = require('../database/db');
(async () => {
  try {
    await db.initDb();
    const cats = db.query('SELECT id, name, slug FROM categories ORDER BY id');
    console.log('CATEGORIAS:');
    cats.forEach(c => console.log(c.id + ' | ' + c.slug + ' | ' + c.name));
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
})();
