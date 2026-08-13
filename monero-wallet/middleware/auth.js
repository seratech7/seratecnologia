const db = require('../database/db');
const { SECRET_ADMIN } = require('../config');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user && user.status === 'active') {
      req.user = user;
      return next();
    }
    delete req.session.userId;
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    const admin = db.getAdminById(req.session.adminId);
    if (admin) {
      req.admin = admin;
      return next();
    }
    delete req.session.adminId;
  }
  res.redirect(SECRET_ADMIN + '/login');
}

function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/wallet');
  next();
}

function redirectIfAdmin(req, res, next) {
  if (req.session && req.session.adminId) return res.redirect(SECRET_ADMIN);
  next();
}

module.exports = { requireAuth, requireAdmin, redirectIfAuth, redirectIfAdmin };