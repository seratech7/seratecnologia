const db = require('./database/db');
(async () => {
  try { await db.initDb(); } catch (e) { console.log('init err', e.message); }
  try {
    db.saveNews({ title: 'Teste Hacking', slug: 'teste-hacking', excerpt: 'ex1', content: 'c1', category: 'Hacking', image: '', author: 'dev', featured: 0, published: 1 });
    db.saveNews({ title: 'Teste Games', slug: 'teste-games', excerpt: 'ex2', content: 'c2', category: 'Games', image: '', author: 'dev', featured: 0, published: 1 });
    db.saveDb();
    console.log('seeded. news=', (db.getNews({ limit: 50 }) || []).length, 'cats=', (db.getNewsCategories() || []).map(c => c.category));
  } catch (e) { console.log('seed err', e.message); }
})();
