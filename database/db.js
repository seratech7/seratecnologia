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

  const adminResult = db.exec('SELECT COUNT(*) as count FROM admins');
  const adminCount = adminResult.length > 0 && adminResult[0].values.length > 0 ? adminResult[0].values[0][0] : 0;
  if (adminCount === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    if (adminPass === 'admin123') {
      console.warn('⚠️  AVISO: Use ADMIN_PASSWORD no .env para definir uma senha forte!');
    }
    const hash = bcrypt.hashSync(adminPass, 12);
    db.run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', ['admin', hash, 'Administrador']);
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

module.exports = { initDb, getDb, query, get, run, saveDb };
