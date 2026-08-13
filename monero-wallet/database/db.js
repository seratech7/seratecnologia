const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'database.sqlite');

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      balance_atomic TEXT NOT NULL DEFAULT '0',
      totp_secret TEXT DEFAULT '',
      totp_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'Admin',
      totp_secret TEXT DEFAULT '',
      totp_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      address TEXT UNIQUE NOT NULL,
      label TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      txid TEXT UNIQUE NOT NULL,
      amount_atomic TEXT NOT NULL,
      confirmations INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      amount_atomic TEXT NOT NULL,
      fee_atomic TEXT NOT NULL,
      txid TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT DEFAULT '',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      processed_by INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount_atomic TEXT NOT NULL,
      balance_after_atomic TEXT NOT NULL,
      description TEXT DEFAULT '',
      reference_type TEXT DEFAULT '',
      reference_id INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_atomic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      reference TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER DEFAULT 0,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      txid TEXT UNIQUE NOT NULL,
      amount_atomic TEXT NOT NULL,
      confirmations INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const defaults = {
    site_name: 'MoneroWallet',
    maintenance_mode: '0',
    min_confirmations: String(process.env.MIN_CONFIRMATIONS || 10),
    withdrawal_fee_atomic: xmrToAtomic(process.env.WITHDRAWAL_FEE_XMR || '0.0001'),
    withdrawal_enabled: '1',
    registration_open: '1'
  };
  Object.keys(defaults).forEach(function (k) {
    if (!get("SELECT key FROM settings WHERE key = ?", [k])) {
      run("INSERT INTO settings (key, value) VALUES (?, ?)", [k, defaults[k]]);
    }
  });

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD;
  const weakPasswords = ['admin', 'admin123', 'password', '123456', 'senha'];
  if (!adminPass || adminPass.length < 8 || weakPasswords.includes(adminPass.toLowerCase()) ||
      !/[A-Z]/.test(adminPass) || !/\d/.test(adminPass)) {
    console.error('❌ ERRO: ADMIN_PASSWORD no .env é fraca. Use no mínimo 8 caracteres com maiúscula e número.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(adminPass, 12);
  run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, adminUser]);
  const adminCount = get("SELECT COUNT(*) as c FROM admins WHERE username = ?", [adminUser]);
  if (!adminCount || adminCount.c === 0) {
    run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', [adminUser, hash, 'Administrador']);
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
    while (stmt.step()) results.push(stmt.getAsObject());
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

function xmrToAtomic(xmr) {
  const s = String(xmr).trim();
  if (!/^\d+(\.\d{1,12})?$/.test(s)) throw new Error('Valor XMR inválido');
  const [i, f] = s.split('.');
  const frac = (f || '').padEnd(12, '0');
  return (BigInt(i) * 1000000000000n + BigInt(frac)).toString();
}

function atomicToXmr(atomic) {
  let a = BigInt(atomic);
  const neg = a < 0n;
  a = neg ? -a : a;
  const whole = a / 1000000000000n;
  const frac = (a % 1000000000000n).toString().padStart(12, '0').replace(/0+$/, '');
  const num = frac ? whole.toString() + '.' + frac : whole.toString();
  return neg ? '-' + num : num;
}

function formatXmr(atomic) {
  const num = atomicToXmr(atomic);
  const [w, f] = num.split('.');
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return f ? whole + ',' + f : whole;
}

// === USERS ===
function createUser(email, passwordHash, displayName) {
  run('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)', [email, passwordHash, displayName || '']);
  const u = get('SELECT * FROM users WHERE email = ?', [email]);
  return u;
}

function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [email]);
}

function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

function getUserBalance(id) {
  const u = getUserById(id);
  return u ? u.balance_atomic : '0';
}

function updateUserBalance(id, newBalanceAtomic) {
  run('UPDATE users SET balance_atomic = ? WHERE id = ?', [newBalanceAtomic, id]);
}

function setUserStatus(id, status) {
  run('UPDATE users SET status = ? WHERE id = ?', [status, id]);
}

function updateLastLogin(id) {
  run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

function listUsers(limit, offset) {
  return query('SELECT id, email, display_name, role, status, balance_atomic, totp_enabled, created_at, last_login_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?', [limit || 100, offset || 0]);
}

function countUsers() {
  const r = get('SELECT COUNT(*) as c FROM users');
  return r ? r.c : 0;
}

function countUsersByStatus(status) {
  const r = get('SELECT COUNT(*) as c FROM users WHERE status = ?', [status]);
  return r ? r.c : 0;
}

// === 2FA ===
function setUserTotp(id, secret, enabled) {
  run('UPDATE users SET totp_secret = ?, totp_enabled = ? WHERE id = ?', [secret || '', enabled ? 1 : 0, id]);
}

function getUserTotp(id) {
  const u = getUserById(id);
  return u ? { secret: u.totp_secret || '', enabled: !!u.totp_enabled } : { secret: '', enabled: false };
}

// === ADDRESSES ===
function createAddress(userId, address, label) {
  run('INSERT INTO user_addresses (user_id, address, label) VALUES (?, ?, ?)', [userId, address, label || '']);
  return get('SELECT * FROM user_addresses WHERE address = ?', [address]);
}

function getAddressByUser(userId) {
  return get('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY id ASC LIMIT 1', [userId]);
}

function getUserByAddress(address) {
  const a = get('SELECT * FROM user_addresses WHERE address = ?', [address]);
  return a ? getUserById(a.user_id) : null;
}

function getAllAddresses() {
  return query('SELECT * FROM user_addresses ORDER BY id ASC');
}

// === DEPOSITS ===
function createDeposit(userId, address, txid, amountAtomic, confirmations) {
  run('INSERT INTO deposits (user_id, address, txid, amount_atomic, confirmations) VALUES (?, ?, ?, ?, ?)',
    [userId, address, txid, amountAtomic, confirmations || 0]);
  return get('SELECT * FROM deposits WHERE txid = ?', [txid]);
}

function getDepositByTxid(txid) {
  return get('SELECT * FROM deposits WHERE txid = ?', [txid]);
}

function updateDepositConfirmations(id, confirmations) {
  run('UPDATE deposits SET confirmations = ? WHERE id = ?', [confirmations, id]);
}

function confirmDeposit(id, userId, amountAtomic) {
  run("UPDATE deposits SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  const oldBal = getUserBalance(userId);
  const newBal = (BigInt(oldBal) + BigInt(amountAtomic)).toString();
  updateUserBalance(userId, newBal);
  run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, 'deposit', amountAtomic, newBal, 'Depósito recebido', 'deposit', id]);
}

function listDeposits(limit, offset) {
  return query('SELECT d.*, u.email as user_email, u.display_name as user_name FROM deposits d LEFT JOIN users u ON d.user_id = u.id ORDER BY d.id DESC LIMIT ? OFFSET ?', [limit || 100, offset || 0]);
}

function listDepositsByUser(userId, limit, offset) {
  return query('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, limit || 50, offset || 0]);
}

function countPendingDeposits() {
  const r = get("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'");
  return r ? r.c : 0;
}

function sumConfirmedDeposits() {
  const r = get("SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) as s FROM deposits WHERE status = 'confirmed'");
  return r ? r.s : 0;
}

// === WITHDRAWALS ===
function createWithdrawal(userId, address, amountAtomic, feeAtomic) {
  run('INSERT INTO withdrawals (user_id, address, amount_atomic, fee_atomic) VALUES (?, ?, ?, ?)',
    [userId, address, amountAtomic, feeAtomic]);
  return get('SELECT * FROM withdrawals WHERE id = (SELECT MAX(id) FROM withdrawals)');
}

function getWithdrawal(id) {
  return get('SELECT * FROM withdrawals WHERE id = ?', [id]);
}

function updateWithdrawal(id, fields) {
  const sets = Object.keys(fields).map(k => k + ' = ?').join(', ');
  const vals = Object.values(fields);
  run('UPDATE withdrawals SET ' + sets + ' WHERE id = ?', vals.concat([id]));
}

function listWithdrawals(limit, offset) {
  return query('SELECT w.*, u.email as user_email, u.display_name as user_name FROM withdrawals w LEFT JOIN users u ON w.user_id = u.id ORDER BY w.id DESC LIMIT ? OFFSET ?', [limit || 100, offset || 0]);
}

function listWithdrawalsByUser(userId, limit, offset) {
  return query('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, limit || 50, offset || 0]);
}

function countPendingWithdrawals() {
  const r = get("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'");
  return r ? r.c : 0;
}

// === TRANSACTIONS ===
function listTransactions(userId, limit, offset) {
  return query('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [userId, limit || 50, offset || 0]);
}

function listAllTransactions(limit, offset) {
  return query('SELECT t.*, u.email as user_email, u.display_name as user_name FROM transactions t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.id DESC LIMIT ? OFFSET ?', [limit || 100, offset || 0]);
}

function sumTransactionsByType(type) {
  const r = get('SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) as s FROM transactions WHERE type = ?', [type]);
  return r ? r.s : 0;
}

// === HOLDS (integração marketplace) ===
function createHold(userId, amountAtomic, reference) {
  run('INSERT INTO holds (user_id, amount_atomic, reference) VALUES (?, ?, ?)', [userId, amountAtomic, reference || '']);
  return get('SELECT * FROM holds WHERE id = (SELECT MAX(id) FROM holds)');
}

function getHold(id) {
  return get('SELECT * FROM holds WHERE id = ?', [id]);
}

function releaseHold(id) {
  const h = getHold(id);
  if (!h || h.status !== 'held') return null;
  run("UPDATE holds SET status = 'released' WHERE id = ?", [id]);
  const oldBal = getUserBalance(h.user_id);
  const newBal = (BigInt(oldBal) + BigInt(h.amount_atomic)).toString();
  updateUserBalance(h.user_id, newBal);
  run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [h.user_id, 'release', h.amount_atomic, newBal, 'Reembolso de reserva', 'hold', id]);
  return h;
}

function captureHold(id) {
  const h = getHold(id);
  if (!h || h.status !== 'held') return null;
  run("UPDATE holds SET status = 'captured' WHERE id = ?", [id]);
  run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [h.user_id, 'debit', h.amount_atomic, getUserBalance(h.user_id), 'Pagamento capturado', 'hold', id]);
  return h;
}

function sumHeld() {
  const r = get("SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) as s FROM holds WHERE status = 'held'");
  return r ? r.s : 0;
}

// === ADMIN ===
function getAdminByUsername(username) {
  return get('SELECT * FROM admins WHERE username = ?', [username]);
}

function getAdminById(id) {
  return get('SELECT * FROM admins WHERE id = ?', [id]);
}

function updateAdminTotp(id, secret, enabled) {
  run('UPDATE admins SET totp_secret = ?, totp_enabled = ? WHERE id = ?', [secret || '', enabled ? 1 : 0, id]);
}

function logAudit(adminId, action, details, ip) {
  run('INSERT INTO audit_log (admin_id, action, details, ip) VALUES (?, ?, ?, ?)', [adminId || 0, action, details || '', ip || '']);
}

function listAudit(limit, offset) {
  return query('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?', [limit || 100, offset || 0]);
}

// === SETTINGS ===
function getSetting(key) {
  const r = get('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : null;
}

function setSetting(key, value) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

// === MOCK TRANSFERS (simulação de depósito sem node) ===
function insertMockTransfer(address, txid, amountAtomic, confirmations) {
  try {
    run('INSERT INTO mock_transfers (address, txid, amount_atomic, confirmations) VALUES (?, ?, ?, ?)',
      [address, txid, amountAtomic, confirmations || 0]);
    return get('SELECT * FROM mock_transfers WHERE txid = ?', [txid]);
  } catch (e) {
    return null;
  }
}

function listMockTransfers() {
  return query('SELECT * FROM mock_transfers ORDER BY id DESC');
}

function incrementMockConfirmations() {
  run('UPDATE mock_transfers SET confirmations = confirmations + 1');
}

function getMockTransfers() {
  return query('SELECT * FROM mock_transfers ORDER BY id ASC');
}

function deleteMockTransfer(id) {
  run('DELETE FROM mock_transfers WHERE id = ?', [id]);
}

module.exports = {
  initDb, query, get, run, saveDb,
  xmrToAtomic, atomicToXmr, formatXmr,
  createUser, getUserByEmail, getUserById, getUserBalance, updateUserBalance,
  setUserStatus, updateLastLogin, listUsers, countUsers, countUsersByStatus,
  setUserTotp, getUserTotp,
  createAddress, getAddressByUser, getUserByAddress, getAllAddresses,
  createDeposit, getDepositByTxid, updateDepositConfirmations, confirmDeposit,
  listDeposits, listDepositsByUser, countPendingDeposits, sumConfirmedDeposits,
  createWithdrawal, getWithdrawal, updateWithdrawal, listWithdrawals, listWithdrawalsByUser, countPendingWithdrawals,
  listTransactions, listAllTransactions, sumTransactionsByType,
  createHold, getHold, releaseHold, captureHold, sumHeld,
  getAdminByUsername, getAdminById, updateAdminTotp, logAudit, listAudit,
  getSetting, setSetting,
  insertMockTransfer, listMockTransfers, incrementMockConfirmations, getMockTransfers, deleteMockTransfer
};