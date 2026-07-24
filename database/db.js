const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDb() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'Admin',
      role TEXT NOT NULL DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  var adminCols = db.exec("PRAGMA table_info(admins)");
  if (adminCols.length > 0) {
    var ac = adminCols[0].values.map(function(r) { return r[1]; });
    if (!ac.includes('role')) db.run("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT,
      sales_count INTEGER DEFAULT 0,
      website TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      icon TEXT DEFAULT '📦',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const sellerInfo = db.exec("PRAGMA table_info(sellers)");
  if (sellerInfo.length > 0) {
    const cols = sellerInfo[0].values.map(r => r[1]);
    if (!cols.includes('bio')) db.run("ALTER TABLE sellers ADD COLUMN bio TEXT DEFAULT ''");
    if (!cols.includes('avatar')) db.run("ALTER TABLE sellers ADD COLUMN avatar TEXT");
    if (!cols.includes('sales_count')) db.run("ALTER TABLE sellers ADD COLUMN sales_count INTEGER DEFAULT 0");
    if (!cols.includes('website')) db.run("ALTER TABLE sellers ADD COLUMN website TEXT DEFAULT ''");
    if (!cols.includes('whatsapp')) db.run("ALTER TABLE sellers ADD COLUMN whatsapp TEXT DEFAULT ''");
    if (!cols.includes('pix_key')) db.run("ALTER TABLE sellers ADD COLUMN pix_key TEXT DEFAULT ''");
    if (!cols.includes('notify_whatsapp')) db.run("ALTER TABLE sellers ADD COLUMN notify_whatsapp TEXT DEFAULT ''");
    if (!cols.includes('notify_signal')) db.run("ALTER TABLE sellers ADD COLUMN notify_signal TEXT DEFAULT ''");
  }

  const tableInfo = db.exec("PRAGMA table_info(products)");
  const hasSellerId = tableInfo.length > 0 && tableInfo[0].values.some(row => row[1] === 'seller_id');

  if (!hasSellerId && tableInfo.length > 0) {
    db.run('DROP TABLE IF EXISTS products');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category_id INTEGER,
      seller_id INTEGER,
      image TEXT,
      code TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      featured INTEGER DEFAULT 0,
      condition TEXT DEFAULT 'new',
      location TEXT DEFAULT 'Brasil',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  var prodCols = db.exec("PRAGMA table_info(products)");
  var hasCode = prodCols.length > 0 && prodCols[0].values.some(function(r) { return r[1] === 'code'; });
  if (!hasCode) {
    db.run("ALTER TABLE products ADD COLUMN code TEXT DEFAULT ''");
  }
  db.run("UPDATE products SET code = 'PROD-' || substr('00000' || id, -5, 5) WHERE code IS NULL OR code = ''");

  var fpCols = db.exec("PRAGMA table_info(products)");
  if (fpCols.length > 0) {
    var fpNames = fpCols[0].values.map(function(r) { return r[1]; });
    if (!fpNames.includes('flash_price')) db.run("ALTER TABLE products ADD COLUMN flash_price REAL DEFAULT NULL");
    if (!fpNames.includes('flash_ends_at')) db.run("ALTER TABLE products ADD COLUMN flash_ends_at DATETIME DEFAULT NULL");
  }

  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (adminPass === 'admin123') {
    console.warn('⚠️  AVISO: Use ADMIN_PASSWORD no .env para definir uma senha forte!');
  }
  const hash = bcrypt.hashSync(adminPass, 12);
  run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, 'admin']);
  const adminCheck = db.exec("SELECT COUNT(*) as c FROM admins WHERE username = 'admin'");
  const adminCount = adminCheck.length > 0 && adminCheck[0].values.length > 0 ? adminCheck[0].values[0][0] : 0;
  if (adminCount === 0) {
    run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', ['admin', hash, 'Administrador']);
  }

  const catResult = db.exec('SELECT COUNT(*) as count FROM categories');
  const catCount = catResult.length > 0 && catResult[0].values.length > 0 ? catResult[0].values[0][0] : 0;
  if (catCount === 0) {
    const cats = [
      ['HDs e Armazenamento', 'hds-armazenamento', '💾'],
      ['SSDs', 'ssds', '⚡'],
      ['Memória RAM', 'memoria-ram', '🧠'],
      ['Processadores', 'processadores', '🔲'],
      ['Placas de Vídeo', 'placas-video', '🎮'],
      ['Placas-mãe', 'placas-mae', '🔧'],
      ['Notebooks e PCs', 'notebooks-pcs', '💻'],
      ['Monitores', 'monitores', '🖥️'],
      ['Periféricos', 'perifericos', '⌨️'],
      ['Fontes e Gabinetes', 'fontes-gabinetes', '🔌'],
      ['Redes e Conectividade', 'redes', '🌐'],
      ['Outros', 'outros', '📦'],
    ];
    for (const [name, slug, icon] of cats) {
      db.run('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)', [name, slug, icon]);
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT DEFAULT '',
      reviewer_ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      link TEXT DEFAULT '',
      image TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      display_duration INTEGER DEFAULT 15,
      cooldown INTEGER DEFAULT 86400,
      start_date TEXT,
      end_date TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const adCount = db.exec("SELECT COUNT(*) as c FROM ads");
  if (adCount.length > 0 && adCount[0].values.length > 0 && adCount[0].values[0][0] === 0) {
    const defaultAds = [
      ['SSD Kingston NV2 1TB', '<i class="fas fa-bolt"></i> SSD Kingston NV2 1TB — R$ 349,90', '/produto/1', '', 15, 86400],
      ['Memória DDR5 32GB', '<i class="fas fa-microchip"></i> Memória DDR5 32GB — R$ 589,90', '/produto/4', '', 15, 86400],
      ['HD Seagate 2TB', '<i class="fas fa-hdd"></i> HD Seagate 2TB — R$ 289,90', '/produto/2', '', 15, 86400],
      ['SSD Samsung 990 Pro', '<i class="fas fa-star"></i> SSD Samsung 990 Pro 2TB — R$ 1.299,90', '/produto/15', '', 15, 86400],
      ['Promoção SSDs', '<i class="fas fa-tags"></i> Aproveite nossas ofertas em SSDs!', '/?category=ssds', '', 20, 43200],
    ];
    defaultAds.forEach(function(ad) {
      var s = db.prepare('INSERT INTO ads (title, text, link, image, display_duration, cooldown, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
      s.bind(ad);
      s.step();
      s.free();
    });
    console.log('[db] Anúncios padrão criados');
    saveDb();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      product_id INTEGER,
      session_id TEXT,
      ip TEXT,
      referrer TEXT DEFAULT '',
      time_spent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL DEFAULT 0,
      reference_type TEXT DEFAULT '',
      reference_id INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mp_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT DEFAULT '',
      expires_at TEXT,
      mp_user_id TEXT,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  var defaultConfigs = {
    'commission_pct': '10',
    'mp_access_token': '',
    'site_name': 'SeraTecnologia',
    'site_description': 'Marketplace de Hardware e Tecnologia',
    'site_whatsapp': '',
    'site_email': 'contato@seratecnologia.com.br',
    'maintenance_mode': '0',
    'default_product_status': 'pending',
    'pix_key_platform': '',
    'max_products_per_seller': '50'
  };
  Object.keys(defaultConfigs).forEach(function(key) {
    var existing = get("SELECT value FROM config WHERE key = ?", [key]);
    if (!existing) {
      run("INSERT INTO config (key, value) VALUES (?, ?)", [key, defaultConfigs[key]]);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_price REAL NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_document TEXT NOT NULL,
      buyer_phone TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      buyer_address TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_method TEXT DEFAULT 'pix',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tracking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      bank_info TEXT DEFAULT '',
      payment_method TEXT DEFAULT 'pix',
      notes TEXT DEFAULT '',
      approved_by INTEGER,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  var sellerCols = db.exec("PRAGMA table_info(sellers)");
  if (sellerCols.length > 0) {
    var sc = sellerCols[0].values.map(function(r) { return r[1]; });
    if (!sc.includes('commission_pct')) db.run("ALTER TABLE sellers ADD COLUMN commission_pct REAL DEFAULT NULL");
    if (!sc.includes('bank_info')) db.run("ALTER TABLE sellers ADD COLUMN bank_info TEXT DEFAULT ''");
    if (!sc.includes('pix_key_recebimento')) db.run("ALTER TABLE sellers ADD COLUMN pix_key_recebimento TEXT DEFAULT ''");
  }

  var salesCols = db.exec("PRAGMA table_info(sales)");
  if (salesCols.length > 0) {
    var colNames = salesCols[0].values.map(function(r) { return r[1]; });
    if (!colNames.includes('tracking_code')) {
      db.run("ALTER TABLE sales ADD COLUMN tracking_code TEXT DEFAULT ''");
    }
    if (!colNames.includes('tracking_status')) {
      db.run("ALTER TABLE sales ADD COLUMN tracking_status TEXT DEFAULT 'pending'");
    }
    if (!colNames.includes('tracking_estimated_days')) {
      db.run("ALTER TABLE sales ADD COLUMN tracking_estimated_days INTEGER DEFAULT 10");
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sale_proofs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      caption TEXT DEFAULT '',
      status_from TEXT DEFAULT '',
      status_to TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cms_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      meta_description TEXT DEFAULT '',
      published INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'percentage',
      value REAL NOT NULL DEFAULT 0,
      min_order REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 0,
      used_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      seller_id INTEGER DEFAULT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  var couponCols = db.exec("PRAGMA table_info(coupons)");
  if (couponCols.length > 0) {
    var cc = couponCols[0].values.map(function(r) { return r[1]; });
    if (!cc.includes('seller_id')) db.run("ALTER TABLE coupons ADD COLUMN seller_id INTEGER DEFAULT NULL");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT DEFAULT '',
      image TEXT NOT NULL,
      link TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      display_duration INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  var bannerCols = db.exec("PRAGMA table_info(banners)");
  if (bannerCols.length > 0) {
    var bc = bannerCols[0].values.map(function(r) { return r[1]; });
    if (!bc.includes('display_duration')) db.run("ALTER TABLE banners ADD COLUMN display_duration INTEGER DEFAULT 10");
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_type TEXT NOT NULL DEFAULT 'system',
      user_id INTEGER DEFAULT 0,
      user_name TEXT DEFAULT '',
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      target_type TEXT DEFAULT '',
      target_id INTEGER DEFAULT 0,
      ip TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blocked_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT UNIQUE NOT NULL,
      reason TEXT DEFAULT '',
      blocked_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      icon TEXT DEFAULT 'bell',
      link TEXT DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      answer TEXT DEFAULT '',
      answered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS seller_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'sales_count',
      target_value REAL NOT NULL,
      prize_description TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS goal_winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      progress REAL DEFAULT 0,
      prize_given INTEGER DEFAULT 0,
      achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT DEFAULT '',
      UNIQUE(goal_id, seller_id)
    )
  `);

  var sCols = db.exec("PRAGMA table_info(sellers)");
  if (sCols.length > 0) {
    var sn = sCols[0].values.map(function(r) { return r[1]; });
    if (!sn.includes('notify_email_sale')) db.run("ALTER TABLE sellers ADD COLUMN notify_email_sale INTEGER DEFAULT 1");
    if (!sn.includes('notify_email_approve')) db.run("ALTER TABLE sellers ADD COLUMN notify_email_approve INTEGER DEFAULT 1");
    if (!sn.includes('notify_whatsapp_sale')) db.run("ALTER TABLE sellers ADD COLUMN notify_whatsapp_sale INTEGER DEFAULT 0");
  }

  var saCols = db.exec("PRAGMA table_info(sales)");
  if (saCols.length > 0) {
    var sc = saCols[0].values.map(function(r) { return r[1]; });
    if (!sc.includes('carrier')) db.run("ALTER TABLE sales ADD COLUMN carrier TEXT DEFAULT ''");
  }

  const orphans = db.exec("SELECT COUNT(*) as c FROM products WHERE seller_id IS NULL");
  const orphanCount = orphans.length > 0 && orphans[0].values.length > 0 ? orphans[0].values[0][0] : 0;
  if (orphanCount > 0) {
    let firstSeller = db.exec('SELECT id FROM sellers ORDER BY id ASC LIMIT 1');
    let sellerId = (firstSeller.length > 0 && firstSeller[0].values.length > 0) ? firstSeller[0].values[0][0] : null;

    if (!sellerId) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('vendedor123', 12);
      db.run("INSERT INTO sellers (name, email, password_hash, bio, sales_count, status) VALUES (?,?,?,?,?,?)",
        ['SeraTecnologia Store', 'vendas@seratecnologia.com', hash, 'Loja oficial SeraTecnologia.', 0, 'active']);
      firstSeller = db.exec('SELECT id FROM sellers ORDER BY id ASC LIMIT 1');
      sellerId = firstSeller[0].values[0][0];
      console.log('[db] Vendedor padrão criado para produtos órfãos');
    }

    db.run('UPDATE products SET seller_id = ? WHERE seller_id IS NULL', [sellerId]);
    console.log(`[db] ${orphanCount} produtos vinculados ao vendedor #${sellerId}`);
  }

  var sellerCount = db.exec("SELECT COUNT(*) as c FROM sellers");
  var numSellers = sellerCount.length > 0 && sellerCount[0].values.length > 0 ? sellerCount[0].values[0][0] : 0;
  if (numSellers < 2) {
    var testHash = require('bcryptjs').hashSync('teste123', 10);
    try {
      run("INSERT INTO sellers (name, email, phone, password_hash, bio, status) VALUES (?,?,?,?,?,?)",
        ['Vendedor Teste', 'teste@teste.com', '11999999999', testHash, 'Conta de teste.', 'active']);
      console.log('[db] Vendedor teste criado: teste@teste.com / teste123');
    } catch (e) {
      // já existe
    }
  }

  var prodCount = get("SELECT COUNT(*) as c FROM products");
  if (prodCount && prodCount.c < 3) {
    var defaultSellerId = 0;
    var ds = get("SELECT id FROM sellers ORDER BY id ASC LIMIT 1");
    if (ds) defaultSellerId = ds.id;
    var catMap = {};
    var cats = query("SELECT id, slug FROM categories");
    cats.forEach(function(c) { catMap[c.slug] = c.id; });

    var defaultProds = [
      ['SSD Kingston NV2 1TB', 'SSD NVMe M.2 Kingston NV2 1TB, leitura 3500MB/s e gravação 3000MB/s. Ideal para jogos e aplicações pesadas.', 349.90, catMap['ssds'], 'Novo', 'Brasil', 'active', 1, 'https://images.pexels.com/photos/35984425/pexels-photo-35984425.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['HD Seagate Barracuda 2TB', 'HD interno Seagate Barracuda 2TB 7200RPM SATA III 256MB cache. Armazenamento confiável para seu PC.', 289.90, catMap['hds-armazenamento'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/28461160/pexels-photo-28461160.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Memória DDR5 32GB Kingston', 'Kit 2x16GB DDR5 4800MHz Kingston Fury Beast RGB. Performance extrema para sua placa-mãe DDR5.', 589.90, catMap['memoria-ram'], 'Novo', 'Brasil', 'active', 1, 'https://images.pexels.com/photos/2582928/pexels-photo-2582928.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Processador Intel Core i7-13700K', 'Intel Core i7-13700K 16 núcleos (8P+8E) 24 threads LGA1700. Até 5.4GHz Turbo para máximo desempenho.', 2199.90, catMap['processadores'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Placa de Vídeo RTX 4060', 'NVIDIA GeForce RTX 4060 8GB GDDR6 DLSS 3. Ray Tracing e desempenho excepcional para jogos.', 1799.90, catMap['placas-video'], 'Novo', 'Brasil', 'active', 1, 'https://images.pexels.com/photos/34552802/pexels-photo-34552802.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Placa-mãe B760M', 'ASUS TUF Gaming B760M-Plus D4 LGA1700 DDR4. Conectividade completa e construção robusta.', 899.90, catMap['placas-mae'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/1029756/pexels-photo-1029756.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Monitor Gamer 27" 165Hz', 'Monitor LG UltraGear 27" IPS 165Hz 1ms GTG. Resolução Full HD com cores precisas.', 1499.90, catMap['monitores'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/1029757/pexels-photo-1029757.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Teclado Mecânico RGB', 'Teclado mecânico gamer switch azul ABNT2. 60% compacto com iluminação RGB personalizável.', 199.90, catMap['perifericos'], 'Novo', 'Brasil', 'active', 1, 'https://images.pexels.com/photos/32755742/pexels-photo-32755742.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Fonte Corsair 650W', 'Fonte ATX Corsair CV650 80 Plus Bronze 650W. Cabos modulares e proteção completa.', 349.90, catMap['fontes-gabinetes'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/2582935/pexels-photo-2582935.jpeg?auto=compress&cs=tinysrgb&w=400'],
      ['Notebook Dell Inspiron 15', 'Dell Inspiron 15" Intel Core i5 8GB RAM 256GB SSD Windows 11. Notebook completo para trabalho e estudo.', 3299.90, catMap['notebooks-pcs'], 'Novo', 'Brasil', 'active', 0, 'https://images.pexels.com/photos/1174122/pexels-photo-1174122.jpeg?auto=compress&cs=tinysrgb&w=400'],
    ];
    defaultProds.forEach(function(p) {
      run('INSERT INTO products (name, description, price, category_id, seller_id, condition, location, status, featured, image) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [p[0], p[1], p[2], p[3], defaultSellerId, p[4]||'new', p[5]||'Brasil', p[6]||'active', p[7]||0, p[8]||'']);
      var lp = get("SELECT MAX(id) as id FROM products");
      if (lp) run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [lp.id, lp.id]);
    });
    console.log('[db] Produtos padrão criados');
  }

  if (defaultSellerId > 0) {
    var testSellerProd = get("SELECT id FROM products WHERE seller_id = ? LIMIT 1", [defaultSellerId]);
    if (testSellerProd) {
      run("UPDATE products SET code = 'PROD-00001' WHERE id = ? AND (code IS NULL OR code = '')", [testSellerProd.id]);
    }
  }

  var testSale = get("SELECT COUNT(*) as c FROM sales WHERE buyer_email = 'comprador@teste.com'");
  if (testSale && testSale.c === 0) {
    var tsSeller = get("SELECT id FROM sellers WHERE email = 'teste@teste.com'") || get("SELECT id FROM sellers ORDER BY id ASC LIMIT 1");
    var tsProd = get("SELECT id, code, name, price FROM products WHERE seller_id = ? AND code != '' LIMIT 1", [tsSeller ? tsSeller.id : 0]);
    if (tsSeller && !tsProd) {
      run("INSERT INTO products (name, description, price, seller_id, status) VALUES (?, ?, ?, ?, ?)",
        ['Teclado Mecânico RGB', 'Teclado gamer switch azul ABNT2', 10, tsSeller.id, 'active']);
      var tp = get("SELECT MAX(id) as id FROM products");
      if (tp) run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [tp.id, tp.id]);
      tsProd = get("SELECT id, code, name, price FROM products WHERE seller_id = ? LIMIT 1", [tsSeller.id]);
    }
    if (tsSeller && tsProd) {
      run("INSERT INTO sales (product_id, seller_id, product_code, product_name, product_price, buyer_name, buyer_document, buyer_phone, buyer_email, buyer_address, status, payment_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [tsProd.id, tsSeller.id, tsProd.code, tsProd.name, tsProd.price, 'Comprador Teste', '000.000.000-00', '11988887777', 'comprador@teste.com', 'Rua Teste, 123', 'paid', 'pix']);
      var tsSale = get("SELECT MAX(id) as id FROM sales");
      var tsCode = gerarCodigoRastreio();
      run("UPDATE sales SET tracking_code = ?, tracking_status = 'confirmed' WHERE id = ?", [tsCode, tsSale.id]);
      createTrackingHistory(tsSale.id, 'confirmed', 'Pedido confirmado');
      var tComm = getCommissionPct(tsSeller.id);
      var tVal = 10;
      addTransaction(tsSeller.id, 'sale', 'Venda ' + tsProd.code + ' - ' + tsProd.name, tVal - (tVal * tComm / 100), 'sale', tsSale.id);
      addTransaction(0, 'commission', 'Comissão ' + tComm + '% - ' + tsProd.code, tVal * tComm / 100, 'commission', tsSale.id);
      console.log('[db] Venda teste criada: R$ 10,00');
    }
  }

  saveDb();

  return db;
}

function query(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  if (sql.trim().toUpperCase().startsWith('SELECT')) {
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } else {
    const result = stmt.run(params);
    stmt.free();
    saveDb();
    return result;
  }
}

function get(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  return query(sql, params);
}

function addNotification(ip, type, message, icon, link) {
  if (ip === 'all') {
    run('INSERT INTO notifications (ip, type, message, icon, link) VALUES (?, ?, ?, ?, ?)',
      ['', type || 'info', message, icon || 'bell', link || '']);
  } else {
    run('INSERT INTO notifications (ip, type, message, icon, link) VALUES (?, ?, ?, ?, ?)',
      [ip || '', type || 'info', message, icon || 'bell', link || '']);
  }
}

function getUnreadNotifications(ip) {
  return query("SELECT * FROM notifications WHERE (ip = ? OR ip = '') AND read = 0 ORDER BY created_at DESC LIMIT 20", [ip || '']);
}

function getNotifications(ip, limit, offset) {
  return query("SELECT * FROM notifications WHERE (ip = ? OR ip = '') ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [ip || '', limit || 50, offset || 0]);
}

function markNotificationRead(id, ip) {
  run("UPDATE notifications SET read = 1 WHERE id = ? AND (ip = ? OR ip = '')", [id, ip]);
}

function markAllNotificationsRead(ip) {
  run("UPDATE notifications SET read = 1 WHERE (ip = ? OR ip = '') AND read = 0", [ip || '']);
}

function getNotificationCount(ip) {
  var r = get("SELECT COUNT(*) as c FROM notifications WHERE (ip = ? OR ip = '') AND read = 0", [ip || '']);
  return r ? r.c : 0;
}

function addTransaction(sellerId, type, description, amount, referenceType, referenceId) {
  var last = get("SELECT balance FROM wallet_transactions WHERE seller_id = ? ORDER BY id DESC LIMIT 1", [sellerId]);
  var balance = (last ? last.balance : 0) + amount;
  run('INSERT INTO wallet_transactions (seller_id, type, description, amount, balance, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sellerId, type, description, amount, balance, referenceType || '', referenceId || 0]);
}

function getWalletBalance(sellerId) {
  var r = get("SELECT balance FROM wallet_transactions WHERE seller_id = ? ORDER BY id DESC LIMIT 1", [sellerId]);
  return r ? r.balance : 0;
}

function getWalletTransactions(sellerId, limit, offset) {
  return query("SELECT * FROM wallet_transactions WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [sellerId, limit || 50, offset || 0]);
}

function getAllTransactions(limit, offset) {
  return query("SELECT w.*, s.name as seller_name, s.email as seller_email FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id ORDER BY w.created_at DESC LIMIT ? OFFSET ?",
    [limit || 50, offset || 0]);
}

function getCommissionPct(sellerId) {
  if (sellerId) {
    var seller = get("SELECT commission_pct FROM sellers WHERE id = ?", [sellerId]);
    if (seller && seller.commission_pct !== null && seller.commission_pct !== undefined) {
      return parseFloat(seller.commission_pct);
    }
  }
  var r = get("SELECT value FROM config WHERE key = 'commission_pct'");
  return r ? parseFloat(r.value) || 10 : 10;
}

function gerarCodigoRastreio() {
  var prefix = 'ST';
  var datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  var seq = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return prefix + datePart + '-' + seq;
}

function createTrackingHistory(saleId, status, message) {
  run('INSERT INTO tracking_history (sale_id, status, message) VALUES (?, ?, ?)', [saleId, status, message || '']);
}

function getTrackingHistory(saleId) {
  return query('SELECT * FROM tracking_history WHERE sale_id = ? ORDER BY created_at ASC', [saleId]);
}

function getSaleByTrackingCode(code) {
  return get("SELECT s.*, p.name as product_name, p.image as product_image, p.price as product_price, s2.name as seller_name FROM sales s LEFT JOIN products p ON s.product_id = p.id LEFT JOIN sellers s2 ON s.seller_id = s2.id WHERE s.tracking_code = ?", [code]);
}

function getPayouts(sellerId, limit, offset) {
  if (sellerId) return query("SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?", [sellerId, limit || 50, offset || 0]);
  return query("SELECT p.*, s.name as seller_name, s.email as seller_email FROM payouts p LEFT JOIN sellers s ON p.seller_id = s.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?", [limit || 50, offset || 0]);
}

function getPayoutCount(sellerId) {
  if (sellerId) { var r = get("SELECT COUNT(*) as c FROM payouts WHERE seller_id = ?", [sellerId]); return r ? r.c : 0; }
  var r = get("SELECT COUNT(*) as c FROM payouts"); return r ? r.c : 0;
}

function getPendingPayoutsCount() {
  var r = get("SELECT COUNT(*) as c FROM payouts WHERE status = 'pending'"); return r ? r.c : 0;
}

function createPayout(sellerId, amount, bankInfo, paymentMethod) {
  var fee = Math.max(0, amount * 0.01);
  var net = amount - fee;
  run("INSERT INTO payouts (seller_id, amount, fee, net_amount, bank_info, payment_method) VALUES (?, ?, ?, ?, ?, ?)",
    [sellerId, amount, fee, net, bankInfo || '', paymentMethod || 'pix']);
  db.addTransaction(sellerId, 'payout', 'Saque solicitado - R$ ' + amount.toFixed(2), -amount, 'payout', 0);
}

function getTransactionsByPeriod(sellerId, startDate, endDate, limit, offset) {
  if (sellerId) {
    return query("SELECT * FROM wallet_transactions WHERE seller_id = ? AND date(created_at) >= ? AND date(created_at) <= ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [sellerId, startDate, endDate, limit || 500, offset || 0]);
  }
  return query("SELECT w.*, s.name as seller_name FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id WHERE date(w.created_at) >= ? AND date(w.created_at) <= ? ORDER BY w.created_at DESC LIMIT ? OFFSET ?",
    [startDate, endDate, limit || 500, offset || 0]);
}

function getFinanceSummary(sellerId, startDate, endDate) {
  if (!startDate) startDate = '2000-01-01';
  if (!endDate) endDate = '2100-01-01';
  var params = [startDate, endDate];
  var sellerClause = '';
  if (sellerId) { sellerClause = 'AND seller_id = ?'; params.unshift(sellerId); }
  var sales = get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM wallet_transactions WHERE type = 'sale' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, sellerId ? [sellerId, startDate, endDate] : [startDate, endDate]);
  var commissions = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'commission' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, sellerId ? [sellerId, startDate, endDate] : [startDate, endDate]);
  var payouts = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'payout' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, sellerId ? [sellerId, startDate, endDate] : [startDate, endDate]);
  var adjustments = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'adjustment' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, sellerId ? [sellerId, startDate, endDate] : [startDate, endDate]);
  return {
    salesTotal: sales ? sales.total : 0,
    salesCount: sales ? sales.count : 0,
    commissionsTotal: commissions ? commissions.total : 0,
    payoutsTotal: payouts ? payouts.total : 0,
    adjustmentsTotal: adjustments ? adjustments.total : 0
  };
}

function getFinanceChart(sellerId, days) {
  days = days || 30;
  var sellerClause = '';
  var params = [days];
  if (sellerId) { sellerClause = 'AND seller_id = ?'; params.push(sellerId); }
  var data = query("SELECT date(created_at) as day, type, COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE created_at >= date('now', '-' || ? || ' days') " + sellerClause + " GROUP BY day, type ORDER BY day ASC", params);
  var chart = {};
  data.forEach(function(r) {
    if (!chart[r.day]) chart[r.day] = { sale: 0, commission: 0, payout: 0, adjustment: 0 };
    chart[r.day][r.type] = r.total;
  });
  return chart;
}

function addSaleProof(saleId, sellerId, imagePath, caption, statusFrom, statusTo) {
  run('INSERT INTO sale_proofs (sale_id, seller_id, image_path, caption, status_from, status_to) VALUES (?, ?, ?, ?, ?, ?)',
    [saleId, sellerId, imagePath, caption || '', statusFrom || '', statusTo || '']);
}

function getSaleProofs(saleId) {
  return query('SELECT * FROM sale_proofs WHERE sale_id = ? ORDER BY created_at DESC', [saleId]);
}

// === CMS PAGES ===
function getPage(slug) {
  return get("SELECT * FROM cms_pages WHERE slug = ? AND published = 1", [slug]);
}

function getAllPages() {
  return query("SELECT * FROM cms_pages ORDER BY title ASC");
}

function savePage(slug, title, content, meta, published) {
  var existing = get("SELECT id FROM cms_pages WHERE slug = ?", [slug]);
  if (existing) {
    run("UPDATE cms_pages SET title = ?, content = ?, meta_description = ?, published = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?",
      [title, content, meta || '', published ? 1 : 0, slug]);
  } else {
    run("INSERT INTO cms_pages (slug, title, content, meta_description, published) VALUES (?, ?, ?, ?, ?)",
      [slug, title, content, meta || '', published ? 1 : 0]);
  }
}

function deletePage(id) {
  run("DELETE FROM cms_pages WHERE id = ?", [id]);
}

// === COUPONS ===
function getCoupon(code) {
  return get("SELECT * FROM coupons WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at >= datetime('now')) AND (max_uses = 0 OR used_count < max_uses)", [code.toUpperCase()]);
}

function getAllCoupons() {
  return query("SELECT c.*, s.name as seller_name FROM coupons c LEFT JOIN sellers s ON c.seller_id = s.id ORDER BY c.created_at DESC");
}

function saveCoupon(code, type, value, minOrder, maxUses, expiresAt, sellerId) {
  var existing = get("SELECT id FROM coupons WHERE code = ?", [code]);
  if (existing) {
    run("UPDATE coupons SET type = ?, value = ?, min_order = ?, max_uses = ?, expires_at = ?, seller_id = ? WHERE code = ?",
      [type, value, minOrder || 0, maxUses || 0, expiresAt || null, sellerId || null, code]);
  } else {
    run("INSERT INTO coupons (code, type, value, min_order, max_uses, expires_at, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [code, type, value, minOrder || 0, maxUses || 0, expiresAt || null, sellerId || null]);
  }
}

function deleteCoupon(id) {
  run("DELETE FROM coupons WHERE id = ?", [id]);
}

function incrementCoupon(id) {
  run("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [id]);
}

// === BANNERS ===
function getActiveBanners() {
  return query("SELECT * FROM banners WHERE active = 1 ORDER BY sort_order ASC, id ASC");
}

function getAllBanners() {
  return query("SELECT * FROM banners ORDER BY sort_order ASC, id ASC");
}

function saveBanner(id, title, subtitle, image, link, sortOrder, active, displayDuration) {
  if (id) {
    run("UPDATE banners SET title = ?, subtitle = ?, image = ?, link = ?, sort_order = ?, active = ?, display_duration = ? WHERE id = ?",
      [title, subtitle, image, link || '', sortOrder || 0, active ? 1 : 0, displayDuration || 10, id]);
  } else {
    run("INSERT INTO banners (title, subtitle, image, link, sort_order, active, display_duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [title, subtitle, image, link || '', sortOrder || 0, active ? 1 : 0, displayDuration || 10]);
  }
}

function deleteBanner(id) {
  run("DELETE FROM banners WHERE id = ?", [id]);
}

  // === ACTIVITY LOG ===
function logActivity(userType, userId, userName, action, details, targetType, targetId, ip) {
  try {
    run("INSERT INTO activity_log (user_type, user_id, user_name, action, details, target_type, target_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [userType || 'system', userId || 0, userName || '', action || '', details || '', targetType || '', targetId || 0, ip || '']);
  } catch(e) {}
}

function getActivityLog(limit, offset) {
  return query("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit || 100, offset || 0]);
}

function getActivityLogCount() {
  var r = get("SELECT COUNT(*) as c FROM activity_log");
  return r ? r.c : 0;
}

// === BLOCKED IPS ===
function isIpBlocked(ip) {
  var r = get("SELECT id FROM blocked_ips WHERE ip = ?", [ip]);
  return !!r;
}

function getBlockedIps() {
  return query("SELECT * FROM blocked_ips ORDER BY created_at DESC");
}

function blockIp(ip, reason, blockedBy) {
  try {
    run("INSERT OR IGNORE INTO blocked_ips (ip, reason, blocked_by) VALUES (?, ?, ?)", [ip, reason || '', blockedBy || 0]);
  } catch(e) {}
}

function unblockIp(id) {
  run("DELETE FROM blocked_ips WHERE id = ?", [id]);
}

// === FEATURE TOGGLES ===
function getToggle(key) {
  var r = get("SELECT value FROM config WHERE key = ?", ['toggle_' + key]);
  return r ? r.value : '1';
}
function setToggle(key, value) {
  run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", ['toggle_' + key, value]);
}
function getAllToggles() {
  return query("SELECT key, value FROM config WHERE key LIKE 'toggle_%' ORDER BY key");
}

// === FLASH SALE ===
function getFlashSales() {
  return query("SELECT p.*, c.name as category_name, c.icon as category_icon, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.flash_price IS NOT NULL AND p.flash_ends_at > datetime('now') AND p.status = 'active' ORDER BY p.flash_ends_at ASC");
}
function setFlashSale(productId, flashPrice, endsAt) {
  run("UPDATE products SET flash_price = ?, flash_ends_at = ? WHERE id = ?", [flashPrice, endsAt, productId]);
}
function removeFlashSale(productId) {
  run("UPDATE products SET flash_price = NULL, flash_ends_at = NULL WHERE id = ?", [productId]);
}

// === CLEANUP ===
function cleanupOldData(daysViews, daysLogs) {
  var deletedViews = 0, deletedLogs = 0;
  try {
    var r1 = get("SELECT changes() as c");
    run("DELETE FROM page_views WHERE created_at < datetime('now', '-' || ? || ' days')", [daysViews || 90]);
    deletedViews = (get("SELECT changes() as c") || {}).c || 0;
    run("DELETE FROM activity_log WHERE created_at < datetime('now', '-' || ? || ' days')", [daysLogs || 180]);
    deletedLogs = (get("SELECT changes() as c") || {}).c || 0;
  } catch(e) {}
  return { deletedViews: deletedViews || 0, deletedLogs: deletedLogs || 0 };
}

// === BLAST NOTIFICATION ===
function notifyAllSellers(type, message, icon, link) {
  var sellers = query("SELECT id FROM sellers");
  sellers.forEach(function(s) {
    try {
      run('INSERT INTO notifications (ip, type, message, icon, link, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
        [String(s.id), type || 'info', message, icon || 'bell', link || '']);
    } catch(e) {}
  });
  return sellers.length;
}

// === SELLER DASHBOARD ===
function getSellerSalesSummary(sellerId) {
  var today = get("SELECT COUNT(*) as c, COALESCE(SUM(product_price),0) as rev FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND date(created_at) = date('now')", [sellerId]);
  var week = get("SELECT COUNT(*) as c, COALESCE(SUM(product_price),0) as rev FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-7 days')", [sellerId]);
  var month = get("SELECT COUNT(*) as c, COALESCE(SUM(product_price),0) as rev FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-30 days')", [sellerId]);
  return { today: today || {c:0,rev:0}, week: week || {c:0,rev:0}, month: month || {c:0,rev:0} };
}
function getSellerChartData(sellerId, days) {
  return query("SELECT date(created_at) as day, COUNT(*) as sales, COALESCE(SUM(product_price),0) as revenue FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-' || ? || ' days') GROUP BY day ORDER BY day ASC", [sellerId, days || 30]);
}
function getSellerTopProducts(sellerId) {
  return query("SELECT p.id, p.name, p.image, p.price, COUNT(s.id) as total_sales, COALESCE(SUM(s.product_price),0) as total_revenue FROM products p LEFT JOIN sales s ON s.product_id = p.id AND s.status NOT IN ('cancelled','pending') WHERE p.seller_id = ? GROUP BY p.id ORDER BY total_sales DESC LIMIT 5", [sellerId]);
}
function getSellerProductViews(sellerId) {
  var r = get("SELECT COUNT(*) as c FROM page_views pv JOIN products p ON pv.product_id = p.id WHERE p.seller_id = ?", [sellerId]);
  return r ? r.c : 0;
}

// === PRODUCT QUESTIONS ===
function getProductQuestions(productId) {
  return query("SELECT * FROM product_questions WHERE product_id = ? AND answer != '' ORDER BY answered_at DESC", [productId]);
}
function getSellerQuestions(sellerId) {
  return query("SELECT pq.*, p.name as product_name FROM product_questions pq JOIN products p ON pq.product_id = p.id WHERE pq.seller_id = ? ORDER BY pq.answered_at IS NULL DESC, pq.created_at DESC", [sellerId]);
}
function askQuestion(productId, sellerId, buyerName, question) {
  run("INSERT INTO product_questions (product_id, seller_id, buyer_name, question) VALUES (?, ?, ?, ?)", [productId, sellerId, buyerName || 'Anônimo', question]);
}
function answerQuestion(questionId, answer) {
  run("UPDATE product_questions SET answer = ?, answered_at = datetime('now') WHERE id = ?", [answer, questionId]);
}

// === CLONE PRODUCT ===
function cloneProduct(id) {
  var p = get("SELECT * FROM products WHERE id = ?", [id]);
  if (!p) return null;
  run("INSERT INTO products (name, description, price, category_id, seller_id, image, status, condition, location, featured, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
    [p.name + ' (cópia)', p.description, p.price, p.category_id, p.seller_id, p.image, 'pending', p.condition || 'new', p.location || 'Brasil', p.code + '-COPY']);
  var r = get("SELECT MAX(id) as id FROM products");
  return r ? r.id : null;
}

// === SELLER GOALS ===
function getActiveGoal() {
  return get("SELECT * FROM seller_goals WHERE active = 1 AND start_date <= date('now') AND end_date >= date('now') ORDER BY created_at DESC LIMIT 1");
}

function getSellerGoalProgress(sellerId, goal) {
  if (!goal) return null;
  var r;
  if (goal.type === 'sales_count') {
    r = get("SELECT COUNT(*) as c FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND date(created_at) >= ? AND date(created_at) <= ?", [sellerId, goal.start_date, goal.end_date]);
  } else {
    r = get("SELECT COALESCE(SUM(product_price),0) as c FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND date(created_at) >= ? AND date(created_at) <= ?", [sellerId, goal.start_date, goal.end_date]);
  }
  var progress = r ? r.c : 0;
  return { progress: progress, target: goal.target_value, pct: Math.min(100, Math.round((progress / goal.target_value) * 100)), achieved: progress >= goal.target_value };
}

function getGoalLeaderboard(goalId) {
  var goal = get("SELECT * FROM seller_goals WHERE id = ?", [goalId]);
  if (!goal) return [];
  var sellers = query("SELECT id, name, avatar FROM sellers WHERE status = 'active'");
  var result = [];
  sellers.forEach(function(s) {
    var p = getSellerGoalProgress(s.id, goal);
    if (!p) return;
    var w = get("SELECT prize_given FROM goal_winners WHERE goal_id = ? AND seller_id = ?", [goalId, s.id]);
    result.push({
      seller_id: s.id,
      seller_name: s.name,
      avatar: s.avatar || '',
      progress: p.progress,
      target: p.target,
      pct: p.pct,
      achieved: p.achieved,
      prize_given: w ? w.prize_given : 0
    });
  });
  result.sort(function(a, b) { return b.pct - a.pct || b.progress - a.progress; });
  return result;
}

function getAllGoals() {
  return query("SELECT * FROM seller_goals ORDER BY created_at DESC");
}

function saveGoal(id, title, type, targetValue, prizeDescription, startDate, endDate) {
  if (id) {
    run("UPDATE seller_goals SET title = ?, type = ?, target_value = ?, prize_description = ?, start_date = ?, end_date = ? WHERE id = ?",
      [title, type, targetValue, prizeDescription||'', startDate, endDate, id]);
  } else {
    run("INSERT INTO seller_goals (title, type, target_value, prize_description, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)",
      [title, type, targetValue, prizeDescription||'', startDate, endDate]);
  }
}

function toggleGoal(id, active) {
  run("UPDATE seller_goals SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

function markGoalWinner(goalId, sellerId, prizeGiven) {
  var existing = get("SELECT id FROM goal_winners WHERE goal_id = ? AND seller_id = ?", [goalId, sellerId]);
  if (existing) {
    run("UPDATE goal_winners SET prize_given = ? WHERE id = ?", [prizeGiven ? 1 : 0, existing.id]);
  } else {
    run("INSERT INTO goal_winners (goal_id, seller_id, progress, prize_given) VALUES (?, ?, (SELECT COUNT(*) FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending')), ?)",
      [goalId, sellerId, sellerId, prizeGiven ? 1 : 0]);
  }
}

function deleteGoal(id) {
  run("DELETE FROM goal_winners WHERE goal_id = ?", [id]);
  run("DELETE FROM seller_goals WHERE id = ?", [id]);
}

// === SELLER CSV EXPORT ===
function getSellerSalesCsv(sellerId) {
  return query("SELECT s.*, p.name as prod_name FROM sales s JOIN products p ON s.product_id = p.id WHERE s.seller_id = ? ORDER BY s.created_at DESC", [sellerId]);
}

module.exports = { initDb, getDb, query, get, run, saveDb, addNotification, getUnreadNotifications, getNotifications, markNotificationRead, markAllNotificationsRead, getNotificationCount, addTransaction, getWalletBalance, getWalletTransactions, getAllTransactions, getCommissionPct, gerarCodigoRastreio, createTrackingHistory, getTrackingHistory, getSaleByTrackingCode, getPayouts, getPayoutCount, getPendingPayoutsCount, createPayout, getTransactionsByPeriod, getFinanceSummary, getFinanceChart, addSaleProof, getSaleProofs, getPage, getAllPages, savePage, deletePage, getCoupon, getAllCoupons, saveCoupon, deleteCoupon, incrementCoupon, getActiveBanners, getAllBanners, saveBanner, deleteBanner, logActivity, getActivityLog, getActivityLogCount, isIpBlocked, getBlockedIps, blockIp, unblockIp, getToggle, setToggle, getAllToggles, getFlashSales, setFlashSale, removeFlashSale, cleanupOldData, notifyAllSellers, getSellerSalesSummary, getSellerChartData, getSellerTopProducts, getSellerProductViews, getProductQuestions, getSellerQuestions, askQuestion, answerQuestion, cloneProduct, getActiveGoal, getSellerGoalProgress, getGoalLeaderboard, getAllGoals, saveGoal, toggleGoal, markGoalWinner, deleteGoal, getSellerSalesCsv };
