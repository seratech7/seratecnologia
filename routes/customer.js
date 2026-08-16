const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const authHive = require('../lib/auth-hive');
const { requireCustomer, redirectIfCustomer } = require('../middleware/auth-hive');

function renderLogin(req, res, opts) {
  res.render('customer/login', Object.assign({
    title: 'Entrar | MarketPlace',
    error: null,
    success: null,
    csrfToken: req.session.csrfToken,
    showMfa: false
  }, opts));
}

const router = express.Router();

router.get('/login', redirectIfCustomer, (req, res) => {
  renderLogin(req, res, { redirect: req.query.redirect || '/conta' });
});

router.get('/registro', redirectIfCustomer, (req, res) => {
  res.render('customer/register', {
    title: 'Criar Conta | MarketPlace',
    error: null,
    success: null,
    csrfToken: req.session.csrfToken
  });
});

router.post('/registro', async (req, res) => {
  const { name, email, phone, password, confirm_password } = req.body;
  const errorView = (msg) => res.render('customer/register', {
    title: 'Criar Conta | MarketPlace',
    error: msg,
    success: null,
    csrfToken: req.session.csrfToken
  });

  if (!name || !email || !password) return errorView('Preencha nome, email e senha');
  if (password !== confirm_password) return errorView('Senha e confirmação não conferem');
  if (String(password).length < 8) return errorView('A senha deve ter no mínimo 8 caracteres');

  if (db.getCustomerByEmail(email)) return errorView('Este email já está cadastrado');

  try {
    const hash = await authHive.hashPassword(password);
    const legacyHash = bcrypt.hashSync(password, 10);
    const customerId = db.createCustomer(name, email, phone, legacyHash);
    if (!customerId || customerId <= 0) throw new Error('customerId inválido: ' + customerId);
    db.createUserAuth('customer:' + customerId, 'customer', hash, '', 1);

    req.session.flash = [{ text: 'Conta criada com sucesso! Faça login para continuar.', type: 'success' }];
    return res.redirect('/login');
  } catch (e) {
    console.error('Erro criando cliente:', e.message);
    return errorView('Erro ao criar conta. Tente novamente.');
  }
});

router.post('/login', async (req, res) => {
  const { email, password, totp, redirect } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '';

  if (!email || !password) return renderLogin(req, res, { error: 'Preencha todos os campos', redirect: redirect || '/conta' });

  const customer = db.getCustomerByEmail(email);
  if (!customer) {
    await authHive.verifyPassword(password, authHive.generateFakeHash());
    return renderLogin(req, res, { error: 'Email ou senha inválidos', redirect: redirect || '/conta' });
  }
  if (customer.status !== 'active') {
    return renderLogin(req, res, { error: 'Sua conta foi desativada. Contate o suporte.', redirect: redirect || '/conta' });
  }

  const uid = 'customer:' + customer.id;

  if (req.session.pendingMfaUid === uid && totp) {
    const userAuth = db.getUserAuth(uid);
    if (!userAuth || !userAuth.mfa_secret_enc) {
      req.session.pendingMfaUid = null;
      return renderLogin(req, res, { error: 'Erro na verificação MFA', showMfa: true, redirect: redirect || '/conta' });
    }
    const secret = authHive.decryptMfaSecret(userAuth.mfa_secret_enc);
    if (!authHive.verifyTotp(totp, secret)) {
      return renderLogin(req, res, { error: 'Código MFA inválido', showMfa: true, redirect: redirect || '/conta' });
    }
    req.session.mfaVerified = true;
    const result = await authHive.completeLogin(uid, 'customer', req, res);
    if (result.success) {
      req.session.pendingMfaUid = null;
      req.session.mfaVerified = null;
      return res.redirect(redirect && redirect.startsWith('/') ? redirect : '/conta');
    }
  }

  let userAuth = db.getUserAuth(uid);
  // Contas antigas podem ter users_auth em argon2 (removido no deploy). O hash da
  // tabela customers e bcrypt puro (sem pepper), entao preferimos ele e migramos
  // o users_auth para bcrypt quando necessario.
  const legacyOk = !!(customer.password_hash && bcrypt.compareSync(password, customer.password_hash));

  if (legacyOk) {
    const newHash = await authHive.hashPassword(password);
    if (userAuth) {
      if (userAuth.argon_hash.startsWith('$argon2')) {
        db.updateUserAuthHash(uid, newHash, (userAuth.pepper_ver || 1) + 1);
      }
    } else {
      db.createUserAuth(uid, 'customer', newHash, '', 1);
    }
    userAuth = db.getUserAuth(uid);
  } else if (!userAuth) {
    db.logLoginAttempt(ip, email, 'customer', false);
    return renderLogin(req, res, { error: 'Email ou senha inválidos', redirect: redirect || '/conta' });
  }

  const result = await authHive.loginUser(uid, 'customer', password, req, res);
  if (!result.success) {
    db.logLoginAttempt(ip, email, 'customer', false);
    return renderLogin(req, res, { error: 'Email ou senha inválidos', redirect: redirect || '/conta' });
  }
  db.logLoginAttempt(ip, email, 'customer', true);

  if (result.mfaRequired) {
    return renderLogin(req, res, { error: null, showMfa: true, redirect: redirect || '/conta' });
  }

  res.redirect(redirect && redirect.startsWith('/') && !redirect.startsWith('/login') ? redirect : '/conta');
});

router.get('/conta', requireCustomer, (req, res) => {
  const customer = db.getCustomerById(req.session.customerId);
  if (!customer) return res.redirect('/login');

  const orders = db.getCustomerOrders(req.session.customerId);
  const addresses = db.getCustomerAddresses(req.session.customerId);

  res.render('customer/account', {
    title: 'Minha Conta | MarketPlace',
    customer,
    orders,
    addresses,
    error: null,
    success: req.query.sucesso || null,
    csrfToken: req.session.csrfToken
  });
});

router.get('/conta/enderecos/novo', requireCustomer, (req, res) => {
  res.render('customer/address-form', {
    title: 'Novo Endereço | MarketPlace',
    address: null,
    error: null,
    csrfToken: req.session.csrfToken
  });
});

router.post('/conta/enderecos/novo', requireCustomer, (req, res) => {
  const { label, recipient, address, city, state, zip } = req.body;
  if (!address) {
    return res.render('customer/address-form', { title: 'Novo Endereço | MarketPlace', address: null, error: 'Endereço é obrigatório', csrfToken: req.session.csrfToken });
  }
  db.createCustomerAddress(req.session.customerId, label, recipient, address, city, state, zip);
  res.redirect('/conta?sucesso=Endereço adicionado com sucesso!');
});

router.get('/conta/enderecos/:id/editar', requireCustomer, (req, res) => {
  const address = db.getCustomerAddress(req.params.id, req.session.customerId);
  if (!address) return res.redirect('/conta');
  res.render('customer/address-form', { title: 'Editar Endereço | MarketPlace', address, error: null, csrfToken: req.session.csrfToken });
});

router.post('/conta/enderecos/:id/editar', requireCustomer, (req, res) => {
  const { label, recipient, address, city, state, zip } = req.body;
  if (!address) {
    const addr = db.getCustomerAddress(req.params.id, req.session.customerId);
    return res.render('customer/address-form', { title: 'Editar Endereço | MarketPlace', address: addr, error: 'Endereço é obrigatório', csrfToken: req.session.csrfToken });
  }
  db.updateCustomerAddress(req.params.id, req.session.customerId, label, recipient, address, city, state, zip);
  res.redirect('/conta?sucesso=Endereço atualizado com sucesso!');
});

router.post('/conta/enderecos/:id/delete', requireCustomer, (req, res) => {
  db.deleteCustomerAddress(req.params.id, req.session.customerId);
  res.redirect('/conta?sucesso=Endereço removido');
});

router.post('/conta/dados', requireCustomer, (req, res) => {
  const { name, phone } = req.body;
  const customer = db.getCustomerById(req.session.customerId);
  if (!name) return res.redirect('/conta?erro=Nome é obrigatório');
  db.updateCustomer(req.session.customerId, name, phone, customer.email);
  res.redirect('/conta?sucesso=Dados atualizados com sucesso!');
});

router.post('/conta/senha', requireCustomer, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const customer = db.getCustomerById(req.session.customerId);
  const uid = 'customer:' + req.session.customerId;
  const userAuth = db.getUserAuth(uid);

  let currentOk = false;
  if (userAuth) {
    try {
      const v = await authHive.verifyPassword(current_password, userAuth.argon_hash);
      currentOk = !!(v && v.verified);
    } catch (e) { currentOk = false; }
  }
  if (!currentOk && !bcrypt.compareSync(current_password, customer.password_hash)) {
    return res.redirect('/conta?erro=Senha atual incorreta');
  }
  if (new_password !== confirm_password) {
    return res.redirect('/conta?erro=Nova senha não confere');
  }
  if (String(new_password).length < 8) {
    return res.redirect('/conta?erro=A senha deve ter no mínimo 8 caracteres');
  }

  const legacyHash = bcrypt.hashSync(new_password, 10);
  db.updateCustomerPassword(req.session.customerId, legacyHash);
  try {
    const newHash = await authHive.hashPassword(new_password);
    if (userAuth) db.updateUserAuthHash(uid, newHash, (userAuth.pepper_ver || 1) + 1);
    else db.createUserAuth(uid, 'customer', newHash, '', 1);
  } catch (e) { console.error('Erro atualizando hash auth-hive cliente:', e.message); }

  res.redirect('/conta?sucesso=Senha alterada com sucesso!');
});

router.get('/conta/sair', requireCustomer, (req, res) => {
  authHive.logoutUser(req, res);
  res.redirect('/');
});

module.exports = router;