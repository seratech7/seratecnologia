const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');

// Lista de produtos digitais (logins com entrega automática)
router.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    const products = db.getDigitalProducts({ category, search, active: true }) || [];
    const all = db.getDigitalProducts({ active: true }) || [];
    const destaque = db.getFeaturedDigitalProducts(20) || [];
    let featured = db.getFeaturedDigitalProducts(5) || [];
    if (featured.length < 5) {
      const extra = all.filter(function(p){ return !featured.some(function(f){ return f.id === p.id; }); }).slice(0, 5 - featured.length);
      featured = featured.concat(extra);
    }
    const categories = db.query('SELECT DISTINCT category FROM digital_products WHERE status = ? ORDER BY category', ['active']) || [];
    res.render('digital', {
      title: 'Logins & Contas - Entrega Automática',
      products,
      featured,
      destaque,
      categories,
      selectedCategory: category || '',
      search: search || ''
    });
  } catch (e) {
    console.error('Digital list error:', e);
    res.render('digital', { title: 'Logins & Contas', products: [], featured: [], categories: [], selectedCategory: '', search: '' });
  }
});

// Detalhe do produto digital
router.get('/:slug', (req, res) => {
  try {
    const product = db.getDigitalProductBySlug(req.params.slug);
    if (!product || product.status !== 'active') return res.status(404).render('404', { title: 'Produto não encontrado' });
    const inStock = db.getDigitalAvailableCount(product.id) > 0;
    res.render('digital-detail', {
      title: product.name,
      product,
      inStock,
      error: null
    });
  } catch (e) {
    console.error('Digital detail error:', e);
    res.status(404).render('404', { title: 'Produto não encontrado' });
  }
});

// Checkout / compra
router.post('/:slug/comprar', (req, res) => {
  try {
    const product = db.getDigitalProductBySlug(req.params.slug);
    if (!product || product.status !== 'active') return res.status(404).render('404', { title: 'Produto não encontrado' });

    const { buyer_name, buyer_email, buyer_phone } = req.body;
    if (!buyer_email || !buyer_name) {
      const inStock = db.getDigitalAvailableCount(product.id) > 0;
      return res.render('digital-detail', {
        title: product.name,
        product,
        inStock,
        error: 'Nome e e-mail são obrigatórios.'
      });
    }

    const available = db.getAvailableDigitalStock(product.id);
    if (!available) {
      const inStock = db.getDigitalAvailableCount(product.id) > 0;
      return res.render('digital-detail', {
        title: product.name,
        product,
        inStock,
        error: 'Esgotado no momento.'
      });
    }

    const deliveryCode = 'ENT' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const saleId = db.createDigitalSale({
      product_id: product.id,
      stock_id: available.id,
      buyer_name: String(buyer_name).slice(0, 120),
      buyer_email: String(buyer_email).slice(0, 160),
      buyer_phone: String(buyer_phone || '').slice(0, 40),
      price: product.price,
      delivery_code: deliveryCode,
      status: 'confirmed'
    });

    db.markDigitalStockSold(available.id, saleId);
    db.incrementDigitalSold(product.id);

    res.redirect('/entrega/' + deliveryCode);
  } catch (e) {
    console.error('Digital checkout error:', e);
    res.status(500).render('404', { title: 'Erro ao processar compra' });
  }
});

module.exports = router;
