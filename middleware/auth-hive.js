const authHive = require('../lib/auth-hive');
const db = require('../database/db');

function requireAdmin(req, res, next) {
  return authHive.requireAuth('admin')(req, res, (err) => {
    if (err) return next(err);
    const session = authHive.validateSession(req, res);
    if (session && session.userType === 'admin') {
      req.session.adminId = session.uid.replace('admin:', '');
      const admin = db.get("SELECT role, display_name FROM admins WHERE id = ?", [req.session.adminId]);
      if (admin) {
        req.adminRole = admin.role;
        req.session.adminName = admin.display_name;
      }
      return next();
    }
    res.redirect('/admin/login');
  });
}

function requireSuperAdmin(req, res, next) {
  return authHive.requireAuth('admin')(req, res, (err) => {
    if (err) return next(err);
    const session = authHive.validateSession(req, res);
    if (session && session.userType === 'admin') {
      req.session.adminId = session.uid.replace('admin:', '');
      const admin = db.get("SELECT role, display_name FROM admins WHERE id = ?", [req.session.adminId]);
      if (admin && (admin.role === 'super_admin' || admin.role === 'admin')) {
        req.adminRole = admin.role;
        req.session.adminName = admin.display_name;
        return next();
      }
    }
    res.redirect('/admin/dashboard');
  });
}

function requireSeller(req, res, next) {
  return authHive.requireAuth('seller')(req, res, (err) => {
    if (err) return next(err);
    const session = authHive.validateSession(req, res);
    if (session && session.userType === 'seller') {
      req.session.sellerId = session.uid.replace('seller:', '');
      const seller = db.get("SELECT name FROM sellers WHERE id = ?", [req.session.sellerId]);
      if (seller) req.session.sellerName = seller.name;
      return next();
    }
    res.redirect('/seller/login');
  });
}

function requireCustomer(req, res, next) {
  return authHive.requireAuth('customer')(req, res, (err) => {
    if (err) return next(err);
    const session = authHive.validateSession(req, res);
    if (session && session.userType === 'customer') {
      req.session.customerId = session.uid.replace('customer:', '');
      const customer = db.get("SELECT name FROM customers WHERE id = ?", [req.session.customerId]);
      if (customer) req.session.customerName = customer.name;
      return next();
    }
    res.redirect('/login');
  });
}

function requireAnyAuth(req, res, next) {
  return authHive.requireAuth()(req, res, next);
}

function redirectIfAuthenticated(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session) {
    const redirectPath = session.userType === 'admin' ? '/admin/dashboard' : (session.userType === 'seller' ? '/seller/dashboard' : '/conta');
    return res.redirect(redirectPath);
  }
  next();
}

function redirectIfAdmin(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session && session.userType === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  next();
}

function redirectIfSeller(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session && session.userType === 'seller') {
    return res.redirect('/seller/dashboard');
  }
  next();
}

function redirectIfCustomer(req, res, next) {
  const session = authHive.validateSession(req, res);
  if (session && session.userType === 'customer') {
    return res.redirect('/conta');
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
    res.locals.isCustomer = session.userType === 'customer';
    
    if (session.userType === 'admin') {
      req.session.adminId = session.uid.replace('admin:', '');
      const admin = db.get("SELECT display_name FROM admins WHERE id = ?", [req.session.adminId]);
      if (admin) req.session.adminName = admin.display_name;
    } else if (session.userType === 'seller') {
      req.session.sellerId = session.uid.replace('seller:', '');
      const seller = db.get("SELECT name FROM sellers WHERE id = ?", [req.session.sellerId]);
      if (seller) req.session.sellerName = seller.name;
    } else if (session.userType === 'customer') {
      req.session.customerId = session.uid.replace('customer:', '');
      const customer = db.get("SELECT name FROM customers WHERE id = ?", [req.session.customerId]);
      if (customer) req.session.customerName = customer.name;
    }
  } else {
    res.locals.auth = null;
    res.locals.isAdmin = false;
    res.locals.isSeller = false;
    res.locals.isCustomer = false;
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
  } else if (userType === 'customer') {
    const customer = db.get("SELECT name FROM customers WHERE id = ?", [uid.replace('customer:', '')]);
    return customer?.name || 'Cliente';
  }
  return 'Usuário';
}

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  requireSeller,
  requireCustomer,
  requireAnyAuth,
  redirectIfAuthenticated,
  redirectIfAdmin,
  redirectIfSeller,
  redirectIfCustomer,
  attachAuthInfo,
  requireMfaComplete,
  getUserDisplayName
};