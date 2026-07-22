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
    db.run('INSERT INTO sellers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [name, email, phone || '', hash]);
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

return router;
};
