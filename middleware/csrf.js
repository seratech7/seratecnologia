function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  var token = req.body?._csrf || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  if (!token || token !== req.session?.csrfToken) {
    console.error('[CSRF] Token inválido:', req.method, req.path);
    if (req.xhr || req.headers['content-type']?.includes('json')) {
      return res.status(403).json({ error: 'Token CSRF inválido. Recarregue a página.' });
    }
    return res.status(403).send('Token CSRF inválido. Recarregue a página.');
  }
  next();
}

module.exports = { csrfProtection };
