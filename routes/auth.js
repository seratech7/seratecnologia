const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../database/db');
const { requireAdmin, redirectIfAdmin } = require('../middleware/auth');

router.get('/login', redirectIfAdmin, (req, res) => {
  res.render('admin/login', { title: 'Login - Painel Admin', error: null });
});

router.post('/login', (req, res) => {
  if (req.body._csrf !== req.session.csrfToken) {
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Token inválido. Recarregue a página.' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Preencha todos os campos' });
  }

  const admin = db.get('SELECT * FROM admins WHERE username = ?', [username]);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Usuário ou senha inválidos' });
  }

  req.session.adminId = admin.id;
  req.session.adminName = admin.display_name;
  res.redirect('/admin/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

module.exports = router;
