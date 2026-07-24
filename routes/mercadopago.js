const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Seller connects MP account via OAuth
router.get('/seller/mercadopago/auth', function(req, res) {
  var sellerId = req.session.sellerId;
  if (!sellerId) return res.redirect('/seller/login');

  var appId = db.get("SELECT value FROM config WHERE key = 'mp_app_id'");
  var redirectUri = (process.env.BASE_URL || 'https://seratecnologia-1.onrender.com') + '/seller/mercadopago/callback';

  if (!appId || !appId.value) {
    return res.send('Mercado Pago não configurado. O administrador precisa configurar o App ID primeiro.');
  }

  var url = 'https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=' + appId.value + '&redirect_uri=' + encodeURIComponent(redirectUri);
  res.redirect(url);
});

// Callback after seller authorizes
router.get('/seller/mercadopago/callback', function(req, res) {
  var sellerId = req.session.sellerId;
  if (!sellerId) return res.redirect('/seller/login');

  // TODO: trocar code por access_token via API do Mercado Pago
  // var code = req.query.code;
  // POST https://api.mercadolibre.com/oauth/token
  //   ?grant_type=authorization_code
  //   &client_id=APP_ID
  //   &client_secret=SECRET
  //   &code=CODE
  //   &redirect_uri=REDIRECT_URI

  res.send('Conclua a configuração do Mercado Pago no arquivo routes/mercadopago.js');
});

// Seller status (connected or not)
router.get('/api/mercadopago/status', function(req, res) {
  var sellerId = req.session.sellerId;
  if (!sellerId) return res.json({ connected: false });
  var conn = db.get('SELECT * FROM mp_connections WHERE seller_id = ?', [sellerId]);
  res.json({ connected: !!conn, sellerId: sellerId });
});

// Disconnect
router.post('/seller/mercadopago/disconnect', function(req, res) {
  var sellerId = req.session.sellerId;
  if (!sellerId) return res.redirect('/seller/login');
  db.run('DELETE FROM mp_connections WHERE seller_id = ?', [sellerId]);
  res.redirect('/seller/profile');
});

// === PAGAMENTO (placeholder) ===

router.post('/api/criar-pagamento-mp', function(req, res) {
  // TODO: criar pagamento via API do Mercado Pago com split
  // var { codigo, nome, email, documento } = req.body;
  // 1. Buscar produto + vendedor
  // 2. Buscar access_token do vendedor (mp_connections)
  // 3. Buscar commission_pct da config
  // 4. Criar preferência MP com split
  // 5. Retornar link de pagamento

  res.json({ error: 'Mercado Pago ainda não configurado. Use PIX por enquanto.' });
});

router.post('/api/webhook/mercadopago', function(req, res) {
  // TODO: receber confirmação de pagamento
  // Atualizar status da venda para "paid"
  // Notificar vendedor
  res.send('ok');
});

module.exports = router;