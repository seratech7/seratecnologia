const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (req.path.indexOf('/api/') === 0) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const token = req.body && req.body._csrf;
  const header = req.headers['x-csrf-token'];
  const valid = token === req.session.csrfToken || header === req.session.csrfToken;
  if (!valid) {
    return res.status(403).json({ error: 'Token CSRF inválido ou expirado. Recarregue a página.' });
  }
  next();
}

function injectCsrfTokens(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

module.exports = { csrfProtection, injectCsrfTokens };