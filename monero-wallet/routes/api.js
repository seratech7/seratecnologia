const express = require('express');
const crypto = require('crypto');
const db = require('../database/db');

const router = express.Router();

// Chaves de API permitidas (integração com o marketplace)
function validApiKey(key) {
  const keys = (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return false;
  return keys.some(k => {
    const a = Buffer.from(String(k));
    const b = Buffer.from(String(key));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

router.use((req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!validApiKey(key)) return res.status(401).json({ error: 'API key inválida.' });
  next();
});

// Retorna o saldo de um usuário
router.post('/balance', (req, res) => {
  const { email, user_id } = req.body;
  let user = null;
  if (user_id) user = db.getUserById(user_id);
  if (email) user = db.getUserByEmail(String(email).toLowerCase().trim());
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Usuário bloqueado.' });
  res.json({
    ok: true,
    user_id: user.id,
    email: user.email,
    balance_xmr: db.atomicToXmr(user.balance_atomic),
    balance_atomic: user.balance_atomic
  });
});

// Reserva saldo para um pagamento (hold). Usado pelo marketplace ao finalizar compra.
router.post('/hold', (req, res) => {
  const { email, user_id, amount_xmr, reference } = req.body;
  let user = null;
  if (user_id) user = db.getUserById(user_id);
  if (email) user = db.getUserByEmail(String(email).toLowerCase().trim());
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Usuário bloqueado.' });

  let amountAtomic;
  try { amountAtomic = db.xmrToAtomic(amount_xmr); } catch (e) { return res.status(400).json({ error: 'Valor inválido.' }); }
  if (BigInt(amountAtomic) <= 0n) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });

  const balance = BigInt(user.balance_atomic);
  if (balance < BigInt(amountAtomic)) return res.status(400).json({ error: 'Saldo insuficiente.' });

  const newBal = (balance - BigInt(amountAtomic)).toString();
  db.updateUserBalance(user.id, newBal);
  db.run('INSERT INTO transactions (user_id, type, amount_atomic, balance_after_atomic, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, 'hold', '-' + amountAtomic, newBal, 'Reserva de pagamento' + (reference ? ' (' + reference + ')' : ''), 'hold', 0]);
  const hold = db.createHold(user.id, amountAtomic, reference);
  res.json({ ok: true, hold_id: hold.id, held_xmr: db.atomicToXmr(amountAtomic) });
});

// Finaliza a compra capturando a reserva
router.post('/capture', (req, res) => {
  const { hold_id } = req.body;
  const hold = db.getHold(hold_id);
  if (!hold) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (hold.status !== 'held') return res.status(400).json({ error: 'Reserva já processada.' });
  const captured = db.captureHold(hold.id);
  res.json({ ok: true, captured: captured.amount_atomic });
});

// Cancela a reserva e devolve o saldo ao usuário
router.post('/release', (req, res) => {
  const { hold_id } = req.body;
  const hold = db.getHold(hold_id);
  if (!hold) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (hold.status !== 'held') return res.status(400).json({ error: 'Reserva já processada.' });
  const released = db.releaseHold(hold.id);
  res.json({ ok: true, released: released.amount_atomic });
});

module.exports = router;