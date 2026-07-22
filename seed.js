require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDb, get, query, run } = require('./database/db');

const categoryMap = {
  1: 'HDs e Armazenamento', 2: 'SSDs', 3: 'Memória RAM',
  4: 'Processadores', 5: 'Placas de Vídeo', 6: 'Placas-mãe',
  7: 'Notebooks e PCs', 8: 'Monitores', 9: 'Periféricos',
  10: 'Fontes e Gabinetes', 11: 'Redes e Conectividade', 12: 'Outros'
};

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function getCategoryId(slug) {
  const cat = get('SELECT id FROM categories WHERE slug = ?', [slug]);
  return cat ? cat.id : 12;
}

const products = [
  {
    name: 'SSD Kingston NV2 1TB NVMe M.2',
    description: 'SSD Kingston NV2 1TB, interface NVMe PCIe 4.0 x4, leitura até 3500MB/s e gravação até 2800MB/s. Ideal para upgrade de desempenho em notebooks e desktops. Baixo consumo de energia e sem partes móveis.',
    price: 429.90, category_slug: 'ssds', condition: 'new',
    color: '#0066ff', icon: '⚡'
  },
  {
    name: 'HD Seagate Barracuda 2TB 3.5"',
    description: 'HD Seagate Barracuda 2TB, 7200RPM, cache 256MB, interface SATA III 6Gb/s. Armazenamento confiável para desktops e servidores domésticos. Tecnologia CMR para desempenho consistente.',
    price: 349.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#4fc3f7', icon: '💾'
  },
  {
    name: 'Memória Kingston Fury Beast 16GB DDR4',
    description: 'Memória Kingston Fury Beast 16GB (1x16GB) DDR4 3200MHz, latência CL16, 1.35V. Heat spreader preto agressivo, suporta Intel XMP e AMD Ryzen. Plug and Play automático.',
    price: 219.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#ff6f00', icon: '🧠'
  },
  {
    name: 'Memória Corsair Vengeance 32GB DDR5',
    description: 'Kit Corsair Vengeance 32GB (2x16GB) DDR5 5600MHz, latência CL40, 1.25V. Dissipador de alumínio preto, suporte Intel XMP 3.0. Desempenho extremo para gamers e criadores.',
    price: 589.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#c62828', icon: '🧠'
  },
  {
    name: 'SSD Samsung 870 EVO 500GB SATA',
    description: 'SSD Samsung 870 EVO 500GB SATA III 2.5", leitura 560MB/s, gravação 530MB/s. Controlador Samsung MKX, V-NAND 3-bit MLC. Software Samsung Magician incluso.',
    price: 319.90, category_slug: 'ssds', condition: 'semi-new',
    color: '#1565c0', icon: '⚡'
  },
  {
    name: 'HD WD Blue 1TB 3.5"',
    description: 'HD Western Digital Blue 1TB, 7200RPM, cache 64MB, SATA III. Solução confiável para armazenamento do dia a dia. Baixo consumo e operação silenciosa. Garantia de 2 anos.',
    price: 279.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#2196f3', icon: '💾'
  },
  {
    name: 'SSD Crucial P3 Plus 1TB NVMe',
    description: 'SSD Crucial P3 Plus 1TB, PCIe 4.0 NVMe M.2, leitura 5000MB/s, gravação 3600MB/s. Tecnologia 3D NAND avançada, ideal para jogos pesados e edição de vídeo 4K.',
    price: 499.90, category_slug: 'ssds', condition: 'new',
    color: '#00bcd4', icon: '⚡'
  },
  {
    name: 'Memória XPG Spectrix D35G 8GB DDR4',
    description: 'Memória XPG Spectrix D35G 8GB DDR4 3200MHz, latência CL16-20-20. LED RGB customizável, dissipador de alumínio prateado. Suporte Intel e AMD.',
    price: 119.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#e91e63', icon: '🧠'
  },
  {
    name: 'SSD Kingston A400 240GB SATA',
    description: 'SSD Kingston A400 240GB SATA III 2.5", leitura 500MB/s, gravação 350MB/s. Perfeito para dar vida nova a computadores antigos. Inicialização do sistema em segundos.',
    price: 179.90, category_slug: 'ssds', condition: 'semi-new',
    color: '#607d8b', icon: '⚡'
  },
  {
    name: 'HD Seagate IronWolf 4TB NAS',
    description: 'HD Seagate IronWolf 4TB NAS 3.5", 5900RPM, cache 256MB. Projetado para sistemas NAS com até 8 baias. Tecnologia AgileArray e RV sensors. Garantia 3 anos.',
    price: 569.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#795548', icon: '💾'
  },
  {
    name: 'Kit Memória Kingston Fury 32GB DDR5',
    description: 'Kit Kingston Fury Beast 32GB (2x16GB) DDR5 5200MHz, latência CL40. Dissipador de calor preto, overclock automático Plug N Play. Suporte Intel XMP 3.0 e AMD EXPO.',
    price: 549.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#ff8f00', icon: '🧠'
  },
  {
    name: 'SSD WD Green 240GB SATA',
    description: 'SSD WD Green 240GB SATA III 2.5", leitura 545MB/s. Armazenamento básico confiável para escritório e estudos. Baixíssimo consumo de energia, opera silenciosamente.',
    price: 199.90, category_slug: 'ssds', condition: 'used',
    color: '#4caf50', icon: '⚡'
  },
  {
    name: 'HD Toshiba P300 3TB 3.5"',
    description: 'HD Toshiba P300 3TB, 7200RPM, cache 64MB, SATA III 6Gb/s. Alta capacidade para jogos e mídia. Operação silenciosa e confiável para uso desktop.',
    price: 429.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#9e9e9e', icon: '💾'
  },
  {
    name: 'Kit Corsair Vengeance LPX 16GB DDR4',
    description: 'Kit Corsair Vengeance LPX 16GB (2x8GB) DDR4 3200MHz, latência CL16. Perfil baixo para compatibilidade com coolers grandes. Suporte Intel XMP 2.0. Testado individualmente.',
    price: 239.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#d32f2f', icon: '🧠'
  },
  {
    name: 'SSD Samsung 990 Pro 2TB NVMe',
    description: 'SSD Samsung 990 Pro 2TB, PCIe 4.0 NVMe M.2, leitura 7450MB/s, gravação 6900MB/s. Controlador Samsung Pascal, V-NAND 3-bit TLC. Dissipador de calor incluído.',
    price: 1299.90, category_slug: 'ssds', condition: 'new',
    color: '#0d47a1', icon: '⚡'
  },
  {
    name: 'HD Seagate Expansion 5TB Externo',
    description: 'HD Externo Seagate Expansion 5TB USB 3.0, portátil. Plug and Play, sem necessidade de fonte externa. Backup automático com software Seagate Toolkit incluído.',
    price: 649.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#3f51b5', icon: '💾'
  },
  {
    name: 'Memória Kingston HyperX Fury 8GB DDR3',
    description: 'Memória Kingston HyperX Fury 8GB DDR3 1866MHz, latência CL10. Ideal para upgrades de PCs mais antigos. Dissipador preto, baixo perfil. Plug and Play automático.',
    price: 89.90, category_slug: 'memoria-ram', condition: 'used',
    color: '#546e7a', icon: '🧠'
  },
  {
    name: 'SSD Crucial BX500 480GB SATA',
    description: 'SSD Crucial BX500 480GB SATA III 2.5", leitura 540MB/s. Inicialização rápida e aplicativos responsivos. Tecnologia 3D NAND, eficiência energética superior.',
    price: 269.90, category_slug: 'ssds', condition: 'semi-new',
    color: '#009688', icon: '⚡'
  },
  {
    name: 'HD WD Purple 2TB 3.5"',
    description: 'HD Western Digital Purple 2TB 3.5", 5400RPM, cache 64MB. Especial para sistemas de vigilância e CFTV. Suporta até 64 câmeras, tecnologia AllFrame para redução de perda de frames.',
    price: 399.90, category_slug: 'hds-armazenamento', condition: 'new',
    color: '#7b1fa2', icon: '💾'
  },
  {
    name: 'Kit G.Skill Trident Z5 64GB DDR5',
    description: 'Kit G.Skill Trident Z5 RGB 64GB (2x32GB) DDR5 6000MHz, latência CL30. Iluminação RGB customizável, dissipador de alumínio preto e prata. Perfil Intel XMP 3.0.',
    price: 1199.90, category_slug: 'memoria-ram', condition: 'new',
    color: '#ffd700', icon: '🧠'
  }
];

function generateSvg(name, color, icon, index) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${color};stop-opacity:0.15"/>
      <stop offset="100%" style="stop-color:${color};stop-opacity:0.30"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="${color}" rx="8"/>
  <rect width="400" height="300" fill="url(#bg)" rx="8"/>
  <text x="200" y="100" text-anchor="middle" font-size="64" fill="white" opacity="0.9">${icon}</text>
  <text x="200" y="160" text-anchor="middle" font-size="14" fill="white" opacity="0.6" font-family="Arial, sans-serif">${name}</text>
  <rect x="120" y="190" width="160" height="40" rx="20" fill="white" opacity="0.15"/>
  <text x="200" y="216" text-anchor="middle" font-size="16" fill="white" opacity="0.8" font-family="Arial, sans-serif" font-weight="bold">VER PRODUTO</text>
</svg>`;
}

async function seed() {
  console.log('Inicializando banco...');
  await initDb();

  const catIdCache = {};
  for (const p of products) {
    if (!catIdCache[p.category_slug]) {
      catIdCache[p.category_slug] = getCategoryId(p.category_slug);
    }
  }

  console.log('Limpando produtos existentes...');
  run('DELETE FROM products');

  const uploadDir = path.join(__dirname, 'public', 'uploads');

  let count = 0;
  for (const p of products) {
    count++;
    const catId = catIdCache[p.category_slug];
    const filename = `prod${count}-${slugify(p.name).slice(0, 30)}.svg`;
    const filepath = path.join(uploadDir, filename);

    const svg = generateSvg(p.name, p.color, p.icon, count);
    fs.writeFileSync(filepath, svg);

    const imagePath = '/uploads/' + filename;
    const locationList = ['São Paulo, SP', 'Rio de Janeiro, RJ', 'Belo Horizonte, MG', 'Curitiba, PR', 'Porto Alegre, RS', 'Brasília, DF', 'Salvador, BA', 'Campinas, SP'];
    const location = locationList[Math.floor(Math.random() * locationList.length)];

    run(
      `INSERT INTO products (name, description, price, category_id, image, status, featured, condition, location)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        p.name,
        p.description,
        p.price,
        catId,
        imagePath,
        count <= 4 ? 1 : 0,
        p.condition,
        location
      ]
    );

    console.log(`  ${count}. ${p.name} — R$ ${p.price.toFixed(2)}`);
  }

  console.log(`\n✅ ${count} produtos inseridos com sucesso!`);
  console.log('📸 Imagens SVG geradas em public/uploads/');
  process.exit(0);
}

seed().catch(e => {
  console.error('Erro:', e);
  process.exit(1);
});
