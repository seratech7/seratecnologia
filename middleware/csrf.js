function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  // Para forms multipart (upload) o corpo só é parseado pelo multer da rota,
  // que roda DEPOIS deste middleware. Então o token é enviado via query string
  // (injetado na action do form pelo injectCsrfIntoHtml) e lido daqui.
  var token = req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  if (!token || token !== req.session?.csrfToken) {
    // Após um deploy no Render o disco é zerado e o cookie antigo aponta para uma
    // sessão inexistente: o express-session regenera a sessão (csrfToken novo), então
    // o token da página previamente carregada não bate mais. Em vez de 403 seco nas
    // telas de login, redireciona para a própria página (GET) para gerar token novo.
    if (req.path === '/admin/login' || req.path === '/seller/login') {
      console.warn('[CSRF] Sessão regenerada pós-deploy, redirecionando', req.path);
      return res.redirect(302, req.path);
    }
    console.error('[CSRF] Token inválido:', req.method, req.path, 'token:', token, 'session:', req.session?.csrfToken);
    if (req.xhr || req.headers['content-type']?.includes('json')) {
      return res.status(403).json({ error: 'Token CSRF inválido. Recarregue a página.' });
    }
    return res.status(403).send('Token CSRF inválido. Recarregue a página.');
  }
  next();
}

// Auto-injects CSRF tokens into every rendered HTML response:
//  1. A hidden `_csrf` input inside each POST form that lacks one.
//  2. A <meta name="csrf-token"> after <head> so client-side fetch() can send the header.
function injectCsrfTokens(req, res, next) {
  var token = req.session?.csrfToken;
  var origSend = res.send.bind(res);
  res.send = function(body) {
    if (body && typeof body === 'string' && token) {
      var ct = res.get('Content-Type') || '';
      if (ct.indexOf('text/html') === 0 || ct.indexOf('text/plain') === 0 || !ct) {
        body = injectCsrfIntoHtml(body, token);
      }
    }
    return origSend(body);
  };
  next();
}

function injectCsrfIntoHtml(html, token) {
  if (!html || typeof html !== 'string' || !token) return html;
  if (html.indexOf('name="_csrf"') !== -1 && html.indexOf('name="csrf-token"') !== -1) return html;

  // Protect JS string literals: never inject inside <script>/<style> blocks.
  var blocks = [];
  var cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, function(m) {
    blocks.push(m);
    return '\u0000BLOCK' + (blocks.length - 1) + '\u0000';
  });

  if (cleaned.indexOf('name="_csrf"') === -1) {
    cleaned = cleaned.replace(/<form\b[^>]*>/gi, function(m) {
      if (/name=["']_csrf/i.test(m)) return m;
      if (/method=["']get["']/i.test(m)) return m;
      var isMultipart = /enctype=["']multipart\/form-data["']/i.test(m);
      // Forms multipart não têm o corpo parseado antes do CSRF (multer roda na
      // rota), então o token vai na action via query string.
      if (isMultipart) {
        var actionMatch = m.match(/action=["']([^"']*)["']/i);
        var action = actionMatch ? actionMatch[1] : '';
        var sep = action.indexOf('?') >= 0 ? '&' : '?';
        m = actionMatch
          ? m.replace(/action=["'][^"']*["']/i, 'action="' + action + sep + '_csrf=' + token + '"')
          : m.replace(/>\s*$/, ' action="' + sep.slice(1) + '_csrf=' + token + '">');
        return m;
      }
      return m + '<input type="hidden" name="_csrf" value="' + token + '">';
    });
  }

  if (cleaned.indexOf('name="csrf-token"') === -1) {
    cleaned = cleaned.replace(/<head\b[^>]*>/i, function(m) {
      return m + '<meta name="csrf-token" content="' + token + '">';
    });
  }

  for (var i = 0; i < blocks.length; i++) {
    cleaned = cleaned.replace('\u0000BLOCK' + i + '\u0000', blocks[i]);
  }
  return cleaned;
}

module.exports = { csrfProtection, injectCsrfTokens, injectCsrfIntoHtml };