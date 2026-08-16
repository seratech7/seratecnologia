require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { initDb } = require('./database/db');
const db = require('./database/db');
const { backupDatabase } = require('./backup-db');
const { autoSave } = require('./auto-save');
const fs = require('fs');
const authRoutes = require('./routes/auth');
const authHive = require('./lib/auth-hive');
const { attachAuthInfo } = require('./middleware/auth-hive');

// Secret path prefixes (change these in .env to hide admin/seller panels)
const SECRET_ADMIN = (process.env.ADMIN_PATH || '/admin').replace(/\/+$/, '');
const SECRET_SELLER = (process.env.SELLER_PATH || '/seller').replace(/\/+$/, '');
const adminRoutes = require('./routes/admin');
const sellerRoutes = require('./routes/seller');
const sellerProfileRoutes = require('./routes/seller-profile');
const productRoutes = require('./routes/products');
const adRoutes = require('./routes/ads');
const notificationRoutes = require('./routes/notifications');
const purchaseRoutes = require('./routes/purchase');
const mercadopagoRoutes = require('./routes/mercadopago');
const customerRoutes = require('./routes/customer');
const newsRoutes = require('./routes/news');
const digitalRoutes = require('./routes/digital');
const { toggleMiddleware } = require('./middleware/toggles');
const { csrfProtection, injectCsrfTokens } = require('./middleware/csrf');
const { securityMiddleware } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// Generate CSP nonce per request
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"]
    }
  }
}));

// X-XSS-Protection override (helmet defaults to 0)
app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
});

// Rate limiting - login (configurable via admin panel: login_limit_max)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req, res) => {
    try {
      var r = db.get("SELECT value FROM config WHERE key = 'login_limit_max'");
      var max = r && r.value ? parseInt(r.value) : 30;
      return isNaN(max) || max <= 0 ? 30 : max;
    } catch (e) { return 30; }
  },
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting - API endpoints
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Muitas requisições. Tente novamente em 5 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting - geral (configurable via admin panel: rate_limit_max)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req, res) => {
    try {
      var r = db.get("SELECT value FROM config WHERE key = 'rate_limit_max'");
      var max = r && r.value ? parseInt(r.value) : 300;
      return isNaN(max) || max <= 0 ? 300 : max;
    } catch (e) { return 300; }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// File upload validation
const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
// Storage customizado: grava no disco (public/uploads) E no banco (file_store)
// em paralelo, garantindo que a foto continue servida mesmo após deploys
// (disco efêmero do Render).
const storage = {
  _handleFile(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowedExtensions.includes(ext) ? ext : '.jpg';
    const filename = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + safeExt;
    const destPath = path.join(__dirname, 'public', 'uploads', filename);
    const chunks = [];
    const out = fs.createWriteStream(destPath);
    file.stream.on('data', (c) => chunks.push(c));
    file.stream.on('error', (e) => cb(e));
    file.stream.pipe(out);
    out.on('error', (e) => cb(e));
    out.on('finish', () => {
      try {
        persistUploadToStore(filename, Buffer.concat(chunks), file.mimetype);
      } catch (e) {}
      cb(null, { path: destPath, filename, size: Buffer.concat(chunks).length });
    });
  },
  _removeFile(req, file, cb) {
    try { if (file.path) fs.unlinkSync(file.path); } catch (e) {}
    try { if (file.filename) db.deleteFileFromStore(file.filename); } catch (e) {}
    cb(null);
  }
};

// Persiste cópias dos uploads no banco (file_store) para sobreviverem a deploys
// com disco efêmero (Render). O multer diskStorage grava no disco; este helper
// copia o arquivo gravado para o banco assim que o buffer é recebido.
const persistUploadToStore = (filename, buffer, mimetype) => {
  try {
    if (!db) return;
    db.saveFileToStore(filename, buffer, mimetype || 'image/jpeg');
  } catch (e) {
    console.error('[uploads] falha ao persistir no file_store:', e.message);
  }
};
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return cb(new Error('Extensão de arquivo inválida.'));
      }
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem inválido. Use JPEG, PNG, GIF ou WebP.'));
    }
  }
});

// Multer for database uploads (.sqlite / .db) — saved outside public/ (not downloadable)
const dbStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'db-imports');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, 'db-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.sqlite')
});
const dbUpload = multer({
  storage: dbStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.sqlite' || ext === '.db') return cb(null, true);
    cb(new Error('O arquivo deve ser .sqlite'));
  }
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Trust the reverse proxy ONLY in production (Render) — never when directly reachable,
// otherwise clients can spoof X-Forwarded-For to bypass rate limits / IP blocks.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
} else {
  app.set('trust proxy', false);
}

var FileStore = require('session-file-store')(session);
var sessionStore;
try {
  var fsmod = require('fs');
  // SESSION_DIR opcional para apontar sessões para um disco persistente (ex.: /var/data/sessions no Render)
  var sessionDir = process.env.SESSION_DIR ? path.resolve(process.env.SESSION_DIR) : path.join(__dirname, 'sessions');
  fsmod.mkdirSync(sessionDir, { recursive: true });
  // Teste real de escrita: alguns hosts (ex.: Render free) tem disco somente leitura
  var probe = path.join(sessionDir, '.probe-' + Date.now());
  fsmod.writeFileSync(probe, 'ok');
  fsmod.unlinkSync(probe);
  sessionStore = new FileStore({
    path: sessionDir,
    ttl: 604800,
    reapInterval: 3600,
    // Deploy no Render zera o disco: arquivos de sessão antigos somem.
    // retries:0 evita o spam "will retry" 5x; o ENOENT propaga e o
    // express-session regenera a sessão no caminho nativo (gera cookie novo).
    retries: 0
  });
  console.log('[session] FileStore em ' + sessionDir);
} catch (e) {
  console.warn('[session] FileStore indisponível, usando MemoryStore:', e.message);
  sessionStore = new session.MemoryStore();
}
app.use(cookieParser());
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || crypto.randomUUID(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

app.use(attachAuthInfo);

// Enforce configurable upload size limit (admin panel -> upload_max_size, default 5MB)
app.use((req, res, next) => {
  var isUpload = (req.method === 'POST' || req.method === 'PUT') &&
    (req.headers['content-type'] || '').toLowerCase().indexOf('multipart/form-data') === 0 &&
    req.path.indexOf('/admin/database') !== 0;
  if (!isUpload) return next();
  try {
    var r = db.get("SELECT value FROM config WHERE key = 'upload_max_size'");
    var mb = r && r.value ? parseFloat(r.value) : 5;
    if (isNaN(mb) || mb <= 0) mb = 5;
    var maxBytes = mb * 1024 * 1024;
    var len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > maxBytes) {
      return res.status(413).send('Arquivo muito grande. Máximo ' + mb + 'MB.');
    }
  } catch (e) {}
  next();
});

app.use(generalLimiter);

// Login rate limiters — apply at secret paths before rewrite
app.use(SECRET_ADMIN + '/login', loginLimiter);
app.use(SECRET_SELLER + '/login', loginLimiter);
// Also apply at default paths for backward compat when using defaults
if (SECRET_ADMIN !== '/admin') app.use('/admin/login', loginLimiter);
if (SECRET_SELLER !== '/seller') app.use('/seller/login', loginLimiter);

app.use(express.static(path.join(__dirname, 'public')));

// Favicon (SVG)
app.get('/favicon.ico', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'img', 'logo-icon.svg'), { headers: { 'Content-Type': 'image/svg+xml' } });
});

// Fallback para arquivos de upload: se o arquivo sumiu do disco (ex.: deploy no Render,
// que usa disco efêmero), serve a cópia persistida no banco (file_store).
app.use('/uploads', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  var filename = path.basename(decodeURIComponent(req.path || ''));
  if (!filename || filename.indexOf('.') === -1) return next();
  var filePath = path.join(__dirname, 'public', 'uploads', filename);
  if (fs.existsSync(filePath)) return next();
  try {
    var stored = db.getFileFromStore(filename);
    if (!stored) return next();
    res.setHeader('Content-Type', stored.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data));
  } catch (e) {
    return next();
  }
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Link do grupo no Signal exibido no banner amarelo do topo (todas as paginas)
app.locals.signalGroupLink = process.env.SIGNAL_GROUP_LINK || 'https://signal.group/#CjQKIE4kEEyVZA0sdLKmgM2CfJ5qxYvr8wx-3vNyW6dIfSj3EhCu2rzTlvQ-X46-HP8GSdzg';

// Upload error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    if (req.path.indexOf('/admin/database') === 0) return res.redirect('/admin/database?error=' + encodeURIComponent('Arquivo muito grande. Máximo 100MB.'));
    var r = null;
    try { r = db.get("SELECT value FROM config WHERE key = 'upload_max_size'"); } catch (e) {}
    var mb = r && r.value ? parseFloat(r.value) : 5;
    if (isNaN(mb) || mb <= 0) mb = 5;
    return res.status(400).send('Arquivo muito grande. Máximo ' + mb + 'MB.');
  }
  if (err.message?.includes('Formato de imagem') || err.message?.includes('.sqlite')) {
    if (req.path.indexOf('/admin/database') === 0) return res.redirect('/admin/database?error=' + encodeURIComponent(err.message));
    return res.status(400).send(err.message);
  }
  next(err);
});

// Rewrite secret paths to internal paths
app.use((req, res, next) => {
  var p = req.path;
  if (SECRET_ADMIN !== '/admin' && (p === SECRET_ADMIN || p.indexOf(SECRET_ADMIN + '/') === 0)) {
    req.url = '/admin' + p.substring(SECRET_ADMIN.length) + (req.url.indexOf('?') >= 0 ? req.url.substring(req.url.indexOf('?')) : '');
  } else if (SECRET_SELLER !== '/seller' && (p === SECRET_SELLER || p.indexOf(SECRET_SELLER + '/') === 0)) {
    req.url = '/seller' + p.substring(SECRET_SELLER.length) + (req.url.indexOf('?') >= 0 ? req.url.substring(req.url.indexOf('?')) : '');
  }
  next();
});

// Override res.redirect to rewrite internal paths back to secret paths
// Also patch res.send/res.render to rewrite paths in HTML
app.use((req, res, next) => {
  var origRedirect = res.redirect.bind(res);
  res.redirect = function(url) {
    if (typeof url === 'string') {
      if (SECRET_ADMIN !== '/admin' && url.indexOf('/admin') === 0) {
        url = SECRET_ADMIN + url.substring(6);
      } else if (SECRET_SELLER !== '/seller' && url.indexOf('/seller') === 0) {
        url = SECRET_SELLER + url.substring(7);
      }
    }
    return origRedirect(url);
  };

  // Patch send to rewrite /admin/ and /seller/ in HTML
  if (SECRET_ADMIN !== '/admin' || SECRET_SELLER !== '/seller') {
    var origSend = res.send.bind(res);
    res.send = function(body) {
      if (body && typeof body === 'string' && (!res.get('Content-Type') || res.get('Content-Type').indexOf('text/html') === 0 || res.get('Content-Type').indexOf('text/plain') === 0)) {
        if (SECRET_ADMIN !== '/admin') body = body.split('/admin/').join(SECRET_ADMIN + '/');
        if (SECRET_SELLER !== '/seller') body = body.split('/seller/').join(SECRET_SELLER + '/');
        // Also rewrite bare /admin and /seller in quotes (action/href without trailing slash)
        if (SECRET_ADMIN !== '/admin') body = body.split('"/admin"').join('"' + SECRET_ADMIN + '"');
        if (SECRET_SELLER !== '/seller') body = body.split('"/seller"').join('"' + SECRET_SELLER + '"');
      }
      return origSend(body);
    };
  }
  next();
});

app.use((req, res, next) => {
  res.locals.admin = req.session.adminId ? true : false;
  res.locals.seller = req.session.sellerId ? true : false;
  res.locals.customer = req.session.customerId ? true : false;
  res.locals.currentPath = req.path;
  res.locals.session = req.session;
  res.locals.query = req.query;
  res.locals.adminPath = SECRET_ADMIN;
  res.locals.sellerPath = SECRET_SELLER;
  if (req.session.sellerId && db.getUnreadMessageCount) {
    res.locals.unreadChat = db.getUnreadMessageCount(req.session.sellerId);
    var sid = req.session.sellerId;
    var pq = db.query("SELECT COUNT(*) as c FROM product_questions WHERE seller_id = ? AND (answer IS NULL OR answer = '')", [sid]);
    res.locals.pendingQuestionsCount = pq && pq[0] ? pq[0].c : 0;
    var pp = db.get("SELECT COUNT(*) as c FROM products WHERE seller_id = ? AND status = 'pending'", [sid]);
    res.locals.pendingProductsCount = pp ? pp.c : 0;
  }
  if (req.session.adminId) {
    var ap = db.get("SELECT COUNT(*) as c FROM products WHERE status='pending'");
    res.locals.adminPendingProducts = ap ? ap.c : 0;
    var asp = db.get("SELECT COUNT(*) as c FROM sales WHERE status='pending'");
    res.locals.adminPendingSales = asp ? asp.c : 0;
    var app2 = db.get("SELECT COUNT(*) as c FROM payouts WHERE status='pending'");
    res.locals.adminPendingPayouts = app2 ? app2.c : 0;
  }
  // Generate CSRF token
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  // Flash messages
  req.flash = function(text, type) {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ text: text, type: type || 'info' });
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
});

app.use(toggleMiddleware);
app.use(securityMiddleware);

// CSRF protection for all non-GET requests (admin/seller included)
app.use(csrfProtection);
// Auto-inject _csrf hidden inputs into POST forms + meta tag for fetch()
app.use(injectCsrfTokens);

// Inject custom CSS/JS from config
app.use((req, res, next) => {
  try {
    var db = require('./database/db');
    var customCss = db.get("SELECT value FROM config WHERE key = 'custom_css'");
    var customJs = db.get("SELECT value FROM config WHERE key = 'custom_js'");
    res.locals.customCSS = customCss ? customCss.value : '';
    res.locals.customJS = customJs ? customJs.value : '';
    var keys = ['site_name','site_description','site_email','site_whatsapp','site_phone','site_address','footer_text','site_logo_url','site_favicon_url','social_instagram','social_facebook','social_tiktok','social_youtube','social_discord'];
    var sc = {};
    keys.forEach(function(k) {
      var r = db.get("SELECT value FROM config WHERE key = ?", [k]);
      sc[k] = r ? r.value : '';
    });
    res.locals.siteConfig = sc;
  } catch(e) {
    res.locals.customCSS = '';
    res.locals.customJS = '';
    res.locals.siteConfig = {};
  }
  next();
});

app.use(function(req, res, next) {
  if (req.path.startsWith('/admin') || req.path.startsWith('/seller') || req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$/i)) return next();
  var db = require('./database/db');
  var ip = req.ip || req.connection.remoteAddress || '';
  var sessionId = req.sessionID || '';
  var productId = null;
  var m = req.path.match(/^\/produto\/(\d+)/);
  if (m) productId = parseInt(m[1], 10);
  try {
    db.run('INSERT INTO page_views (path, product_id, session_id, ip, referrer) VALUES (?, ?, ?, ?, ?)',
      [req.path, productId, sessionId, ip, req.get('Referer') || '']);
  } catch(e) { /* silent */ }

  if (req.path === '/' && req.query._welcome !== '1') {
    try {
      var visitCount = db.get("SELECT COUNT(*) as c FROM page_views WHERE ip = ?", [ip]);
      if (visitCount && visitCount.c <= 1) {
        db.addNotification(ip, 'welcome', 'Bem-vindo à SeraTecnologia! Explore nossos produtos de hardware e componentes.', 'wave', '/');
      }
    } catch(e) { /* silent */ }
  }

  next();
});

// Activity logger middleware (admin + seller actions)
app.use((req, res, next) => {
  var originalEnd = res.end;
  var db = require('./database/db');
  res.end = function() {
    if (req.method === 'POST' && (req.session?.adminId || req.session?.sellerId)) {
      var userType = req.session.adminId ? 'admin' : 'seller';
      var userId = req.session.adminId || req.session.sellerId;
      var userName = req.session.adminName || req.session.sellerName || '';
      var action = req.method + ' ' + req.path;
      if (!req.path.includes('/login') && !req.path.includes('/logout')) {
        db.logActivity(userType, userId, userName, action, '', '', 0, req.ip || req.connection.remoteAddress || '');
      }
    }
    originalEnd.apply(res, arguments);
  };
  next();
});

// Debug endpoint — only accessible with valid admin session
app.get('/admin/debug', (req, res) => {
  if (!req.session || !req.session.adminId) {
    return res.status(404).send('not found');
  }
  const db = require('./database/db');
  const sellers = db.get('SELECT COUNT(*) as c FROM sellers');
  const products = db.get('SELECT COUNT(*) as c FROM products');
  res.json({
    adminExists: true,
    sellers: sellers ? sellers.c : 0,
    products: products ? products.c : 0
  });
});

app.use('/api', apiLimiter);
app.use('/admin', authRoutes);
app.use('/admin', adminRoutes(upload, dbUpload));
app.use('/admin', require('./routes/marketing')());
app.use('/seller', sellerRoutes(upload));
app.use('/vendedor', sellerProfileRoutes);
// Home = Notícias
app.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    const news = db.getNews({ category, search, limit: 50 }) || [];
    const cats = db.getNewsCategories() || [];
    const categoryCounts = {};
    cats.forEach(c => { categoryCounts[c.category] = db.getNewsCount({ category: c.category }); });
    const featured = db.getFeaturedNews(3) || [];
    const videos = db.getNews({ video: true, limit: 4 }) || [];
    const total = db.getNewsCount({ category, search });
    const hasMore = news.length < total;
    res.render('news', {
      title: 'Notícias - Games & Hacking',
      news,
      categories: cats,
      categoryCounts,
      featured,
      videos,
      selectedCategory: category || '',
      search: search || '',
      initialLimit: 50,
      hasMore,
      total
    });
  } catch (e) {
    console.error('Home news error:', e);
    res.render('news', { title: 'Notícias', news: [], categories: [], categoryCounts: {}, featured: [], videos: [], selectedCategory: '', search: '', initialLimit: 9, hasMore: false, total: 0 });
  }
});

app.use('/', productRoutes);
app.use('/', notificationRoutes);
app.use('/', purchaseRoutes);
app.use('/', mercadopagoRoutes);
app.use('/', customerRoutes);
app.use('/api', adRoutes);
app.use('/', require('./routes/attraction'));

// Notícias e produtos digitais (logins com entrega automática)
app.use('/noticias', newsRoutes);
app.use('/noticia', newsRoutes);
app.use('/logins', digitalRoutes);

// Thumbnail gerado localmente para notícias (funciona offline, sem picsum/YT externo)
function catColor(cat) {
  var map = { 'Hacking':'#ff4d4f', 'Games':'#7c3aed', 'Tecnologia':'#00b894', 'Seguranca':'#ff7849', 'Segurança':'#ff7849', 'Ciencia':'#0984e3', 'Ciência':'#0984e3', 'Hardware':'#e17055', 'Software':'#6c5ce7' };
  if (map[cat]) return map[cat];
  var h = 0, s = String(cat || 'Geral');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  var palette = ['#ff4d4f','#7c3aed','#00b894','#0984e3','#e17055','#fdcb6e','#00cec9','#e84393'];
  return palette[h % palette.length];
}
function catColorShade(hex, pct) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function (x) { return x + x; }).join('');
  var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
  function f(c) { return Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255))); }
  return '#' + [f(r), f(g), f(b)].map(function (c) { return ('0' + c.toString(16)).slice(-2); }).join('');
}
app.get('/img/news-thumb', function (req, res) {
  try {
    var w = Math.max(120, Math.min(1200, parseInt(req.query.w) || 600));
    var h = Math.max(120, Math.min(1200, parseInt(req.query.h) || 400));
    var cat = req.query.cat || 'Geral';
    var c = catColor(cat), c2 = catColorShade(c, -40);
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "' viewBox='0 0 " + w + ' ' + h + "' preserveAspectRatio='xMidYMid slice'>"
      + "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + c + "'/><stop offset='1' stop-color='" + c2 + "'/></linearGradient>"
      + "<pattern id='p' width='30' height='30' patternUnits='userSpaceOnUse'><circle cx='3' cy='3' r='1.7' fill='rgba(255,255,255,0.16)'/></pattern></defs>"
      + "<rect width='100%' height='100%' fill='url(#g)'/>"
      + "<rect width='100%' height='100%' fill='url(#p)'/>"
      + "<path d='M0 " + (h * 0.72) + ' L' + (w * 0.35) + ' ' + (h * 0.5) + ' L' + (w * 0.6) + ' ' + (h * 0.66) + ' L' + w + ' ' + (h * 0.4) + ' L' + w + ' ' + h + ' L0 ' + h + " Z' fill='rgba(0,0,0,0.18)'/>"
      + "<path d='M0 " + (h * 0.82) + ' L' + (w * 0.4) + ' ' + (h * 0.62) + ' L' + (w * 0.7) + ' ' + (h * 0.78) + ' L' + w + ' ' + (h * 0.58) + ' L' + w + ' ' + h + ' L0 ' + h + " Z' fill='rgba(0,0,0,0.24)'/>"
      + "</svg>";
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (e) { res.status(500).send(''); }
});
app.get('/entrega/:code', (req, res) => {
  try {
    const sale = db.getDigitalSaleByDeliveryCode(req.params.code);
    if (!sale) return res.status(404).render('404', { title: 'Código de entrega inválido' });
    res.render('digital-delivery', {
      title: 'Entrega - ' + (sale.product_name || 'Produto'),
      sale
    });
  } catch (e) {
    console.error('Delivery error:', e);
    res.status(404).render('404', { title: 'Erro na entrega' });
  }
});

// VAPID public key para o cliente (PWA)
app.get('/api/push/public-key', (req, res) => {
  const { getPublicKey } = require('./utils/push');
  res.json({ publicKey: getPublicKey() });
});

// PWA: manifest e service worker
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Sitemap — only last 50 products to prevent enumeration
app.get('/sitemap.xml', (req, res) => {
  try {
    var db = require('./database/db');
    var products = db.query("SELECT id, updated_at FROM products WHERE status = 'active' ORDER BY id DESC LIMIT 50");
    var pages = db.getAllPages();
    var baseUrl = process.env.BASE_URL || 'https://seratecnologia-1.onrender.com';
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>' + baseUrl + '/</loc><priority>1.0</priority></url>\n';
    products.forEach(function(p) {
      xml += '  <url><loc>' + baseUrl + '/produto/' + p.id + '</loc><lastmod>' + (p.updated_at || '').slice(0,10) + '</lastmod><priority>0.8</priority></url>\n';
    });
    (pages || []).forEach(function(p) {
      xml += '  <url><loc>' + baseUrl + '/pagina/' + p.slug + '</loc><priority>0.5</priority></url>\n';
    });
    xml += '</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch(e) {
    res.status(500).send('Error generating sitemap');
  }
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  var baseUrl = process.env.BASE_URL || 'https://seratecnologia-1.onrender.com';
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: ' + baseUrl + '/sitemap.xml\n');
});

// IndexNow key file (necessário para indexação instantânea Bing/Seznam/Yandex)
app.get('/:idxkey.txt', (req, res) => {
  var key = process.env.INDEXNOW_KEY || '';
  if (!key) return res.status(404).send('not found');
  if (req.params.idxkey !== key) return res.status(404).send('not found');
  res.type('text/plain');
  res.send(key);
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Página não encontrada' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message, err.stack);
  if (req.xhr || req.headers['content-type']?.includes('json')) {
    return res.status(500).json({ error: 'Erro interno do servidor', detail: err.message });
  }
  res.status(500).send('Erro interno do servidor: ' + err.message);
});

async function start() {
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const sessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

  await initDb();

  // Garante que os uploads existentes no disco tenham cópia no banco
  // (file_store), para não sumirem após deploys com disco efêmero.
  try {
    const backfilled = db.backfillFileStore(uploadsDir);
    if (backfilled > 0) console.log(`[uploads] ${backfilled} arquivo(s) copiado(s) para o file_store`);
  } catch (e) { console.error('[uploads] backfill falhou:', e.message); }
  app.listen(PORT, () => {
    console.log(`🚀 SeraTecnologia rodando em http://localhost:${PORT}`);
    console.log(`📊 Painel Admin: http://localhost:${PORT}${SECRET_ADMIN}/login`);
    console.log(`🛒 Painel Vendedor: http://localhost:${PORT}${SECRET_SELLER}/login`);

    backupDatabase();
    setInterval(backupDatabase, 3600000);

    setTimeout(autoSave, 120000);
    setInterval(autoSave, 7200000);

    // Agendador de automação (indexação, promoção diária)
    try {
      const { startScheduler } = require('./utils/scheduler');
      startScheduler();
    } catch (e) { console.error('Erro iniciando agendador:', e.message); }
  });
}

start().catch(e => { console.error('Fatal:', e); process.exit(1); });
