const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/:id', (req, res) => {
  const seller = db.get(
    'SELECT id, name, email, phone, bio, avatar, sales_count, website, whatsapp, created_at FROM sellers WHERE id = ? AND status = ?',
    [req.params.id, 'active']
  );

  if (!seller) return res.status(404).render('404', { title: 'Vendedor não encontrado' });

  const daysOnPlatform = Math.floor((Date.now() - new Date(seller.created_at).getTime()) / (1000 * 60 * 60 * 24));

  const rating = db.get(
    'SELECT COUNT(*) as count, AVG(rating) as avg FROM reviews WHERE seller_id = ?',
    [req.params.id]
  );

  const products = db.query(
    'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.seller_id = ? AND p.status = ? ORDER BY p.created_at DESC',
    [req.params.id, 'active']
  );

  const totalProducts = products.length;

  res.render('seller-profile', {
    title: seller.name,
    seller,
    daysOnPlatform,
    rating,
    products,
    totalProducts
  });
});

module.exports = router;
