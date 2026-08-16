const express = require('express');
const router = express.Router();
const db = require('../database/db');
const mpLib = require('../lib/mercadopago');

// Seller connects MP account via OAuth
router.get('/seller/mercadopago/auth', function(req, res) {
  var sellerId = req.session.sellerId;
  if (!sellerId) return res.redirect('/seller/login');
  if (db.getToggle('mercado_pago') !== '1') return res.send('Mercado Pago está desativado pelo administrador.');

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
  if (db.getToggle('mercado_pago') !== '1') return res.json({ error: 'Mercado Pago está desativado pelo administrador. Use PIX por enquanto.' });
  res.json({ error: 'Mercado Pago ainda não configurado. Use PIX por enquanto.' });
});

router.post('/api/webhook/mercadopago', async function(req, res) {
  try {
    // MP envia topic/id tanto no query string quanto no corpo JSON
    var topic = (req.query && req.query.topic) || (req.body && (req.body.topic || req.body.type)) || '';
    var resourceId = (req.query && req.query.id) || (req.body && req.body.data && req.body.data.id) || (req.body && req.body.id) || null;

    if (topic === 'payment' && resourceId) {
      var payment = await mpLib.getPayment(resourceId);
      var extRef = payment && payment.external_reference;
      if (extRef) {
        var sale = db.getDigitalSaleByDeliveryCode(extRef);
        if (sale) await mpLib.applyPayment(sale, payment);
      }
    } else if (topic === 'merchant_order' && resourceId) {
      // Ordem de pagamento: busca os pagamentos nela contidos e aplica cada um
      var order = await mpLib.getMerchantOrder(resourceId);
      if (order && Array.isArray(order.payments)) {
        for (var i = 0; i < order.payments.length; i++) {
          var p = await mpLib.getPayment(order.payments[i].id);
          var er = p && p.external_reference;
          if (er) {
            var s = db.getDigitalSaleByDeliveryCode(er);
            if (s) await mpLib.applyPayment(s, p);
          }
        }
      }
    }
  } catch (e) {
    console.error('[MP webhook] erro:', e.message);
  }
  res.send('ok');
});

module.exports = router;