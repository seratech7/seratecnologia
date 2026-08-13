require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');

const { initDb } = require('./database/db');
const db = require('./database/db');
const { SECRET_ADMIN } = require('./config');
const { getWallet } = require('./lib/wallet');
const { startScanner } = require('./lib/scanner');
const { csrfProtection, injectCsrfTokens } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
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

app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});

app.set('trust proxy', 1);

var FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({ path: path.join(__dirname, 'sessions'), ttl: 604800, reapInterval: 3600, retries: 0 }),
  secret: process.env.SESSION_SECRET || crypto.randomUUID(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !!process.env.SESSION_SECURE
  }
}));

app.use(generalLimiter);

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Login rate limiter no caminho do admin
app.use(SECRET_ADMIN + '/login', loginLimiter);

// Reescrita do caminho secreto do admin
app.use((req, res, next) => {
  const p = req.path;
  if (SECRET_ADMIN !== '/admin' && (p === SECRET_ADMIN || p.indexOf(SECRET_ADMIN + '/') === 0)) {
    req.url = '/admin' + p.substring(SECRET_ADMIN.length) + (req.url.indexOf('?') >= 0 ? req.url.substring(req.url.indexOf('?')) : '');
  }
  next();
});

app.use((req, res, next) => {
  const origRedirect = res.redirect.bind(res);
  res.redirect = function (url) {
    if (typeof url === 'string' && SECRET_ADMIN !== '/admin' && url.indexOf('/admin') === 0) {
      url = SECRET_ADMIN + url.substring(6);
    }
    return origRedirect(url);
  };
  const origSend = res.send.bind(res);
  res.send = function (body) {
    if (body && typeof body === 'string' && SECRET_ADMIN !== '/admin' && (!res.get('Content-Type') || res.get('Content-Type').indexOf('text/html') === 0)) {
      body = body.split('/admin/').join(SECRET_ADMIN + '/');
      body = body.split('"/admin"').join('"' + SECRET_ADMIN + '"');
    }
    return origSend(body);
  };
  next();
});

app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.adminPath = SECRET_ADMIN;
  res.locals.siteName = db.getSetting('site_name') || 'MoneroWallet';
  res.locals.currentPath = req.path;
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  req.flash = function (text, type) {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ text, type: type || 'info' });
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
});

// Manutenção (configurável no painel admin)
app.use((req, res, next) => {
  if (req.path.indexOf('/admin') === 0) return next();
  if (db.getSetting('maintenance_mode') === '1') {
    return res.status(503).render('maintenance', { title: 'Manutenção' });
  }
  next();
});

app.use(csrfProtection);
app.use(injectCsrfTokens);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/wallet'));
app.use('/api/v1', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/wallet');
  res.redirect('/login');
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Página não encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message, err.stack);
  if (req.xhr || req.headers['content-type']?.includes('json')) {
    return res.status(500).json({ error: 'Erro interno do servidor', detail: err.message });
  }
  res.status(500).send('Erro interno do servidor: ' + err.message);
});

async function start() {
  const sessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  await initDb();

  const wallet = await getWallet();
  console.log(`🔐 Modo da carteira: ${(process.env.WALLET_MODE || 'mock').toUpperCase()}`);

  startScanner(wallet, parseInt(process.env.SCAN_INTERVAL_SECONDS || '20', 10));

  app.listen(PORT, () => {
    console.log(`🚀 ${db.getSetting('site_name') || 'MoneroWallet'} rodando em http://localhost:${PORT}`);
    console.log(`👛 Carteira do usuário: http://localhost:${PORT}/wallet`);
    console.log(`📊 Painel Admin: http://localhost:${PORT}${SECRET_ADMIN}/login`);
  });
}

start().catch(e => { console.error('Fatal:', e); process.exit(1); });

module.exports = { app, SECRET_ADMIN };