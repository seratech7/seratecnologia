const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireSeller, redirectIfSeller } = require('../middleware/auth');

module.exports = function(upload) {
const router = express.Router();

router.get('/profile', requireSeller, (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.session.sellerId]);
  if (!seller) return res.redirect('/seller/logout');
  const mpConn = db.get('SELECT id FROM mp_connections WHERE seller_id = ?', [req.session.sellerId]);
  seller.mp_connected = !!mpConn;
  res.render('seller/profile', { title: 'Meu Perfil', seller, error: null, success: null });
});

router.post('/profile', upload.single('avatar'), requireSeller, (req, res) => {
  const seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.session.sellerId]);
  if (!seller) return res.redirect('/seller/logout');

  const { name, phone, bio, website, whatsapp, email, pix_key } = req.body;

  if (!name || !email) {
    return res.render('seller/profile', { title: 'Meu Perfil', seller, error: 'Nome e email são obrigatórios', success: null });
  }

  let avatar = seller.avatar;
  if (req.file) {
    avatar = '/uploads/' + req.file.filename;
  }

  db.run(
    'UPDATE sellers SET name = ?, email = ?, phone = ?, bio = ?, website = ?, whatsapp = ?, pix_key = ?, avatar = ? WHERE id = ?',
    [name, email, phone || '', bio || '', website || '', whatsapp || '', pix_key || '', avatar, req.session.sellerId]
  );

  req.session.sellerName = name;

  const updated = db.get('SELECT * FROM sellers WHERE id = ?', [req.session.sellerId]);
  res.render('seller/profile', { title: 'Meu Perfil', seller: updated, error: null, success: 'Perfil atualizado com sucesso!' });
});

router.get('/login', redirectIfSeller, (req, res) => {
  res.render('seller/login', { title: 'Login Vendedor', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('seller/login', { title: 'Login Vendedor', error: 'Preencha todos os campos' });
  }

  const seller = db.get('SELECT * FROM sellers WHERE email = ?', [email]);

  if (!seller || !bcrypt.compareSync(password, seller.password_hash)) {
    return res.render('seller/login', { title: 'Login Vendedor', error: 'Email ou senha inválidos' });
  }

  if (seller.status !== 'active') {
    return res.render('seller/login', { title: 'Login Vendedor', error: 'Sua conta foi desativada. Contate o administrador.' });
  }

  req.session.sellerId = seller.id;
  req.session.sellerName = seller.name;
  res.redirect('/seller/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/seller/login');
});

router.use(requireSeller);

router.get('/dashboard', (req, res) => {
  const total = db.get('SELECT COUNT(*) as count FROM products WHERE seller_id = ?', [req.session.sellerId]);
  const active = db.get("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'active'", [req.session.sellerId]);
  const pending = db.get("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'pending'", [req.session.sellerId]);
  const recent = db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC LIMIT 5', [req.session.sellerId]);

  res.render('seller/dashboard', {
    title: 'Meu Painel - Vendedor',
    stats: { total: total.count, active: active.count, pending: pending.count },
    recent
  });
});

router.get('/products', (req, res) => {
  const products = db.query(
    'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC',
    [req.session.sellerId]
  );
  res.render('seller/products', { title: 'Meus Produtos', products });
});

router.get('/products/new', (req, res) => {
  const categories = db.query('SELECT * FROM categories ORDER BY name');
  res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: null });
});

router.post('/products/new', upload.single('image'), (req, res) => {
  const { name, description, price, category_id, condition, location } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome e preço são obrigatórios' });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome inválido' });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Preço deve ser maior que zero' });
  }

  let image = null;
  if (req.file) {
    image = '/uploads/' + req.file.filename;
  }

  db.run(
    'INSERT INTO products (name, description, price, category_id, seller_id, image, condition, location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cleanName, cleanDesc, cleanPrice, category_id || null, req.session.sellerId, image, condition || 'new', cleanLocation, 'pending']
  );
  var lastId = db.get('SELECT MAX(id) as id FROM products');
  if (lastId) db.run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [lastId.id, lastId.id]);

  res.redirect('/seller/products');
});

router.get('/products/edit/:id', (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!product) return res.redirect('/seller/products');

  const categories = db.query('SELECT * FROM categories ORDER BY name');
  res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: null });
});

router.post('/products/edit/:id', upload.single('image'), (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!product) return res.redirect('/seller/products');

  const { name, description, price, category_id, condition, location } = req.body;

  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Nome e preço são obrigatórios' });
  }

  const cleanName = (name || '').toString().trim().slice(0, 100);
  const cleanDesc = (description || '').toString().trim().slice(0, 2000);
  const cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  const cleanPrice = Math.max(0, parseFloat(price) || 0);

  if (!cleanName) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Nome inválido' });
  }
  if (cleanPrice <= 0) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Preço deve ser maior que zero' });
  }

  let image = product.image;
  if (req.file) {
    image = '/uploads/' + req.file.filename;
  }

  db.run(
    "UPDATE products SET name = ?, description = ?, price = ?, category_id = ?, image = ?, condition = ?, location = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?",
    [cleanName, cleanDesc, cleanPrice, category_id || null, image, condition || 'new', cleanLocation, req.params.id, req.session.sellerId]
  );

  res.redirect('/seller/products');
});

router.post('/products/delete/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  res.redirect('/seller/products');
});

router.get('/sales', requireSeller, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;
  const total = db.get('SELECT COUNT(*) as c FROM sales WHERE seller_id = ?', [req.session.sellerId]);
  const sales = db.query('SELECT * FROM sales WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [req.session.sellerId, limit, offset]);
  const totalPages = Math.ceil((total ? total.c : 0) / limit);
  res.render('seller/sales', { title: 'Minhas Vendas', sales, page, totalPages });
});

router.get('/wallet', requireSeller, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;
  const balance = db.getWalletBalance(req.session.sellerId);
  const txns = db.getWalletTransactions(req.session.sellerId, limit, offset);
  const totalVendas = db.get("SELECT COUNT(*) as c FROM sales WHERE seller_id = ?", [req.session.sellerId]);
  const commPct = db.getCommissionPct();
  const totalCount = db.get("SELECT COUNT(*) as c FROM wallet_transactions WHERE seller_id = ?", [req.session.sellerId]);
  const totalPages = Math.ceil((totalCount ? totalCount.c : 0) / limit);
  res.render('seller/wallet', { title: 'Minha Carteira', balance, txns, totalVendas: totalVendas ? totalVendas.c : 0, commPct, page, totalPages });
});

router.post('/sales/status/:id', requireSeller, (req, res) => {
  const { status } = req.body;
  if (['pending', 'paid', 'shipped', 'delivered', 'cancelled'].includes(status)) {
    db.run("UPDATE sales SET status = ? WHERE id = ? AND seller_id = ?", [status, req.params.id, req.session.sellerId]);
  }
  res.redirect('/seller/sales');
});

return router;
};
