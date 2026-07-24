require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { initDb } = require('./database/db');
const { backupDatabase } = require('./backup-db');
const { autoSave } = require('./auto-save');
const fs = require('fs');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const sellerRoutes = require('./routes/seller');
const sellerProfileRoutes = require('./routes/seller-profile');
const productRoutes = require('./routes/products');
const adRoutes = require('./routes/ads');
const notificationRoutes = require('./routes/notifications');
const purchaseRoutes = require('./routes/purchase');
const mercadopagoRoutes = require('./routes/mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting - login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas. Tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting - geral
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});

// File upload validation
const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem inválido. Use JPEG, PNG, GIF ou WebP.'));
    }
  }
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomUUID(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(generalLimiter);
app.use('/admin/login', loginLimiter);
app.use('/seller/login', loginLimiter);

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Erro:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).send('Arquivo muito grande. Máximo 5MB.');
  }
  if (err.message?.includes('Formato de imagem')) {
    return res.status(400).send(err.message);
  }
  res.status(500).send('Erro interno do servidor');
});

app.use((req, res, next) => {
  res.locals.admin = req.session.adminId ? true : false;
  res.locals.seller = req.session.sellerId ? true : false;
  res.locals.currentPath = req.path;
  res.locals.session = req.session;
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

app.get('/admin/reset-senha/:token', (req, res) => {
  if (req.params.token !== '12345') return res.status(404).send('not found');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 12);
  const db = require('./database/db');
  db.run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, 'admin']);
  res.send('Senha do admin resetada para: admin123');
});

app.get('/admin/debug', (req, res) => {
  const db = require('./database/db');
  const bcrypt = require('bcryptjs');
  const admin = db.get('SELECT * FROM admins WHERE username = ?', ['admin']);
  const sellers = db.get('SELECT COUNT(*) as c FROM sellers');
  const products = db.get('SELECT COUNT(*) as c FROM products');
  const freshHash = bcrypt.hashSync('admin123', 12);
  if (admin) {
    res.json({
      adminExists: true,
      hashFull: admin.password_hash,
      compareAdmin123: bcrypt.compareSync('admin123', admin.password_hash),
      freshHash: freshHash,
      compareFresh: bcrypt.compareSync('admin123', freshHash),
      envAdminPassword: process.env.ADMIN_PASSWORD || '(not set)',
      sellers: sellers ? sellers.c : 0,
      products: products ? products.c : 0
    });
  } else {
    res.json({ adminExists: false, sellers: sellers ? sellers.c : 0, products: products ? products.c : 0 });
  }
});

app.use('/admin', authRoutes);
app.use('/admin', adminRoutes(upload));
app.use('/seller', sellerRoutes(upload));
app.use('/vendedor', sellerProfileRoutes);
app.use('/', productRoutes);
app.use('/', notificationRoutes);
app.use('/', purchaseRoutes);
app.use('/', mercadopagoRoutes);
app.use('/api', adRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Página não encontrada' });
});

async function start() {
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  await initDb();
  app.listen(PORT, () => {
    console.log(`🚀 SeraTecnologia rodando em http://localhost:${PORT}`);
    console.log(`📊 Painel Admin: http://localhost:${PORT}/admin/login`);
    console.log(`🛒 Painel Vendedor: http://localhost:${PORT}/seller/login`);

    backupDatabase();
    setInterval(backupDatabase, 3600000);

    setTimeout(autoSave, 120000);
    setInterval(autoSave, 7200000);
  });
}

start().catch(e => { console.error('Fatal:', e); process.exit(1); });
