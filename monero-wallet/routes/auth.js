const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const db = require('../database/db');
const { redirectIfAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/login', redirectIfAuth, (req, res) => {
  res.render('login', { title: 'Entrar', error: null, csrfToken: res.locals.csrfToken });
});

router.post('/login', redirectIfAuth, (req, res) => {
  const { email, password, totp } = req.body;
  const user = db.getUserByEmail((email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Entrar', error: 'Email ou senha incorretos.', csrfToken: res.locals.csrfToken });
  }
  if (user.status !== 'active') {
    return res.status(403).render('login', { title: 'Entrar', error: 'Conta bloqueada.', csrfToken: res.locals.csrfToken });
  }
  if (user.totp_enabled) {
    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: (totp || '').replace(/\s/g, '') });
    if (!verified) {
      return res.status(401).render('login', { title: 'Entrar', error: 'Código 2FA inválido.', csrfToken: res.locals.csrfToken });
    }
  }
  req.session.userId = user.id;
  req.session.userName = user.display_name || user.email;
  db.updateLastLogin(user.id);
  res.redirect('/wallet');
});

router.get('/register', redirectIfAuth, (req, res) => {
  const open = db.getSetting('registration_open') === '1';
  if (!open) return res.render('register', { title: 'Cadastro', error: 'Cadastros temporariamente fechados.', csrfToken: res.locals.csrfToken });
  res.render('register', { title: 'Criar conta', error: null, csrfToken: res.locals.csrfToken });
});

router.post('/register', redirectIfAuth, (req, res) => {
  const open = db.getSetting('registration_open') === '1';
  if (!open) return res.render('register', { title: 'Cadastro', error: 'Cadastros temporariamente fechados.', csrfToken: res.locals.csrfToken });

  const { email, display_name, password, confirm } = req.body;
  const mail = (email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return res.status(400).render('register', { title: 'Criar conta', error: 'Email inválido.', csrfToken: res.locals.csrfToken });
  }
  if (db.getUserByEmail(mail)) {
    return res.status(409).render('register', { title: 'Criar conta', error: 'Email já cadastrado.', csrfToken: res.locals.csrfToken });
  }
  if (!password || password.length < 8) {
    return res.status(400).render('register', { title: 'Criar conta', error: 'Senha deve ter no mínimo 8 caracteres.', csrfToken: res.locals.csrfToken });
  }
  if (password !== confirm) {
    return res.status(400).render('register', { title: 'Criar conta', error: 'As senhas não coincidem.', csrfToken: res.locals.csrfToken });
  }

  const hash = bcrypt.hashSync(password, 12);
  const user = db.createUser(mail, hash, (display_name || '').trim());
  req.session.userId = user.id;
  req.session.userName = user.display_name || user.email;
  res.redirect('/wallet');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ===== SEGURANÇA DA CONTA (2FA) =====
router.get('/account/2fa', requireAuth, (req, res) => {
  const totp = db.getUserTotp(req.user.id);
  if (totp.enabled) {
    return res.render('2fa', { title: 'Autenticação 2FA', enabled: true, error: null, csrfToken: res.locals.csrfToken, qr: null, secret: null });
  }
  const secret = speakeasy.generateSecret({ length: 32 });
  res.render('2fa', {
    title: 'Autenticação 2FA', enabled: false, error: null, csrfToken: res.locals.csrfToken,
    qr: null, secret: null, pendingSecret: secret.base32
  });
});

router.post('/account/2fa', requireAuth, async (req, res) => {
  const totp = db.getUserTotp(req.user.id);
  const { enable, disable, pending_secret, code } = req.body;

  if (disable) {
    const verified = speakeasy.totp.verify({ secret: totp.secret, encoding: 'base32', token: (code || '').replace(/\s/g, '') });
    if (!verified) return res.status(400).json({ error: 'Código 2FA inválido.' });
    db.setUserTotp(req.user.id, '', false);
    return res.json({ ok: true });
  }

  if (enable) {
    const verified = speakeasy.totp.verify({ secret: pending_secret, encoding: 'base32', token: (code || '').replace(/\s/g, '') });
    if (!verified) return res.status(400).json({ error: 'Código 2FA inválido. Tente novamente.' });
    db.setUserTotp(req.user.id, pending_secret, true);
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Requisição inválida.' });
});

router.get('/account/2fa/qr', requireAuth, (req, res) => {
  const totp = db.getUserTotp(req.user.id);
  const secret = totp.secret || speakeasy.generateSecret({ length: 32 }).base32;
  const otpauth = speakeasy.otpauthURL({ secret, label: 'MoneroWallet:' + req.user.email, issuer: 'MoneroWallet', encoding: 'base32' });
  qrcode.toDataURL(otpauth, { width: 220, margin: 1 }, (err, url) => {
    if (err) return res.status(500).json({ error: 'Erro ao gerar QR.' });
    res.json({ qr: url, secret });
  });
});

router.post('/account/password', requireAuth, (req, res) => {
  const { current, next, confirm } = req.body;
  if (!bcrypt.compareSync(current || '', req.user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  if (!next || next.length < 8) return res.status(400).json({ error: 'Nova senha deve ter no mínimo 8 caracteres.' });
  if (next !== confirm) return res.status(400).json({ error: 'As senhas não coincidem.' });
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(next, 12), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;