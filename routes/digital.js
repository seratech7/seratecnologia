const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const mp = require('../lib/mercadopago');

// Lista de produtos digitais (logins com entrega automática)
router.get('/', (req, res) => {
  try {
    const { category, search, sort, instock } = req.query;
    const inStock = instock === '1' || instock === 'on';
    const products = db.getDigitalProducts({ category, search, sort, instock: inStock, active: true }) || [];
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
      search: search || '',
      sort: sort || '',
      instock: inStock ? '1' : ''
    });
  } catch (e) {
    console.error('Digital list error:', e);
    res.render('digital', { title: 'Logins & Contas', products: [], featured: [], categories: [], selectedCategory: '', search: '', sort: '', instock: '' });
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

// Checkout / compra -> cria venda PENDENTE + preferencia Mercado Pago (retorna JSON)
router.post('/:slug/comprar', async (req, res) => {
  try {
    const product = db.getDigitalProductBySlug(req.params.slug);
    if (!product || product.status !== 'active') return res.status(404).json({ ok: false, error: 'Produto não encontrado.' });

    const { buyer_name, buyer_email, buyer_phone, delivery_channel, delivery_contact, observation } = req.body;
    if (!buyer_email || !buyer_name) {
      return res.status(400).json({ ok: false, error: 'Nome e e-mail são obrigatórios.' });
    }

    const available = db.getAvailableDigitalStock(product.id);
    if (!available) {
      return res.status(400).json({ ok: false, error: 'Esgotado no momento.' });
    }

    const deliveryCode = 'ENT' + crypto.randomBytes(6).toString('hex').toUpperCase();

    if (!mp.enabled()) {
      return res.status(400).json({ ok: false, error: 'Pagamento indisponível no momento (Mercado Pago desativado).' });
    }

    // Gera a preferência no MP ANTES de criar a venda, para não deixar venda órfã
    let pref;
    try {
      pref = await mp.createPreference({
        title: product.name,
        price: product.price,
        payerEmail: buyer_email,
        externalRef: deliveryCode
      });
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'Não foi possível gerar o pagamento: ' + e.message });
    }

    const saleId = db.createDigitalSale({
      product_id: product.id,
      stock_id: available.id,
      buyer_name: String(buyer_name).slice(0, 120),
      buyer_email: String(buyer_email).slice(0, 160),
      buyer_phone: String(buyer_phone || '').slice(0, 40),
      delivery_channel: String(delivery_channel || 'email').slice(0, 20),
      delivery_contact: String(delivery_contact || '').slice(0, 160),
      observation: String(observation || '').slice(0, 500),
      price: product.price,
      delivery_code: deliveryCode,
      status: 'pending_payment',
      payment_status: 'pending'
    });

    // Reserva o estoque para evitar venda duplicada
    db.markDigitalStockSold(available.id, saleId);
    db.updateDigitalSalePayment(saleId, { mp_preference_id: pref.id });

    const creds = mp.getCreds();
    res.json({
      ok: true,
      saleId: saleId,
      deliveryCode: deliveryCode,
      preferenceId: pref.id,
      publicKey: creds.publicKey,
      initPoint: pref.init_point || pref.sandbox_init_point
    });
  } catch (e) {
    console.error('Digital checkout error:', e);
    res.status(500).json({ ok: false, error: 'Erro ao processar compra.' });
  }
});

// Status da venda (polling do front + sincroniza com MP quando pendente)
router.get('/api/digital/venda/:code/status', async (req, res) => {
  try {
    const sale = db.getDigitalSaleByDeliveryCode(req.params.code);
    if (!sale) return res.status(404).json({ ok: false });
    if ((sale.payment_status === 'pending' || !sale.payment_status) && mp.enabled()) {
      try {
        const payments = await mp.getPaymentsByExternalRef(sale.delivery_code);
        if (payments.length) {
          const p = payments.sort(function (a, b) { return (b.date_created || '').localeCompare(a.date_created || ''); })[0];
          await mp.applyPayment(sale, p);
        }
      } catch (e) { /* ignora erro de sincronizacao */ }
    }
    const refreshed = db.getDigitalSaleByDeliveryCode(req.params.code);
    res.json({ ok: true, payment_status: refreshed.payment_status, status: refreshed.status });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
