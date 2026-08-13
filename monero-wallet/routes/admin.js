const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');
const db = require('../database/db');
const { requireAdmin, redirectIfAdmin } = require('../middleware/auth');
const { getWallet } = require('../lib/wallet');
const { processIncomingTransfers } = require('../lib/scanner');

const router = express.Router();

// ===== LOGIN =====
router.get('/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', { title: 'Login Admin', error: null, csrfToken: res.locals.csrfToken });
});

router.post('/login', redirectIfAdmin, (req, res) => {
  const { username, password, totp } = req.body;
  const admin = db.getAdminByUsername((username || '').trim());
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).render('admin/login', { title: 'Login Admin', error: 'Usuário ou senha incorretos.', csrfToken: res.locals.csrfToken });
  }
  if (admin.totp_enabled) {
    const verified = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: (totp || '').replace(/\s/g, '') });
    if (!verified) {
      return res.status(401).render('admin/login', { title: 'Login Admin', error: 'Código 2FA inválido.', csrfToken: res.locals.csrfToken });
    }
  }
  req.session.adminId = admin.id;
  req.session.adminName = admin.display_name;
  db.logAudit(admin.id, 'admin_login', 'Login realizado', req.ip);
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireAdmin);

router.use((req, res, next) => {
  res.locals.admin = req.admin;
  res.locals.adminPath = require('../config').SECRET_ADMIN;
  next();
});

// ===== DASHBOARD =====
router.get('/', async (req, res) => {
  const wallet = await getWallet();
  let balance = null;
  try { balance = await wallet.getBalance(); } catch (e) {}

  const users = db.countUsers();
  const activeUsers = db.countUsersByStatus('active');
  const blockedUsers = db.countUsersByStatus('blocked');
  const pendingDeposits = db.countPendingDeposits();
  const pendingWithdrawals = db.countPendingWithdrawals();
  const totalHeld = db.sumHeld();
  const totalDeposited = db.sumConfirmedDeposits();
  const totalWithdrawn = db.sumTransactionsByType('withdraw');

  const recentDeposits = db.listDeposits(8, 0);
  const recentWithdrawals = db.listWithdrawals(8, 0);
  const recentUsers = db.listUsers(8, 0);

  res.render('admin/dashboard', {
    title: 'Painel Admin',
    balance, users, activeUsers, blockedUsers, pendingDeposits, pendingWithdrawals,
    totalHeld, totalDeposited, totalWithdrawn,
    recentDeposits, recentWithdrawals, recentUsers,
    fmt: db.formatXmr, csrfToken: res.locals.csrfToken
  });
});

// ===== USUÁRIOS =====
router.get('/users', (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;
  const users = db.listUsers(limit, offset);
  const total = db.countUsers();
  const pages = Math.max(1, Math.ceil(total / limit));
  res.render('admin/users', { title: 'Usuários', users, fmt: db.formatXmr, page, pages, csrfToken: res.locals.csrfToken });
});

router.get('/users/:id', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).render('404', { title: 'Não encontrado' });
  const txns = db.listTransactions(user.id, 30, 0);
  const deposits = db.listDepositsByUser(user.id, 30, 0);
  const withdrawals = db.listWithdrawalsByUser(user.id, 30, 0);
  res.render('admin/user-detail', { title: 'Usuário #' + user.id, user, txns, deposits, withdrawals, fmt: db.formatXmr, csrfToken: res.locals.csrfToken });
});

// Ajuste manual de saldo (crédito/débito)
router.post('/users/:id/balance', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { amount, description, direction } = req.body;
  let amountAtomic;
  try { amountAtomic = db.xmrToAtomic(amount); } catch (e) { return res.status(400).json({ error: 'Valor inválido.' }); }

  const isDebit = direction === 'debit';
  const delta = isDebit ? -BigInt(amountAtomic) : BigInt(amountAtomic);
  const newBal = (BigInt(user.balance_atomic) + delta).toString();
  if (newBal < 0) return res.status(400).json({ error: 'Saldo não pode ficar negativo.' });

  db.updateUserBalance(user.id, newBal);
  db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, 'adjustment', (isDebit ? '-' : '') + amountAtomic, newBal, description || 'Ajuste manual (admin)', 'admin', req.admin.id]);
  db.logAudit(req.admin.id, 'balance_adjustment', 'Ajuste de saldo do usuário #' + user.id + ': ' + (isDebit ? '-' : '+') + amount + ' XMR', req.ip);
  res.json({ ok: true, balance: newBal });
});

router.post('/users/:id/status', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const status = req.body.status === 'blocked' ? 'blocked' : 'active';
  db.setUserStatus(user.id, status);
  db.logAudit(req.admin.id, 'user_status', 'Usuário #' + user.id + ' agora está ' + status, req.ip);
  res.json({ ok: true });
});

router.post('/users/:id/delete', (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (BigInt(user.balance_atomic) !== 0n) return res.status(400).json({ error: 'Não é possível excluir usuário com saldo. Zere o saldo primeiro.' });
  db.run('DELETE FROM user_addresses WHERE user_id = ?', [user.id]);
  db.run('DELETE FROM transactions WHERE user_id = ?', [user.id]);
  db.run('DELETE FROM withdrawals WHERE user_id = ?', [user.id]);
  db.run('DELETE FROM deposits WHERE user_id = ?', [user.id]);
  db.run('DELETE FROM holds WHERE user_id = ?', [user.id]);
  db.run('DELETE FROM users WHERE id = ?', [user.id]);
  db.logAudit(req.admin.id, 'user_delete', 'Usuário #' + user.id + ' excluído', req.ip);
  res.json({ ok: true });
});

// ===== DEPÓSITOS =====
router.get('/deposits', (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;
  const deposits = db.listDeposits(limit, offset);
  const total = db.get('SELECT COUNT(*) as c FROM deposits');
  const pages = Math.max(1, Math.ceil((total ? total.c : 0) / limit));
  res.render('admin/deposits', { title: 'Depósitos', deposits, fmt: db.formatXmr, page, pages, csrfToken: res.locals.csrfToken });
});

// Forçar confirmação manual de depósito (poder total)
router.post('/deposits/:id/confirm', (req, res) => {
  const dep = db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
  if (!dep) return res.status(404).json({ error: 'Depósito não encontrado.' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Depósito já processado.' });
  db.confirmDeposit(dep.id, dep.user_id, dep.amount_atomic);
  db.logAudit(req.admin.id, 'deposit_confirm', 'Depósito #' + dep.id + ' confirmado manualmente (' + db.atomicToXmr(dep.amount_atomic) + ' XMR)', req.ip);
  res.json({ ok: true });
});

router.post('/deposits/:id/refund', (req, res) => {
  const dep = db.get('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
  if (!dep) return res.status(404).json({ error: 'Depósito não encontrado.' });
  if (dep.status === 'confirmed') {
    const user = db.getUserById(dep.user_id);
    const newBal = (BigInt(user.balance_atomic) - BigInt(dep.amount_atomic)).toString();
    if (newBal < 0) return res.status(400).json({ error: 'Não é possível reverter: saldo insuficiente.' });
    db.updateUserBalance(user.id, newBal);
    db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.id, 'refund', '-' + dep.amount_atomic, newBal, 'Reversão de depósito #' + dep.id, 'deposit', dep.id]);
  }
  db.run("UPDATE deposits SET status = 'refunded' WHERE id = ?", [dep.id]);
  db.logAudit(req.admin.id, 'deposit_refund', 'Depósito #' + dep.id + ' revertido', req.ip);
  res.json({ ok: true });
});

// ===== SAQUES =====
router.get('/withdrawals', (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;
  const withdrawals = db.listWithdrawals(limit, offset);
  const total = db.get('SELECT COUNT(*) as c FROM withdrawals');
  const pages = Math.max(1, Math.ceil((total ? total.c : 0) / limit));
  res.render('admin/withdrawals', { title: 'Saques', withdrawals, fmt: db.formatXmr, page, pages, csrfToken: res.locals.csrfToken });
});

// Aprovar e enviar saque a partir da conta-mestra
router.post('/withdrawals/:id/approve', async (req, res) => {
  const w = db.getWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'Saque não encontrado.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Saque já processado.' });

  const wallet = await getWallet();
  let txid;
  try {
    const amount = BigInt(w.amount_atomic);
    const dest = [{ address: w.address, amount: amount.toString() }];
    const sent = await wallet.transfer(dest);
    txid = sent.txid;
  } catch (e) {
    // Falha no envio: devolve saldo ao usuário
    const user = db.getUserById(w.user_id);
    const refund = (BigInt(user.balance_atomic) + BigInt(w.amount_atomic) + BigInt(w.fee_atomic)).toString();
    db.updateUserBalance(user.id, refund);
    db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.id, 'refund', w.amount_atomic, refund, 'Estorno de saque #' + w.id + ' (falha no envio)', 'withdraw', w.id]);
    db.updateWithdrawal(w.id, { status: 'failed', note: 'Falha no envio: ' + e.message, processed_at: new Date().toISOString(), processed_by: req.admin.id });
    db.logAudit(req.admin.id, 'withdrawal_fail', 'Saque #' + w.id + ' falhou e foi estornado: ' + e.message, req.ip);
    return res.status(500).json({ error: 'Falha no envio. Saldo devolvido ao usuário.', detail: e.message });
  }

  db.updateWithdrawal(w.id, { status: 'sent', txid, processed_at: new Date().toISOString(), processed_by: req.admin.id });
  db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [w.user_id, 'withdraw_fee', '-' + w.fee_atomic, db.getUserBalance(w.user_id), 'Taxa de saque #' + w.id, 'withdraw', w.id]);
  db.logAudit(req.admin.id, 'withdrawal_approve', 'Saque #' + w.id + ' enviado (txid ' + txid + ')', req.ip);
  res.json({ ok: true, txid });
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const w = db.getWithdrawal(req.params.id);
  if (!w) return res.status(404).json({ error: 'Saque não encontrado.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Saque já processado.' });

  const user = db.getUserById(w.user_id);
  const refund = (BigInt(user.balance_atomic) + BigInt(w.amount_atomic) + BigInt(w.fee_atomic)).toString();
  db.updateUserBalance(user.id, refund);
  db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, 'refund', w.amount_atomic, refund, 'Saque #' + w.id + ' rejeitado', 'withdraw', w.id]);
  db.updateWithdrawal(w.id, { status: 'rejected', note: req.body.note || 'Rejeitado pelo administrador', processed_at: new Date().toISOString(), processed_by: req.admin.id });
  db.logAudit(req.admin.id, 'withdrawal_reject', 'Saque #' + w.id + ' rejeitado', req.ip);
  res.json({ ok: true });
});

// ===== CARTEIRA (conta-mestra) =====
router.get('/wallet', async (req, res) => {
  const wallet = await getWallet();
  let balance = null, primary = null, error = null;
  try {
    balance = await wallet.getBalance();
    primary = await wallet.getPrimaryAddress();
  } catch (e) { error = e.message; }

  const users = db.countUsers();
  const totalUserBalances = db.get('SELECT COALESCE(SUM(CAST(balance_atomic AS INTEGER)), 0) as s FROM users');
  const mockTransfers = db.listMockTransfers();

  res.render('admin/wallet', {
    title: 'Conta-Mestra', balance, primary, error, users,
    totalUserBalances: totalUserBalances ? totalUserBalances.s : 0,
    mode: (process.env.WALLET_MODE || 'mock'),
    mockTransfers, fmt: db.formatXmr, csrfToken: res.locals.csrfToken
  });
});

router.post('/wallet/scan', async (req, res) => {
  const wallet = await getWallet();
  try {
    await processIncomingTransfers(wallet);
    db.logAudit(req.admin.id, 'wallet_scan', 'Scanner executado manualmente', req.ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wallet/rescan', async (req, res) => {
  const wallet = await getWallet();
  try {
    await wallet.rescanBlockchain();
    db.logAudit(req.admin.id, 'wallet_rescan', 'Rescan da blockchain executado', req.ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simular depósito (somente em modo mock — para testes)
router.post('/wallet/simulate', (req, res) => {
  if ((process.env.WALLET_MODE || 'mock') !== 'mock') {
    return res.status(400).json({ error: 'Simulação disponível apenas em modo mock.' });
  }
  const { address, amount } = req.body;
  if (!address) return res.status(400).json({ error: 'Endereço de depósito do usuário é obrigatório.' });
  let amountAtomic;
  try { amountAtomic = db.xmrToAtomic(amount); } catch (e) { return res.status(400).json({ error: 'Valor inválido.' }); }

  const txid = 'mock_' + crypto.randomBytes(16).toString('hex');
  const t = db.insertMockTransfer(address, txid, amountAtomic, 0);
  if (!t) return res.status(400).json({ error: 'Falha ao simular (endereço inexistente ou txid duplicado).' });
  db.logAudit(req.admin.id, 'mock_deposit', 'Depósito simulado de ' + amount + ' XMR para ' + address, req.ip);
  res.json({ ok: true, txid });
});

router.post('/wallet/simulate/remove', (req, res) => {
  const { id } = req.body;
  db.deleteMockTransfer(id);
  res.json({ ok: true });
});

// ===== CONFIGURAÇÕES =====
router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Configurações',
    settings: {
      site_name: db.getSetting('site_name'),
      maintenance_mode: db.getSetting('maintenance_mode'),
      min_confirmations: db.getSetting('min_confirmations'),
      withdrawal_fee_xmr: db.atomicToXmr(db.getSetting('withdrawal_fee_atomic') || '0'),
      withdrawal_enabled: db.getSetting('withdrawal_enabled'),
      registration_open: db.getSetting('registration_open')
    },
    csrfToken: res.locals.csrfToken
  });
});

router.post('/settings', (req, res) => {
  const { site_name, maintenance_mode, min_confirmations, withdrawal_fee_xmr, withdrawal_enabled, registration_open } = req.body;
  if (site_name !== undefined) db.setSetting('site_name', site_name);
  if (maintenance_mode !== undefined) db.setSetting('maintenance_mode', maintenance_mode === '1' ? '1' : '0');
  if (min_confirmations !== undefined) db.setSetting('min_confirmations', String(parseInt(min_confirmations, 10) || 10));
  if (withdrawal_fee_xmr !== undefined) {
    try { db.setSetting('withdrawal_fee_atomic', db.xmrToAtomic(withdrawal_fee_xmr)); }
    catch (e) { return res.status(400).json({ error: 'Taxa de saque inválida.' }); }
  }
  if (withdrawal_enabled !== undefined) db.setSetting('withdrawal_enabled', withdrawal_enabled === '1' ? '1' : '0');
  if (registration_open !== undefined) db.setSetting('registration_open', registration_open === '1' ? '1' : '0');
  db.logAudit(req.admin.id, 'settings_update', 'Configurações atualizadas', req.ip);
  res.json({ ok: true });
});

// ===== SEGURANÇA / LOGS =====
router.get('/logs', (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;
  const logs = db.listAudit(limit, offset);
  const total = db.get('SELECT COUNT(*) as c FROM audit_log');
  const pages = Math.max(1, Math.ceil((total ? total.c : 0) / limit));
  res.render('admin/logs', { title: 'Logs de Auditoria', logs, page, pages, csrfToken: res.locals.csrfToken });
});

router.get('/security', (req, res) => {
  const admin = req.admin;
  const totpEnabled = !!admin.totp_enabled;
  res.render('admin/security', { title: 'Segurança', admin, totpEnabled, csrfToken: res.locals.csrfToken });
});

router.post('/security/2fa', (req, res) => {
  const admin = db.getAdminById(req.admin.id);
  const { enable, disable, pending_secret, code } = req.body;
  if (disable) {
    const verified = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: (code || '').replace(/\s/g, '') });
    if (!verified) return res.status(400).json({ error: 'Código 2FA inválido.' });
    db.updateAdminTotp(admin.id, '', false);
    return res.json({ ok: true });
  }
  if (enable) {
    const verified = speakeasy.totp.verify({ secret: pending_secret, encoding: 'base32', token: (code || '').replace(/\s/g, '') });
    if (!verified) return res.status(400).json({ error: 'Código 2FA inválido.' });
    db.updateAdminTotp(admin.id, pending_secret, true);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: 'Requisição inválida.' });
});

router.get('/security/2fa/qr', (req, res) => {
  const admin = db.getAdminById(req.admin.id);
  const secret = admin.totp_secret || speakeasy.generateSecret({ length: 32 }).base32;
  const otpauth = speakeasy.otpauthURL({ secret, label: 'MoneroWallet Admin:' + admin.username, issuer: 'MoneroWallet', encoding: 'base32' });
  qrcode.toDataURL(otpauth, { width: 220, margin: 1 }, (err, url) => {
    if (err) return res.status(500).json({ error: 'Erro ao gerar QR.' });
    res.json({ qr: url, secret });
  });
});

router.post('/security/password', (req, res) => {
  const admin = db.getAdminById(req.admin.id);
  const { current, next, confirm } = req.body;
  if (!bcrypt.compareSync(current || '', admin.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'Nova senha deve ter no mínimo 8 caracteres.' });
  if (next !== confirm) return res.status(400).json({ error: 'As senhas não coincidem.' });
  db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(next, 12), admin.id]);
  db.logAudit(admin.id, 'admin_password', 'Senha do admin alterada', req.ip);
  res.json({ ok: true });
});

module.exports = router;