const db = require('../database/db');

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    var admin = db.get("SELECT role FROM admins WHERE id = ?", [req.session.adminId]);
    if (admin) {
      req.adminRole = admin.role;
      return next();
    }
  }
  res.redirect('/admin/login');
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    var admin = db.get("SELECT role FROM admins WHERE id = ?", [req.session.adminId]);
    if (admin && admin.role === 'admin') {
      req.adminRole = admin.role;
      return next();
    }
  }
  res.redirect('/admin/dashboard');
}

function redirectIfAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

function requireSeller(req, res, next) {
  if (req.session && req.session.sellerId) {
    return next();
  }
  res.redirect('/seller/login');
}

function redirectIfSeller(req, res, next) {
  if (req.session && req.session.sellerId) {
    return res.redirect('/seller/dashboard');
  }
  next();
}

module.exports = { requireAdmin, requireSuperAdmin, redirectIfAdmin, requireSeller, redirectIfSeller };