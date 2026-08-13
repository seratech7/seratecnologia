const crypto = require('crypto');

function csrfProtection(req, res, next) {
  if (req.path.indexOf('/api/') === 0) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const token = req.body && req.body._csrf;
  const header = req.headers['x-csrf-token'];
  const valid = token === req.session.csrfToken || header === req.session.csrfToken;
  if (!valid) {
    // Após deploy no Render o disco é zerado e o cookie antigo aponta para sessão
    // inexistente: o express-session regenera a sessão (csrfToken novo). Nas telas de
    // login, redireciona (GET) para gerar token novo em vez de 403 seco.
    if (req.path === '/login' || req.path === '/admin/login') {
      return res.redirect(302, req.path);
    }
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