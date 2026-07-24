const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const path = require('path');
const fs = require('fs');
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
  if (req.file) avatar = '/uploads/' + req.file.filename;
  db.run('UPDATE sellers SET name = ?, email = ?, phone = ?, bio = ?, website = ?, whatsapp = ?, pix_key = ?, avatar = ? WHERE id = ?',
    [name, email, phone || '', bio || '', website || '', whatsapp || '', pix_key || '', avatar, req.session.sellerId]);
  req.session.sellerName = name;
  const updated = db.get('SELECT * FROM sellers WHERE id = ?', [req.session.sellerId]);
  res.render('seller/profile', { title: 'Meu Perfil', seller: updated, error: null, success: 'Perfil atualizado com sucesso!' });
});

router.get('/login', redirectIfSeller, (req, res) => {
  res.render('seller/login', { title: 'Login Vendedor', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.render('seller/login', { title: 'Login Vendedor', error: 'Preencha todos os campos' });
  const seller = db.get('SELECT * FROM sellers WHERE email = ?', [email]);
  if (!seller || !bcrypt.compareSync(password, seller.password_hash)) return res.render('seller/login', { title: 'Login Vendedor', error: 'Email ou senha inválidos' });
  if (seller.status !== 'active') return res.render('seller/login', { title: 'Login Vendedor', error: 'Sua conta foi desativada. Contate o administrador.' });
  req.session.sellerId = seller.id;
  req.session.sellerName = seller.name;
  req.session.sellerPhone = seller.whatsapp || seller.phone || '';
  res.redirect('/seller/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/seller/login');
});

router.use(requireSeller);

// ========== DASHBOARD ==========
router.get('/dashboard', (req, res) => {
  var sid = req.session.sellerId;
  var total = db.get('SELECT COUNT(*) as count FROM products WHERE seller_id = ?', [sid]) || {count:0};
  var active = db.get("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'active'", [sid]) || {count:0};
  var pending = db.get("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'pending'", [sid]) || {count:0};
  var recent = db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC LIMIT 5', [sid]);
  var rejected = db.get("SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND status = 'rejected'", [sid]) || {count:0};
  var salesSummary = db.getSellerSalesSummary(sid);
  var chartData = db.getSellerChartData(sid, 30);
  var topProducts = db.getSellerTopProducts(sid);
  var totalViews = db.getSellerProductViews(sid);
  var activeGoal = db.getActiveGoal();
  var goalProgress = activeGoal ? db.getSellerGoalProgress(sid, activeGoal) : null;
  var leaderboard = activeGoal ? db.getGoalLeaderboard(activeGoal.id) : [];
  var pendingQuestions = db.query("SELECT COUNT(*) as c FROM product_questions WHERE seller_id = ? AND (answer IS NULL OR answer = '')", [sid]);
  pendingQuestions = pendingQuestions && pendingQuestions[0] ? pendingQuestions[0].c : 0;

  res.render('seller/dashboard', {
    title: 'Meu Painel - Vendedor',
    stats: { total: total.count, active: active.count, pending: pending.count, rejected: rejected.count },
    recent, salesSummary, chartData, topProducts, totalViews, goal: goalProgress, activeGoal, leaderboard, pendingQuestions
  });
});

// ========== PRODUCTS ==========
router.get('/products', (req, res) => {
  var products = db.query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? ORDER BY p.created_at DESC', [req.session.sellerId]);
  res.render('seller/products', { title: 'Meus Produtos', products });
});

router.get('/products/new', (req, res) => {
  const categories = db.query('SELECT * FROM categories ORDER BY name');
  res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: null });
});

router.post('/products/new', upload.array('images', 5), (req, res) => {
  const { name, description, price, category_id, condition, location } = req.body;
  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome e preço são obrigatórios' });
  }
  var cleanName = (name || '').toString().trim().slice(0, 100);
  var cleanDesc = (description || '').toString().trim().slice(0, 2000);
  var cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  var cleanPrice = Math.max(0, parseFloat(price) || 0);
  if (!cleanName) { const categories = db.query('SELECT * FROM categories ORDER BY name'); return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Nome inválido' }); }
  if (cleanPrice <= 0) { const categories = db.query('SELECT * FROM categories ORDER BY name'); return res.render('seller/product-form', { title: 'Novo Produto', product: null, categories, error: 'Preço deve ser maior que zero' }); }
  var mainImage = null;
  if (req.files && req.files.length > 0) mainImage = '/uploads/' + req.files[0].filename;
  db.run('INSERT INTO products (name, description, price, category_id, seller_id, image, condition, location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cleanName, cleanDesc, cleanPrice, category_id || null, req.session.sellerId, mainImage, condition || 'new', cleanLocation, 'pending']);
  var lastId = db.get('SELECT MAX(id) as id FROM products');
  if (lastId) db.run("UPDATE products SET code = 'PROD-' || substr('00000' || ?, -5, 5) WHERE id = ?", [lastId.id, lastId.id]);
  // Save extra images
  if (req.files && req.files.length > 1 && lastId) {
    for (var i = 1; i < req.files.length; i++) {
      db.run("INSERT INTO product_images (product_id, image) VALUES (?, ?)", [lastId.id, '/uploads/' + req.files[i].filename]);
    }
  }
  try {
    var baseUrl = process.env.BASE_URL || 'https://seratecnologia-1.onrender.com';
    var prodCode = 'PROD-' + String(lastId ? lastId.id : 0).padStart(5, '0');
    var waMsg = encodeURIComponent('Acabei de cadastrar o produto ' + cleanName + ' (' + prodCode + ') no SeraTecnologia!');
    var sellerPhone = req.session.sellerPhone || '';
    var waLink = sellerPhone ? 'https://wa.me/55' + sellerPhone.replace(/\D/g, '') + '?text=' + waMsg : baseUrl + '/seller/products';
    var sellerId = req.session.sellerId ? req.session.sellerId.toString() : 'all';
    db.addNotification(sellerId, 'promo', 'Produto "' + cleanName + '" criado! Divulgue agora no WhatsApp →', 'share-alt', waLink);
  } catch(e) { /* silent */ }
  res.redirect('/seller/products');
});

router.get('/products/edit/:id', (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!product) return res.redirect('/seller/products');
  const extraImages = db.query("SELECT * FROM product_images WHERE product_id = ?", [req.params.id]);
  const categories = db.query('SELECT * FROM categories ORDER BY name');
  res.render('seller/product-form', { title: 'Editar Produto', product, categories, extraImages: extraImages || [], error: null });
});

router.post('/products/edit/:id', upload.array('images', 5), (req, res) => {
  const product = db.get('SELECT * FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!product) return res.redirect('/seller/products');
  const { name, description, price, category_id, condition, location } = req.body;
  if (!name || !price) {
    const categories = db.query('SELECT * FROM categories ORDER BY name');
    return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Nome e preço são obrigatórios' });
  }
  var cleanName = (name || '').toString().trim().slice(0, 100);
  var cleanDesc = (description || '').toString().trim().slice(0, 2000);
  var cleanLocation = (location || 'Brasil').toString().trim().slice(0, 100);
  var cleanPrice = Math.max(0, parseFloat(price) || 0);
  if (!cleanName) { const categories = db.query('SELECT * FROM categories ORDER BY name'); return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Nome inválido' }); }
  if (cleanPrice <= 0) { const categories = db.query('SELECT * FROM categories ORDER BY name'); return res.render('seller/product-form', { title: 'Editar Produto', product, categories, error: 'Preço deve ser maior que zero' }); }
  var image = product.image;
  if (req.files && req.files.length > 0) image = '/uploads/' + req.files[0].filename;
  db.run("UPDATE products SET name = ?, description = ?, price = ?, category_id = ?, image = ?, condition = ?, location = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?",
    [cleanName, cleanDesc, cleanPrice, category_id || null, image, condition || 'new', cleanLocation, req.params.id, req.session.sellerId]);
  // Save extra images
  if (req.files && req.files.length > 1) {
    for (var i = 1; i < req.files.length; i++) {
      db.run("INSERT INTO product_images (product_id, image) VALUES (?, ?)", [req.params.id, '/uploads/' + req.files[i].filename]);
    }
  }
  res.redirect('/seller/products');
});

router.post('/products/delete/:id', (req, res) => {
  var p = db.get('SELECT image FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (p && p.image) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', p.image)); } catch(e) {} }
  db.run('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  res.redirect('/seller/products');
});

router.post('/products/clone/:id', (req, res) => {
  var p = db.get('SELECT id FROM products WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!p) return res.redirect('/seller/products');
  db.cloneProduct(req.params.id);
  res.redirect('/seller/products');
});

router.post('/products/review-request/:id', (req, res) => {
  var p = db.get("SELECT id, name FROM products WHERE id = ? AND seller_id = ? AND status = 'rejected'", [req.params.id, req.session.sellerId]);
  if (!p) return res.redirect('/seller/products');
  db.run("UPDATE products SET status = 'pending' WHERE id = ?", [req.params.id]);
  db.addNotification('admin', 'review', 'Vendedor solicitou revisão do produto: ' + p.name, 'sync', '/admin/products?filter=pending');
  res.redirect('/seller/products');
});

router.post('/products/delete-image/:id', (req, res) => {
  var img = db.get("SELECT * FROM product_images WHERE id = ?", [req.params.id]);
  if (img) {
    try { fs.unlinkSync(path.join(__dirname, '..', 'public', img.image)); } catch(e) {}
    db.run("DELETE FROM product_images WHERE id = ?", [req.params.id]);
  }
  res.redirect(req.get('Referer') || '/seller/products');
});

// ========== SALES ==========
router.get('/sales', requireSeller, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;
    const total = db.get('SELECT COUNT(*) as c FROM sales WHERE seller_id = ?', [req.session.sellerId]);
    const sales = db.query('SELECT * FROM sales WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [req.session.sellerId, limit, offset]);
    const totalPages = Math.ceil((total ? total.c : 0) / limit);
    res.render('seller/sales', { title: 'Minhas Vendas', sales, page, totalPages });
  } catch(e) {
    console.error('ERRO /seller/sales:', e);
    res.status(500).send('Erro: ' + e.message);
  }
});

router.post('/sales/status/:id', requireSeller, upload.array('proof_photos', 5), (req, res) => {
  var { status, tracking_message, carrier } = req.body;
  var sale = db.get('SELECT * FROM sales WHERE id = ? AND seller_id = ?', [req.params.id, req.session.sellerId]);
  if (!sale) return res.redirect('/seller/sales');
  var validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  var trackingMap = { 'paid': 'preparing', 'shipped': 'shipped', 'delivered': 'delivered', 'cancelled': 'cancelled' };
  var statusLabels = { 'pending': 'Pendente', 'paid': 'Pago', 'shipped': 'Enviado', 'delivered': 'Entregue', 'cancelled': 'Cancelado' };
  var trackingLabels = { 'pending': 'Pendente', 'confirmed': 'Confirmado', 'preparing': 'Em separação', 'shipped': 'Despachado', 'in_transit': 'Em trânsito', 'delivered': 'Entregue', 'cancelled': 'Cancelado' };
  var requireProof = ['shipped', 'delivered', 'paid'];
  var needsPhoto = requireProof.includes(status) && (!req.files || req.files.length === 0);
  if (needsPhoto) return res.redirect('/seller/sales?error=prova_foto');
  if (validStatuses.includes(status)) {
    db.run("UPDATE sales SET status = ?, carrier = ? WHERE id = ? AND seller_id = ?", [status, carrier || '', req.params.id, req.session.sellerId]);
    if (req.files && req.files.length > 0) {
      req.files.forEach(function(file) {
        db.addSaleProof(req.params.id, req.session.sellerId, '/uploads/' + file.filename, tracking_message || '', sale.status, status);
      });
    }
    var trackingStatus = trackingMap[status] || sale.tracking_status;
    var msg = tracking_message || 'Status atualizado para: ' + (statusLabels[status] || status);
    if (carrier && status === 'shipped') msg += ' | Transportadora: ' + carrier;
    if (trackingStatus !== sale.tracking_status) db.run("UPDATE sales SET tracking_status = ? WHERE id = ?", [trackingStatus, req.params.id]);
    db.createTrackingHistory(req.params.id, trackingStatus, msg);
    var seller = db.get('SELECT name FROM sellers WHERE id = ?', [req.session.sellerId]);
    var notifyMsg = '📦 ' + (seller ? seller.name : 'Vendedor') + ' atualizou seu pedido ' + sale.product_code + '!\n\nStatus: ' + (trackingLabels[trackingStatus] || trackingStatus) + '\nMensagem: ' + msg;
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

// ========== WALLET ==========
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
  const commPct = db.getCommissionPct(req.session.sellerId);
  const totalCount = db.get("SELECT COUNT(*) as c FROM wallet_transactions WHERE seller_id = ?", [req.session.sellerId]) || {c:0};
  const totalPages = Math.ceil(totalCount.c / limit);
  const summary = db.getFinanceSummary(req.session.sellerId, startDate || '2000-01-01', endDate);
  const chartData = db.getFinanceChart(req.session.sellerId, 30);
  const payouts = db.getPayouts(req.session.sellerId, 20, 0);
  const sellerInfo = db.get('SELECT bank_info, pix_key_recebimento FROM sellers WHERE id = ?', [req.session.sellerId]);
  res.render('seller/wallet', {
    title: 'Minha Carteira', balance, txns, totalVendas: totalCount.c,
    commPct, page, totalPages, period, startDate, endDate,
    summary, chartData, payouts, sellerInfo,
    sucesso: req.query.sucesso || '', erro: req.query.erro || ''
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

// ========== COUPONS ==========
router.get('/coupons', requireSeller, (req, res) => {
  var coupons = db.query("SELECT c.* FROM coupons c WHERE c.seller_id = ? ORDER BY c.created_at DESC", [req.session.sellerId]);
  res.render('seller/coupons', { title: 'Meus Cupons', coupons, error: null });
});

router.post('/coupons/new', requireSeller, (req, res) => {
  var { code, type, value, min_order, max_uses, expires_at } = req.body;
  if (!code || !value) return res.redirect('/seller/coupons');
  try {
    db.run("INSERT INTO coupons (code, type, value, min_order, max_uses, expires_at, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [code.toUpperCase(), type || 'percentage', parseFloat(value), parseFloat(min_order) || 0, parseInt(max_uses) || 0, expires_at || null, req.session.sellerId]);
    db.logActivity('seller', req.session.sellerId, req.session.sellerName, 'create_coupon', 'Cupom criado: ' + code, 'coupon', 0, req.ip);
  } catch(e) { return res.redirect('/seller/coupons?erro=Código já existe'); }
  res.redirect('/seller/coupons');
});

router.post('/coupons/delete/:id', requireSeller, (req, res) => {
  db.run("DELETE FROM coupons WHERE id = ? AND seller_id = ?", [req.params.id, req.session.sellerId]);
  res.redirect('/seller/coupons');
});

// ========== QUESTIONS & ANSWERS ==========
router.get('/questions', requireSeller, (req, res) => {
  var questions = db.getSellerQuestions(req.session.sellerId);
  res.render('seller/questions', { title: 'Perguntas dos Clientes', questions });
});

router.post('/questions/answer/:id', requireSeller, (req, res) => {
  var { answer } = req.body;
  var q = db.get("SELECT pq.*, p.name as pname FROM product_questions pq JOIN products p ON pq.product_id = p.id WHERE pq.id = ? AND pq.seller_id = ?", [req.params.id, req.session.sellerId]);
  if (!q || !answer) return res.redirect('/seller/questions');
  db.answerQuestion(req.params.id, answer);
  res.redirect('/seller/questions');
});

// ========== EXPORT CSV ==========
router.get('/exportar-vendas', requireSeller, (req, res) => {
  var sales = db.getSellerSalesCsv(req.session.sellerId);
  var csv = 'ID,Produto,Código,Comprador,WhatsApp,Email,Valor,Status,Data\n';
  sales.forEach(function(s) {
    csv += s.id + ',"' + (s.prod_name || '').replace(/"/g, '""') + '","' + s.product_code + '","' + (s.buyer_name || '').replace(/"/g, '""') + '","' + (s.buyer_phone || '') + '","' + (s.buyer_email || '') + '",' + (s.product_price || 0) + ',"' + (s.status || '') + '","' + (s.created_at || '') + '"\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=vendas.csv');
  res.send('\ufeff' + csv);
});

// ========== SETTINGS / NOTIFICATION PREFS ==========
router.get('/configuracoes', requireSeller, (req, res) => {
  var seller = db.get('SELECT * FROM sellers WHERE id = ?', [req.session.sellerId]);
  if (!seller) return res.redirect('/seller/logout');
  res.render('seller/settings', { title: 'Configurações', seller, success: req.query.sucesso || '', error: null });
});

router.post('/configuracoes', requireSeller, (req, res) => {
  var prefs = {
    notify_email_sale: req.body.notify_email_sale === '1',
    notify_email_approve: req.body.notify_email_approve === '1',
    notify_whatsapp_sale: req.body.notify_whatsapp_sale === '1'
  };
  db.updateSellerNotifPrefs(req.session.sellerId, prefs);
  res.redirect('/seller/configuracoes?sucesso=Salvo');
});

// ========== PLACAR / SCOREBOARD ==========
router.get('/placar', requireSeller, (req, res) => {
  var activeGoal = db.getActiveGoal();
  var allGoals = db.getAllGoals();
  var leaderboard = activeGoal ? db.getGoalLeaderboard(activeGoal.id) : [];
  var myProgress = activeGoal ? db.getSellerGoalProgress(req.session.sellerId, activeGoal) : null;
  res.render('seller/placar', { title: 'Placar de Metas', activeGoal, allGoals, leaderboard, myProgress });
});

return router;
};