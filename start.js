require('dotenv').config();
const crypto = require('crypto');
const { initDb, get, run } = require('./database/db');

const products = [
  { name: "SSD Kingston NV2 1TB NVMe M.2", price: 349.90, cat: "ssds", cond: "novo", desc: "SSD Kingston NV2 1TB PCIe 4.0 NVMe — leitura 3500MB/s, escrita 2100MB/s." },
  { name: "HD Seagate Barracuda 2TB 3.5\"", price: 289.90, cat: "hds-armazenamento", cond: "semi-novo", desc: "HD Seagate Barracuda 2TB, 7200RPM, 256MB cache, SATA III." },
  { name: "Memória Kingston Fury Beast 16GB DDR4", price: 179.90, cat: "memoria-ram", cond: "novo", desc: "Kingston Fury Beast 16GB DDR4-3200MHz CL16." },
  { name: "Memória Corsair Vengeance 32GB DDR5", price: 589.90, cat: "memoria-ram", cond: "novo", desc: "Corsair Vengeance 32GB (2x16GB) DDR5-5200MHz." },
  { name: "SSD Samsung 870 EVO 500GB SATA", price: 259.90, cat: "ssds", cond: "semi-novo", desc: "SSD Samsung 870 EVO 500GB SATA III. Leitura 560MB/s." },
  { name: "HD WD Blue 1TB 3.5\"", price: 219.90, cat: "hds-armazenamento", cond: "usado", desc: "HD WD Blue 1TB, 7200RPM, 64MB cache." },
  { name: "SSD Crucial P3 Plus 1TB NVMe", price: 419.90, cat: "ssds", cond: "novo", desc: "Crucial P3 Plus 1TB PCIe 4.0 NVMe. Leitura 5000MB/s." },
  { name: "Memória XPG Spectrix D35G 8GB DDR4", price: 109.90, cat: "memoria-ram", cond: "novo", desc: "XPG Spectrix D35G 8GB DDR4-3200MHz com RGB." },
  { name: "SSD Kingston A400 240GB SATA", price: 139.90, cat: "ssds", cond: "usado", desc: "SSD Kingston A400 240GB SATA III. Upgrade de baixo custo." },
  { name: "HD Seagate IronWolf 4TB NAS", price: 529.90, cat: "hds-armazenamento", cond: "semi-novo", desc: "Seagate IronWolf 4TB NAS, 5900RPM, 64MB cache." },
  { name: "Kit Memória Kingston Fury 32GB DDR5", price: 459.90, cat: "memoria-ram", cond: "novo", desc: "Kit Kingston Fury Beast 32GB (2x16GB) DDR5-5600MHz." },
  { name: "SSD WD Green 240GB SATA", price: 149.90, cat: "ssds", cond: "semi-novo", desc: "WD Green 240GB SATA III. SSD básico com baixo consumo." },
  { name: "HD Toshiba P300 3TB 3.5\"", price: 339.90, cat: "hds-armazenamento", cond: "novo", desc: "Toshiba P300 3TB, 7200RPM, 64MB cache." },
  { name: "Kit Corsair Vengeance LPX 16GB DDR4", price: 209.90, cat: "memoria-ram", cond: "novo", desc: "Corsair Vengeance LPX 16GB (2x8GB) DDR4-3200MHz CL16." },
  { name: "SSD Samsung 990 Pro 2TB NVMe", price: 1299.90, cat: "ssds", cond: "novo", desc: "Samsung 990 Pro 2TB PCIe 4.0 NVMe. Leitura 7450MB/s." },
  { name: "HD Seagate Expansion 5TB Externo", price: 459.90, cat: "hds-armazenamento", cond: "semi-novo", desc: "Seagate Expansion 5TB USB 3.0. Portátil plug-and-play." },
  { name: "Memória Kingston HyperX Fury 8GB DDR3", price: 79.90, cat: "memoria-ram", cond: "usado", desc: "HyperX Fury 8GB DDR3-1866MHz CL10." },
  { name: "SSD Crucial BX500 480GB SATA", price: 199.90, cat: "ssds", cond: "novo", desc: "Crucial BX500 480GB SATA III. Excelente custo-benefício." },
  { name: "HD WD Purple 2TB 3.5\"", price: 299.90, cat: "hds-armazenamento", cond: "novo", desc: "WD Purple 2TB surveillance drive AllFrame Technology." },
  { name: "Kit G.Skill Trident Z5 64GB DDR5", price: 1199.90, cat: "memoria-ram", cond: "novo", desc: "G.Skill Trident Z5 64GB (2x32GB) DDR5-6000MHz CL30." }
];

const imageFiles = [
  "prod1.jpg","prod2.jpg","prod3.jpg","prod4.webp","prod5.jpg",
  "prod6.jpg","prod7.jpg","prod8.png","prod9.jpg","prod10.jpg",
  "prod11.jpg","prod12.jpg","prod13.jpg","prod14.jpg","prod15.jpg",
  "prod16.jpg","prod17.jpg","prod18.jpg","prod19.png","prod20.jpg"
];

const locations = ["São Paulo, SP","Rio de Janeiro, RJ","Belo Horizonte, MG","Curitiba, PR","Porto Alegre, RS","Brasília, DF","Salvador, BA","Campinas, SP"];

async function start() {
  await initDb();
  const sellerCount = get('SELECT COUNT(*) as count FROM sellers');
  let sellerId = null;
  if (!sellerCount || sellerCount.count === 0) {
    const bcrypt = require('bcryptjs');
    const sellerPass = 'seller' + crypto.randomBytes(3).toString('hex');
    const hash = bcrypt.hashSync(sellerPass, 12);
    run("INSERT INTO sellers (name, email, phone, password_hash, bio, sales_count, whatsapp, status) VALUES (?,?,?,?,?,?,?,?)",
      ['SeraTecnologia Store', 'vendas@seratecnologia.com', '(11) 99999-8888', hash,
       'Loja oficial SeraTecnologia — especializada em hardware, componentes e periféricos. Qualidade e confiança desde 2026.',
       45, '5511999998888', 'active']);
    sellerId = get('SELECT id FROM sellers ORDER BY id DESC LIMIT 1').id;
    console.log('👤 Vendedor padrão criado! Senha: ' + sellerPass);
    console.log('⚠️  Anote esta senha! Ela não será mostrada novamente.');
  } else {
    sellerId = get('SELECT id FROM sellers ORDER BY id ASC LIMIT 1').id;
  }

  const existing = get('SELECT COUNT(*) as count FROM products');
  if (!existing || existing.count === 0) {
    console.log('🌱 Primeira execução — semeando produtos...');
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const cat = get('SELECT id FROM categories WHERE slug = ?', [p.cat]);
      const catId = cat ? cat.id : 12;
      const loc = locations[Math.floor(Math.random() * locations.length)];
      run('INSERT INTO products (name,description,price,category_id,seller_id,image,status,featured,condition,location,code) VALUES (?,?,?,?,?,?,?,?,?,?,"")',
        [p.name, p.desc, p.price, catId, sellerId, '/uploads/' + imageFiles[i], 'active', i < 4 ? 1 : 0, p.cond, loc]);
      var lastId = get('SELECT MAX(id) as id FROM products');
      if (lastId) run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [lastId.id, lastId.id]);
      console.log(`  ${i+1}. ${p.name}`);
    }
    console.log(`✅ ${products.length} produtos inseridos!`);
  }
  require('./server');
}
start().catch(e => { console.error('Fatal:', e); process.exit(1); });
