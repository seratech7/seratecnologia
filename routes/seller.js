const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { requireSeller, redirectIfSeller } = require('../middleware/auth');
const { sendTrackingUpdate } = require('../utils/email');

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
  const period = req.query.period || 'all';
  var startDate = '', endDate = new Date().toISOString().slice(0,10);
  if (period === '7d') startDate = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  else if (period === '30d') startDate = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  else if (period === '90d') startDate = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
  else if (period === '12m') startDate = new Date(Date.now() - 365*86400000).toISOString().slice(0,10);

  const balance = db.getWalletBalance(req.session.sellerId);
  const txns = db.getWalletTransactions(req.session.sellerId, limit, offset);
  const totalVendas = db.get("SELECT COUNT(*) as c FROM sales WHERE seller_id = ?", [req.session.sellerId]);
  const commPct = db.getCommissionPct(req.session.sellerId);
  const totalCount = db.get("SELECT COUNT(*) as c FROM wallet_transactions WHERE seller_id = ?", [req.session.sellerId]);
  const totalPages = Math.ceil((totalCount ? totalCount.c : 0) / limit);
  const summary = db.getFinanceSummary(req.session.sellerId, startDate || '2000-01-01', endDate);
  const chartData = db.getFinanceChart(req.session.sellerId, 30);
  const payouts = db.getPayouts(req.session.sellerId, 20, 0);
  const sellerInfo = db.get('SELECT bank_info, pix_key_recebimento FROM sellers WHERE id = ?', [req.session.sellerId]);

  res.render('seller/wallet', {
    title: 'Minha Carteira',
    balance, txns, totalVendas: totalVendas ? totalVendas.c : 0,
    commPct, page, totalPages, period, startDate, endDate,
    summary, chartData, payouts, sellerInfo
  });
});

router.post('/wallet/solicitar-saque', requireSeller, (req, res) => {
  var { amount, bank_info, payment_method } = req.body;
  var val = parseFloat(amount);
  var balance = db.getWalletBalance(req.session.sellerId);
  if (val <= 0) return res.redirect('/seller/wallet?erro=Valor inválido');
  if (val > balance) return res.redirect('/seller/wallet?erro=Saldo insuficiente');
  if (val < 10) return res.redirect('/seller/wallet?erro=Valor mínimo é R$ 10,00');
  db.createPayout(req.session.sellerId, val, bank_info || '', payment_method || 'pix');
  db.addNotification('admin', 'payout', 'Saque solicitado: ' + req.session.sellerName + ' - R$ ' + val.toFixed(2), 'money-bill', '/admin/financeiro');
  res.redirect('/seller/wallet?sucesso=Saque solicitado com sucesso');
});

router.post('/sales/status/:id', requireSeller, (req, res) => {
  var { status, tracking_message } = req.body;
  var sale = db.get('SELECT * FROM sales WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!sale) return res.redirect('/seller/sales');

  var validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  var trackingMap = { 'paid': 'preparing', 'shipped': 'shipped', 'delivered': 'delivered', 'cancelled': 'cancelled' };
  var statusLabels = { 'pending': 'Pendente', 'paid': 'Pago', 'shipped': 'Enviado', 'delivered': 'Entregue', 'cancelled': 'Cancelado' };
  var trackingLabels = { 'pending': 'Pendente', 'confirmed': 'Confirmado', 'preparing': 'Em separação', 'shipped': 'Despachado', 'in_transit': 'Em trânsito', 'delivered': 'Entregue', 'cancelled': 'Cancelado' };

  if (validStatuses.includes(status)) {
    db.run("UPDATE sales SET status = ? WHERE id = ? AND seller_id = ?", [status, req.params.id, req.session.sellerId]);

    var trackingStatus = trackingMap[status] || sale.tracking_status;
    var msg = tracking_message || 'Status atualizado para: ' + (statusLabels[status] || status);

    if (trackingStatus !== sale.tracking_status) {
      db.run("UPDATE sales SET tracking_status = ? WHERE id = ?", [trackingStatus, req.params.id]);
    }
    db.createTrackingHistory(req.params.id, trackingStatus, msg);

    var seller = db.get('SELECT name FROM sellers WHERE id = ?', [req.session.sellerId]);
    var notifyMsg = '📦 ' + (seller ? seller.name : 'Vendedor') + ' atualizou seu pedido ' + sale.product_code + '!\n\nStatus: ' + (trackingLabels[trackingStatus] || trackingStatus) + '\nMensagem: ' + msg + '\n\nAcompanhe: https://seratecnologia-1.onrender.com/rastreio?codigo=' + sale.tracking_code;

    db.addNotification('customer_' + sale.id, 'tracking', notifyMsg, 'truck', '/rastreio?codigo=' + sale.tracking_code);

    var waNum = sale.buyer_phone.replace(/\D/g, '');
    if (waNum) {
      var waLink = 'https://wa.me/55' + waNum + '?text=' + encodeURIComponent(notifyMsg);
      db.addNotification('customer_' + sale.id, 'whatsapp', 'Clique para notificar ' + sale.buyer_name + ' via WhatsApp', 'whatsapp', waLink);
    }

    sendTrackingUpdate(sale, trackingLabels[trackingStatus] || trackingStatus, msg);
  }

  res.redirect('/seller/sales');
});

return router;
};
