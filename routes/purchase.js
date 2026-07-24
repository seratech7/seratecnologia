const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { gerarPixPayload, gerarQRCodeBase64 } = require('../utils/pix');

router.get('/comprar', function(req, res) {
  var produto = null;
  var codigo = req.query.codigo || '';
  if (codigo) {
    produto = db.get("SELECT p.*, c.name as category_name, c.icon as category_icon, s.name as seller_name, s.pix_key as seller_pix, s.phone as seller_phone, s.whatsapp as seller_whatsapp, s.id as sid FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
  }
  res.render('comprar', { title: 'Compra Online', produto: produto, codigo: codigo, error: codigo && !produto ? 'Produto não encontrado' : null });
});

router.get('/api/produto/:codigo', function(req, res) {
  var p = db.get("SELECT p.id, p.name, p.price, p.image, p.code, p.location, s.pix_key as seller_pix, s.name as seller_name, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [req.params.codigo]);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(p);
});

router.post('/api/finalizar-compra', function(req, res) {
  try {
    var { codigo, nome, documento, telefone, email, endereco } = req.body;
    if (!codigo || !nome || !documento || !telefone || !email || !endereco) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }

    var produto = db.get("SELECT p.*, s.name as seller_name, s.pix_key as seller_pix, s.whatsapp as seller_whatsapp, s.notify_whatsapp, s.notify_signal FROM products p LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!produto.seller_id) return res.status(400).json({ error: 'Produto sem vendedor' });

    db.run(
      'INSERT INTO sales (product_id, seller_id, product_code, product_name, product_price, buyer_name, buyer_document, buyer_phone, buyer_email, buyer_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [produto.id, produto.seller_id, produto.code, produto.name, produto.price, nome, documento, telefone, email, endereco]
    );

    var commPct = db.getCommissionPct();
    var commValue = produto.price * (commPct / 100);
    var sellerValue = produto.price - commValue;
    db.addTransaction(produto.seller_id, 'sale', 'Venda ' + produto.code + ' - ' + produto.name, sellerValue, 'sale', produto.id);
    db.addTransaction(0, 'commission', 'Comissão ' + commPct + '% - ' + produto.code, commValue, 'commission', produto.id);

    var vendaMsg = '🛒 NOVA VENDA!\nProduto: ' + produto.name + '\nCódigo: ' + produto.code + '\nValor: R$ ' + produto.price.toFixed(2) + '\nComprador: ' + nome + '\nWhatsApp: ' + telefone + '\nEmail: ' + email;

    db.addNotification(produto.seller_id.toString(), 'sale', 'Nova venda: ' + produto.name + ' - R$ ' + produto.price.toFixed(2), 'shopping-cart', '/seller/sales');

    if (produto.notify_whatsapp) {
      var waNum = produto.notify_whatsapp.replace(/\D/g, '');
      if (waNum) {
        var waMsg = encodeURIComponent(vendaMsg);
        db.addNotification(produto.seller_id.toString(), 'whatsapp', 'Clique para enviar notificação via WhatsApp', 'whatsapp', 'https://wa.me/' + waNum + '?text=' + waMsg);
      }
    }

    if (produto.notify_signal) {
      var sigNum = produto.notify_signal.replace(/\D/g, '');
      if (sigNum) {
        var sigMsg = encodeURIComponent(vendaMsg);
        db.addNotification(produto.seller_id.toString(), 'signal', 'Clique para enviar notificação via Signal', 'comment', 'https://signal.me/#p/' + sigNum + '?text=' + sigMsg);
      }
    }

    res.json({ success: true, message: 'Compra registrada com sucesso!' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao registrar compra' });
  }
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