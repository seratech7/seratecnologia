// Seed que SUBSTITUI todos os produtos do marketplace por 40 produtos realistas.
// Imagens: foto REAL de cada modelo resolvida via Wikipedia (upload.wikimedia.org,
// hotlink-friendly). Se não houver artigo, cai para LoremFlickr por categoria.
// No servidor de produção, use "Baixar imagens externas" na Galeria de Imagens
// (/admin/galeria) para armazená-las localmente.
const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));

const CAT_TAGS = {
  'notebooks-pcs': 'gaming,laptop',
  'celulares': 'smartphone,gaming',
  'perifericos': 'gaming,keyboard',
  'memoria-ram': 'ram,memory',
  'ssds': 'ssd',
  'hds': 'harddrive,disk',
};

function lockFor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 9000) + 1000;
}

async function resolveImage(name, cat) {
  const tags = CAT_TAGS[cat] || 'computer';
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
      encodeURIComponent(name) + '&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json';
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'MarketplaceSeed/1.0 (https://example.com; seed@seratecnologia.com)' }
    });
    const j = await resp.json();
    const pages = (j.query && j.query.pages) ? Object.values(j.query.pages) : [];
    for (const p of pages) {
      if (p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
    }
  } catch (e) { /* ignora e cai no fallback */ }
  return 'https://loremflickr.com/640/480/' + tags + '?lock=' + lockFor(name);
}

const products = [
  // ===== 10 NOTEBOOKS GAMER =====
  { name: 'Acer Nitro 5 AN515', cat: 'notebooks-pcs', price: 4299.90, featured: 1, qty: 12,
    desc: 'Notebook gamer Acer Nitro 5 com Intel Core i5-12450H, GeForce RTX 3050 4GB, 16GB DDR4 e SSD NVMe 512GB. Tela Full HD 144Hz para jogos fluidos, teclado retroiluminado RGB e sistema de resfriamento dual-fan. Ideal para titles competitivos e produtividade.' },
  { name: 'Lenovo Legion 5', cat: 'notebooks-pcs', price: 5999.90, featured: 1, qty: 8,
    desc: 'Lenovo Legion 5 equipado com AMD Ryzen 7 6800H, RTX 3060 6GB, 16GB DDR5 e SSD 512GB. Tela WQHD 165Hz com cores precisas, construção robusta em alumínio e resfriamento ColdFront para sessões longas sem throttling.' },
  { name: 'ASUS TUF Gaming A15', cat: 'notebooks-pcs', price: 4899.90, featured: 0, qty: 10,
    desc: 'ASUS TUF Gaming A15 com Ryzen 7 7735HS, RTX 4050 6GB, 16GB DDR5 e SSD 512GB. Certificado militar MIL-STD-810H, teclado resistente a derrames e bateria de longa duração para gaming em qualquer lugar.' },
  { name: 'Dell G15', cat: 'notebooks-pcs', price: 4599.90, featured: 0, qty: 9,
    desc: 'Dell G15 com Intel Core i5-11260H, RTX 3050 Ti 4GB, 16GB DDR4 e SSD 512GB. Refrigeração Alienware-inspired, tela 120Hz e acabamento discreto que vai do escritório ao game.' },
  { name: 'MSI Katana GF66', cat: 'notebooks-pcs', price: 5399.90, featured: 0, qty: 6,
    desc: 'MSI Katana GF66 com Core i7-11800H, RTX 3060 6GB, 16GB DDR4 e SSD 1TB. Cooler Boost 5, teclado per-key RGB e desempenho sustentado para títulos pesados como Cyberpunk e COD.' },
  { name: 'HP Victus 15', cat: 'notebooks-pcs', price: 3999.90, featured: 0, qty: 14,
    desc: 'HP Victus 15 com Core i5-12450H, RTX 3050 4GB, 8GB DDR4 e SSD 512GB. Design clean, tela 144Hz e ótimo custo-benefício para quem quer entrar no mundo gamer.' },
  { name: 'Acer Predator Helios 300', cat: 'notebooks-pcs', price: 7499.90, featured: 1, qty: 5,
    desc: 'Acer Predator Helios 300 com Core i7-12700H, RTX 3070 8GB, 16GB DDR5 e SSD 1TB. Tela QHD 165Hz, tecnologia AeroBlade 3D e overclock de fábrica para máxima performance.' },
  { name: 'Lenovo LOQ 15', cat: 'notebooks-pcs', price: 4199.90, featured: 0, qty: 11,
    desc: 'Lenovo LOQ 15 com Core i5-12450H, RTX 3050 4GB, 12GB DDR4 e SSD 512GB. Linha focada em durabilidade e custo-benefício, com vapor chamber e BIOS gamer.' },
  { name: 'ASUS ROG Strix G15', cat: 'notebooks-pcs', price: 6899.90, featured: 0, qty: 7,
    desc: 'ASUS ROG Strix G15 com Ryzen 7 7735HS, RTX 4060 8GB, 16GB DDR5 e SSD 1TB. Tela 165Hz, iluminação Aura Sync, speakers com Dolby Atmos e chassi premium.' },
  { name: 'Samsung Galaxy Book Odyssey', cat: 'notebooks-pcs', price: 5699.90, featured: 0, qty: 6,
    desc: 'Samsung Galaxy Book Odyssey com Core i7-11800H, RTX 3050 Ti 4GB, 16GB DDR4 e SSD 512GB. Integração com o ecossistema Samsung, tela AMOLED 144Hz e corpo fino e leve.' },

  // ===== 10 CELULARES GAMER =====
  { name: 'ASUS ROG Phone 7', cat: 'celulares', price: 4999.90, featured: 1, qty: 10,
    desc: 'ASUS ROG Phone 7 com Snapdragon 8 Gen 2, 16GB RAM e 512GB. Tela AMOLED 165Hz, gatilhos ultrassônicos GameCool 7, bateria 6000mAh e refrigeração vapor chamber. O smartphone definitivo para mobile gaming.' },
  { name: 'Nubia Red Magic 8 Pro', cat: 'celulares', price: 4299.90, featured: 1, qty: 8,
    desc: 'Nubia Red Magic 8 Pro com Snapdragon 8 Gen 2, 12GB RAM e 256GB. Ventoinha interna ativa, tela sob a tela (UDC), 165Hz e gatilhos touch de 520Hz para vantagem competitiva.' },
  { name: 'POCO F5 Pro', cat: 'celulares', price: 2699.90, featured: 0, qty: 15,
    desc: 'POCO F5 Pro com Snapdragon 8+ Gen 1, 8GB RAM e 256GB. Tela AMOLED 120Hz, carregamento rápido 67W e excelente custo-benefício para jogos e uso diário.' },
  { name: 'Samsung Galaxy S23', cat: 'celulares', price: 3499.90, featured: 0, qty: 12,
    desc: 'Samsung Galaxy S23 com Snapdragon 8 Gen 2, 8GB RAM e 256GB. Tela Dynamic AMOLED 120Hz, câmera de 50MP e desempenho consistente em qualquer jogo.' },
  { name: 'Motorola Moto G84', cat: 'celulares', price: 1499.90, featured: 0, qty: 20,
    desc: 'Motorola Moto G84 com Snapdragon 695, 8GB RAM e 256GB. Tela pOLED 120Hz, bateria 5000mAh e ótimo para quem busca um celular equilibrado e acessível.' },
  { name: 'realme GT 3', cat: 'celulares', price: 2999.90, featured: 0, qty: 9,
    desc: 'realme GT 3 com Snapdragon 8+ Gen 1, 8GB RAM e 128GB. Carregamento ultra-rápido 240W, tela 144Hz e design chamativo para gamers.' },
  { name: 'ASUS ROG Phone 6', cat: 'celulares', price: 3799.90, featured: 0, qty: 7,
    desc: 'ASUS ROG Phone 6 com Snapdragon 8+ Gen 1, 12GB RAM e 256GB. Tela 165Hz AMOLED, gatilhos laterais e bateria 6000mAh com resfriamento líquido.' },
  { name: 'Nubia Red Magic 7', cat: 'celulares', price: 3299.90, featured: 0, qty: 6,
    desc: 'ZTE Nubia Red Magic 7 com Snapdragon 8 Gen 1, 12GB RAM e 128GB. Ventoinha interna, tela 165Hz e gatilhos para mobile esports.' },
  { name: 'POCO X5 Pro', cat: 'celulares', price: 1899.90, featured: 0, qty: 18,
    desc: 'POCO X5 Pro com Snapdragon 778G, 8GB RAM e 256GB. Tela AMOLED 120Hz, carregamento 67W e visual premium custo-benefício.' },
  { name: 'Samsung Galaxy A54', cat: 'celulares', price: 1799.90, featured: 0, qty: 22,
    desc: 'Samsung Galaxy A54 com Exynos 1380, 8GB RAM e 256GB. Tela Super AMOLED 120Hz, câmera OIS 50MP e bateria 5000mAh para o dia todo.' },

  // ===== 10 PERIFÉRICOS / RAM / SSD / HD =====
  { name: 'Teclado Mecânico Redragon Kumara', cat: 'perifericos', price: 249.90, featured: 0, qty: 30,
    desc: 'Teclado mecânico gamer Redragon Kumara com switches Outemu Red, iluminação RGB, layout ABNT2 e estrutura em aço. Resposta rápida e durável para horas de jogo.' },
  { name: 'Mouse Gamer Logitech G502', cat: 'perifericos', price: 329.90, featured: 1, qty: 25,
    desc: 'Mouse Logitech G502 Hero com sensor de 25.600 DPI, 11 botões programáveis, peso ajustável e iluminação RGB. Precisão de elite para FPS e MOBA.' },
  { name: 'Headset HyperX Cloud II', cat: 'perifericos', price: 399.90, featured: 0, qty: 20,
    desc: 'Headset HyperX Cloud II com som 7.1 virtual, microfone com cancelamento de ruído e almofadas memory foam. Conforto e áudio imersivo para maratonas de jogo.' },
  { name: 'Memória DDR4 16GB 3200MHz Crucial', cat: 'memoria-ram', price: 289.90, featured: 0, qty: 40,
    desc: 'Memória RAM Crucial DDR4 16GB (2x8GB) 3200MHz CL16. Plug-and-play, compatível com Intel e AMD, ideal para multitarefa e jogos atuais.' },
  { name: 'Memória DDR5 32GB 5600MHz Kingston Fury', cat: 'memoria-ram', price: 749.90, featured: 1, qty: 18,
    desc: 'Kit Kingston Fury Beast DDR5 32GB (2x16GB) 5600MHz com heatsink. Máxima largura de banda para placas Intel/AMD de nova geração.' },
  { name: 'Memória DDR4 8GB 2666MHz Corsair', cat: 'memoria-ram', price: 159.90, featured: 0, qty: 50,
    desc: 'Memória Corsair Vengeance DDR4 8GB 2666MHz. Solução econômica para upgrades rápidos e notebooks/desktops corporativos.' },
  { name: 'SSD NVMe Kingston NV2 1TB', cat: 'ssds', price: 349.90, featured: 1, qty: 35,
    desc: 'SSD Kingston NV2 1TB M.2 PCIe 4.0 com leitura de 3500MB/s e gravação de 3000MB/s. Boot instantâneo e carregamento veloz de jogos.' },
  { name: 'SSD SATA Kingston A400 480GB', cat: 'ssds', price: 199.90, featured: 0, qty: 45,
    desc: 'SSD Kingston A400 480GB SATA III com até 500MB/s. Upgrade acessível para dar nova vida a PCs mais antigos.' },
  { name: 'HD Seagate Barracuda 2TB', cat: 'hds', price: 289.90, featured: 0, qty: 30,
    desc: 'HD interno Seagate Barracuda 2TB 7200RPM SATA III com 256MB de cache. Armazenamento confiável para backups e biblioteca de mídia.' },
  { name: 'HD WD Blue 1TB', cat: 'hds', price: 219.90, featured: 0, qty: 38,
    desc: 'HD Western Digital Blue 1TB 7200RPM com tecnologia IntelliSeek para eficiência e silêncio. Ideal para armazenamento secundário.' },

  // ===== 10 COMPUTADORES BÁSICOS DE MESA =====
  { name: 'PC Desktop Core i3 8GB 240GB', cat: 'notebooks-pcs', price: 1899.90, featured: 0, qty: 15,
    desc: 'Computador de mesa com Intel Core i3, 8GB DDR4 e SSD 240GB. Pronto para navegar, estudar, trabalhar em escritório e uso familiar básico.' },
  { name: 'PC Desktop Ryzen 3 8GB 256GB', cat: 'notebooks-pcs', price: 1799.90, featured: 0, qty: 16,
    desc: 'PC montado com AMD Ryzen 3, 8GB RAM e SSD 256GB. Equilíbrio entre custo e desempenho para tarefas do dia a dia.' },
  { name: 'PC Desktop Celeron 4GB 128GB', cat: 'notebooks-pcs', price: 1199.90, featured: 0, qty: 20,
    desc: 'PC de entrada com Intel Celeron, 4GB RAM e eMMC/SSD 128GB. Perfeito para acesso à internet, e-mails e estudos leves.' },
  { name: 'PC Desktop Core i5 8GB 512GB', cat: 'notebooks-pcs', price: 2499.90, featured: 1, qty: 12,
    desc: 'PC office com Core i5, 8GB DDR4 e SSD 512GB. Produtividade rápida para home office, planilhas e reuniões.' },
  { name: 'PC Desktop Ryzen 5 8GB 1TB', cat: 'notebooks-pcs', price: 2299.90, featured: 0, qty: 13,
    desc: 'PC familiar com AMD Ryzen 5, 8GB RAM e HD/SSD 1TB. Espaço de sobra para fotos, vídeos e aplicativos do dia a dia.' },
  { name: 'Mini PC Intel N100 8GB 256GB', cat: 'notebooks-pcs', price: 1599.90, featured: 0, qty: 18,
    desc: 'Mini PC compacto com Intel N100, 8GB RAM e SSD 256GB. Silencioso e portátil, ideal para escritório e central de mídia.' },
  { name: 'PC Desktop Core i3 4GB 500GB', cat: 'notebooks-pcs', price: 1399.90, featured: 0, qty: 17,
    desc: 'PC básico com Core i3, 4GB RAM e HD 500GB. Solução econômica para uso essencial em casa ou pequenas empresas.' },
  { name: 'PC Desktop Athlon 4GB 128GB', cat: 'notebooks-pcs', price: 1099.90, featured: 0, qty: 22,
    desc: 'PC de entrada AMD Athlon com 4GB RAM e SSD 128GB. Navegação e tarefas leves com baixo consumo de energia.' },
  { name: 'PC Desktop Core i5 16GB 1TB', cat: 'notebooks-pcs', price: 2999.90, featured: 0, qty: 10,
    desc: 'PC de trabalho com Core i5, 16GB DDR4 e SSD 1TB. Multitarefa fluida para profissionais e estudos intensivos.' },
  { name: 'PC Desktop Ryzen 5 16GB 512GB', cat: 'notebooks-pcs', price: 2699.90, featured: 0, qty: 11,
    desc: 'PC familiar avançado com Ryzen 5, 16GB RAM e SSD 512GB. Desempenho sólido para toda a família e home office.' },
];

(async () => {
  try {
    await db.initDb();

    const ensureCat = (name, slug, icon) => {
      const c = db.get('SELECT id FROM categories WHERE slug = ?', [slug]);
      if (!c) db.run('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)', [name, slug, icon]);
    };
    ensureCat('Celulares', 'celulares', 'Cel');
    ensureCat('HDs e Armazenamento', 'hds', 'HD');

    const ids = db.query('SELECT id FROM products');
    ids.forEach(id => {
      db.run('DELETE FROM product_images WHERE product_id = ?', [id.id]);
      db.run('DELETE FROM reviews WHERE product_id = ?', [id.id]);
    });
    db.run('DELETE FROM products');

    let inserted = 0;
    for (const p of products) {
      const cat = db.get('SELECT id FROM categories WHERE slug = ?', [p.cat]);
      if (!cat) throw new Error('Categoria não encontrada: ' + p.cat);
      await new Promise(r => setTimeout(r, 300));
      const image = await resolveImage(p.name, p.cat);
      db.run(
        'INSERT INTO products (name, description, price, category_id, seller_id, image, status, featured, condition, location, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [p.name, p.desc, p.price, cat.id, null, image, 'active', p.featured ? 1 : 0, 'new', 'Brasil', p.qty]
      );
      inserted++;
      if (inserted % 10 === 0) console.log('  inserido ' + inserted + '/40...');
    }

    const total = db.get('SELECT COUNT(*) as c FROM products');
    const wiki = db.get("SELECT COUNT(*) as c FROM products WHERE image LIKE 'https://upload.wikimedia.org%'");
    console.log('OK: ' + inserted + ' produtos inseridos. Total: ' + total.c + ' | com foto Wikipedia: ' + wiki.c);
    process.exit(0);
  } catch (e) {
    console.error('ERRO no seed:', e.message);
    process.exit(1);
  }
})();
