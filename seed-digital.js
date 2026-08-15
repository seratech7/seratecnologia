const db = require('./database/db');

const products = [
  { name: 'Netflix Premium 4K - 30 Dias (Entrega Automática)', slug: 'netflix-premium-4k', category: 'Assinaturas e Premium', price: 10.99, badge: 'ENTREGA 24H', description: 'NETFLIX TELA 4k ULTRA HD 30 DIAS. Conta compartilhada, 1 dispositivo. Garantia e suporte 30 dias. Entrega automática dos dados de acesso.', img: 'https://dfgmax.com.br/repo/images/mSJZkAE.png', stock: 50 },
  { name: 'Prime Video Tela - 30 Dias (Entrega Automática)', slug: 'prime-video-tela', category: 'Assinaturas e Premium', price: 7.99, badge: 'ENTREGA AUTOMÁTICA', description: 'TELA PRIME VIDEO - 30 DIAS. Suporte durante 30 dias. Acesso aos melhores conteúdos.', img: 'https://dfgmax.com.br/repo/images/tUD0iOk.jpg', stock: 40 },
  { name: 'Tela HBO Max 30 Dias (Entrega Automática)', slug: 'hbomax-tela', category: 'Assinaturas e Premium', price: 6.99, badge: 'ENTREGA AUTOMÁTICA', description: 'TELA HBOMAX 30 DIAS. Entrega automática. Receba diretamente aqui no site e seu email.', img: 'https://dfgmax.com.br/repo/images/v40O3Yd.jpg', stock: 35 },
  { name: 'ChatGPT Plus - Assinatura Mensal', slug: 'chatgpt-plus', category: 'Assinaturas e Premium', price: 20.00, badge: '30 DIAS', description: 'Chat GPT-4 Plus. 30 dias de garantia. Assinatura mensal funcional.', img: 'https://dfgmax.com.br/repo/images/a34bTi6.png', stock: 60 },
  { name: 'Youtube Premium + Music (Não Necessário da Senha)', slug: 'youtube-premium-music', category: 'Assinaturas e Premium', price: 8.99, badge: 'ENTREGA AUTOMÁTICA', description: 'YOUTUBE PREMIUM + MUSIC. Acesso sem necessidade de senha.', img: 'https://dfgmax.com.br/repo/images/x4KUNzq.jpeg', stock: 45 },
  { name: 'Spotify Premium Individual - 30 Dias', slug: 'spotify-premium', category: 'Assinaturas e Premium', price: 6.99, badge: 'ENTREGA 24H', description: 'Spotify Premium Individual. Entrega 24H, acesso imediato.', img: 'https://dfgmax.com.br/repo/images/7mdfwPa.png', stock: 70 },
  { name: 'Disney+ Star ESPN Completo - 30 Dias', slug: 'disney-plus-star', category: 'Assinaturas e Premium', price: 10.99, badge: 'ENTREGA AUTOMÁTICA', description: 'DISNEY PREMIUM + STAR + ESPN COMPLETO. 30 dias de acesso.', img: 'https://dfgmax.com.br/repo/images/Ue3pZiE.png', stock: 30 },
  { name: 'CapCut PRO + 30 Dias de Uso', slug: 'capcut-pro', category: 'Assinaturas e Premium', price: 9.99, badge: 'PREMIUM', description: 'CapCut PRO + 30 dias de uso. Premium desbloqueado.', img: 'https://dfgmax.com.br/repo/images/jaZxV7T.png', stock: 25 },
  { name: 'Claro TV + (30 Dias) / Entrega Automática', slug: 'claro-tv-30', category: 'CLAROTV+', price: 5.99, badge: 'ENTREGA AUTOMÁTICA', description: 'CLARO TV + 30 dias. Entrega automática dos dados de acesso.', img: 'https://dfgmax.com.br/repo/images/frT58bu.png', stock: 20 },
  { name: 'Claro TV + HBOMAX + Glob Play - 30 Dias', slug: 'claro-tv-hbomax', category: 'CLAROTV+', price: 12.99, badge: 'ENTREGA AUTOMÁTICA', description: 'CLARO TV + HBOMAX + GLOB PLAY. 30 dias de acesso.', img: 'https://dfgmax.com.br/repo/images/fkWzGBE.png', stock: 18 },
  { name: 'Claro TV + Premiere + Glob Play', slug: 'claro-tv-premiere', category: 'CLAROTV+', price: 15.99, badge: 'ENTREGA AUTOMÁTICA', description: 'CLARO TV + PREMIERE + GLOB PLAY. 30 dias.', img: 'https://dfgmax.com.br/repo/images/NxemiPc.png', stock: 15 },
  { name: 'Combo Exclusivo - Netflix + Disney + ESPN (30 Dias)', slug: 'combo-exclusivo', category: 'COMBO DO DIA', price: 17.99, badge: 'COMBO', description: 'COMBO EXCLUSIVO - NETFLIX + DISNEY + ESPN + STAR incluso. 30 dias de acesso.', img: 'https://dfgmax.com.br/repo/images/sZoYch4.png', stock: 22 },
  { name: 'Spotify Individual + HBO Max', slug: 'spotify-hbo', category: 'COMBO DO DIA', price: 12.99, badge: 'COMBO', description: 'SPOTIFY INDIVIDUAL + HBO MAX. 30 dias.', img: 'https://dfgmax.com.br/repo/images/S1QPewx.png', stock: 28 },
  { name: 'Prime Video + Paramount', slug: 'prime-paramount', category: 'COMBO DO DIA', price: 14.99, badge: 'COMBO', description: 'PRIME VIDEO + PARAMOUNT. 30 dias de acesso.', img: 'https://dfgmax.com.br/repo/images/gwZkH6y.png', stock: 19 },
  { name: 'Conta Google Completa (Email + Drive + Fotos)', slug: 'conta-google-completa', category: 'Contas Completas', price: 9.99, badge: 'CONTA', description: 'Conta Google completa com email, drive e fotos. Acesso entregue automaticamente.', img: 'https://dfgmax.com.br/repo/images/FyUqIhM.jpeg', stock: 33 },
  { name: 'Conta Microsoft Office 365 - 1 Mês', slug: 'office-365', category: 'Contas Completas', price: 5.99, badge: 'CONTA', description: 'Microsoft Office 365 / 1 mês. Ativação no seu email.', img: 'https://dfgmax.com.br/repo/images/eASkXsI.png', stock: 40 },
  { name: 'Adobe Creative Cloud', slug: 'adobe-creative', category: 'Serviços digitais', price: 17.99, badge: 'SERVIÇO', description: 'Adobe Creative Cloud completo. Acesso por 30 dias.', img: 'https://dfgmax.com.br/repo/images/w9xonDh.jpeg', stock: 26 },
  { name: 'Canva PRO em Sua Conta - 30 Dias', slug: 'canva-pro', category: 'Serviços digitais', price: 4.99, badge: 'SERVIÇO', description: 'CANVA PRO em sua conta via link convite. 30 dias.', img: 'https://dfgmax.com.br/repo/images/q9uExth.jpg', stock: 55 },
  { name: 'Tinder Gold - 1 Mês', slug: 'tinder-gold', category: 'Serviços digitais', price: 35.99, badge: 'SERVIÇO', description: 'TINDER GOLD - 1 mês de acesso.', img: 'https://dfgmax.com.br/repo/images/Tv5hdSk.jpeg', stock: 12 },
  { name: 'Kindle Unlimited Amazon', slug: 'kindle-unlimited', category: 'Assinaturas e Premium', price: 12.99, badge: 'ENTREGA AUTOMÁTICA', description: 'Kindle Unlimited Amazon. 30 dias de leitura ilimitada.', img: 'https://dfgmax.com.br/repo/images/w9xonDh.jpeg', stock: 21 },
  { name: 'Glob Play Canais + Premier + Telecine', slug: 'globplay-premier', category: 'Assinaturas e Premium', price: 20.00, badge: 'ENTREGA AUTOMÁTICA', description: 'GLOB PLAY CANAIS + PREMIER + TELECINE. 30 dias.', img: 'https://dfgmax.com.br/repo/images/QjefsXh.png', stock: 17 },
  { name: 'Crunchyroll Premium 2 Meses', slug: 'crunchyroll-2m', category: 'Assinaturas e Premium', price: 15.99, badge: 'ENTREGA AUTOMÁTICA', description: 'CRUNCHYROLL PREMIUM 2 MESES. Entrega automática.', img: 'https://dfgmax.com.br/repo/images/gimuC9T.png', stock: 24 },
  { name: 'Apple Music Conta Privada - 30 Dias', slug: 'apple-music', category: 'Assinaturas e Premium', price: 5.99, badge: 'ENTREGA AUTOMÁTICA', description: 'APPLE MUSIC CONTA PRIVADA. 30 dias de acesso.', img: 'https://dfgmax.com.br/repo/images/lYEOF3j.png', stock: 38 },
  { name: 'Monte Seu Combo (Combo Básico)', slug: 'monte-combo-basico', category: 'COMBO DO DIA', price: 22.99, badge: 'COMBO', description: 'MONTE SEU COMBO básico. Escolha seus acessos.', img: 'https://dfgmax.com.br/repo/images/dbz6xVo.png', stock: 16 }
];

db.initDb().then(function () {
  let inserted = 0;
  products.forEach(function (p) {
    try {
      const id = db.saveDigitalProduct({
        name: p.name, slug: p.slug, description: p.description,
        price: p.price, category: p.category, image: p.img, badge: p.badge, status: 'active'
      });
      for (let i = 0; i < p.stock; i++) {
        db.run('INSERT INTO digital_stock (product_id, credential, password, status) VALUES (?,?,?,?)',
          [id, 'login_' + p.slug + '_' + i, 'senha_' + (1000 + i), 'available']);
      }
      inserted++;
    } catch (e) {
      console.log('Erro ao inserir ' + p.slug + ': ' + e.message);
    }
  });
  db.saveDb();
  console.log('Produtos digitais inseridos: ' + inserted);
}).catch(function (e) {
  console.error('Falha ao inicializar DB:', e);
});
