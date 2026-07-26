const db = require('../database/db');

function getConfig(key, def) {
  var r = db.get("SELECT value FROM config WHERE key = ?", [key]);
  return r ? r.value : def;
}

function securityMiddleware(req, res, next) {
  // Maintenance mode (skip for admin routes/admin login)
  if (!req.path.startsWith('/admin') && !req.path.startsWith('/seller') && req.path !== '/admin/login') {
    var mode = getConfig('maintenance_mode', '0');
    if (mode === '1' && !req.session.adminId) {
      var msg = getConfig('maintenance_message', 'Em manutenção. Voltamos em breve!');
      return res.status(503).render('maintenance', { title: 'Manutenção', message: msg });
    }
  }

  // IP block check
  var ip = req.ip || req.connection.remoteAddress || '';
  if (ip && db.isIpBlocked(ip)) {
    return res.status(403).send('Seu IP foi bloqueado.');
  }

  // CSP override from config
  var csp = getConfig('csp_enabled', '1');
  if (csp === '1') {
    var cspDirectives = getConfig('csp_directives', '');
    if (cspDirectives) {
      try {
        var dirs = JSON.parse(cspDirectives);
        var parts = [];
        Object.keys(dirs).forEach(function(k) {
          parts.push(k + ' ' + dirs[k].join(' '));
        });
        if (res.setHeader) res.setHeader('Content-Security-Policy', parts.join('; '));
      } catch(e) {}
    }
  }

  next();
}

module.exports = { securityMiddleware };
