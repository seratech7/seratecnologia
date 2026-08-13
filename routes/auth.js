const express = require('express');
const crypto = require('crypto');
const qrcode = require('qrcode');
const router = express.Router();
const db = require('../database/db');
const authHive = require('../lib/auth-hive');
const { redirectIfAuthenticated } = require('../middleware/auth-hive');

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('admin/login', { title: 'Login - Painel Admin', error: null, csrfToken: req.session.csrfToken });
});

router.post('/login', async (req, res) => {
  const { username, password, totp } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '';

  if (!username || !password) {
    db.logLoginAttempt(ip, username, 'admin', false);
    return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Preencha todos os campos', csrfToken: req.session.csrfToken });
  }

  const uid = 'admin:' + username;
  
  if (req.session.pendingMfaUid === uid && totp) {
    const userAuth = db.getUserAuth(uid);
    if (!userAuth || !userAuth.mfa_secret_enc) {
      req.session.pendingMfaUid = null;
      return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Erro na verificação MFA', csrfToken: req.session.csrfToken });
    }
    
    const secret = authHive.decryptMfaSecret(userAuth.mfa_secret_enc);
    if (!authHive.verifyTotp(totp, secret)) {
      db.logAuthEvent(uid, 'mfa_failed', ip, req.get('User-Agent') || '', 'failure', 'invalid_totp');
      return res.render('admin/login', { title: 'Login - Painel Admin', error: 'Código MFA inválido', csrfToken: req.session.csrfToken, showMfa: true });
    }
    
    req.session.mfaVerified = true;
    const result = await authHive.completeLogin(uid, 'admin', req, res);
    if (result.success) {
      req.session.pendingMfaUid = null;
      req.session.mfaVerified = null;
      return res.redirect('/admin/dashboard');
    }
  }
  
  const result = await authHive.loginUser(uid, 'admin', password, req, res);
  if (!result.success) {
    db.logLoginAttempt(ip, username, 'admin', false);
    return res.render('admin/login', { title: 'Login - Painel Admin', error: result.error, csrfToken: req.session.csrfToken });
  }
  
  db.logLoginAttempt(ip, username, 'admin', true);
  
  if (result.mfaRequired) {
    return res.render('admin/login', { title: 'Login - Painel Admin', error: null, csrfToken: req.session.csrfToken, showMfa: true });
  }
  
  res.redirect('/admin/dashboard');
});

router.get('/logout', (req, res) => {
  authHive.logoutUser(req, res);
  res.redirect('/admin/login');
});

router.get('/seller/login', redirectIfAuthenticated, (req, res) => {
  res.render('seller/login', { title: 'Login - Painel Vendedor', error: null, csrfToken: req.session.csrfToken });
});

router.post('/seller/login', async (req, res) => {
  const { email, password, totp } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '';

  if (!email || !password) {
    db.logLoginAttempt(ip, email, 'seller', false);
    return res.render('seller/login', { title: 'Login - Painel Vendedor', error: 'Preencha todos os campos', csrfToken: req.session.csrfToken });
  }

  const seller = db.get('SELECT id FROM sellers WHERE email = ?', [email]);
  if (!seller) {
    await authHive.verifyPassword(password, authHive.generateFakeHash());
    db.logLoginAttempt(ip, email, 'seller', false);
    return res.render('seller/login', { title: 'Login - Painel Vendedor', error: 'Credenciais inválidas', csrfToken: req.session.csrfToken });
  }

  const uid = 'seller:' + seller.id;
  
  if (req.session.pendingMfaUid === uid && totp) {
    const userAuth = db.getUserAuth(uid);
    if (!userAuth || !userAuth.mfa_secret_enc) {
      req.session.pendingMfaUid = null;
      return res.render('seller/login', { title: 'Login - Painel Vendedor', error: 'Erro na verificação MFA', csrfToken: req.session.csrfToken });
    }
    
    const secret = authHive.decryptMfaSecret(userAuth.mfa_secret_enc);
    if (!authHive.verifyTotp(totp, secret)) {
      db.logAuthEvent(uid, 'mfa_failed', ip, req.get('User-Agent') || '', 'failure', 'invalid_totp');
      return res.render('seller/login', { title: 'Login - Painel Vendedor', error: 'Código MFA inválido', csrfToken: req.session.csrfToken, showMfa: true });
    }
    
    req.session.mfaVerified = true;
    const result = await authHive.completeLogin(uid, 'seller', req, res);
    if (result.success) {
      req.session.pendingMfaUid = null;
      req.session.mfaVerified = null;
      return res.redirect('/seller/dashboard');
    }
  }
  
  const result = await authHive.loginUser(uid, 'seller', password, req, res);
  if (!result.success) {
    db.logLoginAttempt(ip, email, 'seller', false);
    return res.render('seller/login', { title: 'Login - Painel Vendedor', error: result.error, csrfToken: req.session.csrfToken });
  }
  
  db.logLoginAttempt(ip, email, 'seller', true);
  
  if (result.mfaRequired) {
    return res.render('seller/login', { title: 'Login - Painel Vendedor', error: null, csrfToken: req.session.csrfToken, showMfa: true });
  }
  
  res.redirect('/seller/dashboard');
});

router.get('/seller/logout', (req, res) => {
  authHive.logoutUser(req, res);
  res.redirect('/seller/login');
});

router.get('/mfa-setup', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const userAuth = db.getUserAuth(session.uid);
  if (userAuth?.totp_enabled) {
    return res.redirect('/admin/dashboard?mfa=already_enabled');
  }
  
  const secret = authHive.generateTotpSecret();
  const encryptedSecret = authHive.encryptMfaSecret(secret);
  const recoveryCodes = authHive.generateRecoveryCodes(10);
  const recoveryHashes = authHive.hashRecoveryCodes(recoveryCodes);
  
  req.session.mfaSetupSecret = encryptedSecret;
  req.session.mfaSetupRecovery = recoveryHashes;
  req.session.mfaSetupCodes = recoveryCodes;
  
  const label = 'admin@SeraTecnologia';
  const otpauth = authHive.generateTotpUri(secret, label);
  
  qrcode.toDataURL(otpauth, (err, qrCodeUrl) => {
    if (err) {
      console.error('QR Code error:', err);
      return res.status(500).send('Erro ao gerar QR Code');
    }
    res.render('admin/mfa-setup', {
      title: 'Configurar MFA - Painel Admin',
      qrCodeUrl,
      secret,
      recoveryCodes,
      csrfToken: req.session.csrfToken
    });
  });
});

router.post('/mfa-setup', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const { totp } = req.body;
  const encryptedSecret = req.session.mfaSetupSecret;
  const recoveryHashes = req.session.mfaSetupRecovery;
  const recoveryCodes = req.session.mfaSetupCodes;
  
  if (!encryptedSecret || !recoveryHashes) {
    return res.redirect('/admin/mfa-setup?error=expired');
  }
  
  const secret = authHive.decryptMfaSecret(encryptedSecret);
  if (!authHive.verifyTotp(totp, secret)) {
    return res.render('admin/mfa-setup', {
      title: 'Configurar MFA - Painel Admin',
      qrCodeUrl: '',
      secret: '',
      recoveryCodes: [],
      error: 'Código MFA inválido',
      csrfToken: req.session.csrfToken
    });
  }
  
  db.updateUserAuthMFA(session.uid, encryptedSecret, true, recoveryHashes);
  db.logAuthEvent(session.uid, 'mfa_enabled', req.ip || '', req.get('User-Agent') || '', 'success', '');
  
  req.session.mfaSetupSecret = null;
  req.session.mfaSetupRecovery = null;
  req.session.mfaSetupCodes = null;
  
  res.redirect('/admin/dashboard?mfa=enabled');
});

router.get('/mfa-disable', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  res.render('admin/mfa-disable', {
    title: 'Desativar MFA - Painel Admin',
    csrfToken: req.session.csrfToken
  });
});

router.post('/mfa-disable', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const { password, totp, recovery_code } = req.body;
  const userAuth = db.getUserAuth(session.uid);
  
  if (!userAuth || !userAuth.totp_enabled) {
    return res.redirect('/admin/dashboard?mfa=not_enabled');
  }
  
  const secret = authHive.decryptMfaSecret(userAuth.mfa_secret_enc);
  let mfaValid = false;
  
  if (totp && authHive.verifyTotp(totp, secret)) {
    mfaValid = true;
  } else if (recovery_code && authHive.verifyRecoveryCode(recovery_code, userAuth.recovery_hashes)) {
    mfaValid = true;
    const newRecoveryHashes = authHive.removeRecoveryCode(recovery_code, userAuth.recovery_hashes);
    db.updateUserAuthMFA(session.uid, userAuth.mfa_secret_enc, true, newRecoveryHashes);
  }
  
  if (!mfaValid) {
    return res.render('admin/mfa-disable', {
      title: 'Desativar MFA - Painel Admin',
      error: 'Código MFA ou código de recuperação inválido',
      csrfToken: req.session.csrfToken
    });
  }
  
  db.updateUserAuthMFA(session.uid, '', false, '');
  db.logAuthEvent(session.uid, 'mfa_disabled', req.ip || '', req.get('User-Agent') || '', 'success', '');
  
  res.redirect('/admin/dashboard?mfa=disabled');
});

router.get('/sessions', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const sessions = db.getUserSessions(session.uid);
  const devices = db.getAuthDevices(session.uid);
  
  res.render('admin/sessions', {
    title: 'Sessões Ativas - Painel Admin',
    sessions,
    devices,
    currentSidHash: session.sidHash,
    csrfToken: req.session.csrfToken
  });
});

router.post('/sessions/revoke', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const { sid_hash } = req.body;
  if (sid_hash === session.sidHash) {
    return res.status(400).json({ error: 'Não pode revogar a sessão atual' });
  }
  
  db.deleteAuthSession(sid_hash);
  db.logAuthEvent(session.uid, 'session_revoked', req.ip || '', req.get('User-Agent') || '', 'success', `revoked:${sid_hash}`);
  
  res.json({ success: true });
});

router.post('/sessions/revoke-all', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const { except_current } = req.body;
  const sessions = db.getUserSessions(session.uid);
  
  for (const s of sessions) {
    if (except_current && s.sid_hash === session.sidHash) continue;
    db.deleteAuthSession(s.sid_hash);
  }
  
  db.logAuthEvent(session.uid, 'all_sessions_revoked', req.ip || '', req.get('User-Agent') || '', 'success', '');
  
  res.json({ success: true });
});

router.post('/devices/revoke', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const { device_id } = req.body;
  db.revokeAuthDevice(session.uid, device_id);
  db.logAuthEvent(session.uid, 'device_revoked', req.ip || '', req.get('User-Agent') || '', 'success', `device:${device_id}`);
  
  res.json({ success: true });
});

router.post('/devices/label', (req, res) => {
  const session = authHive.validateSession(req, res);
  if (!session || session.userType !== 'admin') {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const { device_id, label } = req.body;
  db.updateAuthDeviceLabel(session.uid, device_id, label);
  
  res.json({ success: true });
});

module.exports = router;