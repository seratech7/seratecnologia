const express = require('express');
const qrcode = require('qrcode');
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { getWallet } = require('../lib/wallet');

const router = express.Router();

router.use(['/wallet', '/deposit', '/withdraw', '/history'], requireAuth);

async function ensureAddress(user) {
  let addr = db.getAddressByUser(user.id);
  if (!addr) {
    const wallet = await getWallet();
    const created = await wallet.createAddress('user_' + user.id);
    addr = db.createAddress(user.id, created.address, 'user_' + user.id);
  }
  return addr;
}

router.get('/wallet', async (req, res) => {
  const user = req.user;
  const address = await ensureAddress(user);
  const balance = db.getUserBalance(user.id);
  const recent = db.listTransactions(user.id, 10, 0);
  const deposits = db.listDepositsByUser(user.id, 5, 0);
  const withdrawals = db.listWithdrawalsByUser(user.id, 5, 0);
  res.render('wallet', {
    title: 'Minha Carteira', user, address: address.address, balance,
    recent, deposits, withdrawals,
    fmt: db.formatXmr, csrfToken: res.locals.csrfToken
  });
});

router.get('/deposit', async (req, res) => {
  const user = req.user;
  const address = await ensureAddress(user);
  let qr = null;
  try { qr = await qrcode.toDataURL('monero:' + address.address); } catch (e) {}
  const deposits = db.listDepositsByUser(user.id, 20, 0);
  res.render('deposit', {
    title: 'Depositar XMR', user, address: address.address, qr, deposits,
    fmt: db.formatXmr, csrfToken: res.locals.csrfToken
  });
});

router.post('/deposit/refresh', async (req, res) => {
  const user = req.user;
  const wallet = await getWallet();
  const created = await wallet.createAddress('user_' + user.id + '_' + Date.now());
  db.createAddress(user.id, created.address, 'user_' + user.id);
  res.json({ ok: true, address: created.address });
});

router.get('/withdraw', async (req, res) => {
  const user = req.user;
  const fee = db.getSetting('withdrawal_fee_atomic') || '0';
  const enabled = db.getSetting('withdrawal_enabled') === '1';
  const history = db.listWithdrawalsByUser(user.id, 20, 0);
  res.render('withdraw', {
    title: 'Sacar XMR', user, fee, enabled, history,
    fmt: db.formatXmr, csrfToken: res.locals.csrfToken
  });
});

router.post('/withdraw', async (req, res) => {
  const user = req.user;
  const enabled = db.getSetting('withdrawal_enabled') === '1';
  if (!enabled) return res.status(400).json({ error: 'Saques temporariamente desativados.' });

  const { address, amount } = req.body;
  if (!address || !/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{90,110}$/.test(address)) {
    return res.status(400).json({ error: 'Endereço Monero inválido.' });
  }

  let amountAtomic;
  try {
    amountAtomic = db.xmrToAtomic(amount);
  } catch (e) {
    return res.status(400).json({ error: 'Valor inválido.' });
  }
  if (BigInt(amountAtomic) <= 0n) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });

  const fee = db.getSetting('withdrawal_fee_atomic') || '0';
  const total = (BigInt(amountAtomic) + BigInt(fee)).toString();
  const balance = BigInt(db.getUserBalance(user.id));
  if (balance < BigInt(total)) {
    return res.status(400).json({ error: 'Saldo insuficiente para saque + taxa.' });
  }

  // Reserva o saldo imediatamente para evitar saque duplo
  const newBal = (balance - BigInt(total)).toString();
  db.updateUserBalance(user.id, newBal);
  db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, 'withdraw', '-' + amountAtomic, newBal, 'Saque solicitado', 'withdraw', 0]);

  const w = db.createWithdrawal(user.id, address, amountAtomic, fee);
  res.json({ ok: true, id: w.id });
});

router.get('/history', async (req, res) => {
  const user = req.user;
  const page = parseInt(req.query.page || '1', 10);
  const limit = 25;
  const offset = (page - 1) * limit;
  const txns = db.listTransactions(user.id, limit, offset);
  const total = db.get('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?', [user.id]);
  const pages = Math.max(1, Math.ceil((total ? total.c : 0) / limit));
  res.render('history', { title: 'Histórico', user, txns, fmt: db.formatXmr, page, pages, csrfToken: res.locals.csrfToken });
});

module.exports = router;