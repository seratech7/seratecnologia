const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { backupDatabase, getBackups, restoreBackup, restoreFromFile } = require('../backup-db');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { encryptField, decryptField, decryptSale } = require('../utils/crypto');
const newsAgent = require('../utils/news-agent');
const multer = require('multer');

const videoStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, '..', 'public', 'videos')); },
  filename: function (req, file, cb) {
    var ext = path.extname(file.originalname) || '.mp4';
    cb(null, 'vid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + ext);
  }
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (/video\//.test(file.mimetype) || /\.(mp4|webm|ogg|mov|m4v)$/i.test(file.originalname)) cb(null, true);
    else cb(null, false);
  }
});

module.exports = function(upload, dbUpload) {
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
  var recentSales = db.query("SELECT s.*, sl.name as seller_name FROM sales s LEFT JOIN sellers sl ON s.seller_id = sl.id ORDER BY s.created_at DESC LIMIT 5");
  var pendingPayouts = db.get("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM payouts WHERE status = 'pending'");
  var lowStockCount = db.get("SELECT COUNT(*) as c FROM products WHERE status = 'active' AND quantity <= 5");
  var chartSales = db.query("SELECT date(created_at) as day, COUNT(*) as sales FROM sales WHERE status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-30 days') GROUP BY day ORDER BY day ASC");
  var chartRevenue = db.query("SELECT date(created_at) as day, COALESCE(SUM(product_price),0) as revenue FROM sales WHERE status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-30 days') GROUP BY day ORDER BY day ASC");
  var topSellers = db.query("SELECT s.id, s.name, s.avatar, COUNT(sl.id) as sales_count, COALESCE(SUM(sl.product_price),0) as revenue FROM sellers s LEFT JOIN sales sl ON sl.seller_id = s.id AND sl.status NOT IN ('cancelled','pending') WHERE s.status = 'active' GROUP BY s.id ORDER BY revenue DESC LIMIT 5");
  var prev30 = db.get("SELECT COALESCE(SUM(product_price),0) as rev FROM sales WHERE status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days')");
  var curr30 = db.get("SELECT COALESCE(SUM(product_price),0) as rev FROM sales WHERE status NOT IN ('cancelled','pending') AND created_at >= datetime('now', '-30 days')");
  var goal = db.getActiveGoal();
  var goalProgress = null;
  if (goal) {
    var totalGoal = db.get("SELECT COALESCE(SUM(product_price),0) as v FROM sales WHERE status NOT IN ('cancelled','pending') AND date(created_at) >= ? AND date(created_at) <= ?", [goal.start_date, goal.end_date]);
    var gv = totalGoal ? totalGoal.v : 0;
    goalProgress = { title: goal.title, type: goal.type, start_date: goal.start_date, end_date: goal.end_date, progress: gv, target: goal.target_value, pct: Math.min(100, Math.round((gv / goal.target_value) * 100)), achieved: gv >= goal.target_value };
  }
  var convViews = db.get("SELECT COUNT(*) as c FROM page_views");
  var convSales = db.get("SELECT COUNT(*) as c FROM sales WHERE status NOT IN ('cancelled','pending')");
  var statusBreakdown = {
    pending: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='pending'")||{}).c||0,
    approved: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='approved'")||{}).c||0,
    paid: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='paid'")||{}).c||0,
    shipped: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='shipped'")||{}).c||0,
    delivered: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='delivered'")||{}).c||0,
    cancelled: (db.get("SELECT COUNT(*) as c FROM sales WHERE status='cancelled'")||{}).c||0
  };
  var pendingReviews = (db.get("SELECT COUNT(*) as c FROM reviews")||{}).c||0;
  var totalCommission = (db.get("SELECT COALESCE(SUM(amount),0) as v FROM wallet_transactions WHERE type='commission'")||{}).v||0;
  var sellerWalletTotal = (db.get("SELECT COALESCE(SUM(balance),0) as v FROM (SELECT seller_id, MAX(id) as mid FROM wallet_transactions WHERE amount > 0 GROUP BY seller_id) w JOIN wallet_transactions t ON t.id = w.mid")||{}).v||0;
  var avgOrder = db.get("SELECT AVG(product_price) as v FROM sales WHERE status NOT IN ('cancelled','pending')");
  var newSellers = (db.get("SELECT COUNT(*) as c FROM sellers WHERE created_at >= datetime('now', '-30 days')")||{}).c||0;

  res.render('admin/dashboard', {
    title: 'Dashboard - Painel Admin',
    stats: {
      total: total.count, active: active.count, pending: pending.count,
      sellers: totalSellers.count, featured: featured.count,
      totalSales: totalSales.c, revenue: totalSales.rev,
      pendingSales: pendingSales.c, totalViews: totalViews.c, todayViews: todayViews.c,
      pendingPayouts: pendingPayouts ? pendingPayouts.c : 0,
      pendingPayoutsTotal: pendingPayouts ? pendingPayouts.total : 0,
      lowStockCount: lowStockCount ? lowStockCount.c : 0
    },
    statusBreakdown,
    pendingReviews,
    totalCommission,
    sellerWalletTotal,
    avgOrder: avgOrder ? avgOrder.v : 0,
    newSellers,
    revenueNow: curr30 ? curr30.rev : 0,
    revenueBefore: prev30 ? prev30.rev : 0,
    conversionRate: convViews && convViews.c > 0 ? Math.round(((convSales ? convSales.c : 0) / convViews.c) * 1000) / 10 : 0,
    goalProgress,
    recentProducts: recent,
    featuredProducts,
    recentSales,
    chartSales,
    chartRevenue,
    topSellers
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
router.get('/analytics/exportar-csv', (req, res) => {
  var rows = db.query(`
    SELECT date(created_at) as dia, COUNT(*) as visualizacoes, COUNT(DISTINCT ip) as visitantes,
           COUNT(DISTINCT product_id) as produtos_vistos
    FROM page_views WHERE created_at >= date('now', '-14 days')
    GROUP BY dia ORDER BY dia ASC
  `);
  var headers = ['dia', 'visualizacoes', 'visitantes', 'produtos_vistos'];
  var csv = headers.join(',') + '\n';
  rows.forEach(function(r) {
    csv += headers.map(function(h) { return r[h] !== null && r[h] !== undefined ? r[h] : ''; }).join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=analytics-14dias.csv');
  res.send('\ufeff' + csv);
});

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
  const sales = db.query(dataSql, [...params, limit, offset]).map(decryptSale);
  const totalPages = Math.ceil(totalCount.count / limit);

  const summary = {
    pending: db.get("SELECT COUNT(*) as c FROM sales WHERE status='pending'").c,
    approved: db.get("SELECT COUNT(*) as c FROM sales WHERE status='approved'").c,
    paid: db.get("SELECT COUNT(*) as c FROM sales WHERE status='paid'").c,
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
    if (sale.product_id) db.run("UPDATE products SET quantity = quantity + 1 WHERE id = ?", [sale.product_id]);
    db.refundSale(req.params.id);
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'sale_cancel', 'Cancelou venda #' + req.params.id + ' (carteira estornada)');
  }
  res.redirect(req.get('Referer') || '/admin/sales');
});

router.post('/sales/status/:id', (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','approved','paid','shipped','delivered','cancelled'];
  if (allowed.includes(status)) {
    var sale = db.get("SELECT product_id, status as old_status FROM sales WHERE id = ?", [req.params.id]);
    db.run("UPDATE sales SET status = ? WHERE id = ? AND status != 'cancelled' AND status != 'delivered'", [status, req.params.id]);
    if (status === 'approved' && sale && sale.product_id) {
      db.run("UPDATE products SET quantity = MAX(0, quantity - 1) WHERE id = ?", [sale.product_id]);
      var prod = db.get("SELECT quantity FROM products WHERE id = ?", [sale.product_id]);
      if (prod && prod.quantity <= 0) {
        db.run("UPDATE products SET status = 'inactive' WHERE id = ? AND status = 'active'", [sale.product_id]);
      }
    }
    if (status === 'cancelled' && sale && sale.old_status !== 'cancelled' && sale.old_status !== 'delivered') {
      db.refundSale(req.params.id);
    }
  }
  res.redirect(req.get('Referer') || '/admin/sales');
});

router.get('/sales/edit/:id', requireSuperAdmin, (req, res) => {
  var sale = db.get("SELECT s.*, sl.name as seller_name FROM sales s LEFT JOIN sellers sl ON s.seller_id = sl.id WHERE s.id = ?", [req.params.id]);
  if (!sale) return res.redirect('/admin/sales');
  sale = decryptSale(sale);
  res.render('admin/sale-form', { title: 'Editar Venda #' + sale.id, sale, msg: req.query.msg || '' });
});

router.post('/sales/edit/:id', requireSuperAdmin, (req, res) => {
  var s = req.body;
  db.run("UPDATE sales SET product_code=?, product_name=?, product_price=?, buyer_name=?, buyer_document=?, buyer_phone=?, buyer_email=?, buyer_address=?, status=?, payment_method=?, tracking_code=?, carrier=?, tracking_status=? WHERE id=?", [
    s.product_code||'', s.product_name||'', parseFloat(s.product_price)||0, s.buyer_name||'', encryptField(s.buyer_document||''), s.buyer_phone||'', s.buyer_email||'', encryptField(s.buyer_address||''), s.status||'pending', s.payment_method||'', s.tracking_code||'', s.carrier||'', s.tracking_status||'', req.params.id
  ]);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'sale_edit', 'Editou venda #' + req.params.id);
  res.redirect('/admin/sales/edit/' + req.params.id + '?msg=salvo');
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
  var id = parseInt(req.params.id);
  if (!id) return res.redirect('/admin/products');
  var p = db.get("SELECT status FROM products WHERE id = ?", [id]);
  if (!p) return res.redirect('/admin/products');
  var wasApproved = p.status === 'active';
  db.run("UPDATE products SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  var check = db.get("SELECT status FROM products WHERE id = ?", [id]);
  if (check && check.status !== 'active') {
    db.run("UPDATE products SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }
  // Auto-anúncio: notifica Discord + IndexNow quando um produto novo é aprovado
  if (!wasApproved) {
    try {
      const automation = require('../utils/automation');
      automation.announceNewProduct(db, id).catch(() => {});
    } catch (e) { /* automação não bloqueia aprovação */ }
  }
  res.redirect('/admin/products');
});

router.post('/products/reject/:id', (req, res) => {
  var id = parseInt(req.params.id);
  if (!id) return res.redirect('/admin/products');
  var reason = (req.body.rejection_reason || '').trim();
  db.run("UPDATE products SET status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [reason, id]);
  res.redirect(req.get('Referer') || '/admin/products');
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

router.post('/products/new', upload.array('images', 3), (req, res) => {
  const { name, description, price, category_id, condition, location, status, featured, seller_id } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome e preço são obrigatórios', sellers: [], extraImages: [] });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);
  const cleanQty = Math.max(0, parseInt(req.body.quantity) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome inválido', sellers: [], extraImages: [] });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('admin/product-form', { title: 'Novo Produto', product: null, categories, error: 'Preço deve ser maior que zero', sellers: [], extraImages: [] });
  }

  var mainImage = null;
  if (req.files && req.files.length > 0) mainImage = '/uploads/' + req.files[0].filename;

  db.run(
    'INSERT INTO products (name, description, price, quantity, category_id, seller_id, image, condition, location, status, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cleanName, cleanDesc, cleanPrice, cleanQty, category_id || null, seller_id || null, mainImage, condition || 'new', cleanLocation, status || 'active', featured ? 1 : 0]
  );
  var lastId = db.get('SELECT MAX(id) as id FROM products');
  if (lastId) db.run("UPDATE products SET code = 'PROD-' || upper(substr(hex(randomblob(4)), 1, 8)) WHERE id = ?", [lastId.id]);

  // Save extra images
  if (req.files && req.files.length > 1 && lastId) {
    for (var i = 1; i < req.files.length; i++) {
      db.run("INSERT INTO product_images (product_id, image) VALUES (?, ?)", [lastId.id, '/uploads/' + req.files[i].filename]);
    }
  }

  res.redirect('/admin/products');
});

router.get('/products/edit/:id', (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');

  const categories = db.query('SELECT * FROM categories ORDER BY name');
  const sellers = db.query("SELECT id, name FROM sellers WHERE status = 'active' ORDER BY name");
  const extraImages = db.query("SELECT * FROM product_images WHERE product_id = ?", [req.params.id]);
  res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: null, sellers, extraImages });
});

router.post('/products/edit/:id', upload.array('images', 3), (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.redirect('/admin/products');

  const { name, description, price, category_id, condition, location, status, featured, seller_id } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    const extraImages = db.query("SELECT * FROM product_images WHERE product_id = ?", [req.params.id]);
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Nome e preço são obrigatórios', sellers: [], extraImages });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);
  const cleanQty = Math.max(0, parseInt(req.body.quantity) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    const extraImages = db.query("SELECT * FROM product_images WHERE product_id = ?", [req.params.id]);
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Nome inválido', sellers: [], extraImages });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    const extraImages = db.query("SELECT * FROM product_images WHERE product_id = ?", [req.params.id]);
    return res.render('admin/product-form', { title: 'Editar Produto', product, categories, error: 'Preço deve ser maior que zero', sellers: [], extraImages });
  }

  var mainImage = product.image;
  if (req.files && req.files.length > 0) mainImage = '/uploads/' + req.files[0].filename;

  db.run(
    'UPDATE products SET name = ?, description = ?, price = ?, quantity = ?, category_id = ?, seller_id = ?, image = ?, condition = ?, location = ?, status = ?, featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [cleanName, cleanDesc, cleanPrice, cleanQty, category_id || null, seller_id || null, mainImage, condition || 'new', cleanLocation, status || 'active', featured ? 1 : 0, req.params.id]
  );

  // Save extra images
  if (req.files && req.files.length > 1) {
    for (var i = 1; i < req.files.length; i++) {
      db.run("INSERT INTO product_images (product_id, image) VALUES (?, ?)", [req.params.id, '/uploads/' + req.files[i].filename]);
    }
  }

  res.redirect('/admin/products');
});

router.post('/products/delete-image/:id', (req, res) => {
  var img = db.get("SELECT * FROM product_images WHERE id = ?", [req.params.id]);
  if (img) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', img.image)); } catch(e) {}
    db.run("DELETE FROM product_images WHERE id = ?", [req.params.id]);
  }
  res.redirect(req.get('Referer') || '/admin/products');
});

router.post('/products/delete/:id', (req, res) => {
  var p = db.get('SELECT image FROM products WHERE id = ?', [req.params.id]);
  if (p && p.image) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', p.image)); } catch(e) {} }
  db.run('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.redirect('/admin/products');
});

router.get('/sellers', (req, res) => {
  var statusFilter = req.query.status && ['active', 'inactive', 'all'].includes(req.query.status) ? req.query.status : 'all';
  var search = (req.query.search || '').toString().trim().toLowerCase();
  var sellers = db.query(
    'SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.status = ?) as active_count, (SELECT COUNT(*) FROM sales sl WHERE sl.seller_id = s.id AND sl.status NOT IN (?, ?)) as sales_count, (SELECT COALESCE(SUM(sl2.product_price),0) FROM sales sl2 WHERE sl2.seller_id = s.id AND sl2.status NOT IN (?, ?)) as revenue, (SELECT COALESCE(SUM(wt.amount),0) FROM wallet_transactions wt WHERE wt.seller_id = s.id) as wallet_balance, (SELECT COUNT(*) FROM products p3 WHERE p3.seller_id = s.id AND p3.status = ?) as pending_count FROM sellers s',
    ['active', 'cancelled', 'pending', 'cancelled', 'pending', 'pending']
  );
  if (statusFilter !== 'all') sellers = sellers.filter(s => s.status === statusFilter);
  if (search) sellers = sellers.filter(s => (s.name || '').toLowerCase().includes(search) || (s.email || '').toLowerCase().includes(search) || (s.phone || '').toLowerCase().includes(search));
  var totalSellers = db.get('SELECT COUNT(*) as c FROM sellers');
  var activeSellers = db.get("SELECT COUNT(*) as c FROM sellers WHERE status = 'active'");
  var inactiveSellers = db.get("SELECT COUNT(*) as c FROM sellers WHERE status = 'inactive'");
  var pendingProducts = db.get("SELECT COUNT(*) as c FROM products WHERE status = 'pending'");
  res.render('admin/sellers', {
    title: 'Vendedores',
    sellers,
    stats: {
      total: totalSellers ? totalSellers.c : 0,
      active: activeSellers ? activeSellers.c : 0,
      inactive: inactiveSellers ? inactiveSellers.c : 0,
      pendingProducts: pendingProducts ? pendingProducts.c : 0
    },
    statusFilter,
    search: req.query.search || '',
    error: null,
    msg: req.query.msg || ''
  });
});

router.post('/sellers/new', (req, res) => {
  const { name, email, phone, whatsapp, password } = req.body;
  if (!name || !email || !password) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: 'Nome, email e senha são obrigatórios' });
  }
  var pwErrors = db.validatePassword(password);
  if (pwErrors.length > 0) {
    const sellers = db.query('SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) as product_count FROM sellers s ORDER BY s.created_at DESC');
    return res.render('admin/sellers', { title: 'Vendedores', sellers, error: pwErrors.join('<br>') });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run("INSERT INTO sellers (name, email, phone, whatsapp, password_hash, status) VALUES (?, ?, ?, ?, ?, 'active')", [name, email, phone || '', whatsapp || '', hash]);
    const sidRow = db.get("SELECT MAX(id) as id FROM sellers");
    const sid = sidRow ? sidRow.id : null;
    const authHive = require('../lib/auth-hive');
    authHive.hashPassword(password).then(function(newHash) {
      try {
        const uid = 'seller:' + sid;
        const existing = db.getUserAuth(uid);
        if (existing) db.updateUserAuthHash(uid, newHash, (existing.pepper_ver || 1) + 1);
        else db.createUserAuth(uid, 'seller', newHash, '', 1);
      } catch (e) { console.error('Erro users_auth seller:', e.message); }
    });
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

// Notificar um vendedor individual (a notificação fica visível no painel dele)
router.post('/sellers/notify/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers?msg=Vendedor+n%C3%A3o+encontrado');
  const message = String(req.body.message || '').trim();
  if (!message) return res.redirect('/admin/sellers?msg=Mensagem+vazia');
  db.addNotification(String(seller.id), 'seller', message, 'bell', req.body.link || '');
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'seller_notify', 'Notificou vendedor ' + seller.name + ': ' + message.slice(0, 80));
  res.redirect('/admin/sellers?msg=Notifica%C3%A7%C3%A3o+enviada+para+'+encodeURIComponent(seller.name));
});

// Força logout do vendedor (invalida sessões dele)
router.post('/sellers/logout/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers?msg=Vendedor+n%C3%A3o+encontrado');
  try {
    db.deleteAllUserSessions('seller:' + req.params.id);
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'seller_force_logout', 'Forçou logout do vendedor ' + seller.name);
  } catch (e) {}
  res.redirect('/admin/sellers?msg=Logout+for%C3%A7ado+para+'+encodeURIComponent(seller.name));
});

// Resetar senha do vendedor
router.post('/sellers/reset-password/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers?msg=Vendedor+n%C3%A3o+encontrado');
  const newPass = String(req.body.new_password || '').trim();
  if (newPass.length < 6) return res.redirect('/admin/sellers?msg=Senha+deve+ter+pelo+menos+6+caracteres');
  try {
    const hash = bcrypt.hashSync(newPass, 10);
    db.run('UPDATE sellers SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    const authHive = require('../lib/auth-hive');
    authHive.hashPassword(newPass).then(function(newHash) {
      try {
        const uid = 'seller:' + req.params.id;
        const existing = db.getUserAuth(uid);
        if (existing) db.updateUserAuthHash(uid, newHash, (existing.pepper_ver || 1) + 1);
        else db.createUserAuth(uid, 'seller', newHash, '', 1);
      } catch (e) { console.error('Erro users_auth seller reset:', e.message); }
    });
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'seller_reset_password', 'Resetou senha do vendedor ' + seller.name);
  } catch (e) {}
  res.redirect('/admin/sellers?msg=Senha+de+'+encodeURIComponent(seller.name)+'+redefinida');
});

// Ativar / desativar TODOS os vendedores (em massa)
router.post('/sellers/bulk-status', (req, res) => {
  var status = req.body.status === 'inactive' ? 'inactive' : 'active';
  db.run('UPDATE sellers SET status = ? WHERE status <> ?', [status, status]);
  if (status === 'inactive') {
    db.run("UPDATE products SET status = 'inactive' WHERE seller_id IN (SELECT id FROM sellers WHERE status = 'inactive') AND status = 'active'");
  } else {
    db.run("UPDATE products SET status = 'active' WHERE seller_id IN (SELECT id FROM sellers WHERE status = 'active') AND status = 'inactive'");
  }
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'seller_bulk_status', 'Ação em massa: vendedores ' + (status === 'active' ? 'ativados' : 'desativados'));
  res.redirect('/admin/sellers?msg=Todos+os+vendedores+'+ (status === 'active' ? 'ativados' : 'desativados'));
});

router.get('/sellers/:id', (req, res) => {
  const seller = db.get("SELECT *, (SELECT COUNT(*) FROM products WHERE seller_id = ?) as product_count, (SELECT COUNT(*) FROM products WHERE seller_id = ? AND status = 'active') as active_count, (SELECT COUNT(*) FROM products WHERE seller_id = ? AND featured = 1) as featured_count FROM sellers WHERE id = ?", [req.params.id, req.params.id, req.params.id, req.params.id]);
  if (!seller) return res.redirect('/admin/sellers');
  seller.bank_info = decryptField(seller.bank_info);

  const products = db.query('SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM page_views WHERE product_id = p.id) as views, (SELECT COUNT(*) FROM sales WHERE product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC', [req.params.id]);
  const sales = db.query("SELECT s.* FROM sales s WHERE s.seller_id = ? ORDER BY s.created_at DESC LIMIT 20", [req.params.id]).map(decryptSale);
  const totalRevenue = db.get("SELECT COALESCE(SUM(product_price),0) as total FROM sales WHERE seller_id = ? AND status NOT IN ('cancelled','pending')", [req.params.id]);
  const walletBalance = db.get("SELECT COALESCE(SUM(amount),0) as balance FROM wallet_transactions WHERE seller_id = ?", [req.params.id]);

  res.render('admin/seller-detail', {
    title: `${seller.name} - Vendedor`,
    seller, products, sales, totalRevenue: totalRevenue.total, walletBalance: walletBalance.balance
  });
});

router.get('/sellers/edit/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers');
  seller.bank_info = decryptField(seller.bank_info);
  res.render('admin/seller-form', { title: 'Editar Vendedor - ' + seller.name, seller, error: null });
});

router.post('/sellers/edit/:id', (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.params.id]);
  if (!seller) return res.redirect('/admin/sellers');

  const { name, email, phone, whatsapp, password, bio, website, pix_key, commission_pct, bank_info, sales_count, status } = req.body;

  if (!name || !email) {
    seller.name = name; seller.email = email; seller.phone = phone; seller.whatsapp = whatsapp;
    seller.bio = bio; seller.website = website; seller.pix_key = pix_key;
    seller.commission_pct = commission_pct; seller.bank_info = bank_info;
    seller.sales_count = sales_count; seller.status = status;
    return res.render('admin/seller-form', { title: 'Editar Vendedor - ' + name, seller, error: 'Nome e email são obrigatórios' });
  }

  try {
    if (password && String(password).length >= 6) {
      const hash = bcrypt.hashSync(password, 10);
      db.run("UPDATE sellers SET name=?, email=?, phone=?, whatsapp=?, password_hash=?, bio=?, website=?, pix_key=?, commission_pct=?, bank_info=?, sales_count=?, status=? WHERE id=?",
        [name, email, phone || '', whatsapp || '', hash, bio || '', website || '', pix_key || '', commission_pct !== '' ? parseFloat(commission_pct) : null, encryptField(bank_info || ''), parseInt(sales_count) || 0, status || 'active', req.params.id]);
      const authHive = require('../lib/auth-hive');
      authHive.hashPassword(password).then(function(newHash) {
        try {
          const uid = 'seller:' + req.params.id;
          const existing = db.getUserAuth(uid);
          if (existing) db.updateUserAuthHash(uid, newHash, (existing.pepper_ver || 1) + 1);
          else db.createUserAuth(uid, 'seller', newHash, '', 1);
        } catch (e) { console.error('Erro users_auth seller:', e.message); }
      });
    } else {
      db.run("UPDATE sellers SET name=?, email=?, phone=?, whatsapp=?, bio=?, website=?, pix_key=?, commission_pct=?, bank_info=?, sales_count=?, status=? WHERE id=?",
        [name, email, phone || '', whatsapp || '', bio || '', website || '', pix_key || '', commission_pct !== '' ? parseFloat(commission_pct) : null, encryptField(bank_info || ''), parseInt(sales_count) || 0, status || 'active', req.params.id]);
    }
  } catch (e) {
    seller.name = name; seller.email = email; seller.phone = phone; seller.whatsapp = whatsapp;
    seller.bio = bio; seller.website = website; seller.pix_key = pix_key;
    seller.commission_pct = commission_pct; seller.bank_info = bank_info;
    seller.sales_count = sales_count; seller.status = status;
    return res.render('admin/seller-form', { title: 'Editar Vendedor - ' + name, seller, error: 'Email já cadastrado para outro vendedor' });
  }
  res.redirect('/admin/sellers/' + req.params.id);
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
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    db.run('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)', [name, slug, icon || '📦']);
  } catch (e) {
    const categories = db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name');
    return res.render('admin/categories', { title: 'Categorias - Painel Admin', categories, error: 'Categoria já existe' });
  }
  res.redirect('/admin/categories');
});

router.post('/categories/edit/:id', (req, res) => {
  const { name, icon } = req.body;
  if (!name) {
    const categories = db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name');
    return res.render('admin/categories', { title: 'Categorias - Painel Admin', categories, error: 'Nome é obrigatório' });
  }
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  db.run('UPDATE categories SET name = ?, slug = ?, icon = ? WHERE id = ?', [name, slug, icon || '📦', req.params.id]);
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
  var pwErrors = db.validatePassword(password);
  if (pwErrors.length > 0) {
    const admins = db.query('SELECT id, username, display_name, created_at FROM admins ORDER BY created_at DESC');
    return res.render('admin/admins', { title: 'Administradores', admins, error: pwErrors.join('<br>') });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)', [username, hash, display_name || username]);
    const aidRow = db.get("SELECT MAX(id) as id FROM admins");
    const aid = aidRow ? aidRow.id : null;
    const authHive = require('../lib/auth-hive');
    authHive.hashPassword(password).then(function(newHash) {
      try {
        const uid = 'admin:' + aid;
        db.createUserAuth(uid, 'admin', newHash, '', 1);
      } catch (e) { console.error('Erro users_auth admin:', e.message); }
    });
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

router.post('/ads/new', upload.single('imageFile'), (req, res) => {
  const { title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order, status } = req.body;
  if (!text) return res.render('admin/ad-form', { title: 'Novo Anúncio', ad: null, error: 'Texto do anúncio é obrigatório' });
  var imageVal = (image || '').toString().trim().slice(0, 200);
  if (req.file) imageVal = '/uploads/' + req.file.filename;
  try {
    db.run(
      'INSERT INTO ads (title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        (title || '').toString().trim().slice(0, 100),
        text.toString().trim().slice(0, 500),
        (link || '').toString().trim().slice(0, 200),
        imageVal,
        parseInt(display_duration) || 15,
        parseInt(cooldown) || 86400,
        start_date || null,
        end_date || null,
        parseInt(sort_order) || 0,
        (status === 'active' || status === 'inactive') ? status : 'active'
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

router.post('/ads/edit/:id', upload.single('imageFile'), (req, res) => {
  const ad = db.get('SELECT * FROM ads WHERE id = ?', [req.params.id]);
  if (!ad) return res.redirect('/admin/ads');
  const { title, text, link, image, display_duration, cooldown, start_date, end_date, sort_order, status } = req.body;
  if (!text) return res.render('admin/ad-form', { title: 'Editar Anúncio', ad, error: 'Texto do anúncio é obrigatório' });
  var imageVal = (image || '').toString().trim().slice(0, 200);
  if (req.file) imageVal = '/uploads/' + req.file.filename;
  else if (req.body.image_clear) imageVal = '';
  db.run(
    'UPDATE ads SET title = ?, text = ?, link = ?, image = ?, display_duration = ?, cooldown = ?, start_date = ?, end_date = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [
      (title || '').toString().trim().slice(0, 100),
      text.toString().trim().slice(0, 500),
      (link || '').toString().trim().slice(0, 200),
      imageVal,
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

router.get('/notifications/count', (req, res) => {
  var c = db.getNotificationCount('admin');
  res.json({ count: c });
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
  var allSellers = db.query("SELECT s.id, s.name, s.email, s.commission_pct, s.bank_info, (SELECT COALESCE(balance,0) FROM wallet_transactions WHERE seller_id = s.id ORDER BY id DESC LIMIT 1) as balance, (SELECT COUNT(*) FROM sales WHERE seller_id = s.id) as sales_count FROM sellers s ORDER BY s.name").map(function(s) { if (s.bank_info) s.bank_info = decryptField(s.bank_info); return s; });

  var commPct = db.getCommissionPct();
  var summary = db.getFinanceSummary(null, startDate || '2000-01-01', endDate || '2100-01-01');
  var chartData = db.getFinanceChart(null, 30);
  var pendingPayoutsCount = db.getPendingPayoutsCount();
  var payouts = db.getPayouts(null, 20, 0);
  var payoutsTotal = db.getPayoutCount(null);
  var avgTicket = summary.salesCount > 0 ? (summary.salesTotal / summary.salesCount) : 0;

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
    avgTicket: avgTicket,
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

router.post('/financeiro/payout/pagar/:id', (req, res) => {
  db.run("UPDATE payouts SET status = 'paid', notes = 'Pago pelo admin', paid_at = datetime('now') WHERE id = ? AND status = 'approved'", [req.params.id]);
  res.redirect('/admin/financeiro');
});

router.post('/financeiro/payout/manual', (req, res) => {
  var sellerId = parseInt(req.body.seller_id, 10);
  var amount = parseFloat(req.body.amount);
  if (!sellerId || isNaN(amount) || amount <= 0) return res.redirect('/admin/financeiro?msg=Informe vendedor e valor válidos');
  var seller = db.get('SELECT id FROM sellers WHERE id = ?', [sellerId]);
  if (!seller) return res.redirect('/admin/financeiro?msg=Vendedor não encontrado');
  var balance = db.getWalletBalance(sellerId);
  if (amount > balance) return res.redirect('/admin/financeiro?msg=Saldo insuficiente do vendedor');
  var bank = (req.body.bank_info || '').toString();
  var method = req.body.payment_method || 'pix';
  var payoutId = db.createPayout(sellerId, amount, bank, method);
  db.run("UPDATE payouts SET status = 'approved', approved_by = ?, approved_at = datetime('now'), notes = 'Saque manual criado pelo admin' WHERE id = ?", [req.session.adminId || 0, payoutId]);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'payout_manual', 'Criou saque manual de R$ ' + amount.toFixed(2) + ' para vendedor #' + sellerId);
  res.redirect('/admin/financeiro?msg=Saque manual criado (aguardando pagamento)');
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

router.post('/notifications/marcar-todas', (req, res) => {
  db.run('UPDATE notifications SET read = 1 WHERE read = 0');
  res.redirect('/admin/notifications');
});

// ========== SITE CONFIG ==========
router.get('/config', (req, res) => {
  var allConfigs = db.query('SELECT * FROM config ORDER BY key');
  var configObj = {};
  allConfigs.forEach(function(c) { configObj[c.key] = c.value; });

  var sellers = db.query('SELECT id, name, email FROM sellers ORDER BY name');
  var admins = db.query('SELECT id, username FROM admins ORDER BY username');
  var categories = db.query('SELECT * FROM categories ORDER BY name');

  res.render('admin/config', {
    title: 'Configurações do Site',
    config: configObj,
    sellers: sellers,
    admins: admins,
    categories: categories,
    error: null,
    success: null
  });
});

router.post('/config', (req, res) => {
  var allowedKeys = [
    'site_name', 'site_description', 'site_whatsapp', 'site_email',
    'commission_pct', 'mp_access_token', 'pix_key_platform',
    'default_product_status', 'maintenance_mode', 'max_products_per_seller',
    'custom_css', 'custom_js', 'flash_category_id',
    'site_logo_url', 'site_favicon_url', 'social_instagram', 'social_facebook', 'social_tiktok', 'social_youtube', 'social_discord',
    'site_address', 'site_phone', 'footer_text'
  ];
  allowedKeys.forEach(function(key) {
    if (req.body[key] !== undefined) {
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, String(req.body[key]).trim()]);
    }
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'update_config', 'Configurações do site atualizadas');
  res.redirect('/admin/config');
});

router.post('/config/upload-logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.redirect('/admin/config');
  var url = '/uploads/' + req.file.filename;
  db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('site_logo_url', ?)", [url]);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'update_config', 'Logo do site atualizado');
  res.redirect('/admin/config');
});

router.post('/config/upload-favicon', upload.single('favicon'), (req, res) => {
  if (!req.file) return res.redirect('/admin/config');
  var url = '/uploads/' + req.file.filename;
  db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('site_favicon_url', ?)", [url]);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'update_config', 'Favicon atualizado');
  res.redirect('/admin/config');
});

// ========== ADMIN PASSWORD ==========
router.get('/senha', (req, res) => {
  res.render('admin/change-password', { title: 'Alterar Senha', error: null, success: null });
});

router.post('/senha', async (req, res) => {
  var { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.render('admin/change-password', { title: 'Alterar Senha', error: 'Preencha todos os campos', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('admin/change-password', { title: 'Alterar Senha', error: 'Nova senha e confirmação não conferem', success: null });
  }
  var pwErrors = db.validatePassword(new_password);
  if (pwErrors.length > 0) {
    return res.render('admin/change-password', { title: 'Alterar Senha', error: pwErrors.join('<br>'), success: null });
  }
  var admin = db.get("SELECT * FROM admins WHERE id = ?", [req.session.adminId]);
  var adminAuth = db.getUserAuth('admin:' + req.session.adminId);
  var currentOk = false;
  if (adminAuth) {
    try {
      const authHive = require('../lib/auth-hive');
      const v = await authHive.verifyPassword(current_password, adminAuth.argon_hash);
      currentOk = !!(v && v.verified);
    } catch (e) { currentOk = false; }
  }
  if (!currentOk && (!admin || !bcrypt.compareSync(current_password, admin.password_hash))) {
    return res.render('admin/change-password', { title: 'Alterar Senha', error: 'Senha atual incorreta', success: null });
  }
  var hash = bcrypt.hashSync(new_password, 10);
  db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, req.session.adminId]);
  try {
    const authHive = require('../lib/auth-hive');
    const newHash = await authHive.hashPassword(new_password);
    const uid = 'admin:' + req.session.adminId;
    if (adminAuth) db.updateUserAuthHash(uid, newHash, (adminAuth.pepper_ver || 1) + 1);
    else db.createUserAuth(uid, 'admin', newHash, '', 1);
    db.logAuthEvent(uid, 'password_changed', req.ip || '', req.get('User-Agent') || '', 'success', '');
  } catch (e) { console.error('Erro atualizando hash auth-hive admin:', e.message); }
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'change_password', 'Alterou a própria senha');
  res.render('admin/change-password', { title: 'Alterar Senha', error: null, success: 'Senha alterada com sucesso!' });
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

router.post('/cupons/toggle/:id', (req, res) => {
  var c = db.getCouponById(req.params.id);
  if (c) db.toggleCoupon(req.params.id, !c.active);
  res.redirect('/admin/cupons');
});

router.post('/cupons/reset/:id', (req, res) => {
  db.resetCouponUses(req.params.id);
  res.redirect('/admin/cupons');
});

router.post('/cupons/editar/:id', (req, res) => {
  var { code, type, value, min_order, max_uses, expires_at } = req.body;
  var c = db.getCouponById(req.params.id);
  if (!c) return res.redirect('/admin/cupons');
  if (!code || !value) return res.redirect('/admin/cupons');
  db.updateCoupon(req.params.id, code.toUpperCase(), type, parseFloat(value), parseFloat(min_order) || 0, parseInt(max_uses) || 0, expires_at || null);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'edit_coupon', 'Cupom editado: ' + code);
  res.redirect('/admin/cupons');
});

// ========== BANNERS ==========
router.get('/banners', (req, res) => {
  var banners = db.getAllBanners();
  res.render('admin/banners', { title: 'Banners', banners, error: null, editBanner: null });
});

router.get('/banners/novo', (req, res) => {
  res.render('admin/banner-form', { title: 'Novo Banner', banner: null, error: null });
});

router.get('/banners/editar/:id', (req, res) => {
  var banner = db.get("SELECT * FROM banners WHERE id = ?", [req.params.id]);
  if (!banner) return res.redirect('/admin/banners');
  res.render('admin/banner-form', { title: 'Editar Banner', banner, error: null });
});

router.post('/banners/novo', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'mobile_image', maxCount: 1 }]), (req, res) => {
  var { title, subtitle, link, sort_order, active, display_duration, bg_color, text_align, position, transition, start_date, end_date, target_blank } = req.body;
  var image = req.files && req.files['image'] && req.files['image'][0] ? '/uploads/' + req.files['image'][0].filename : '';
  if (!image) return res.render('admin/banner-form', { title: 'Novo Banner', banner: null, error: 'Imagem principal é obrigatória' });
  var mobileImage = req.files && req.files['mobile_image'] && req.files['mobile_image'][0] ? '/uploads/' + req.files['mobile_image'][0].filename : '';
  db.saveBanner(null, title || '', subtitle || '', image, link, parseInt(sort_order) || 0, active === '1', parseInt(display_duration) || 10, {
    mobileImage: mobileImage, bgColor: bg_color || '#1a1a2e', textAlign: text_align || 'left',
    position: position || 'hero', transition: transition || 'slide',
    startDate: start_date || null, endDate: end_date || null, targetBlank: target_blank === '1'
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'create_banner', 'Banner criado: ' + (title || ''), 'banner', 0, req.ip);
  res.redirect('/admin/banners');
});

router.post('/banners/editar/:id', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'mobile_image', maxCount: 1 }]), (req, res) => {
  var { title, subtitle, link, sort_order, active, display_duration, bg_color, text_align, position, transition, start_date, end_date, target_blank } = req.body;
  var existing = db.get("SELECT * FROM banners WHERE id = ?", [req.params.id]);
  if (!existing) return res.redirect('/admin/banners');
  var image = req.files && req.files['image'] && req.files['image'][0] ? '/uploads/' + req.files['image'][0].filename : existing.image;
  var mobileImage = req.files && req.files['mobile_image'] && req.files['mobile_image'][0] ? '/uploads/' + req.files['mobile_image'][0].filename : (existing.mobile_image || '');
  db.saveBanner(req.params.id, title || '', subtitle || '', image, link, parseInt(sort_order) || 0, active === '1', parseInt(display_duration) || 10, {
    mobileImage: mobileImage, bgColor: bg_color || existing.bg_color || '#1a1a2e', textAlign: text_align || existing.text_align || 'left',
    position: position || existing.position || 'hero', transition: transition || existing.transition || 'slide',
    startDate: start_date || null, endDate: end_date || null, targetBlank: target_blank === '1'
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'edit_banner', 'Banner editado: ' + (title || ''), 'banner', req.params.id, req.ip);
  res.redirect('/admin/banners');
});

router.post('/banners/deletar/:id', (req, res) => {
  var b = db.get("SELECT image, mobile_image FROM banners WHERE id = ?", [req.params.id]);
  if (b && b.image) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', b.image)); } catch(e) {}
  }
  if (b && b.mobile_image) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', b.mobile_image)); } catch(e) {}
  }
  db.deleteBanner(req.params.id);
  res.redirect('/admin/banners');
});

router.post('/banners/clique/:id', (req, res) => {
  db.incrementBannerClicks(req.params.id);
  res.json({ ok: true });
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
  var backups = getBackups();
  var dbSize = 0;
  try { dbSize = fs.statSync(path.join(__dirname, '..', 'database.sqlite')).size; } catch(e) {}
  res.render('admin/backup', {
    title: 'Backup - Painel Admin',
    backups,
    dbSize,
    success: req.query.success,
    error: req.query.error
  });
});

router.post('/backup/criar', (req, res) => {
  try {
    var file = backupDatabase();
    res.redirect('/admin/backup?success=Backup criado: ' + encodeURIComponent(file));
  } catch (e) {
    res.redirect('/admin/backup?error=Erro ao criar backup: ' + encodeURIComponent(e.message));
  }
});

router.get('/backup/baixar/:filename', (req, res) => {
  try {
    var file = path.basename(req.params.filename);
    var p = path.join(__dirname, '..', 'database', 'backups', file);
    if (!fs.existsSync(p)) return res.redirect('/admin/backup?error=Backup não encontrado');
    res.download(p, file);
  } catch (e) {
    res.redirect('/admin/backup?error=' + encodeURIComponent(e.message));
  }
});

router.post('/backup/restaurar/:filename', (req, res) => {
  try {
    restoreBackup(path.basename(req.params.filename));
    res.redirect('/admin/backup?success=Backup restaurado com sucesso');
  } catch (e) {
    res.redirect('/admin/backup?error=Erro ao restaurar: ' + encodeURIComponent(e.message));
  }
});

router.post('/backup/baixar-atual', (req, res) => {
  var dbPath = path.join(__dirname, '..', 'database.sqlite');
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
  var allowed = ['banners', 'compras', 'cadastro_vendedor', 'mercado_pago', 'pix'];
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
  var daysViews = parseInt(req.body.days_views) || 90;
  var daysLogs = parseInt(req.body.days_logs) || 180;
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
  var flashCat = (db.get("SELECT value FROM config WHERE key = 'flash_category_id'")||{}).value;
  var catFilter = flashCat ? "AND category_id = " + parseInt(flashCat) + " " : "";
  var allProducts = db.query("SELECT id, name, price, category_id FROM products WHERE status = 'active' " + catFilter + "ORDER BY name");
  var categories = db.query("SELECT * FROM categories ORDER BY name");
  res.render('admin/ofertas', { title: 'Ofertas Relâmpago', flashProducts, allProducts, categories, flashCat, success: null, error: null });
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

router.post('/products/reactivate-all', requireAdmin, (req, res) => {
  db.run("UPDATE products SET status = 'active', updated_at = CURRENT_TIMESTAMP");
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'reactivate_all', 'Reativou todos os produtos');
  res.redirect('/admin/products');
});

router.get('/diagnostico', requireAdmin, (req, res) => {
  const dbState = {
    products: (db.get('SELECT COUNT(*) as c FROM products') || {}).c || 0,
    productsActive: (db.get("SELECT COUNT(*) as c FROM products WHERE status = 'active'") || {}).c || 0,
    categories: (db.get('SELECT COUNT(*) as c FROM categories') || {}).c || 0,
    ads: (db.get('SELECT COUNT(*) as c FROM ads') || {}).c || 0,
    sellers: (db.get('SELECT COUNT(*) as c FROM sellers') || {}).c || 0,
    banners: (db.get('SELECT COUNT(*) as c FROM banners') || {}).c || 0,
    pageViews: (db.get('SELECT COUNT(*) as c FROM page_views') || {}).c || 0,
    sales: (db.get('SELECT COUNT(*) as c FROM sales') || {}).c || 0,
    productSample: db.query('SELECT id, name, status FROM products LIMIT 5') || [],
    categorySample: db.query('SELECT id, name FROM categories LIMIT 5') || [],
  };
  res.render('admin/debug', { title: 'Diagnóstico', db: dbState, msg: req.query.msg || '' });
});

// ========== AUDITORIA IA ==========
const { runAudit, analyzeWithAI } = require('../utils/ai-audit');

router.get('/ai-audit', async (req, res) => {
  try {
    const report = await runAudit();
    res.render('admin/ai-audit', {
      title: 'Auditoria IA',
      report: report,
      aiConfig: {
        api_key: (db.get("SELECT value FROM config WHERE key = 'ai_api_key'") || {}).value || '',
        base_url: (db.get("SELECT value FROM config WHERE key = 'ai_base_url'") || {}).value || process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
        model: (db.get("SELECT value FROM config WHERE key = 'ai_model'") || {}).value || process.env.AI_MODEL || 'llama-3.3-70b-versatile'
      },
      msg: req.query.msg || ''
    });
  } catch(e) {
    res.status(500).send('Erro na auditoria: ' + e.message);
  }
});

router.post('/ai-audit/finding/:code', (req, res) => {
  const code = String(req.params.code || '').slice(0, 64);
  const status = req.body.status === 'resolved' ? 'resolved' : (req.body.status === 'ignored' ? 'ignored' : 'open');
  if (code) db.setAuditFindingStatus(code, status);
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'ai_audit_finding', 'Alterou status do achado ' + code + ' para ' + status);
  res.redirect('/admin/ai-audit');
});

router.post('/ai-audit/config', (req, res) => {
  const keys = ['ai_api_key', 'ai_base_url', 'ai_model'];
  keys.forEach(function(key) {
    if (req.body[key] !== undefined) {
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, String(req.body[key]).trim()]);
    }
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'ai_audit_config', 'Configurações de IA da auditoria atualizadas');
  res.redirect('/admin/ai-audit?msg=Configura%C3%A7%C3%B5es+de+IA+salvas');
});

router.post('/ai-audit/analyze', async (req, res) => {
  try {
    const report = await runAudit();
    const open = report.findings.filter(f => f.status === 'open');
    const ai = await analyzeWithAI(open);
    res.render('admin/ai-audit', {
      title: 'Auditoria IA',
      report: Object.assign(report, { ai: ai && !ai.error ? ai : null, aiError: ai && ai.error ? ai.error : null }),
      aiConfig: {
        api_key: (db.get("SELECT value FROM config WHERE key = 'ai_api_key'") || {}).value || '',
        base_url: (db.get("SELECT value FROM config WHERE key = 'ai_base_url'") || {}).value || process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
        model: (db.get("SELECT value FROM config WHERE key = 'ai_model'") || {}).value || process.env.AI_MODEL || 'llama-3.3-70b-versatile'
      },
      msg: ai && ai.error ? 'Falha na análise de IA: ' + ai.error : (ai ? 'Análise de IA gerada com sucesso' : 'Configure uma chave de API de IA para usar a análise inteligente')
    });
  } catch(e) {
    res.status(500).send('Erro: ' + e.message);
  }
});

router.post('/reseed-categories', requireAdmin, (req, res) => {
  const existing = db.get('SELECT COUNT(*) as c FROM categories');
  if (existing && existing.c > 0) {
    return res.redirect('/admin/diagnostico?msg=categorias+ja+existem');
  }
  const cats = [
    ['HDs e Armazenamento', 'hds-armazenamento', '💾'],
    ['SSDs', 'ssds', '⚡'],
    ['Memória RAM', 'memoria-ram', '🧠'],
    ['Processadores', 'processadores', '🔲'],
    ['Placas de Vídeo', 'placas-video', '🎮'],
    ['Placas-mãe', 'placas-mae', '🔧'],
    ['Notebooks e PCs', 'notebooks-pcs', '💻'],
    ['Monitores', 'monitores', '🖥️'],
    ['Periféricos', 'perifericos', '⌨️'],
    ['Fontes e Gabinetes', 'fontes-gabinetes', '🔌'],
    ['Redes e Conectividade', 'redes', '🌐'],
    ['Outros', 'outros', '📦'],
  ];
  for (const [name, slug, icon] of cats) {
    db.run('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)', [name, slug, icon]);
  }
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'reseed_categories', 'Recriou todas as categorias');
  res.redirect('/admin/categories?sucesso=categorias+recriadas');
});

router.post('/reseed-ads', requireAdmin, (req, res) => {
  const existing = db.get('SELECT COUNT(*) as c FROM ads');
  if (existing && existing.c > 0) {
    return res.redirect('/admin/diagnostico?msg=anuncios+ja+existem');
  }
  const defaultAds = [
    ['SSD Kingston NV2 1TB', '<i class="fas fa-bolt"></i> SSD Kingston NV2 1TB — R$ 349,90', '/produto/1', '', 15, 86400],
    ['Memória DDR5 32GB', '<i class="fas fa-microchip"></i> Memória DDR5 32GB — R$ 589,90', '/produto/4', '', 15, 86400],
    ['HD Seagate 2TB', '<i class="fas fa-hdd"></i> HD Seagate 2TB — R$ 289,90', '/produto/2', '', 15, 86400],
    ['SSD Samsung 990 Pro', '<i class="fas fa-star"></i> SSD Samsung 990 Pro 2TB — R$ 1.299,90', '/produto/15', '', 15, 86400],
    ['Promoção SSDs', '<i class="fas fa-tags"></i> Aproveite nossas ofertas em SSDs!', '/?category=ssds', '', 20, 43200],
  ];
  defaultAds.forEach(function(ad) {
    db.run('INSERT INTO ads (title, text, link, image, display_duration, cooldown, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', ad);
  });
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'reseed_ads', 'Recriou todos os anúncios');
  res.redirect('/admin/ads?sucesso=anuncios+recriados');
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

// ========== SEGURANCA ==========
router.get('/seguranca', requireSuperAdmin, (req, res) => {
  var keys = ['maintenance_mode','maintenance_message','rate_limit_max','rate_limit_window','login_limit_max','login_limit_window','password_min_length','password_require_special','password_require_number','password_require_upper','upload_max_size','csp_enabled'];
  var configs = {};
  keys.forEach(function(k) {
    var r = db.get("SELECT value FROM config WHERE key = ?", [k]);
    configs[k] = r ? r.value : '';
  });
  var loginAttempts = db.getLoginAttempts(100);
  res.render('admin/seguranca', { title: 'Segurança', configs, loginAttempts, msg: req.query.msg || '' });
});

router.post('/seguranca', requireSuperAdmin, (req, res) => {
  var action = req.body.action;
  if (action === 'save') {
    var keys = ['maintenance_mode','maintenance_message','rate_limit_max','rate_limit_window','login_limit_max','login_limit_window','password_min_length','password_require_special','password_require_number','password_require_upper','upload_max_size','csp_enabled'];
    keys.forEach(function(k) {
      var val = req.body[k] !== undefined ? req.body[k] : '';
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [k, val.toString()]);
    });
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'security', 'Alterou configurações de segurança');
    return res.redirect('/admin/seguranca?msg=Configurações salvas!');
  }
  if (action === 'force_logout_sellers') {
    db.run("DELETE FROM auth_sessions WHERE user_type = 'seller'");
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'security', 'Forçou logout de todos os vendedores');
    return res.redirect('/admin/seguranca?msg=Logout forçado de todos os vendedores!');
  }
  if (action === 'force_logout_admins') {
    var currentSid = null;
    if (req.session.authSidHash) currentSid = req.session.authSidHash;
    if (currentSid) {
      db.run("DELETE FROM auth_sessions WHERE user_type = 'admin' AND sid_hash != ?", [currentSid]);
    } else {
      db.run("DELETE FROM auth_sessions WHERE user_type = 'admin'");
    }
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'security', 'Forçou logout de todos os admins');
    req.session.destroy();
    return res.redirect('/admin/login');
  }
  res.redirect('/admin/seguranca');
});

router.get('/super', requireSuperAdmin, (req, res) => {
  var configs = db.query("SELECT key, value FROM config ORDER BY key");
  var admins = db.query("SELECT id, username, display_name, role FROM admins");
  res.render('admin/super', { title: 'Super Panel', configs, admins, msg: req.query.msg || '' });
});

// ========== DATABASE MANAGEMENT ==========
var DB_FILE = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'database.sqlite');

router.get('/database', requireSuperAdmin, (req, res) => {
  var dbPath = DB_FILE;
  var dbStats = null;
  try {
    var st = fs.statSync(dbPath);
    dbStats = { size: st.size, mtime: st.mtime };
  } catch(e) {}
  var counts = {
    products: db.get('SELECT COUNT(*) as c FROM products'),
    sellers: db.get('SELECT COUNT(*) as c FROM sellers'),
    sales: db.get('SELECT COUNT(*) as c FROM sales'),
    payouts: db.get('SELECT COUNT(*) as c FROM payouts'),
    reviews: db.get('SELECT COUNT(*) as c FROM reviews')
  };
  res.render('admin/database', {
    title: 'Banco de Dados',
    backups: getBackups(),
    dbStats,
    counts: {
      products: counts.products ? counts.products.c : 0,
      sellers: counts.sellers ? counts.sellers.c : 0,
      sales: counts.sales ? counts.sales.c : 0,
      payouts: counts.payouts ? counts.payouts.c : 0,
      reviews: counts.reviews ? counts.reviews.c : 0
    },
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/database/backup', requireSuperAdmin, (req, res) => {
  var name = backupDatabase();
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'db_backup', 'Backup manual criado: ' + (name || 'falha'));
  res.redirect('/admin/database?success=' + encodeURIComponent(name ? 'Backup criado: ' + name : 'Falha ao criar backup'));
});

router.get('/database/download', requireSuperAdmin, (req, res) => {
  var dbPath = DB_FILE;
  if (!fs.existsSync(dbPath)) return res.status(404).send('Banco não encontrado');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="database-' + new Date().toISOString().slice(0,10) + '.sqlite"');
  res.send(fs.readFileSync(dbPath));
});

router.get('/database/download/:filename', requireSuperAdmin, (req, res) => {
  var name = path.basename(req.params.filename);
  if (!name.endsWith('.sqlite')) return res.status(400).send('Arquivo inválido');
  var file = path.join(process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(__dirname, '..', 'database', 'backups'), name);
  if (!fs.existsSync(file)) return res.status(404).send('Backup não encontrado');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.send(fs.readFileSync(file));
});

router.post('/database/restore/:filename', requireSuperAdmin, (req, res) => {
  var confirm = (req.body.confirm || '').toString().trim();
  if (confirm !== 'CONFIRMAR') {
    return res.redirect('/admin/database?error=' + encodeURIComponent('Digite CONFIRMAR para restaurar'));
  }
  var result = restoreBackup(req.params.filename);
  if (!result.ok) return res.redirect('/admin/database?error=' + encodeURIComponent(result.error));
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'db_restore', 'Restaurou backup: ' + result.name);
  db.reloadFromDisk().then(function() {
    res.redirect('/admin/database?success=' + encodeURIComponent('Backup restaurado: ' + result.name));
  }).catch(function() {
    res.redirect('/admin/database?success=' + encodeURIComponent('Backup restaurado (reinicie o servidor para aplicar): ' + result.name));
  });
});

router.post('/database/upload', requireSuperAdmin, dbUpload.array('files', 1), (req, res) => {
  var confirm = (req.body.confirm || '').toString().trim();
  if (confirm !== 'CONFIRMAR') {
    return res.redirect('/admin/database?error=' + encodeURIComponent('Digite CONFIRMAR para importar'));
  }
  if (!req.files || req.files.length === 0 || !req.files[0].filename) {
    return res.redirect('/admin/database?error=' + encodeURIComponent('Envie um arquivo .sqlite'));
  }
  var ext = path.extname(req.files[0].originalname || '').toLowerCase();
  if (ext !== '.sqlite' && ext !== '.db') {
    return res.redirect('/admin/database?error=' + encodeURIComponent('O arquivo deve ser .sqlite'));
  }
  var result = restoreFromFile(req.files[0].path);
  try { fs.unlinkSync(req.files[0].path); } catch(e) {}
  if (!result.ok) return res.redirect('/admin/database?error=' + encodeURIComponent(result.error));
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'db_import', 'Importou banco: ' + (req.files[0].originalname || 'arquivo'));
  db.reloadFromDisk().then(function() {
    res.redirect('/admin/database?success=' + encodeURIComponent('Banco importado com sucesso'));
  }).catch(function() {
    res.redirect('/admin/database?success=' + encodeURIComponent('Banco importado (reinicie o servidor para aplicar)'));
  });
});

router.post('/super/config', requireSuperAdmin, (req, res) => {
  var { key, value } = req.body;
  if (key) {
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key.trim(), value || '']);
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'super_config', 'Editou config: ' + key);
  }
  res.redirect('/admin/super');
});

router.post('/super/config/delete', requireSuperAdmin, (req, res) => {
  db.run("DELETE FROM config WHERE key = ?", [req.body.key]);
  res.redirect('/admin/super');
});

router.post('/super/sql', requireSuperAdmin, (req, res) => {
  var sql = req.body.query && req.body.query.trim();
  if (!sql) return res.redirect('/admin/super');
  var result = null, error = null;
  try {
    if (sql.toUpperCase().startsWith('SELECT') || sql.toUpperCase().startsWith('PRAGMA')) {
      result = db.query(sql);
    } else {
      db.run(sql);
      result = { affected: 'OK' };
    }
  } catch(e) { error = e.message; }
  db.logActivity('admin', req.session.adminId, req.session.adminName, 'super_sql', 'Executou SQL: ' + sql.substring(0,80));
  res.render('admin/super', { title: 'Super Panel', configs: db.query("SELECT key, value FROM config ORDER BY key"), admins: db.query("SELECT id, username, display_name, role FROM admins"), msg: '', sqlResult: result, sqlError: error, sqlQuery: sql });
});

router.post('/super/admin-role', requireSuperAdmin, (req, res) => {
  var { admin_id, role } = req.body;
  if (admin_id && role) {
    db.run("UPDATE admins SET role = ? WHERE id = ?", [role, admin_id]);
    db.logActivity('admin', req.session.adminId, req.session.adminName, 'super_admin_role', 'Alterou role do admin #' + admin_id + ' para ' + role);
  }
  res.redirect('/admin/super');
});

// ===================== NOTÍCIAS (portal Games & Hacking) =====================
function setCfg(key, value) {
  try { db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, String(value)]); } catch (e) {}
}

router.get('/noticias', (req, res) => {
  try {
    var status = req.query.status || '';
    var q = req.query.q || '';
    var sql = "SELECT * FROM news WHERE 1=1";
    var params = [];
    if (status === 'draft') { sql += " AND published = 0"; }
    else if (status === 'published') { sql += " AND published = 1"; }
    if (q) { sql += " AND (title LIKE ? OR excerpt LIKE ? OR content LIKE ?)"; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    sql += " ORDER BY created_at DESC LIMIT 300";
    var news = db.query(sql, params) || [];
    var drafts = db.get("SELECT COUNT(*) as c FROM news WHERE published = 0") || { c: 0 };
    var categories = db.getNewsCategories() || [];
    res.render('admin/news', {
      title: 'Gerenciar Notícias',
      news: news,
      draftsCount: drafts.c,
      categories: categories,
      agent: newsAgent.getAgentConfig(),
      msg: req.query.msg || '',
      err: req.query.err || '',
      status: status,
      q: q
    });
  } catch (e) {
    console.error('Admin news list error:', e);
    res.render('admin/news', { title: 'Gerenciar Notícias', news: [], draftsCount: 0, categories: [], agent: newsAgent.getAgentConfig(), msg: '', err: 'Erro ao carregar', status: '', q: '' });
  }
});

router.get('/noticias/novo', (req, res) => {
  res.render('admin/news-form', { title: 'Nova Notícia', article: null, categories: db.getNewsCategories() || [], err: '' });
});

router.post('/noticias/novo', videoUpload.single('videoFile'), (req, res) => {
  try {
    var b = req.body;
    var videoVal = b.video || '';
    if (req.file) videoVal = '/videos/' + req.file.filename;
    db.saveNews({
      title: b.title, slug: b.slug || '', excerpt: b.excerpt || '', content: b.content || '',
      category: b.category || 'Hacking', image: b.image || '', author: b.author || 'Redação',
      featured: b.featured ? 1 : 0, published: b.published ? 1 : 0, video: videoVal
    });
    db.saveDb();
    res.redirect('/admin/noticias?msg=' + encodeURIComponent('Notícia criada.'));
  } catch (e) {
    console.error('Admin news create error:', e);
    res.render('admin/news-form', { title: 'Nova Notícia', article: req.body, categories: db.getNewsCategories() || [], err: e.message });
  }
});

router.get('/noticias/editar/:id', (req, res) => {
  var a = db.get("SELECT * FROM news WHERE id = ?", [req.params.id]);
  if (!a) return res.redirect('/admin/noticias?err=' + encodeURIComponent('Notícia não encontrada'));
  res.render('admin/news-form', { title: 'Editar Notícia', article: a, categories: db.getNewsCategories() || [], err: '' });
});

router.post('/noticias/editar/:id', videoUpload.single('videoFile'), (req, res) => {
  try {
    var b = req.body;
    var videoVal = (b.video || '').trim();
    if (req.file) videoVal = '/videos/' + req.file.filename;
    else if (b.video_clear) videoVal = '';
    db.saveNews({
      title: b.title, slug: b.slug || '', excerpt: b.excerpt || '', content: b.content || '',
      category: b.category || 'Hacking', image: b.image || '', author: b.author || 'Redação',
      featured: b.featured ? 1 : 0, published: b.published ? 1 : 0, video: videoVal
    }, parseInt(req.params.id, 10));
    db.saveDb();
    res.redirect('/admin/noticias?msg=' + encodeURIComponent('Notícia atualizada.'));
  } catch (e) {
    console.error('Admin news edit error:', e);
    res.render('admin/news-form', { title: 'Editar Notícia', article: req.body, categories: db.getNewsCategories() || [], err: e.message });
  }
});

router.post('/noticias/excluir/:id', (req, res) => {
  try { db.deleteNews(parseInt(req.params.id, 10)); db.saveDb(); } catch (e) {}
  res.redirect('/admin/noticias?msg=' + encodeURIComponent('Notícia excluída.'));
});

router.post('/noticias/publicar/:id', (req, res) => {
  try { db.run("UPDATE news SET published = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [parseInt(req.params.id, 10)]); db.saveDb(); } catch (e) {}
  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') >= 0)) return res.json({ ok: true });
  res.redirect('/admin/noticias?msg=' + encodeURIComponent('Notícia publicada.'));
});

router.post('/noticias/rascunho/:id', (req, res) => {
  try { db.run("UPDATE news SET published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [parseInt(req.params.id, 10)]); db.saveDb(); } catch (e) {}
  res.redirect('/admin/noticias?msg=' + encodeURIComponent('Notícia movida para rascunho.'));
});

router.post('/noticias/destaque/:id', (req, res) => {
  try { db.toggleNewsFeatured(parseInt(req.params.id, 10)); db.saveDb(); } catch (e) {}
  res.redirect('/admin/noticias');
});

// Assistente de IA: gera rascunhos (resposta JSON para o painel)
router.post('/noticias/ia-gerar', async (req, res) => {
  try {
    var b = req.body || {};
    var themes = b.theme || 'Hacking,Games';
    var count = parseInt(b.count || '3', 10);
    var briefing = b.briefing || '';
    var result = await newsAgent.runAgent({ themes: themes, count: count, briefing: briefing, video: b.video === '1', force: true });
    res.json({ ok: true, created: result.created, errors: result.errors, total: result.total });
  } catch (e) {
    console.error('IA gerar erro:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Salvar configurações do agente autônomo
router.post('/noticias/agente-salvar', (req, res) => {
  try {
    var b = req.body;
    setCfg('news_agent_enabled', b.enabled === '1' ? '1' : '0');
    setCfg('news_agent_interval', parseInt(b.interval || '6', 10) || 6);
    setCfg('news_agent_themes', (b.themes || 'Hacking,Games').toString().slice(0, 200));
    setCfg('news_agent_per_run', parseInt(b.per_run || '3', 10) || 3);
    setCfg('news_agent_video', b.video === '1' ? '1' : '0');
    setCfg('news_agent_briefing', (b.briefing || '').toString().slice(0, 1000));
    db.saveDb();
    res.redirect('/admin/noticias?msg=' + encodeURIComponent('Configurações do assistente salvas.'));
  } catch (e) {
    res.redirect('/admin/noticias?err=' + encodeURIComponent('Erro ao salvar: ' + e.message));
  }
});

// Executar o agente agora (manual)
router.post('/noticias/agente-executar', async (req, res) => {
  try {
    var result = await newsAgent.runAgent({ force: true });
    res.redirect('/admin/noticias?msg=' + encodeURIComponent('Assistente gerou ' + result.created.length + ' rascunho(s).'));
  } catch (e) {
    res.redirect('/admin/noticias?err=' + encodeURIComponent('Erro: ' + e.message));
  }
});

return router;
};
