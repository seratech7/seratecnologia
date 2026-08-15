const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const PEPPER = process.env.AUTH_PEPPER || crypto.randomBytes(32).toString('hex');
const SESSION_ENC_KEY = crypto.createHash('sha256').update(process.env.SESSION_ENC_KEY || crypto.randomBytes(32).toString('hex')).digest();
const DEVICE_ID_COOKIE = '__device_id';
const SESSION_COOKIE_PREFIX = '__Host-';

const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'database.sqlite');

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

// Recarrega o banco em memória a partir do arquivo em disco (usado após restore/import)
async function reloadFromDisk() {
  if (!fs.existsSync(DB_PATH)) return false;
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(buffer);
  db.run('PRAGMA foreign_keys = ON');
  await initDb();
  return true;
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
  if (!cols.includes('pix_type')) db.run("ALTER TABLE sellers ADD COLUMN pix_type TEXT DEFAULT ''");
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
  db.run("UPDATE products SET code = 'PROD-' || upper(substr(hex(randomblob(4)), 1, 8)) WHERE code IS NULL OR code = ''");

  var fpCols = db.exec("PRAGMA table_info(products)");
  if (fpCols.length > 0) {
    var fpNames = fpCols[0].values.map(function(r) { return r[1]; });
    if (!fpNames.includes('flash_price')) db.run("ALTER TABLE products ADD COLUMN flash_price REAL DEFAULT NULL");
    if (!fpNames.includes('flash_ends_at')) db.run("ALTER TABLE products ADD COLUMN flash_ends_at DATETIME DEFAULT NULL");
    if (!fpNames.includes('quantity')) db.run("ALTER TABLE products ADD COLUMN quantity INTEGER DEFAULT 0");
    if (!fpNames.includes('rejection_reason')) db.run("ALTER TABLE products ADD COLUMN rejection_reason TEXT DEFAULT ''");
  }

  const adminPass = process.env.ADMIN_PASSWORD || 'admn123';
  const hash = bcrypt.hashSync(adminPass, 12);
  run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, 'admin']);
  const adminCheck = db.exec("SELECT COUNT(*) as c FROM admins WHERE username = 'admin'");
  const adminCount = adminCheck.length > 0 && adminCheck[0].values.length > 0 ? adminCheck[0].values[0][0] : 0;
  if (adminCount === 0) {
    run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', ['admin', hash, 'Administrador']);
  }

  // === AUTH-HIVE: garante users_auth do admin (uid = 'admin:' + id) ===
  try {
    // Limpa registros legados com uid antigo baseado em username ('admin:admin')
    run("DELETE FROM users_auth WHERE uid IN ('admin:admin', 'admin:0')");

    const adminRow = get("SELECT id FROM admins WHERE username = 'admin'");
    if (adminRow) {
      const uid = 'admin:' + adminRow.id;
      const authHive = require('../lib/auth-hive');
      const h = await authHive.hashPassword(adminPass);
      const existingAuth = getUserAuth(uid);
      if (!existingAuth) {
        createUserAuth(uid, 'admin', h, '', 1);
        console.log('[db] users_auth do admin criado (' + uid + ')');
      } else if (existingAuth.argon_hash !== h) {
        updateUserAuthHash(uid, h, (existingAuth.pepper_ver || 1) + 1);
        console.log('[db] users_auth do admin atualizado (' + uid + ')');
      }
    }
  } catch (e) {
    console.error('[db] seed users_auth admin falhou:', e.message);
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
    'max_products_per_seller': '50',
    'flash_category_id': ''
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

  var payoutCols = db.exec("PRAGMA table_info(payouts)");
  if (payoutCols.length > 0) {
    var pc = payoutCols[0].values.map(function(r) { return r[1]; });
    if (!pc.includes('paid_at')) db.run("ALTER TABLE payouts ADD COLUMN paid_at DATETIME");
  }

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
    if (!colNames.includes('city')) {
      db.run("ALTER TABLE sales ADD COLUMN city TEXT DEFAULT ''");
    }
    if (!colNames.includes('buyer_name')) {
      db.run("ALTER TABLE sales ADD COLUMN buyer_name TEXT DEFAULT ''");
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
    if (!bc.includes('mobile_image')) db.run("ALTER TABLE banners ADD COLUMN mobile_image TEXT DEFAULT ''");
    if (!bc.includes('bg_color')) db.run("ALTER TABLE banners ADD COLUMN bg_color TEXT DEFAULT '#1a1a2e'");
    if (!bc.includes('text_align')) db.run("ALTER TABLE banners ADD COLUMN text_align TEXT DEFAULT 'left'");
    if (!bc.includes('position')) db.run("ALTER TABLE banners ADD COLUMN position TEXT DEFAULT 'hero'");
    if (!bc.includes('transition')) db.run("ALTER TABLE banners ADD COLUMN transition TEXT DEFAULT 'slide'");
    if (!bc.includes('start_date')) db.run("ALTER TABLE banners ADD COLUMN start_date TEXT");
    if (!bc.includes('end_date')) db.run("ALTER TABLE banners ADD COLUMN end_date TEXT");
    if (!bc.includes('clicks')) db.run("ALTER TABLE banners ADD COLUMN clicks INTEGER DEFAULT 0");
    if (!bc.includes('target_blank')) db.run("ALTER TABLE banners ADD COLUMN target_blank INTEGER DEFAULT 1");
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
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      username TEXT DEFAULT '',
      type TEXT DEFAULT 'admin',
      success INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users_auth (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL,
      user_type TEXT NOT NULL,
      argon_hash TEXT NOT NULL,
      mfa_secret_enc TEXT DEFAULT '',
      totp_enabled INTEGER DEFAULT 0,
      passkey_id TEXT DEFAULT '',
      recovery_hashes TEXT DEFAULT '',
      pepper_ver INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      label TEXT DEFAULT 'Principal',
      recipient TEXT DEFAULT '',
      address TEXT NOT NULL,
      city TEXT DEFAULT '',
      state TEXT DEFAULT '',
      zip TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  var salesColsMigrate = db.exec("PRAGMA table_info(sales)");
  if (salesColsMigrate.length > 0) {
    var scm = salesColsMigrate[0].values.map(function(r) { return r[1]; });
    if (!scm.includes('customer_id')) {
      db.run("ALTER TABLE sales ADD COLUMN customer_id INTEGER DEFAULT NULL");
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      sid_hash TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL,
      user_type TEXT NOT NULL,
      device_id TEXT NOT NULL,
      ua_hash TEXT NOT NULL,
      ip_zone TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      result TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid TEXT NOT NULL,
      device_id TEXT NOT NULL,
      label TEXT DEFAULT '',
      last_ip TEXT DEFAULT '',
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_uid, device_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_uid);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_uid);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_auth_devices_user ON auth_devices(user_uid);
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

  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      subject TEXT DEFAULT '',
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      platforms TEXT NOT NULL,
      target TEXT DEFAULT 'all',
      total_sent INTEGER DEFAULT 0,
      total_failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_campaign_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      recipient TEXT DEFAULT '',
      status TEXT DEFAULT 'sent',
      error TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_list_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      name TEXT DEFAULT '',
      FOREIGN KEY (list_id) REFERENCES marketing_lists(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS wa_autoreply (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      reply TEXT NOT NULL,
      match_type TEXT DEFAULT 'exact',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS marketing_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      scheduled_for DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // === ATRAÇÃO DE VISITANTES (referral, giveaway, recuperação, push) ===
  db.run(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_code TEXT NOT NULL,
      referrer_ip TEXT DEFAULT '',
      visitor_ip TEXT DEFAULT '',
      visitor_session TEXT DEFAULT '',
      converted INTEGER DEFAULT 0,
      coupon_generated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  var refCols = db.exec("PRAGMA table_info(referrals)");
  if (refCols.length > 0) {
    var refNames = refCols[0].values.map(function(r) { return r[1]; });
    if (!refNames.includes('coupon_generated')) db.run("ALTER TABLE referrals ADD COLUMN coupon_generated INTEGER DEFAULT 0");
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS abandoned_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ip TEXT DEFAULT '',
      last_product_id INTEGER DEFAULT 0,
      last_product_name TEXT DEFAULT '',
      visits_count INTEGER DEFAULT 1,
      coupon_offered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      keys_json TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS social_proof (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT DEFAULT '',
      meta TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT DEFAULT '',
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
      FOREIGN KEY (seller_id) REFERENCES sellers(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      product_id INTEGER,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
      FOREIGN KEY (sender_id) REFERENCES sellers(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
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
      if (lp) run("UPDATE products SET code = 'PROD-' || upper(substr(hex(randomblob(4)), 1, 8)) WHERE id = ?", [lp.id]);
    });
    console.log('[db] Produtos padrão criados');
  }

  if (defaultSellerId > 0) {
    var testSellerProd = get("SELECT id FROM products WHERE seller_id = ? LIMIT 1", [defaultSellerId]);
    if (testSellerProd) {
      run("UPDATE products SET code = 'PROD-00001' WHERE id = ? AND (code IS NULL OR code = '')", [testSellerProd.id]);
    }
  }

  // Test sale removed for security

  // === AUDITORIA IA: status de achados (para não repetir achados já tratados) ===
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_findings_status (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // === ARMAZENAMENTO PERSISTENTE DE ARQUIVOS (uploads) ===
  // Guarda cópias das imagens enviadas para que não sumam após deploys
  // (o disco do Render é efêmero; o banco persiste via DB_PATH/backup).
  db.run(`
    CREATE TABLE IF NOT EXISTS file_store (
      filename TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      content_type TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // === NOTÍCIAS (portal de jogos & hacking) ===
  db.run(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt TEXT,
      content TEXT,
      category TEXT NOT NULL DEFAULT 'jogos',
      image TEXT,
      author TEXT DEFAULT 'Redação',
      featured INTEGER DEFAULT 0,
      published INTEGER DEFAULT 1,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      video TEXT DEFAULT ''
    )
  `);

  var newsInfo = db.exec("PRAGMA table_info(news)");
  if (newsInfo.length > 0) {
    var newsCols = newsInfo[0].values.map(function (r) { return r[1]; });
    if (!newsCols.includes('video')) db.run("ALTER TABLE news ADD COLUMN video TEXT DEFAULT ''");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS news_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(news_id, type, ip)
    )
  `);

  // === PRODUTOS DIGITAIS (venda de logins com entrega automática) ===
  db.run(`
    CREATE TABLE IF NOT EXISTS digital_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'outros',
      image TEXT,
      badge TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sold_count INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    var _di = db.exec("PRAGMA table_info(digital_products)");
    if (_di.length > 0) {
      var _hasFeat = _di[0].values.map(function(r){ return r[1]; }).indexOf('featured') !== -1;
      if (!_hasFeat) db.run("ALTER TABLE digital_products ADD COLUMN featured INTEGER DEFAULT 0");
    }
  } catch (e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS digital_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      credential TEXT NOT NULL,
      password TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      sale_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS digital_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      stock_id INTEGER,
      buyer_name TEXT,
      buyer_email TEXT,
      buyer_phone TEXT,
      delivery_channel TEXT,
      delivery_contact TEXT,
      observation TEXT,
      price REAL NOT NULL DEFAULT 0,
      delivery_code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    try {
      var _sc = db.exec("PRAGMA table_info(digital_sales)");
      if (_sc.length > 0) {
        var _scCols = _sc[0].values.map(function(r){ return r[1]; });
        if (_scCols.indexOf('delivery_channel') === -1) db.run("ALTER TABLE digital_sales ADD COLUMN delivery_channel TEXT");
        if (_scCols.indexOf('delivery_contact') === -1) db.run("ALTER TABLE digital_sales ADD COLUMN delivery_contact TEXT");
        if (_scCols.indexOf('observation') === -1) db.run("ALTER TABLE digital_sales ADD COLUMN observation TEXT");
      }
    } catch (e) {}

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

function refundSale(saleId) {
  var refunded = 0;
  var sale = get('SELECT product_price, seller_id FROM sales WHERE id = ?', [saleId]);
  if (!sale) return 0;
  var rows = query("SELECT seller_id, amount, type FROM wallet_transactions WHERE reference_type = 'sale' AND reference_id = ? AND type IN ('sale','commission')", [saleId]);
  rows.forEach(function(t) {
    addTransaction(t.seller_id, t.type === 'sale' ? 'sale_refund' : 'commission_refund', 'Estorno de venda #' + saleId, -Math.abs(t.amount), 'sale_refund', saleId);
    refunded += Math.abs(t.amount);
  });
  return refunded;
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
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var seq = '';
  for (var i = 0; i < 8; i++) {
    seq += alphabet[crypto.randomInt(0, alphabet.length)];
  }
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
  var payoutId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  addTransaction(sellerId, 'payout', 'Saque solicitado - R$ ' + amount.toFixed(2), -amount, 'payout', payoutId);
  return payoutId;
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
  if (sellerId) { sellerClause = 'AND seller_id = ?'; params = [startDate, endDate, sellerId]; }
  var sales = get("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM wallet_transactions WHERE type = 'sale' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, params);
  var commissions = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'commission' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, params);
  var payouts = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'payout' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, params);
  var adjustments = get("SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE type = 'adjustment' AND date(created_at) >= ? AND date(created_at) <= ? " + sellerClause, params);
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

function updateCoupon(id, code, type, value, minOrder, maxUses, expiresAt) {
  run("UPDATE coupons SET code = ?, type = ?, value = ?, min_order = ?, max_uses = ?, expires_at = ? WHERE id = ?",
    [code, type, value, minOrder || 0, maxUses || 0, expiresAt || null, id]);
}

function toggleCoupon(id, active) {
  run("UPDATE coupons SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

function resetCouponUses(id) {
  run("UPDATE coupons SET used_count = 0 WHERE id = ?", [id]);
}

function getCouponById(id) {
  return get("SELECT * FROM coupons WHERE id = ?", [id]);
}

function incrementCoupon(id) {
  run("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [id]);
}

// === BANNERS ===
function getActiveBanners() {
  return query("SELECT * FROM banners WHERE active = 1 AND (start_date IS NULL OR start_date <= datetime('now')) AND (end_date IS NULL OR end_date >= datetime('now')) ORDER BY sort_order ASC, id ASC");
}

function getBannersByPosition(position) {
  return query("SELECT * FROM banners WHERE active = 1 AND position = ? AND (start_date IS NULL OR start_date <= datetime('now')) AND (end_date IS NULL OR end_date >= datetime('now')) ORDER BY sort_order ASC, id ASC", [position]);
}

function getAllBanners() {
  return query("SELECT * FROM banners ORDER BY sort_order ASC, id ASC");
}

function saveBanner(id, title, subtitle, image, link, sortOrder, active, displayDuration, opts) {
  opts = opts || {};
  if (id) {
    run("UPDATE banners SET title=?, subtitle=?, image=?, link=?, sort_order=?, active=?, display_duration=?, mobile_image=?, bg_color=?, text_align=?, position=?, transition=?, start_date=?, end_date=?, target_blank=? WHERE id=?",
      [title, subtitle, image, link || '', sortOrder || 0, active ? 1 : 0, displayDuration || 10,
       opts.mobileImage || '', opts.bgColor || '#1a1a2e', opts.textAlign || 'left',
       opts.position || 'hero', opts.transition || 'slide',
       opts.startDate || null, opts.endDate || null,
       opts.targetBlank !== undefined ? (opts.targetBlank ? 1 : 0) : 1,
       id]);
  } else {
    run("INSERT INTO banners (title, subtitle, image, link, sort_order, active, display_duration, mobile_image, bg_color, text_align, position, transition, start_date, end_date, target_blank) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [title, subtitle, image, link || '', sortOrder || 0, active ? 1 : 0, displayDuration || 10,
       opts.mobileImage || '', opts.bgColor || '#1a1a2e', opts.textAlign || 'left',
       opts.position || 'hero', opts.transition || 'slide',
       opts.startDate || null, opts.endDate || null,
       opts.targetBlank !== undefined ? (opts.targetBlank ? 1 : 0) : 1]);
  }
}

function deleteBanner(id) {
  run("DELETE FROM banners WHERE id = ?", [id]);
}

function incrementBannerClicks(id) {
  run("UPDATE banners SET clicks = COALESCE(clicks, 0) + 1 WHERE id = ?", [id]);
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

function logLoginAttempt(ip, username, type, success) {
  run("INSERT INTO login_attempts (ip, username, type, success) VALUES (?, ?, ?, ?)", [ip || '', username || '', type || 'admin', success ? 1 : 0]);
}

function getLoginAttempts(limit) {
  return query("SELECT * FROM login_attempts ORDER BY created_at DESC LIMIT ?", [limit || 100]);
}

function getPasswordPolicy() {
  var a = get("SELECT value FROM config WHERE key = 'password_min_length'");
  var b = get("SELECT value FROM config WHERE key = 'password_require_special'");
  var c = get("SELECT value FROM config WHERE key = 'password_require_number'");
  var d = get("SELECT value FROM config WHERE key = 'password_require_upper'");
  return {
    minLength: a ? parseInt(a.value) || 0 : 0,
    requireSpecial: b ? b.value === '1' : false,
    requireNumber: c ? c.value === '1' : false,
    requireUpper: d ? d.value === '1' : false
  };
}

function validatePassword(password) {
  var policy = getPasswordPolicy();
  var min = Math.max(policy.minLength, 6);
  var errors = [];
  if (password.length < min) errors.push('A senha deve ter no mínimo ' + min + ' caracteres');
  if (policy.requireSpecial && !/[!@#$%^&*(),.?":{}|<>_-]/.test(password)) errors.push('A senha deve conter pelo menos um caractere especial');
  if (policy.requireNumber && !/\d/.test(password)) errors.push('A senha deve conter pelo menos um número');
  if (policy.requireUpper && !/[A-Z]/.test(password)) errors.push('A senha deve conter pelo menos uma letra maiúscula');
  return errors;
}

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
  var flashCat = get("SELECT value FROM config WHERE key = 'flash_category_id'");
  var catFilter = '';
  if (flashCat && flashCat.value) catFilter = 'AND p.category_id = ' + parseInt(flashCat.value) + ' ';
  return query("SELECT p.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.flash_price IS NOT NULL AND p.flash_ends_at > datetime('now') AND p.status = 'active' " + catFilter + "ORDER BY p.flash_ends_at ASC");
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
  var goal = get("SELECT * FROM seller_goals WHERE id = ?", [goalId]);
  var progressSql = goal && goal.type === 'revenue'
    ? "(SELECT COALESCE(SUM(product_price),0) FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND date(created_at) >= ? AND date(created_at) <= ?)"
    : "(SELECT COUNT(*) FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending') AND date(created_at) >= ? AND date(created_at) <= ?)";
  var existing = get("SELECT id FROM goal_winners WHERE goal_id = ? AND seller_id = ?", [goalId, sellerId]);
  if (existing) {
    run("UPDATE goal_winners SET prize_given = ? WHERE id = ?", [prizeGiven ? 1 : 0, existing.id]);
  } else {
    run("INSERT INTO goal_winners (goal_id, seller_id, progress, prize_given) VALUES (?, ?, " + progressSql + ", ?)",
      [goalId, sellerId, sellerId, goal.start_date, goal.end_date, prizeGiven ? 1 : 0]);
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

// === MARKETING TEMPLATES ===
function getMarketingTemplates(platform) {
  if (platform) return query("SELECT * FROM marketing_templates WHERE platform = ? ORDER BY name", [platform]);
  return query("SELECT * FROM marketing_templates ORDER BY platform, name");
}
function getMarketingTemplate(id) { return get('SELECT * FROM marketing_templates WHERE id = ?', [id]); }
function saveMarketingTemplate(name, platform, subject, content, id) {
  if (id) { run("UPDATE marketing_templates SET name=?, platform=?, subject=?, content=?, updated_at=datetime('now') WHERE id=?", [name,platform,subject||'',content,id]); return id; }
  run("INSERT INTO marketing_templates (name,platform,subject,content) VALUES (?,?,?,?)", [name,platform,subject||'',content]);
  return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
}
function deleteMarketingTemplate(id) { run("DELETE FROM marketing_templates WHERE id = ?", [id]); }

// === MARKETING CAMPAIGNS ===
function getMarketingCampaigns(limit) {
  return query("SELECT * FROM marketing_campaigns ORDER BY created_at DESC LIMIT ?", [limit||50]);
}
function getMarketingCampaign(id) { return get('SELECT * FROM marketing_campaigns WHERE id = ?', [id]); }
function getMarketingCampaignResults(campaignId) {
  return query("SELECT * FROM marketing_campaign_results WHERE campaign_id = ? ORDER BY created_at", [campaignId]);
}
function createMarketingCampaign(name, message, platforms, target, createdBy) {
  run("INSERT INTO marketing_campaigns (name,message,platforms,target,created_by) VALUES (?,?,?,?,?)",
    [name||'',message,platforms,target||'all',createdBy||0]);
  return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
}
function addMarketingCampaignResult(campaignId, platform, recipient, status, error) {
  run("INSERT INTO marketing_campaign_results (campaign_id,platform,recipient,status,error) VALUES (?,?,?,?,?)",
    [campaignId,platform,recipient||'',status||'sent',error||'']);
}
function updateMarketingCampaignStats(id, sent, failed) {
  run("UPDATE marketing_campaigns SET total_sent=total_sent+?, total_failed=total_failed+? WHERE id=?", [sent||0,failed||0,id]);
}
function getMarketingStats() {
  return {
    totalCampaigns: (get('SELECT COUNT(*) as c FROM marketing_campaigns')||{}).c||0,
    totalSent: (get('SELECT COALESCE(SUM(total_sent),0) as c FROM marketing_campaigns')||{}).c||0,
    totalTemplates: (get('SELECT COUNT(*) as c FROM marketing_templates')||{}).c||0,
  };
}

// === MARKETING SCHEDULE ===
function getMarketingSchedules(limit) { return query("SELECT * FROM marketing_schedule ORDER BY scheduled_for ASC LIMIT ?", [limit||50]); }
function getPendingMarketingSchedules() { return query("SELECT * FROM marketing_schedule WHERE status='pending' AND scheduled_for <= datetime('now') ORDER BY scheduled_for ASC"); }
function createMarketingSchedule(title, platform, content, scheduledFor) { run("INSERT INTO marketing_schedule (title,platform,content,scheduled_for) VALUES (?,?,?,?)", [title,platform,content,scheduledFor]); return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0]; }
function markMarketingScheduleDone(id) { run("UPDATE marketing_schedule SET status='sent' WHERE id=?", [id]); }
function deleteMarketingSchedule(id) { run("DELETE FROM marketing_schedule WHERE id = ?", [id]); }

function getMarketingFullStats() {
  return {
    totalCampaigns: (get('SELECT COUNT(*) as c FROM marketing_campaigns')||{}).c||0,
    totalSent: (get('SELECT COALESCE(SUM(total_sent),0) as c FROM marketing_campaigns')||{}).c||0,
    totalTemplates: (get('SELECT COUNT(*) as c FROM marketing_templates')||{}).c||0,
    totalLists: (get('SELECT COUNT(*) as c FROM marketing_lists')||{}).c||0,
    totalMembers: (get('SELECT COUNT(*) as c FROM marketing_list_members')||{}).c||0,
    totalCoupons: (get('SELECT COUNT(*) as c FROM coupons')||{}).c||0,
    totalSchedule: (get("SELECT COUNT(*) as c FROM marketing_schedule WHERE status='pending'")||{}).c||0,
    totalAutoReplies: (get('SELECT COUNT(*) as c FROM wa_autoreply')||{}).c||0
  };
}

// === BROADCAST LISTS ===
function getMarketingLists() { return query("SELECT ml.*, (SELECT COUNT(*) FROM marketing_list_members WHERE list_id=ml.id) as member_count FROM marketing_lists ml ORDER BY name"); }
function getMarketingList(id) { return get('SELECT * FROM marketing_lists WHERE id = ?', [id]); }
function createMarketingList(name, desc) { run("INSERT INTO marketing_lists (name,description) VALUES (?,?)", [name,desc||'']); return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0]; }
function deleteMarketingList(id) { run("DELETE FROM marketing_lists WHERE id = ?", [id]); run("DELETE FROM marketing_list_members WHERE list_id = ?", [id]); }
function getMarketingListMembers(listId) { return query("SELECT * FROM marketing_list_members WHERE list_id = ? ORDER BY name", [listId]); }
function addMarketingListMember(listId, phone, name) {
  var existing = get("SELECT id FROM marketing_list_members WHERE list_id = ? AND phone = ?", [listId, phone]);
  if (existing) return existing.id;
  run("INSERT INTO marketing_list_members (list_id,phone,name) VALUES (?,?,?)", [listId,phone,name||'']);
  return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
}
function deleteMarketingListMember(id) { run("DELETE FROM marketing_list_members WHERE id = ?", [id]); }

// === AUTO-RESPOSTA (wa_autoreply) ===
function getAutoReplies() { return query("SELECT * FROM wa_autoreply ORDER BY keyword"); }
function getAutoReply(id) { return get("SELECT * FROM wa_autoreply WHERE id = ?", [id]); }
function saveAutoReply(keyword, reply, matchType, active) {
  run("INSERT INTO wa_autoreply (keyword, reply, match_type, active) VALUES (?,?,?,?)", [keyword, reply, matchType||'exact', active?1:0]);
  return db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
}
function updateAutoReply(id, keyword, reply, matchType, active) {
  run("UPDATE wa_autoreply SET keyword=?, reply=?, match_type=?, active=? WHERE id=?", [keyword, reply, matchType||'exact', active?1:0, id]);
}
function deleteAutoReply(id) { run("DELETE FROM wa_autoreply WHERE id = ?", [id]); }
function toggleAutoReply(id, active) { run("UPDATE wa_autoreply SET active=? WHERE id=?", [active?1:0, id]); }

// === SELLER CHAT ===
function getSellerConversations(sellerId) {
  var convs = query("SELECT c.*, cp.last_read_at, (SELECT content FROM chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message, (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id AND id > COALESCE((SELECT last_read_at FROM chat_participants WHERE conversation_id = c.id AND seller_id = ?),0)) as unread FROM chat_conversations c INNER JOIN chat_participants cp ON cp.conversation_id = c.id AND cp.seller_id = ? ORDER BY c.last_message_at DESC", [sellerId, sellerId]);
  convs.forEach(function(c) {
    var parts = query("SELECT s.name FROM chat_participants cp INNER JOIN sellers s ON s.id = cp.seller_id WHERE cp.conversation_id = ? AND cp.seller_id != ?", [c.id, sellerId]);
    c.participant_names = parts.map(function(p) { return p.name; }).join(', ');
  });
  return convs;
}
function getConversationParticipants(conversationId) {
  return query("SELECT s.id, s.name, s.avatar FROM chat_participants cp INNER JOIN sellers s ON s.id = cp.seller_id WHERE cp.conversation_id = ?", [conversationId]);
}
function getConversationMessages(conversationId, sellerId, limit, offset) {
  if (!limit) limit = 50;
  if (!offset) offset = 0;
  var msgs = query("SELECT m.*, s.name as sender_name, s.avatar as sender_avatar FROM chat_messages m INNER JOIN sellers s ON s.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ? OFFSET ?", [conversationId, limit, offset]);
  run("UPDATE chat_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND seller_id = ?", [conversationId, sellerId]);
  return msgs.reverse();
}
function sendMessage(conversationId, senderId, content, productId) {
  run("INSERT INTO chat_messages (conversation_id, sender_id, content, product_id) VALUES (?,?,?,?)", [conversationId, senderId, content, productId || null]);
  run("UPDATE chat_conversations SET last_message_at = datetime('now') WHERE id = ?", [conversationId]);
  var msgId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  var msg = get("SELECT m.*, s.name as sender_name, s.avatar as sender_avatar FROM chat_messages m INNER JOIN sellers s ON s.id = m.sender_id WHERE m.id = ?", [msgId]);
  return msg;
}
function createConversation(seller1Id, seller2Id, subject) {
  run("INSERT INTO chat_conversations (subject) VALUES (?)", [subject || '']);
  var convId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  run("INSERT INTO chat_participants (conversation_id, seller_id) VALUES (?,?)", [convId, seller1Id]);
  run("INSERT INTO chat_participants (conversation_id, seller_id) VALUES (?,?)", [convId, seller2Id]);
  return convId;
}
function getOrCreateConversation(seller1Id, seller2Id) {
  var existing = get("SELECT cp1.conversation_id as id FROM chat_participants cp1 INNER JOIN chat_participants cp2 ON cp2.conversation_id = cp1.conversation_id WHERE cp1.seller_id = ? AND cp2.seller_id = ?", [seller1Id, seller2Id]);
  if (existing) return existing.id;
  return createConversation(seller1Id, seller2Id, '');
}
function getUnreadMessageCount(sellerId) {
  var r = get("SELECT COUNT(*) as c FROM chat_messages m INNER JOIN chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.seller_id = ? WHERE m.sender_id != ? AND m.id > COALESCE((SELECT last_read_at FROM chat_participants WHERE conversation_id = m.conversation_id AND seller_id = ?),0)", [sellerId, sellerId, sellerId]);
  return r ? r.c : 0;
}
function searchSellers(query) {
  return query("SELECT id, name, avatar, bio FROM sellers WHERE status = 'active' AND (name LIKE ? OR email LIKE ?) LIMIT 20", ['%' + query + '%', '%' + query + '%']);
}

function updateSellerNotifPrefs(sellerId, prefs) {
  run("UPDATE sellers SET notify_email_sale = ?, notify_email_approve = ? WHERE id = ?", [prefs.notify_email_sale ? 1 : 0, prefs.notify_email_approve ? 1 : 0, sellerId]);
}

// === AUTHHIVE FUNCTIONS ===
function createUserAuth(uid, userType, passwordHash, mfaSecretEnc, pepperVer) {
  run("INSERT INTO users_auth (uid, user_type, argon_hash, mfa_secret_enc, pepper_ver) VALUES (?, ?, ?, ?, ?)",
    [uid, userType, passwordHash, mfaSecretEnc || '', pepperVer || 1]);
}

function getUserAuth(uid) {
  return get("SELECT * FROM users_auth WHERE uid = ?", [uid]);
}

function getUserAuthByTypeAndId(userType, userId) {
  return get("SELECT * FROM users_auth WHERE uid = ?", [userType + ':' + userId]);
}

function updateUserAuthHash(uid, newHash, pepperVer) {
  run("UPDATE users_auth SET argon_hash = ?, pepper_ver = ? WHERE uid = ?", [newHash, pepperVer, uid]);
}

function updateUserAuthMFA(uid, mfaSecretEnc, totpEnabled, recoveryHashes) {
  run("UPDATE users_auth SET mfa_secret_enc = ?, totp_enabled = ?, recovery_hashes = ? WHERE uid = ?",
    [mfaSecretEnc || '', totpEnabled ? 1 : 0, recoveryHashes || '', uid]);
}

function updateUserAuthPasskey(uid, passkeyId) {
  run("UPDATE users_auth SET passkey_id = ? WHERE uid = ?", [passkeyId || '', uid]);
}

function createAuthSession(sidHash, userUid, userType, deviceId, uaHash, ipZone, expiresAt) {
  run("INSERT INTO auth_sessions (sid_hash, user_uid, user_type, device_id, ua_hash, ip_zone, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [sidHash, userUid, userType, deviceId, uaHash, ipZone, expiresAt]);
}

function getAuthSession(sidHash) {
  return get("SELECT * FROM auth_sessions WHERE sid_hash = ? AND expires_at > datetime('now')", [sidHash]);
}

function updateAuthSessionLastSeen(sidHash) {
  run("UPDATE auth_sessions SET last_seen = datetime('now') WHERE sid_hash = ?", [sidHash]);
}

function updateAuthSessionBinding(sidHash, uaHash, ipZone) {
  run("UPDATE auth_sessions SET ua_hash = ?, ip_zone = ?, last_seen = datetime('now') WHERE sid_hash = ?", [uaHash, ipZone, sidHash]);
}

function deleteAuthSession(sidHash) {
  run("DELETE FROM auth_sessions WHERE sid_hash = ?", [sidHash]);
}

function deleteAllUserSessions(userUid) {
  run("DELETE FROM auth_sessions WHERE user_uid = ?", [userUid]);
}

function getUserSessions(userUid) {
  return query("SELECT * FROM auth_sessions WHERE user_uid = ? ORDER BY last_seen DESC", [userUid]);
}

function logAuthEvent(userUid, eventType, ip, userAgent, result, details) {
  run("INSERT INTO auth_events (user_uid, event_type, ip, user_agent, result, details) VALUES (?, ?, ?, ?, ?, ?)",
    [userUid, eventType, ip || '', userAgent || '', result, details || '']);
}

function getAuthEvents(userUid, limit) {
  return query("SELECT * FROM auth_events WHERE user_uid = ? ORDER BY created_at DESC LIMIT ?", [userUid, limit || 100]);
}

function createAuthDevice(userUid, deviceId, label, ip) {
  run("INSERT OR REPLACE INTO auth_devices (user_uid, device_id, label, last_ip, last_seen) VALUES (?, ?, ?, ?, datetime('now'))",
    [userUid, deviceId, label || '', ip || '']);
}

function getAuthDevices(userUid) {
  return query("SELECT * FROM auth_devices WHERE user_uid = ? ORDER BY last_seen DESC", [userUid]);
}

function revokeAuthDevice(userUid, deviceId) {
  run("UPDATE auth_devices SET revoked = 1 WHERE user_uid = ? AND device_id = ?", [userUid, deviceId]);
  run("DELETE FROM auth_sessions WHERE user_uid = ? AND device_id = ?", [userUid, deviceId]);
}

function updateAuthDeviceLabel(userUid, deviceId, label) {
  run("UPDATE auth_devices SET label = ? WHERE user_uid = ? AND device_id = ?", [label, userUid, deviceId]);
}

function cleanupExpiredSessions() {
  run("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')");
}

// === CUSTOMERS (compradores) ===
function getCustomerByEmail(email) {
  return get('SELECT * FROM customers WHERE email = ?', [email]);
}

function getCustomerById(id) {
  return get('SELECT * FROM customers WHERE id = ?', [id]);
}

function createCustomer(name, email, phone, passwordHash) {
  run('INSERT INTO customers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [name, email, phone || '', passwordHash]);
  const r = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  return r;
}

function updateCustomer(id, name, phone, email) {
  run('UPDATE customers SET name = ?, phone = ?, email = ? WHERE id = ?', [name, phone || '', email, id]);
}

function updateCustomerPassword(id, passwordHash) {
  run('UPDATE customers SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

function getCustomerAddresses(customerId) {
  return query('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY created_at DESC', [customerId]);
}

function getCustomerAddress(addressId, customerId) {
  return get('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?', [addressId, customerId]);
}

function createCustomerAddress(customerId, label, recipient, address, city, state, zip) {
  run('INSERT INTO customer_addresses (customer_id, label, recipient, address, city, state, zip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [customerId, label || 'Principal', recipient || '', address, city || '', state || '', zip || '']);
}

function updateCustomerAddress(addressId, customerId, label, recipient, address, city, state, zip) {
  run('UPDATE customer_addresses SET label = ?, recipient = ?, address = ?, city = ?, state = ?, zip = ? WHERE id = ? AND customer_id = ?',
    [label || 'Principal', recipient || '', address, city || '', state || '', zip || '', addressId, customerId]);
}

function deleteCustomerAddress(addressId, customerId) {
  run('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?', [addressId, customerId]);
}

function getCustomerOrders(customerId) {
  return query("SELECT s.*, p.image as product_image, p.name as product_name_join FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.customer_id = ? ORDER BY s.created_at DESC", [customerId]);
}

// === AUDITORIA IA ===
function getAuditFindingStatuses() {
  try {
    return query("SELECT code, status FROM audit_findings_status");
  } catch(e) { return []; }
}

function getAuditFindingStatus(code) {
  try {
    return get("SELECT * FROM audit_findings_status WHERE code = ?", [code]);
  } catch(e) { return null; }
}

function setAuditFindingStatus(code, status) {
  try {
    run("INSERT INTO audit_findings_status (code, status, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(code) DO UPDATE SET status = excluded.status, updated_at = datetime('now')",
      [code, status || 'open']);
  } catch(e) {}
}

// === ARMAZENAMENTO PERSISTENTE DE UPLOADS ===
function saveFileToStore(filename, data, contentType) {
  try {
    if (!data) return;
    var buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    run('INSERT INTO file_store (filename, data, content_type, size, created_at) VALUES (?, ?, ?, ?, datetime("now")) ON CONFLICT(filename) DO UPDATE SET data = excluded.data, content_type = excluded.content_type, size = excluded.size, created_at = datetime("now")',
      [filename, buf, contentType || '', buf.length]);
  } catch(e) { console.error('[file_store] save error:', e.message); }
}

function getFileFromStore(filename) {
  try {
    var r = get('SELECT data, content_type FROM file_store WHERE filename = ?', [filename]);
    if (!r || !r.data) return null;
    return { data: r.data, contentType: r.content_type || 'application/octet-stream' };
  } catch(e) { return null; }
}

function deleteFileFromStore(filename) {
  try { run('DELETE FROM file_store WHERE filename = ?', [filename]); } catch(e) {}
}

function fileExistsInStore(filename) {
  try { return !!get('SELECT 1 as x FROM file_store WHERE filename = ?', [filename]); } catch(e) { return false; }
}

// Backfill: copia arquivos existentes em public/uploads para o file_store
function backfillFileStore(uploadsDir) {
  var fsx = require('fs');
  var pathx = require('path');
  if (!fsx.existsSync(uploadsDir)) return 0;
  var count = 0;
  try {
    var files = fsx.readdirSync(uploadsDir);
    files.forEach(function(f) {
      var full = pathx.join(uploadsDir, f);
      var st = fsx.statSync(full);
      if (!st.isFile()) return;
      if (fileExistsInStore(f)) return;
      try {
        var data = fsx.readFileSync(full);
        saveFileToStore(f, data, 'application/octet-stream');
        count++;
      } catch(e) {}
    });
  } catch(e) {}
  return count;
}

// === NOTÍCIAS ===
function getNews(opts) {
  opts = opts || {};
  var sql = "SELECT n.* FROM news n WHERE 1=1";
  var params = [];
  if (opts.category) { sql += " AND n.category = ?"; params.push(opts.category); }
  if (opts.search) { sql += " AND (n.title LIKE ? OR n.excerpt LIKE ?)"; params.push('%' + opts.search + '%', '%' + opts.search + '%'); }
  if (opts.video) { sql += " AND n.video IS NOT NULL AND n.video <> ''"; }
  if (opts.published === undefined || opts.published === true) { sql += " AND n.published = 1"; }
  sql += " ORDER BY n.featured DESC, n.created_at DESC";
  if (opts.offset && opts.limit) {
    sql += " LIMIT ? OFFSET ?";
    params.push(parseInt(opts.limit), parseInt(opts.offset));
  } else if (opts.limit) {
    sql += " LIMIT ?";
    params.push(parseInt(opts.limit));
  }
  return query(sql, params);
}
function getNewsCount(opts) {
  opts = opts || {};
  var sql = "SELECT COUNT(*) as c FROM news n WHERE 1=1";
  var params = [];
  if (opts.category) { sql += " AND n.category = ?"; params.push(opts.category); }
  if (opts.search) { sql += " AND (n.title LIKE ? OR n.excerpt LIKE ?)"; params.push('%' + opts.search + '%', '%' + opts.search + '%'); }
  if (opts.video) { sql += " AND n.video IS NOT NULL AND n.video <> ''"; }
  if (opts.published === undefined || opts.published === true) { sql += " AND n.published = 1"; }
  var r = query(sql, params);
  return r && r[0] ? r[0].c : 0;
}

function getNewsById(id) { return get("SELECT * FROM news WHERE id = ?", [id]); }
function getNewsBySlug(slug) { return get("SELECT * FROM news WHERE slug = ?", [slug]); }
function getNewsCategories() { return query("SELECT DISTINCT category FROM news WHERE published = 1 ORDER BY category"); }
function getFeaturedNews(limit) { return query("SELECT * FROM news WHERE published = 1 AND featured = 1 ORDER BY created_at DESC LIMIT ?", [limit || 5]); }
function saveNews(data, id) {
  var title = String(data.title || '').trim().slice(0, 200);
  var slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
  if (!slug) slug = 'noticia-' + Date.now();
  var video = (data.video && String(data.video).trim()) ? String(data.video).trim() : null;
  if (id) {
    run("UPDATE news SET title=?, slug=?, excerpt=?, content=?, category=?, image=?, author=?, featured=?, published=?, video=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [title, slug, (data.excerpt || '').slice(0, 500), data.content || '', data.category || 'jogos', data.image || null, data.author || 'Redação', data.featured ? 1 : 0, data.published === undefined ? 1 : (data.published ? 1 : 0), video, id]);
    return id;
  }
  run("INSERT INTO news (title, slug, excerpt, content, category, image, author, featured, published, video) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [title, slug, (data.excerpt || '').slice(0, 500), data.content || '', data.category || 'jogos', data.image || null, data.author || 'Redação', data.featured ? 1 : 0, data.published === undefined ? 1 : (data.published ? 1 : 0), video]);
  var r = get("SELECT MAX(id) as id FROM news");
  return r ? r.id : null;
}
function deleteNews(id) { run("DELETE FROM news WHERE id = ?", [id]); }
function toggleNewsPublish(id) { run("UPDATE news SET published = CASE WHEN published = 1 THEN 0 ELSE 1 END WHERE id = ?", [id]); }
function toggleNewsFeatured(id) { run("UPDATE news SET featured = CASE WHEN featured = 1 THEN 0 ELSE 1 END WHERE id = ?", [id]); }
function incrementNewsViews(id) { run("UPDATE news SET views = COALESCE(views,0) + 1 WHERE id = ?", [id]); }
function addNewsReaction(newsId, type, ip) {
  try {
    run("INSERT INTO news_reactions (news_id, type, ip, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", [newsId, type, ip || '']);
    return true;
  } catch (e) {
    return false;
  }
}
function getNewsReactionCounts(newsId) {
  return query("SELECT type, COUNT(*) as c FROM news_reactions WHERE news_id = ? GROUP BY type", [newsId]) || [];
}
function getUserNewsReaction(newsId, ip) {
  var r = get("SELECT type FROM news_reactions WHERE news_id = ? AND ip = ?", [newsId, ip || '']);
  return r ? r.type : null;
}
function removeNewsReaction(newsId, type, ip) {
  run("DELETE FROM news_reactions WHERE news_id = ? AND type = ? AND ip = ?", [newsId, type, ip || '']);
}

// === PRODUTOS DIGITAIS / LOGINS ===
function getDigitalProducts(opts) {
  opts = opts || {};
  var sql = "SELECT dp.*, (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id = dp.id AND ds.status = 'available') as stock_count FROM digital_products dp WHERE 1=1";
  var params = [];
  if (opts.category) { sql += " AND dp.category = ?"; params.push(opts.category); }
  if (opts.search) {
    var s = '%' + String(opts.search).trim() + '%';
    sql += " AND (dp.name LIKE ? OR dp.description LIKE ? OR dp.category LIKE ? OR dp.badge LIKE ?)";
    params.push(s, s, s, s);
  }
  if (opts.instock) {
    sql += " AND (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id = dp.id AND ds.status = 'available') > 0";
  }
  if (opts.active) { sql += " AND dp.status = 'active'"; }
  if (opts.sort === 'price_asc') sql += " ORDER BY dp.price ASC";
  else if (opts.sort === 'price_desc') sql += " ORDER BY dp.price DESC";
  else if (opts.sort === 'sold') sql += " ORDER BY dp.sold_count DESC";
  else sql += " ORDER BY dp.created_at DESC";
  return query(sql, params);
}
function getDigitalProductById(id) {
  return get("SELECT dp.*, (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id = dp.id AND ds.status = 'available') as stock_count FROM digital_products dp WHERE dp.id = ?", [id]);
}
function getDigitalProductBySlug(slug) {
  return get("SELECT dp.*, (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id = dp.id AND ds.status = 'available') as stock_count FROM digital_products dp WHERE dp.slug = ?", [slug]);
}
function saveDigitalProduct(data, id) {
  var name = String(data.name || '').trim().slice(0, 200);
  var slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
  if (!slug) slug = 'login-' + Date.now();
  var price = Math.max(0, parseFloat(data.price) || 0);
  var featured = (data.featured == 1 || data.featured === '1' || data.featured === true || data.featured === 'on') ? 1 : 0;
  if (id) {
    run("UPDATE digital_products SET name=?, slug=?, description=?, price=?, category=?, image=?, badge=?, status=?, featured=? WHERE id=?",
      [name, slug, data.description || '', price, data.category || 'outros', data.image || null, data.badge || null, data.status || 'active', featured, id]);
    return id;
  }
  run("INSERT INTO digital_products (name, slug, description, price, category, image, badge, status, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [name, slug, data.description || '', price, data.category || 'outros', data.image || null, data.badge || null, data.status || 'active', featured]);
  var r = get("SELECT MAX(id) as id FROM digital_products");
  return r ? r.id : null;
}

function getFeaturedDigitalProducts(limit) {
  limit = parseInt(limit) || 5;
  return query(
    "SELECT dp.*, (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id = dp.id AND ds.status = 'available') as stock_count FROM digital_products dp WHERE dp.featured = 1 AND dp.status = 'active' ORDER BY dp.created_at DESC LIMIT ?",
    [limit]
  );
}
function deleteDigitalProduct(id) { run("DELETE FROM digital_products WHERE id = ?", [id]); run("DELETE FROM digital_stock WHERE product_id = ?", [id]); }
function toggleDigitalProduct(id) { run("UPDATE digital_products SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END WHERE id = ?", [id]); }
function getDigitalStock(productId) {
  return query("SELECT ds.*, (SELECT name FROM digital_products WHERE id = ds.product_id) as product_name FROM digital_stock ds WHERE ds.product_id = ? ORDER BY ds.status, ds.id DESC", [productId]);
}
function getDigitalStockById(id) { return get("SELECT * FROM digital_stock WHERE id = ?", [id]); }
function getAvailableDigitalStock(productId) {
  return get("SELECT * FROM digital_stock WHERE product_id = ? AND status = 'available' ORDER BY id ASC LIMIT 1", [productId]);
}
function getDigitalAvailableCount(productId) {
  var r = get("SELECT COUNT(*) as c FROM digital_stock WHERE product_id = ? AND status = 'available'", [productId]);
  return r ? r.c : 0;
}
function addDigitalStock(productId, credential, password, note) {
  run("INSERT INTO digital_stock (product_id, credential, password, note) VALUES (?, ?, ?, ?)", [productId, credential, password || '', note || '']);
}
function deleteDigitalStock(id) { run("DELETE FROM digital_stock WHERE id = ?", [id]); }
function markDigitalStockSold(stockId, saleId) {
  run("UPDATE digital_stock SET status = 'sold', sale_id = ? WHERE id = ?", [saleId, stockId]);
}
function createDigitalSale(data) {
  run("INSERT INTO digital_sales (product_id, stock_id, buyer_name, buyer_email, buyer_phone, delivery_channel, delivery_contact, observation, price, delivery_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [data.product_id, data.stock_id || null, data.buyer_name || '', data.buyer_email || '', data.buyer_phone || '', data.delivery_channel || '', data.delivery_contact || '', data.observation || '', data.price || 0, data.delivery_code, data.status || 'confirmed']);
  var r = get("SELECT MAX(id) as id FROM digital_sales");
  return r ? r.id : null;
}
function getDigitalSaleByDeliveryCode(code) {
  return get("SELECT ds.*, dp.name as product_name, dp.image as product_image, dsk.credential, dsk.password, dsk.note FROM digital_sales ds LEFT JOIN digital_products dp ON ds.product_id = dp.id LEFT JOIN digital_stock dsk ON ds.stock_id = dsk.id WHERE ds.delivery_code = ?", [code]);
}
function getDigitalSales(limit) {
  return query("SELECT ds.*, dp.name as product_name, dp.image as product_image FROM digital_sales ds LEFT JOIN digital_products dp ON ds.product_id = dp.id ORDER BY ds.id DESC LIMIT ?", [limit || 100]);
}
function getDigitalStockBySaleId(saleId) { return get("SELECT * FROM digital_stock WHERE sale_id = ?", [saleId]); }
function incrementDigitalSold(productId) { run("UPDATE digital_products SET sold_count = COALESCE(sold_count,0) + 1 WHERE id = ?", [productId]); }

module.exports = { initDb, getDb, query, get, run, saveDb, reloadFromDisk, addNotification, getUnreadNotifications, getNotifications, markNotificationRead, markAllNotificationsRead, getNotificationCount, getPasswordPolicy, validatePassword, addTransaction, getWalletBalance, getWalletTransactions, getAllTransactions, getCommissionPct, gerarCodigoRastreio, createTrackingHistory, getTrackingHistory, getSaleByTrackingCode, getPayouts, getPayoutCount, getPendingPayoutsCount, createPayout, refundSale, getTransactionsByPeriod, getFinanceSummary, getFinanceChart, addSaleProof, getSaleProofs, getPage, getAllPages, savePage, deletePage, getCoupon, getAllCoupons, saveCoupon, deleteCoupon, updateCoupon, toggleCoupon, resetCouponUses, getCouponById, incrementCoupon, getActiveBanners, getBannersByPosition, getAllBanners, saveBanner, deleteBanner, incrementBannerClicks, logActivity, getActivityLog, getActivityLogCount, isIpBlocked, getBlockedIps, blockIp, unblockIp, logLoginAttempt, getLoginAttempts, getToggle, setToggle, getAllToggles, getFlashSales, setFlashSale, removeFlashSale, cleanupOldData, notifyAllSellers, getSellerSalesSummary, getSellerChartData, getSellerTopProducts, getSellerProductViews, getProductQuestions, getSellerQuestions, askQuestion, answerQuestion, cloneProduct, getActiveGoal, getSellerGoalProgress, getGoalLeaderboard, getAllGoals, saveGoal, toggleGoal, markGoalWinner, deleteGoal, getSellerSalesCsv, getMarketingTemplates, getMarketingTemplate, saveMarketingTemplate, deleteMarketingTemplate, getMarketingCampaigns, getMarketingCampaign, getMarketingCampaignResults, createMarketingCampaign, addMarketingCampaignResult, updateMarketingCampaignStats, getMarketingStats, getMarketingLists, getMarketingList, createMarketingList, deleteMarketingList, getMarketingListMembers, addMarketingListMember, deleteMarketingListMember, getAutoReplies, getAutoReply, saveAutoReply, updateAutoReply, deleteAutoReply, toggleAutoReply, getMarketingSchedules, getPendingMarketingSchedules, createMarketingSchedule, markMarketingScheduleDone, deleteMarketingSchedule, getMarketingFullStats, getSellerConversations, getConversationParticipants, getConversationMessages, sendMessage, createConversation, getOrCreateConversation, getUnreadMessageCount, searchSellers, updateSellerNotifPrefs, createUserAuth, getUserAuth, getUserAuthByTypeAndId, updateUserAuthHash, updateUserAuthMFA, updateUserAuthPasskey, createAuthSession, getAuthSession, updateAuthSessionLastSeen, updateAuthSessionBinding, deleteAuthSession, deleteAllUserSessions, getUserSessions, logAuthEvent, getAuthEvents, createAuthDevice, getAuthDevices, revokeAuthDevice, updateAuthDeviceLabel, cleanupExpiredSessions, getCustomerByEmail, getCustomerById, createCustomer, updateCustomer, updateCustomerPassword, getCustomerAddresses, getCustomerAddress, createCustomerAddress, updateCustomerAddress, deleteCustomerAddress, getCustomerOrders, getAuditFindingStatuses, getAuditFindingStatus, setAuditFindingStatus, saveFileToStore, getFileFromStore, deleteFileFromStore, fileExistsInStore, backfillFileStore, getNews, getNewsCount, getNewsById, getNewsBySlug, getNewsCategories, getFeaturedNews, saveNews, deleteNews, toggleNewsPublish, toggleNewsFeatured, incrementNewsViews, addNewsReaction, getNewsReactionCounts, getUserNewsReaction, removeNewsReaction, getDigitalProducts, getDigitalProductById, getDigitalProductBySlug, saveDigitalProduct, getFeaturedDigitalProducts, deleteDigitalProduct, toggleDigitalProduct, getDigitalStock, getDigitalStockById, getAvailableDigitalStock, getDigitalAvailableCount, addDigitalStock, deleteDigitalStock, markDigitalStockSold, createDigitalSale, getDigitalSaleByDeliveryCode, getDigitalSales, getDigitalStockBySaleId, incrementDigitalSold };
