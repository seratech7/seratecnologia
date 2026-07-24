const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/comprar', function(req, res) {
  var produto = null;
  var codigo = req.query.codigo || '';
  if (codigo) {
    produto = db.get("SELECT p.*, c.name as category_name, c.icon as category_icon, s.name as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.code = ? AND p.status = 'active'", [codigo]);
  }
  res.render('comprar', { title: 'Compra Online', produto: produto, codigo: codigo, error: codigo && !produto ? 'Produto não encontrado' : null });
});

router.get('/api/produto/:codigo', function(req, res) {
  var p = db.get("SELECT p.id, p.name, p.price, p.image, p.code, p.location, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.code = ? AND p.status = 'active'", [req.params.codigo]);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(p);
});

module.exports = router;