const db = require('./database/db');

(async () => {
  await db.initDb();

  // Insere notícia de teste
  const newsId = db.saveNews({
    title: 'Teste Noticia Mercado',
    slug: 'teste-noticia-mercado',
    excerpt: 'Resumo da notícia de teste para validação.',
    content: '<p>Conteúdo de teste da notícia. <strong>Games & Hacking</strong>.</p>',
    category: 'jogos',
    image: '',
    author: 'Redação',
    featured: 1,
    published: 1
  });
  console.log('News inserted id:', newsId);

  // Insere produto digital de teste
  const prodId = db.saveDigitalProduct({
    name: 'Teste Login Netflix',
    slug: 'teste-login-netflix',
    description: 'Conta de teste com entrega automática.',
    price: 9.90,
    category: 'streaming',
    image: '',
    badge: 'Teste',
    status: 'active'
  });
  console.log('Digital product inserted id:', prodId);

  // Insere estoque disponível
  db.addDigitalStock(prodId, 'usuario_teste@exemplo.com', 'senha123', 'Acesso de teste');
  console.log('Stock added');

  db.saveDb();
  console.log('DB saved');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
