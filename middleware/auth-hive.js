const authHive = require('../lib/auth-hive');
const db = require('../database/db');

function requireAdmin(req, res, next) {
  return authHive.requireAuth('admin')(req, res, next);
}

function requireSeller(req, res, next) {
  return authHive.requireAuth('seller')(req, res, next);
}

function requireAnyAuth(req, res, next) {
  return authHive.requireAuth()(req, res, next);
}

function redirectIfAuthenticated(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session) {
    const redirectPath = session.userType === 'admin' ? '/admin/dashboard' : '/seller/dashboard';
    return res.redirect(redirectPath);
  }
  next();
}

function attachAuthInfo(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session) {
    req.auth = session;
    res.locals.auth = authHive.getSessionInfo(req);
    res.locals.isAdmin = session.userType === 'admin';
    res.locals.isSeller = session.userType === 'seller';
  } else {
    res.locals.auth = null;
    res.locals.isAdmin = false;
    res.locals.isSeller = false;
  }
  next();
}

function requireMfaComplete(req, res, next) {
  if (req.session.pendingMfaUid && !req.session.mfaVerified) {
    return res.redirect('/admin/mfa-verify');
  }
  next();
}

function getUserDisplayName(uid, userType) {
  if (userType === 'admin') {
    const admin = db.get("SELECT display_name FROM admins WHERE id = ?", [uid.replace('admin:', '')]);
    return admin?.display_name || 'Admin';
  } else if (userType === 'seller') {
    const seller = db.get("SELECT name FROM sellers WHERE id = ?", [uid.replace('seller:', '')]);
    return seller?.name || 'Vendedor';
  }
  return 'Usuário';
}

module.exports = {
  requireAdmin,
  requireSeller,
  requireAnyAuth,
  redirectIfAuthenticated,
  attachAuthInfo,
  requireMfaComplete,
  getUserDisplayName
};