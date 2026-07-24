const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { gerarPixPayload, gerarQRCodeBase64 } = require('../utils/pix');

router.get('/comprar', function(req, res) {
  var produto = null;
  var codigo = req.query.codigo || '';
  if (codigo) {
    produto = db.get("SELECT p.*, c.name as category_name, c.icon as category_icon, s.name as seller_name, s.pix_key as seller_pix FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
  }
  res.render('comprar', { title: 'Compra Online', produto: produto, codigo: codigo, error: codigo && !produto ? 'Produto não encontrado' : null });
});

router.get('/api/produto/:codigo', function(req, res) {
  var p = db.get("SELECT p.id, p.name, p.price, p.image, p.code, p.location, s.pix_key as seller_pix, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [req.params.codigo]);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(p);
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