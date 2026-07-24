const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

module.exports = function(upload) {
const router = express.Router();
router.use(requireAdmin);

router.get('/dashboard', (req, res) => {
  const total = db.get('SELECT COUNT(*) as count FROM products');
  const active = db.get("SELECT COUNT(*) as count FROM products WHERE status = 'active'");
  const pending = db.get("SELECT COUNT(*) as count FROM products WHERE status = 'pending'");
  const totalSellers = db.get('SELECT COUNT(*) as count FROM sellers');
  const featured = db.get('SELECT COUNT(*) as count FROM products WHERE featured = 1');
  const recent = db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.created_at DESC LIMIT 5');
  const featuredProducts = db.query('SELECT p.*, c.name as category_name, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.featured = 1 ORDER BY p.updated_at DESC');

  res.render('admin/dashboard', {
    title: 'Dashboard - Painel Admin',
    stats: { total: total.count, active: active.count, pending: pending.count, sellers: totalSellers.count, featured: featured.count },
    recentProducts: recent,
    featuredProducts
  });
});

router.get('/analytics', (req, res) => {
  const totalViews = db.get('SELECT COUNT(*) as c FROM page_views');
  const uniqueVisitors = db.get("SELECT COUNT(DISTINCT ip) as c FROM page_views");
  const todayViews = db.get("SELECT COUNT(*) as c FROM page_views WHERE date(created_at) = date('now')");
  const todayVisitors = db.get("SELECT COUNT(DISTINCT ip) as c FROM page_views WHERE date(created_at) = date('now')");
  const activeNow = db.get("SELECT COUNT(DISTINCT session_id) as c FROM page_views WHERE created_at >= datetime('now', '-5 minutes')");

  const topProducts = db.query(`
    SELECT p.id, p.name, p.image, COUNT(*) as views,
           (SELECT MIN(created_at) FROM page_views WHERE product_id = p.id) as first_view
    FROM page_views pv JOIN products p ON pv.product_id = p.id
    GROUP BY p.id ORDER BY views DESC LIMIT 10
  `);

  const topPages = db.query(`
    SELECT path, COUNT(*) as views, COUNT(DISTINCT ip) as visitors
    FROM page_views WHERE product_id IS NULL
    GROUP BY path ORDER BY views DESC LIMIT 10
  `);

  const viewsByDay = db.query(`
    SELECT date(created_at) as day, COUNT(*) as views, COUNT(DISTINCT ip) as visitors
    FROM page_views WHERE created_at >= date('now', '-14 days')
    GROUP BY day ORDER BY day ASC
  `);

  const recentViews = db.query(`
    SELECT pv.*, p.name as product_name
    FROM page_views pv LEFT JOIN products p ON pv.product_id = p.id
    ORDER BY pv.created_at DESC LIMIT 20
  `);

  res.render('admin/analytics', {
    title: 'Analytics - Painel Admin',
    stats: {
      totalViews: totalViews ? totalViews.c : 0,
      uniqueVisitors: uniqueVisitors ? uniqueVisitors.c : 0,
      todayViews: todayViews ? todayViews.c : 0,
      todayVisitors: todayVisitors ? todayVisitors.c : 0,
      activeNow: activeNow ? activeNow.c : 0
    },
    topProducts,
    topPages,
    viewsByDay,
    recentViews
  });
});

router.get('/products', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const filter = req.query.filter || 'all';

  let where = '';
  const params = [];

  if (filter === 'pending') { where = "WHERE p.status = 'pending'"; }
  else if (filter === 'active') { where = "WHERE p.status = 'active'"; }
  else if (filter === 'rejected') { where = "WHERE p.status = 'rejected'"; }
  else if (filter === 'featured') { where = "WHERE p.featured = 1"; }

  if (search) {
    const joinOp = where ? 'AND' : 'WHERE';
    where += ` ${joinOp} (p.name LIKE ? OR p.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  const countSql = `SELECT COUNT(*) as count FROM products p ${where}`;
  const dataSql = `SELECT p.*, c.name as category_name, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;

  const totalCount = db.get(countSql, params);
  const products = db.query(dataSql, [...params, limit, offset]);
  const totalPages = Math.ceil(totalCount.count / limit);

  res.render('admin/products', {
    title: 'Produtos - Painel Admin',
    products, currentPage: page, totalPages, search, filter
  });
});

router.post('/products/approve/:id', (req, res) => {
  db.run("UPDATE products SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  res.redirect('/admin/products');
});

router.post('/products/reject/:id', (req, res) => {
  db.run("UPDATE products SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  res.redirect('/admin/products');
});

router.post('/products/feature/:id', (req, res) => {
  const product = db.get('SELECT featured FROM products WHERE id = ?', [req.params.id]);
  if (product) {
    const newVal = product.featured ? 0 : 1;
    db.run('UPDATE products SET featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newVal, req.params.id]);
  }
  res.redirect(req.get('Referer') || '/admin/products');
});

router.get('/products/new', (req, res) => {
  const categories = db.query('SELECT * FROM categories ORDER BY name');
  res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: null, sellers: [] });
});

router.post('/products/new', upload.single('image'), (req, res) => {
  const { name, description, price, category_id, condition, location, status, featured, seller_id } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome e preço são obrigatórios', sellers: [] });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome inválido', sellers: [] });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Preço deve ser maior que zero', sellers: [] });
  }

  let image = null;
  if (req.file) image = '/uploads/' + req.file.filename;

  db.run(
    'INSERT INTO products (name, description, price, category_id, seller_id, image, condition, location, status, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cleanName, cleanDesc, cleanPrice, category_id || null, seller_id || null, image, condition || 'new', cleanLocation, status || 'active', featured ? 1 : 0]
  );
  var lastId = db.get('SELECT MAX(id) as id FROM products');
  if (lastId) db.run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [lastId.id, lastId.id]);

  res.redirect('/admin/products');
});

router.get('/products/edit/:id', (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');

  const categories = db.query('SELECT * FROM categories ORDER BY name');
  const sellers = db.query("SELECT id, name FROM sellers WHERE status = 'active' ORDER BY name");
  res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: null, sellers });
});

router.post('/products/edit/:id', upload.single('image'), (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');

  const { name, description, price, category_id, condition, location, status, featured, seller_id } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Nome e preço são obrigatórios', sellers: [] });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Nome inválido', sellers: [] });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Preço deve ser maior que zero', sellers: [] });
  }

  let image = product.image;
  if (req.file) image = '/uploads/' + req.file.filename;

  db.run(
    'UPDATE products SET name = ?, description = ?, price = ?, category_id = ?, seller_id = ?, image = ?, condition = ?, location = ?, status = ?, featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [cleanName, cleanDesc, cleanPrice, category_id || null, seller_id || null, image, condition || 'new', cleanLocation, status || 'active', featured ? 1 : 0, req.params.id]
  );

  res.redirect('/admin/products');
});

router.post('/products/delete/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.redirect('/admin/products');
});

router.get('/sellers', (req, res) => {
  const sellers = db.query(
    'SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.status = ?) as active_count FROM sellers s ORDER BY s.created_at DESC',
    ['active']
  );
  res.render('admin/sellers', { title: 'Vendedores', sellers, error: null });
});

router.post('/sellers/new', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: 'Nome, email e senha são obrigatórios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run("INSERT INTO sellers (name, email, phone, password_hash, status) VALUES (?, ?, ?, ?, 'active')", [name, email, phone || '', hash]);
  } catch (e) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: 'Email já cadastrado' });
  }
  res.redirect('/admin/sellers');
});

router.post('/sellers/toggle/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers');
  const newStatus = seller.status === 'active' ? 'inactive' : 'active';
  db.run('UPDATE sellers SET status = ? WHERE id = ?', [newStatus, req.params.id]);
  if (newStatus === 'inactive') {
    db.run("UPDATE products SET status = 'inactive' WHERE seller_id = ? AND status = 'active'", [req.params.id]);
  }
  res.redirect('/admin/sellers');
});

router.post('/sellers/delete/:id', (req, res) => {
  db.run('UPDATE products SET seller_id = NULL WHERE seller_id = ?', [req.params.id]);
  db.run('DELETE FROM sellers WHERE id = ?', [req.params.id]);
  res.redirect('/admin/sellers');
});

router.get('/categories', (req, res) => {
  const categories = db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name');
  res.render('admin/categories', { title: 'Categorias - Painel Admin', categories, error: null });
});

router.post('/categories/new', (req, res) => {
  const { name, icon } = req.body;
  if (!name) {
    const categories = db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name');
    return res.render('admin/categories', { title: 'Categorias - Painel Admin', categories, error: 'Nome é obrigatório' });
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    db.run('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)', [name, slug, icon || '📦']);
  } catch (e) {
    const categories = db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name');
    return res.render('admin/categories', { title: 'Categorias - Painel Admin', categories, error: 'Categoria já existe' });
  }
  res.redirect('/admin/categories');
});

router.post('/categories/delete/:id', (req, res) => {
  db.run('UPDATE products SET category_id = NULL WHERE category_id = ?', [req.params.id]);
  db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.redirect('/admin/categories');
});

router.get('/admins', (req, res) => {
  const admins = db.query('SELECT id, username, display_name, created_at FROM admins ORDER BY created_at DESC');
  res.render('admin/admins', { title: 'Administradores', admins, error: null });
});

router.post('/admins/new', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password) {
    const admins = db.query('SELECT id, username, display_name, created_at FROM admins ORDER BY created_at DESC');
    return res.render('admin/admins', { title: 'Administradores', admins, error: 'Usuário e senha são obrigatórios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', [username, hash, display_name || username]);
  } catch (e) {
    const admins = db.query('SELECT id, username, display_name, created_at FROM admins ORDER BY created_at DESC');
    return res.render('admin/admins', { title: 'Administradores', admins, error: 'Usuário já existe' });
  }
  res.redirect('/admin/admins');
});

router.post('/admins/delete/:id', (req, res) => {
  if (parseInt(req.params.id) === req.session.adminId) return res.redirect('/admin/admins');
  db.run('DELETE FROM admins WHERE id = ?', [req.params.id]);
  res.redirect('/admin/admins');
});

// ============ ADS ============

router.get('/ads', (req, res) => {
  const ads = db.query('SELECT * FROM ads ORDER BY sort_order ASC, id ASC');
  res.render('admin/ads', { title: 'Anúncios - Painel Admin', ads, error: null });
});

router.get('/ads/new', (req, res) => {
  res.render('admin/ad-form', { title: 'Novo Anúncio', ad: null, error: null });
});

router.post('/ads/new', (req, res) => {
  const { title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order } = req.body;
  if (!text) return res.render('admin/ad-form', { title: 'Novo Anúncio', ad: null, error: 'Texto do anúncio é obrigatório' });
  try {
    db.run(
      'INSERT INTO ads (title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        (title || '').toString().trim().slice(0, 100),
        text.toString().trim().slice(0, 500),
        (link || '').toString().trim().slice(0, 200),
        (image || '').toString().trim().slice(0, 200),
        parseInt(display_duration) || 15,
        parseInt(cooldown) || 86400,
        start_date || null,
        end_date || null,
        parseInt(sort_order) || 0
      ]
    );
  } catch (e) {
    return res.render('admin/ad-form', { title: 'Novo Anúncio', ad: null, error: 'Erro ao criar anúncio' });
  }
  res.redirect('/admin/ads');
});

router.get('/ads/edit/:id', (req, res) => {
  const ad = db.get('SELECT * FROM ads WHERE id = ?', [req.params.id]);
  if (!ad) return res.redirect('/admin/ads');
  res.render('admin/ad-form', { title: 'Editar Anúncio', ad, error: null });
});

router.post('/ads/edit/:id', (req, res) => {
  const ad = db.get('SELECT * FROM ads WHERE id = ?', [req.params.id]);
  if (!ad) return res.redirect('/admin/ads');
  const { title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order, status } = req.body;
  if (!text) return res.render('admin/ad-form', { title: 'Editar Anúncio', ad, error: 'Texto do anúncio é obrigatório' });
  db.run(
    'UPDATE ads SET title = ?, text = ?, link = ?, image = ?, display_duration = ?, cooldown = ?, start_date = ?, end_date = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [
      (title || '').toString().trim().slice(0, 100),
      text.toString().trim().slice(0, 500),
      (link || '').toString().trim().slice(0, 200),
      (image || '').toString().trim().slice(0, 200),
      parseInt(display_duration) || 15,
      parseInt(cooldown) || 86400,
      start_date || null,
      end_date || null,
      parseInt(sort_order) || 0,
      status || 'active',
      req.params.id
    ]
  );
  res.redirect('/admin/ads');
});

router.post('/ads/toggle/:id', (req, res) => {
  const ad = db.get('SELECT * FROM ads WHERE id = ?', [req.params.id]);
  if (!ad) return res.redirect('/admin/ads');
  const newStatus = ad.status === 'active' ? 'inactive' : 'active';
  db.run('UPDATE ads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, req.params.id]);
  res.redirect('/admin/ads');
});

router.post('/ads/delete/:id', (req, res) => {
  db.run('DELETE FROM ads WHERE id = ?', [req.params.id]);
  res.redirect('/admin/ads');
});

// ============ REVIEWS ============

router.get('/reviews', (req, res) => {
  const filter = req.query.filter || 'all';
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;

  let where = '';
  if (filter === 'low') where = 'WHERE r.rating <= 2';
  else if (filter === 'high') where = 'WHERE r.rating >= 4';

  const count = db.get('SELECT COUNT(*) as c FROM reviews r ' + where);
  const reviews = db.query(`
    SELECT r.*, p.name as product_name, s.name as seller_name
    FROM reviews r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN sellers s ON r.seller_id = s.id
    ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?
  `, [limit, offset]);

  const totalPages = Math.ceil((count ? count.c : 0) / limit);

  res.render('admin/reviews', {
    title: 'Avaliações - Painel Admin',
    reviews, filter, page, totalPages, error: null
  });
});

router.post('/reviews/edit/:id', (req, res) => {
  const review = db.get('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
  if (!review) return res.redirect('/admin/reviews');
  const rating = parseInt(req.body.rating);
  const comment = (req.body.comment || '').trim().slice(0, 500);
  if (rating < 1 || rating > 5) return res.redirect('/admin/reviews');
  db.run('UPDATE reviews SET rating = ?, comment = ? WHERE id = ?', [rating, comment, req.params.id]);
  res.redirect('/admin/reviews');
});

router.post('/reviews/delete/:id', (req, res) => {
  db.run('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.redirect('/admin/reviews');
});

// ============ NOTIFICATIONS ============

router.get('/notifications', (req, res) => {
  const filter = req.query.filter || 'all';
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  let where = '';
  if (filter === 'unread') where = 'WHERE read = 0';
  else if (filter === 'read') where = 'WHERE read = 1';

  const count = db.get('SELECT COUNT(*) as c FROM notifications ' + where);
  const notifications = db.query('SELECT * FROM notifications ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
  const totalPages = Math.ceil((count ? count.c : 0) / limit);

  res.render('admin/notifications', {
    title: 'Notificações - Painel Admin',
    notifications, filter, page, totalPages, error: null
  });
});

router.post('/notifications/new', (req, res) => {
  const { message, type, icon, link, ip } = req.body;
  if (!message) {
    const notifications = db.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50');
    return res.render('admin/notifications', { title: 'Notificações - Painel Admin', notifications, filter: 'all', page: 1, totalPages: 1, error: 'Mensagem é obrigatória' });
  }
  db.run('INSERT INTO notifications (message, type, icon, link, ip) VALUES (?, ?, ?, ?, ?)',
    [message.trim().slice(0, 500), type || 'info', icon || 'bell', link || '', ip || '']);
  res.redirect('/admin/notifications');
});

router.get('/financeiro', (req, res) => {
  var search = req.query.search || '';
  var period = req.query.period || 'all';
  var startDate = req.query.start_date || '';
  var endDate = req.query.end_date || '';
  var page = parseInt(req.query.page) || 1;
  var limit = 50;
  var offset = (page - 1) * limit;
  var txns, totalCount;

  if (!startDate) {
    if (period === '7d') startDate = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    else if (period === '30d') startDate = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    else if (period === '90d') startDate = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
    else if (period === '12m') startDate = new Date(Date.now() - 365*86400000).toISOString().slice(0,10);
    else startDate = '';
  }
  if (!endDate) endDate = new Date().toISOString().slice(0,10);

  if (search) {
    txns = db.query("SELECT w.*, s.name as seller_name, s.email as seller_email FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id WHERE (s.name LIKE ? OR w.description LIKE ?) AND date(w.created_at) >= ? AND date(w.created_at) <= ? ORDER BY w.created_at DESC LIMIT ? OFFSET ?", ['%' + search + '%', '%' + search + '%', startDate || '2000-01-01', endDate || '2100-01-01', limit, offset]);
    totalCount = db.get("SELECT COUNT(*) as c FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id WHERE (s.name LIKE ? OR w.description LIKE ?) AND date(w.created_at) >= ? AND date(w.created_at) <= ?", ['%' + search + '%', '%' + search + '%', startDate || '2000-01-01', endDate || '2100-01-01']);
  } else {
    txns = db.getTransactionsByPeriod(null, startDate || '2000-01-01', endDate || '2100-01-01', limit, offset);
    totalCount = db.get("SELECT COUNT(*) as c FROM wallet_transactions WHERE date(created_at) >= ? AND date(created_at) <= ?", [startDate || '2000-01-01', endDate || '2100-01-01']);
  }

  var totalPages = Math.ceil((totalCount ? totalCount.c : 0) / limit);
  var allSellers = db.query("SELECT s.id, s.name, s.email, s.commission_pct, s.bank_info, (SELECT COALESCE(balance,0) FROM wallet_transactions WHERE seller_id = s.id ORDER BY id DESC LIMIT 1) as balance, (SELECT COUNT(*) FROM sales WHERE seller_id = s.id) as sales_count FROM sellers s ORDER BY s.name");

  var commPct = db.getCommissionPct();
  var summary = db.getFinanceSummary(null, startDate || '2000-01-01', endDate || '2100-01-01');
  var chartData = db.getFinanceChart(null, 30);
  var pendingPayoutsCount = db.getPendingPayoutsCount();
  var payouts = db.getPayouts(null, 20, 0);
  var payoutsTotal = db.getPayoutCount(null);

  var months = [];
  var now = new Date();
  for (var m = 11; m >= 0; m--) {
    var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    var label = d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' });
    months.push({ label: label, value: d.toISOString().slice(0,7) });
  }

  res.render('admin/financeiro', {
    title: 'Financeiro - Painel Admin',
    txns, search, period, startDate, endDate, page, totalPages, allSellers, commPct,
    summary: summary,
    chartData: chartData,
    pendingPayoutsCount: pendingPayoutsCount,
    payouts: payouts,
    payoutsTotal: payoutsTotal,
    months: months
  });
});

router.post('/financeiro/comissao', (req, res) => {
  var pct = parseFloat(req.body.commission_pct);
  if (pct >= 0 && pct <= 100) {
    db.run("UPDATE config SET value = ? WHERE key = 'commission_pct'", [pct.toString()]);
  }
  res.redirect('/admin/financeiro');
});

router.post('/financeiro/comissao-seller', (req, res) => {
  var { seller_id, commission_pct } = req.body;
  var pct = commission_pct !== '' ? parseFloat(commission_pct) : null;
  if (seller_id && (pct === null || (pct >= 0 && pct <= 100))) {
    db.run("UPDATE sellers SET commission_pct = ? WHERE id = ?", [pct, seller_id]);
  }
  res.redirect('/admin/financeiro');
});

router.post('/financeiro/ajuste', (req, res) => {
  var { seller_id, amount, description } = req.body;
  var val = parseFloat(amount);
  if (seller_id && val && description) {
    db.addTransaction(parseInt(seller_id), 'adjustment', description, val, 'adjustment', 0);
  }
  res.redirect('/admin/financeiro');
});

router.get('/financeiro/exportar-csv', (req, res) => {
  var search = req.query.search || '';
  var startDate = req.query.start_date || '2000-01-01';
  var endDate = req.query.end_date || '2100-01-01';
  var txns;
  if (search) {
    txns = db.query("SELECT w.*, s.name as seller_name, s.email as seller_email FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id WHERE (s.name LIKE ? OR w.description LIKE ?) AND date(w.created_at) >= ? AND date(w.created_at) <= ? ORDER BY w.created_at DESC", ['%' + search + '%', '%' + search + '%', startDate, endDate]);
  } else {
    txns = db.query("SELECT w.*, s.name as seller_name FROM wallet_transactions w LEFT JOIN sellers s ON w.seller_id = s.id WHERE date(w.created_at) >= ? AND date(w.created_at) <= ? ORDER BY w.created_at DESC", [startDate, endDate]);
  }
  var csv = 'sep=;\nData;Vendedor;Descricao;Tipo;Valor;Saldo\n';
  txns.forEach(function(t) {
    csv += t.created_at + ';' + (t.seller_name || 'Admin') + ';' + (t.description || '').replace(/;/g,',') + ';' + t.type + ';' + (t.amount || 0).toFixed(2) + ';' + (t.balance || 0).toFixed(2) + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=transacoes.csv');
  res.send('\uFEFF' + csv);
});

router.post('/financeiro/payout/aprovar/:id', (req, res) => {
  db.run("UPDATE payouts SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'pending'", [req.session.adminId || 0, req.params.id]);
  res.redirect('/admin/financeiro');
});

router.post('/financeiro/payout/rejeitar/:id', (req, res) => {
  var p = db.get('SELECT * FROM payouts WHERE id = ? AND status = ?', [req.params.id, 'pending']);
  if (p) {
    db.run("UPDATE payouts SET status = 'rejected', notes = 'Rejeitado pelo admin' WHERE id = ?", [req.params.id]);
    db.addTransaction(p.seller_id, 'adjustment', 'Estorno saque rejeitado - R$ ' + p.amount.toFixed(2), p.amount, 'payout_refund', p.id);
  }
  res.redirect('/admin/financeiro');
});

router.post('/notifications/edit/:id', (req, res) => {
  const n = db.get('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
  if (!n) return res.redirect('/admin/notifications');
  const { message, type, icon, link, ip, read } = req.body;
  db.run('UPDATE notifications SET message = ?, type = ?, icon = ?, link = ?, ip = ?, read = ? WHERE id = ?',
    [(message || '').trim().slice(0, 500), type || 'info', icon || 'bell', link || '', ip || '', read ? 1 : 0, req.params.id]);
  res.redirect('/admin/notifications');
});

router.post('/notifications/delete/:id', (req, res) => {
  db.run('DELETE FROM notifications WHERE id = ?', [req.params.id]);
  res.redirect('/admin/notifications');
});

return router;
};
