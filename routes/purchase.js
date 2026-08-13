const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { gerarPixPayload, gerarQRCodeBase64 } = require('../utils/pix');
const { encryptField } = require('../utils/crypto');

router.get('/comprar', function(req, res) {
  var produto = null;
  var codigo = req.query.codigo || '';
  var cupom = req.query.cupom || '';
  var desconto = 0;

  if (codigo) {
    produto = db.get("SELECT p.*, c.name as category_name, c.icon as category_icon, s.name as seller_name, s.pix_key as seller_pix, s.phone as seller_phone, s.whatsapp as seller_whatsapp, s.id as sid FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);

    if (produto && cupom) {
      var coupon = db.getCoupon(cupom);
      if (coupon && (!coupon.seller_id || coupon.seller_id === produto.sid) && produto.price >= (coupon.min_order || 0)) {
        desconto = coupon.type === 'percentage' ? produto.price * (coupon.value / 100) : coupon.value;
        if (desconto > produto.price) desconto = produto.price;
      }
    }
  }

  res.render('comprar', {
    title: 'Compra Online',
    produto: produto,
    codigo: codigo,
    cupom: cupom,
    desconto: desconto,
    error: codigo && !produto ? 'Produto não encontrado' : null
  });
});

router.get('/api/produto/:codigo', function(req, res) {
  var p = db.get("SELECT p.id, p.name, p.price, p.image, p.code, p.location, p.quantity, s.pix_key as seller_pix, s.name as seller_name, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [req.params.codigo]);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(p);
});

router.post('/api/finalizar-compra', function(req, res) {
  try {
    var { codigo, nome, documento, telefone, email, endereco, cupom } = req.body;
    if (!codigo || !nome || !documento || !telefone || !email || !endereco) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }
    nome = String(nome).trim().slice(0, 200);
    documento = String(documento).replace(/[^0-9.\-\/]/g, '').slice(0, 20);
    telefone = String(telefone).replace(/[^0-9+\-\s()]/g, '').slice(0, 30);
    email = String(email).trim().toLowerCase().slice(0, 200);
    endereco = String(endereco).trim().slice(0, 500);
    if (email.length < 3 || !email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    var produto = db.get("SELECT p.*, s.name as seller_name, s.pix_key as seller_pix, s.whatsapp as seller_whatsapp, s.notify_whatsapp FROM products p LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!produto.seller_id) return res.status(400).json({ error: 'Produto sem vendedor' });
    if ((produto.quantity || 0) <= 0) return res.status(400).json({ error: 'Produto sem estoque disponível' });

    // Apply coupon discount
    var finalPrice = produto.price;
    if (cupom) {
      var coupon = db.getCoupon(cupom);
      if (coupon && (!coupon.seller_id || coupon.seller_id === produto.seller_id) && finalPrice >= (coupon.min_order || 0)) {
        var disc = coupon.type === 'percentage' ? finalPrice * (coupon.value / 100) : coupon.value;
        if (disc > finalPrice) disc = finalPrice;
        finalPrice = Math.round((finalPrice - disc) * 100) / 100;
        db.incrementCoupon(coupon.id);
      }
    }

    db.run(
      'INSERT INTO sales (product_id, seller_id, product_code, product_name, product_price, buyer_name, buyer_document, buyer_phone, buyer_email, buyer_address, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [produto.id, produto.seller_id, produto.code, produto.name, finalPrice, nome, encryptField(documento), telefone, email, encryptField(endereco), req.session.customerId || null]
    );

    var lastSale = db.get('SELECT MAX(id) as id FROM sales');
    var saleId = lastSale ? lastSale.id : 0;

    var trackingCode = db.gerarCodigoRastreio();
    db.run("UPDATE sales SET tracking_code = ?, tracking_status = 'confirmed' WHERE id = ?", [trackingCode, saleId]);
    db.createTrackingHistory(saleId, 'confirmed', 'Pedido confirmado e pagamento recebido');

    var commPct = db.getCommissionPct(produto.seller_id);
    var commValue = Math.round(finalPrice * (commPct / 100) * 100) / 100;
    var sellerValue = Math.round((finalPrice - commValue) * 100) / 100;
    db.addTransaction(produto.seller_id, 'sale', 'Venda ' + produto.code + ' - ' + produto.name, sellerValue, 'sale', saleId);
    db.addTransaction(0, 'commission', 'Comissão ' + commPct + '% - ' + produto.code, commValue, 'commission', saleId);

    var vendaMsg = '🛒 NOVA VENDA!\nProduto: ' + produto.name + '\nCódigo: ' + produto.code + '\nValor: R$ ' + finalPrice.toFixed(2) + '\nComprador: ' + nome + '\nWhatsApp: ' + telefone + '\nEmail: ' + email;

    db.addNotification(produto.seller_id.toString(), 'sale', 'Nova venda: ' + produto.name + ' - R$ ' + finalPrice.toFixed(2), 'shopping-cart', '/seller/sales');

    res.json({ success: true, message: 'Compra registrada com sucesso!', trackingCode: trackingCode, saleId: saleId });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao registrar compra' });
  }
});

router.get('/rastreio', function(req, res) {
  var code = req.query.codigo || '';
  var sale = null;
  var history = [];
  if (code) {
    var raw = db.getSaleByTrackingCode(code);
    if (raw) {
      history = db.getTrackingHistory(raw.id);
      sale = {
        id: raw.id,
        tracking_code: raw.tracking_code,
        tracking_status: raw.tracking_status,
        tracking_estimated_days: raw.tracking_estimated_days,
        status: raw.status,
        product_code: raw.product_code,
        product_name: raw.product_name,
        product_price: raw.product_price,
        product_image: raw.product_image,
        seller_name: raw.seller_name,
        created_at: raw.created_at
      };
    }
  }
  res.render('rastreio', { title: 'Rastrear Pedido', sale: sale, history: history, code: code, error: code && !sale ? 'Informe um código de rastreio válido' : null });
});

router.get('/api/rastreio/:codigo', function(req, res) {
  var sale = db.getSaleByTrackingCode(req.params.codigo);
  if (!sale) return res.status(404).json({ error: 'Não encontrado' });
  var history = db.getTrackingHistory(sale.id);
  // Whitelist: never expose buyer PII (name, CPF, phone, email, address) via this endpoint
  res.json({
    sale: {
      id: sale.id,
      tracking_code: sale.tracking_code,
      tracking_status: sale.tracking_status,
      tracking_estimated_days: sale.tracking_estimated_days,
      status: sale.status,
      product_code: sale.product_code,
      product_name: sale.product_name,
      product_price: sale.product_price,
      product_image: sale.product_image,
      seller_name: sale.seller_name,
      created_at: sale.created_at
    },
    history: history
  });
});

router.post('/api/gerar-pix', async function(req, res) {
  try {
    var { codigo, nome, cidade } = req.body;
    if (!codigo) return res.status(400).json({ error: 'Código do produto é obrigatório' });

    var produto = db.get("SELECT p.*, s.name as seller_name, s.pix_key as seller_pix FROM products p LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

    var chavePix = produto.seller_pix || '';
    var nomeVendedor = produto.seller_name || 'Vendedor';
    var valor = produto.price;
    var cidadeVendedor = (produto.location || 'Brasil').split(',')[0].trim();

    if (!chavePix) {
      return res.status(400).json({ error: 'Vendedor ainda não configurou chave PIX', sellerName: nomeVendedor });
    }

    var descricao = 'Compra ' + produto.code + ' - ' + produto.name;
    var payload = gerarPixPayload(chavePix, valor, nomeVendedor, cidadeVendedor, descricao);
    var qrcode = await gerarQRCodeBase64(payload);

    res.json({
      qrcode: qrcode,
      payload: payload,
      chave: chavePix,
      valor: valor,
      sellerName: nomeVendedor
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gerar PIX' });
  }
});

module.exports = router;