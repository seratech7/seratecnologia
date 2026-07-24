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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
  var hasCommission = get("SELECT value FROM config WHERE key = 'commission_pct'");
  if (!hasCommission) {
    run("INSERT INTO config (key, value) VALUES ('commission_pct', '10')");
  }
  var hasMpToken = get("SELECT value FROM config WHERE key = 'mp_access_token'");
  if (!hasMpToken) {
    run("INSERT INTO config (key, value) VALUES ('mp_access_token', '')");
  }

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
      ['SSD Kingston NV2 1TB', 'SSD NVMe M.2 Kingston NV2 1TB, leitura 3500MB/s', 349.90, catMap['ssds'], 'Novo', 'Brasil', 'active'],
      ['HD Seagate Barracuda 2TB', 'HD interno Seagate 2TB 7200RPM SATA III', 289.90, catMap['hds-armazenamento'], 'Novo', 'Brasil', 'active'],
      ['Memória DDR5 32GB Kingston', 'Kit 2x16GB DDR5 4800MHz Kingston Fury Beast', 589.90, catMap['memoria-ram'], 'Novo', 'Brasil', 'active'],
      ['Processador Intel Core i7-13700K', 'Intel Core i7-13700K 16 núcleos LGA1700', 2199.90, catMap['processadores'], 'Novo', 'Brasil', 'active'],
      ['Placa de Vídeo RTX 4060', 'NVIDIA GeForce RTX 4060 8GB GDDR6', 1799.90, catMap['placas-video'], 'Novo', 'Brasil', 'active'],
      ['Placa-mãe B760M', 'ASUS TUF Gaming B760M-Plus D4 LGA1700', 899.90, catMap['placas-mae'], 'Novo', 'Brasil', 'active'],
      ['Monitor Gamer 27" 165Hz', 'Monitor LG UltraGear 27" IPS 165Hz 1ms', 1499.90, catMap['monitores'], 'Novo', 'Brasil', 'active'],
      ['Teclado Mecânico RGB', 'Teclado gamer switch azul ABNT2', 199.90, catMap['perifericos'], 'Novo', 'Brasil', 'active'],
      ['Fonte Corsair 650W', 'Fonte ATX Corsair CV650 80 Plus Bronze', 349.90, catMap['fontes-gabinetes'], 'Novo', 'Brasil', 'active'],
      ['Notebook Dell Inspiron 15', 'Dell Inspiron 15" i5 8GB 256GB SSD', 3299.90, catMap['notebooks-pcs'], 'Novo', 'Brasil', 'active'],
    ];
    defaultProds.forEach(function(p) {
      run('INSERT INTO products (name, description, price, category_id, seller_id, condition, location, status, featured) VALUES (?,?,?,?,?,?,?,?,?)',
        [p[0], p[1], p[2], p[3], defaultSellerId, p[4]||'new', p[5]||'Brasil', p[6]||'active', 1]);
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
  var where = sellerId ? "seller_id = " + sellerId + " AND" : "";
  if (!startDate) startDate = '2000-01-01';
  if (!endDate) endDate = '2100-01-01';
  var sales = get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM wallet_transactions WHERE " + where + " type = 'sale' AND date(created_at) >= ? AND date(created_at) <= ?", [startDate, endDate]);
  var commissions = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE " + where + " type = 'commission' AND date(created_at) >= ? AND date(created_at) <= ?", [startDate, endDate]);
  var payouts = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE " + where + " type = 'payout' AND date(created_at) >= ? AND date(created_at) <= ?", [startDate, endDate]);
  var adjustments = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE " + where + " type = 'adjustment' AND date(created_at) >= ? AND date(created_at) <= ?", [startDate, endDate]);
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
  var where = sellerId ? "AND seller_id = " + sellerId : "";
  var data = query("SELECT date(created_at) as day, type, COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE created_at >= date('now', '-' || ? || ' days') " + where + " GROUP BY day, type ORDER BY day ASC", [days]);
  var chart = {};
  data.forEach(function(r) {
    if (!chart[r.day]) chart[r.day] = { sale: 0, commission: 0, payout: 0, adjustment: 0 };
    chart[r.day][r.type] = r.total;
  });
  return chart;
}

module.exports = { initDb, getDb, query, get, run, saveDb, addNotification, getUnreadNotifications, getNotifications, markNotificationRead, markAllNotificationsRead, getNotificationCount, addTransaction, getWalletBalance, getWalletTransactions, getAllTransactions, getCommissionPct, gerarCodigoRastreio, createTrackingHistory, getTrackingHistory, getSaleByTrackingCode, getPayouts, getPayoutCount, getPendingPayoutsCount, createPayout, getTransactionsByPeriod, getFinanceSummary, getFinanceChart };
