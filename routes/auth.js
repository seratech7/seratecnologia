const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database/db');
const { requireAdmin, redirectIfAdmin } = require('../middleware/auth');

router.get('/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', { title: 'Login - Painel Admin', error: null, csrfToken: req.session.csrfToken });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  var ip = req.ip || req.connection.remoteAddress || '';

  if (!username || !password) {
    db.logLoginAttempt(ip, username, 'admin', false);
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Preencha todos os campos', csrfToken: req.session.csrfToken });
  }

  const admin = db.get('SELECT * FROM admins WHERE username = ?', [username]);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    db.logLoginAttempt(ip, username, 'admin', false);
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Usuário ou senha inválidos', csrfToken: req.session.csrfToken });
  }

  db.logLoginAttempt(ip, username, 'admin', true);
  req.session.regenerate(function() {
    req.session.adminId = admin.id;
    req.session.adminName = admin.display_name;
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    res.redirect('/admin/dashboard');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
