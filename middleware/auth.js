function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
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

module.exports = { requireAdmin, redirectIfAdmin, requireSeller, redirectIfSeller };
