const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');

module.exports = function(upload) {
const router = express.Router();
router.use(requireAdmin);

router.get('/dashboard', (req, res) => {
  const total = db.get('SELECT COUNT(*) as count FROM products');
  const active = db.get("SELECT COUNT(*) as count FROM products WHERE status = 'active'");
  const pending = db.get("SELECT COUNT(*) as count FROM products WHERE status = 'pending'");
  const totalSellers = db.get('SELECT COUNT(*) as count FROM sellers');
  const featured = db.get('SELECT COUNT(*) as count FROM products WHERE featured = 1');
  const totalSales = db.get("SELECT COUNT(*) as c, COALESCE(SUM(product_price),0) as rev FROM sales WHERE status NOT IN ('cancelled','pending')");
  const pendingSales = db.get("SELECT COUNT(*) as c FROM sales WHERE status='pending'");
  const totalViews = db.get('SELECT COUNT(*) as c FROM page_views');
  const todayViews = db.get("SELECT COUNT(*) as c FROM page_views WHERE date(created_at) = date('now')");
  const recent = db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.created_at DESC LIMIT 5');
  const featuredProducts = db.query('SELECT p.*, c.name as category_name, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.featured = 1 ORDER BY p.updated_at DESC');

  res.render('admin/dashboard', {
    title: 'Dashboard - Painel Admin',
    stats: {
      total: total.count, active: active.count, pending: pending.count,
      sellers: totalSellers.count, featured: featured.count,
      totalSales: totalSales.c, revenue: totalSales.rev,
      pendingSales: pendingSales.c, totalViews: totalViews.c, todayViews: todayViews.c
    },
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

// ========== SALES ==========
router.get('/sales', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;
  const filter = req.query.filter || 'all';
  const search = req.query.search || '';

  let where = '';
  const params = [];

  if (filter !== 'all') {
    where = "WHERE s.status = ?";
    params.push(filter);
  }

  if (search) {
    const joinOp = where ? 'AND' : 'WHERE';
    where += ` ${joinOp} (s.buyer_name LIKE ? OR s.buyer_email LIKE ? OR s.buyer_phone LIKE ? OR s.product_name LIKE ? OR s.product_code LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const countSql = `SELECT COUNT(*) as count FROM sales s ${where}`;
  const dataSql = `SELECT s.*, sl.name as seller_name, (SELECT SUM(amount) FROM wallet_transactions WHERE reference_type='sale' AND reference_id=s.id) as commission FROM sales s LEFT JOIN sellers sl ON s.seller_id = sl.id ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;

  const totalCount = db.get(countSql, params);
  const sales = db.query(dataSql, [...params, limit, offset]);
  const totalPages = Math.ceil(totalCount.count / limit);

  const summary = {
    pending: db.get("SELECT COUNT(*) as c FROM sales WHERE status='pending'").c,
    approved: db.get("SELECT COUNT(*) as c FROM sales WHERE status='approved'").c,
    shipped: db.get("SELECT COUNT(*) as c FROM sales WHERE status='shipped'").c,
    delivered: db.get("SELECT COUNT(*) as c FROM sales WHERE status='delivered'").c,
    cancelled: db.get("SELECT COUNT(*) as c FROM sales WHERE status='cancelled'").c,
    total: db.get("SELECT COUNT(*) as c FROM sales").c,
    revenue: db.get("SELECT COALESCE(SUM(product_price),0) as total FROM sales WHERE status NOT IN ('cancelled','pending')").total
  };

  res.render('admin/sales', {
    title: 'Vendas - Painel Admin',
    sales, currentPage: page, totalPages, filter, search, summary
  });
});

router.get('/sales/provas/:id', (req, res) => {
  var proofs = db.getSaleProofs(req.params.id);
  res.json(proofs);
});

router.post('/sales/cancel/:id', (req, res) => {
  const sale = db.get("SELECT * FROM sales WHERE id = ?", [req.params.id]);
  if (sale && sale.status !== 'cancelled' && sale.status !== 'delivered') {
    db.run("UPDATE sales SET status = 'cancelled' WHERE id = ?", [req.params.id]);
  }
  res.redirect(req.get('Referer') || '/admin/sales');
});

router.post('/sales/status/:id', (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','approved','shipped','delivered','cancelled'];
  if (allowed.includes(status)) {
    db.run("UPDATE sales SET status = ? WHERE id = ? AND status != 'cancelled' AND status != 'delivered'", [status, req.params.id]);
  }
  res.redirect(req.get('Referer') || '/admin/sales');
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
  else if (filter === 'flash') { where = "WHERE p.flash_price IS NOT NULL AND p.flash_ends_at > datetime('now')"; }

  if (search) {
    const joinOp = where ? 'AND' : 'WHERE';
    where += ` ${joinOp} (p.name LIKE ? OR p.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  const countSql = `SELECT COUNT(*) as count FROM products p ${where}`;
  const dataSql = `SELECT p.*, c.name as category_name, s.name as seller_name, (SELECT COUNT(*) FROM page_views WHERE product_id = p.id) as views, (SELECT COUNT(*) FROM sales WHERE product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;

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
  if (lastId) db.run("UPDATE products SET code = 'PROD-' || upper(substr(hex(randomblob(4)), 1, 8)) WHERE id = ?", [lastId.id]);

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
  const { name, email, phone, whatsapp, password } = req.body;
  if (!name || !email || !password) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: 'Nome, email e senha são obrigatórios' });
  }
  if (String(password).length < 6) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: 'Senha deve ter no mínimo 6 caracteres' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run("INSERT INTO sellers (name, email, phone, whatsapp, password_hash, status) VALUES (?, ?, ?, ?, ?, 'active')", [name, email, phone || '', whatsapp || '', hash]);
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

router.get('/sellers/:id', (req, res) => {
  const seller = db.get('SELECT *, (SELECT COUNT(*) FROM products WHERE seller_id = ?) as product_count, (SELECT COUNT(*) FROM products WHERE seller_id = ? AND status = "active") as active_count, (SELECT COUNT(*) FROM products WHERE seller_id = ? AND featured = 1) as featured_count FROM sellers WHERE id = ?', [req.params.id, req.params.id, req.params.id, req.params.id]);
  if (!seller) return res.redirect('/admin/sellers');

  const products = db.query('SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM page_views WHERE product_id = p.id) as views, (SELECT COUNT(*) FROM sales WHERE product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC', [req.params.id]);
  const sales = db.query("SELECT s.* FROM sales s WHERE s.seller_id = ? ORDER BY s.created_at DESC LIMIT 20", [req.params.id]);
  const totalRevenue = db.get("SELECT COALESCE(SUM(product_price),0) as total FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending')", [req.params.id]);
  const walletBalance = db.get("SELECT COALESCE(SUM(amount),0) as balance FROM wallet_transactions WHERE seller_id = ? AND status = 'completed'", [req.params.id]);

  res.render('admin/seller-detail', {
    title: `${seller.name} - Vendedor`,
    seller, products, sales, totalRevenue: totalRevenue.total, walletBalance: walletBalance.balance
  });
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
    months: months,
    tab: req.query.tab || 'resumo'
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

// ========== SITE CONFIG ==========
router.get('/config', (req, res) => {
  var allConfigs = db.query('SELECT * FROM config ORDER BY key');
  var configObj = {};
  allConfigs.forEach(function(c) { configObj[c.key] = c.value; });

  var sellers = db.query('SELECT id, name, email FROM sellers ORDER BY name');
  var admins = db.query('SELECT id, username FROM admins ORDER BY username');

  res.render('admin/config', {
    title: 'Configurações do Site',
    config: configObj,
    sellers: sellers,
    admins: admins,
    error: null,
    success: null
  });
});

router.post('/config', (req, res) => {
  var allowedKeys = [
    'site_name', 'site_description', 'site_whatsapp', 'site_email',
    'commission_pct', 'mp_access_token', 'pix_key_platform',
    'default_product_status', 'maintenance_mode', 'max_products_per_seller',
    'custom_css', 'custom_js'
  ];
  allowedKeys.forEach(function(key) {
    if (req.body[key] !== undefined) {
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, String(req.body[key]).trim()]);
    }
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'update_config', 'Configurações do site atualizadas');
  res.redirect('/admin/config');
});

// ========== CMS PAGES ==========
router.get('/paginas', (req, res) => {
  var pages = db.getAllPages();
  res.render('admin/pages', { title: 'Páginas do Site', pages });
});

router.get('/paginas/editar/:slug', (req, res) => {
  var page = db.get("SELECT * FROM cms_pages WHERE slug = ?", [req.params.slug]);
  if (!page) page = { slug: req.params.slug, title: '', content: '', meta_description: '', published: 1 };
  res.render('admin/page-form', { title: 'Editar Página', page, error: null });
});

router.post('/paginas/editar/:slug', (req, res) => {
  var { title, content, meta_description, published } = req.body;
  if (!title) return res.render('admin/page-form', { title: 'Editar Página', page: { slug: req.params.slug, title: '', content: '', meta_description: '', published: 1 }, error: 'Título é obrigatório' });
  db.savePage(req.params.slug, title, content, meta_description, published === '1');
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'edit_page', 'Página editada: ' + title, 'page', 0, req.ip);
  res.redirect('/admin/paginas');
});

router.post('/paginas/deletar/:id', (req, res) => {
  db.deletePage(req.params.id);
  res.redirect('/admin/paginas');
});

// ========== COUPONS ==========
router.get('/cupons', (req, res) => {
  var coupons = db.getAllCoupons();
  res.render('admin/coupons', { title: 'Cupons de Desconto', coupons, error: null });
});

router.post('/cupons/novo', (req, res) => {
  var { code, type, value, min_order, max_uses, expires_at } = req.body;
  if (!code || !value) return res.redirect('/admin/cupons');
  try {
    db.saveCoupon(code.toUpperCase(), type, parseFloat(value), parseFloat(min_order) || 0, parseInt(max_uses) || 0, expires_at || null);
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'create_coupon', 'Cupom criado: ' + code, 'coupon', 0, req.ip);
  } catch(e) {}
  res.redirect('/admin/cupons');
});

router.post('/cupons/deletar/:id', (req, res) => {
  db.deleteCoupon(req.params.id);
  res.redirect('/admin/cupons');
});

// ========== BANNERS ==========
router.get('/banners', (req, res) => {
  var banners = db.getAllBanners();
  res.render('admin/banners', { title: 'Banners da Home', banners, error: null });
});

router.post('/banners/novo', upload.single('image'), (req, res) => {
  var { title, subtitle, link, sort_order, active, display_duration } = req.body;
  var image = req.file ? '/uploads/' + req.file.filename : '';
  if (!image) return res.redirect('/admin/banners');
  db.saveBanner(null, title || '', subtitle || '', image, link, parseInt(sort_order) || 0, active === '1', parseInt(display_duration) || 10);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'create_banner', 'Banner criado: ' + (title || ''), 'banner', 0, req.ip);
  res.redirect('/admin/banners');
});

router.post('/banners/editar/:id', upload.single('image'), (req, res) => {
  var { title, subtitle, link, sort_order, active, display_duration } = req.body;
  var existing = db.get("SELECT * FROM banners WHERE id = ?", [req.params.id]);
  if (!existing) return res.redirect('/admin/banners');
  var image = req.file ? '/uploads/' + req.file.filename : existing.image;
  db.saveBanner(req.params.id, title || '', subtitle || '', image, link, parseInt(sort_order) || 0, active === '1', parseInt(display_duration) || 10);
  res.redirect('/admin/banners');
});

router.post('/banners/deletar/:id', (req, res) => {
  var b = db.get("SELECT image FROM banners WHERE id = ?", [req.params.id]);
  if (b && b.image) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', b.image)); } catch(e) {}
  }
  db.deleteBanner(req.params.id);
  res.redirect('/admin/banners');
});

// ========== ACTIVITY LOG ==========
router.get('/logs', (req, res) => {
  var page = parseInt(req.query.page) || 1;
  var limit = 50;
  var offset = (page - 1) * limit;
  var logs = db.getActivityLog(limit, offset);
  var total = db.getActivityLogCount();
  var totalPages = Math.ceil(total / limit);
  res.render('admin/logs', { title: 'Registro de Atividades', logs, page, totalPages });
});

// ========== BACKUP ==========
router.get('/backup', (req, res) => {
  var dbPath = path.join(__dirname, '..', 'database', 'data.db');
  res.download(dbPath, 'backup-seratecnologia-' + new Date().toISOString().slice(0,10) + '.db');
});

// ========== CSV EXPORT ==========
router.get('/exportar/:tipo', (req, res) => {
  var tipo = req.params.tipo;
  var data = [];
  var headers = [];
  var filename = '';

  if (tipo === 'produtos') {
    data = db.query("SELECT p.*, c.name as category_name, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id ORDER BY p.created_at DESC");
    headers = ['id','name','description','price','category','seller','condition','location','status','featured','code','views','created_at'];
    filename = 'produtos.csv';
  } else if (tipo === 'vendas') {
    data = db.query("SELECT s.*, sl.name as seller_name FROM sales s LEFT JOIN sellers sl ON s.seller_id = sl.id ORDER BY s.created_at DESC");
    headers = ['id','product_code','product_name','product_price','buyer_name','buyer_email','buyer_phone','status','seller','tracking_code','created_at'];
    filename = 'vendas.csv';
  } else if (tipo === 'vendedores') {
    data = db.query("SELECT s.*, (SELECT COUNT(*) FROM products WHERE seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC");
    headers = ['id','name','email','phone','whatsapp','status','product_count','sales_count','created_at'];
    filename = 'vendedores.csv';
  } else {
    return res.redirect('/admin/config');
  }

  var csv = headers.join(',') + '\n';
  data.forEach(function(row) {
    var line = headers.map(function(h) {
      var val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) val = '"' + val.replace(/"/g, '""') + '"';
      return val;
    }).join(',');
    csv += line + '\n';
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
  res.send('\ufeff' + csv);
});

// ========== BLOCKED IPS ==========
router.get('/ips-bloqueados', (req, res) => {
  var ips = db.getBlockedIps();
  res.render('admin/blocked-ips', { title: 'IPs Bloqueados', ips, error: null });
});

router.post('/ips-bloqueados/novo', (req, res) => {
  var { ip, reason } = req.body;
  if (!ip) return res.redirect('/admin/ips-bloqueados');
  db.blockIp(ip.trim(), reason || '', req.session.adminId);
  res.redirect('/admin/ips-bloqueados');
});

router.post('/ips-bloqueados/desbloquear/:id', (req, res) => {
  db.unblockIp(req.params.id);
  res.redirect('/admin/ips-bloqueados');
});

// ========== FEATURE TOGGLES ==========
router.get('/toggles', requireSuperAdmin, (req, res) => {
  var toggles = {};
  var rows = db.getAllToggles();
  rows.forEach(function(r) {
    var key = r.key.replace('toggle_', '');
    toggles[key] = r.value;
  });
  res.render('admin/toggles', { title: 'Controle de Funcionalidades', toggles, success: null, error: null });
});

router.post('/toggles', requireSuperAdmin, (req, res) => {
  var allowed = ['banners', 'compras', 'cadastro_vendedor', 'whatsapp', 'mercado_pago', 'pix'];
  allowed.forEach(function(key) {
    db.setToggle(key, req.body[key] === '1' ? '1' : '0');
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'update_toggles', 'Toggles atualizados');
  res.render('admin/toggles', { title: 'Controle de Funcionalidades', toggles: {}, success: 'Toggles salvos!', error: null });
});

// ========== BLAST NOTIFICATION ==========
router.get('/blast', requireSuperAdmin, (req, res) => {
  res.render('admin/blast', { title: 'Notificação em Massa', success: null, error: null });
});

router.post('/blast', requireSuperAdmin, (req, res) => {
  var { type, message, icon, link } = req.body;
  if (!message) return res.render('admin/blast', { title: 'Notificação em Massa', success: null, error: 'Mensagem obrigatória' });
  var count = db.notifyAllSellers(type || 'info', message, icon || 'bell', link || '');
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'blast_notification', 'Notificação enviada para ' + count + ' vendedores: ' + message);
  res.render('admin/blast', { title: 'Notificação em Massa', success: 'Notificação enviada para ' + count + ' vendedores!', error: null });
});

// ========== DATA CLEANUP ==========
router.get('/limpar', requireSuperAdmin, (req, res) => {
  res.render('admin/cleanup', { title: 'Limpeza de Dados', result: null, error: null });
});

router.post('/limpar', requireSuperAdmin, (req, res) => {
  var daysViews = parseInt(req.query.days_views) || 90;
  var daysLogs = parseInt(req.query.days_logs) || 180;
  var result = db.cleanupOldData(daysViews, daysLogs);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'cleanup', 'Limpeza: ' + result.deletedViews + ' views, ' + result.deletedLogs + ' logs');
  res.render('admin/cleanup', { title: 'Limpeza de Dados', result: result, error: null });
});

// ========== FLASH SALE ==========
router.post('/products/flash/:id', requireSuperAdmin, (req, res) => {
  var { flash_price, flash_hours } = req.body;
  if (!flash_price || !flash_hours) return res.redirect('/admin/products');
  var product = db.get("SELECT * FROM products WHERE id = ?", [req.params.id]);
  if (!product) return res.redirect('/admin/products');
  var endsAt = new Date(Date.now() + parseInt(flash_hours) * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  db.setFlashSale(req.params.id, parseFloat(flash_price), endsAt);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'flash_sale', 'Flash sale: ' + product.name + ' - R$ ' + flash_price);
  res.redirect('/admin/products');
});

router.post('/products/flash/remove/:id', requireSuperAdmin, (req, res) => {
  db.removeFlashSale(req.params.id);
  res.redirect('/admin/products');
});

// ========== FLASH SALES MANAGEMENT ==========
router.get('/ofertas/novo', requireSuperAdmin, (req, res) => res.redirect('/admin/ofertas'));

router.get('/ofertas', requireSuperAdmin, (req, res) => {
  var flashProducts = db.getFlashSales();
  var allProducts = db.query("SELECT id, name, price, status FROM products WHERE status = 'active' ORDER BY name");
  res.render('admin/ofertas', { title: 'Ofertas Relâmpago', flashProducts, allProducts, success: null, error: null });
});

router.post('/ofertas/novo', requireSuperAdmin, (req, res) => {
  var { product_id, flash_price, flash_hours } = req.body;
  if (!product_id || !flash_price || !flash_hours) return res.redirect('/admin/ofertas');
  var p = db.get("SELECT name FROM products WHERE id = ?", [product_id]);
  if (!p) return res.redirect('/admin/ofertas');
  var endsAt = new Date(Date.now() + parseInt(flash_hours) * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  db.setFlashSale(product_id, parseFloat(flash_price), endsAt);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'flash_sale', 'Flash: ' + p.name + ' - R$ ' + flash_price);
  res.redirect('/admin/ofertas');
});

router.post('/ofertas/remover/:id', requireSuperAdmin, (req, res) => {
  db.removeFlashSale(req.params.id);
  res.redirect('/admin/ofertas');
});

// ========== BULK ACTIONS ==========
router.post('/products/bulk', requireAdmin, (req, res) => {
  var { action, ids } = req.body;
  if (!action || !ids) return res.redirect('/admin/products');
  var list = Array.isArray(ids) ? ids : [ids];
  if (action === 'approve') {
    list.forEach(function(id) { db.run("UPDATE products SET status = 'active' WHERE id = ?", [id]); });
  } else if (action === 'feature') {
    list.forEach(function(id) { db.run("UPDATE products SET featured = 1 WHERE id = ?", [id]); });
  } else if (action === 'unfeature') {
    list.forEach(function(id) { db.run("UPDATE products SET featured = 0 WHERE id = ?", [id]); });
  } else if (action === 'delete') {
    list.forEach(function(id) {
      var p = db.get("SELECT image FROM products WHERE id = ?", [id]);
      if (p && p.image) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', p.image)); } catch(e) {} }
      db.run("DELETE FROM products WHERE id = ?", [id]);
    });
  }
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'bulk_' + action, 'Ação em massa: ' + action + ' em ' + list.length + ' produtos');
  res.redirect('/admin/products');
});

// ========== GOALS ==========
router.get('/metas', requireSuperAdmin, (req, res) => {
  var goals = db.getAllGoals();
  res.render('admin/metas', { title: 'Metas dos Vendedores', goals, success: req.query.sucesso || '', error: null });
});

router.post('/metas/novo', requireSuperAdmin, (req, res) => {
  var { title, type, target_value, prize_description, start_date, end_date } = req.body;
  if (!title || !target_value || !start_date || !end_date) return res.redirect('/admin/metas');
  db.saveGoal(null, title, type || 'sales_count', parseFloat(target_value), prize_description, start_date, end_date);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'create_goal', 'Meta criada: ' + title, 'goal', 0, req.ip);
  res.redirect('/admin/metas?sucesso=Meta criada!');
});

router.post('/metas/editar/:id', requireSuperAdmin, (req, res) => {
  var { title, type, target_value, prize_description, start_date, end_date } = req.body;
  if (!title || !target_value || !start_date || !end_date) return res.redirect('/admin/metas');
  db.saveGoal(req.params.id, title, type || 'sales_count', parseFloat(target_value), prize_description, start_date, end_date);
  res.redirect('/admin/metas?sucesso=Meta atualizada!');
});

router.post('/metas/toggle/:id', requireSuperAdmin, (req, res) => {
  var g = db.get("SELECT active FROM seller_goals WHERE id = ?", [req.params.id]);
  if (g) db.toggleGoal(req.params.id, !g.active);
  res.redirect('/admin/metas');
});

router.post('/metas/winner/:id/:sellerId', requireSuperAdmin, (req, res) => {
  db.markGoalWinner(req.params.id, req.params.sellerId, req.body.prize_given === '1');
  res.redirect('/admin/placar?goal_id=' + req.params.id);
});

router.post('/metas/deletar/:id', requireSuperAdmin, (req, res) => {
  db.deleteGoal(req.params.id);
  res.redirect('/admin/metas?sucesso=Meta removida');
});

router.get('/placar', requireAdmin, (req, res) => {
  var goalId = req.query.goal_id || null;
  var goals = db.getAllGoals();
  var selectedGoal = goalId ? db.get("SELECT * FROM seller_goals WHERE id = ?", [goalId]) : (db.getActiveGoal() || null);
  var leaderboard = selectedGoal ? db.getGoalLeaderboard(selectedGoal.id) : [];
  res.render('admin/placar', { title: 'Placar de Metas', goals, selectedGoal, leaderboard });
});

return router;
};
