const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', (req, res) => {
  const { search, category, condition: cond, price_min, price_max, sort } = req.query;
  const categories = db.query('SELECT * FROM categories ORDER BY name');

  let sql = 'SELECT p.*, c.name as category_name, c.icon as category_icon FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = ?';
  let params = ['active'];

  if (search) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    sql += ' AND c.slug = ?';
    params.push(category);
  }

  if (cond) {
    sql += ' AND p.condition = ?';
    params.push(cond);
  }

  if (price_min) {
    sql += ' AND p.price >= ?';
    params.push(parseFloat(price_min));
  }

  if (price_max) {
    sql += ' AND p.price <= ?';
    params.push(parseFloat(price_max));
  }

  let orderBy = 'p.featured DESC, p.created_at DESC';
  if (sort === 'price_asc') orderBy = 'p.price ASC';
  else if (sort === 'price_desc') orderBy = 'p.price DESC';
  else if (sort === 'oldest') orderBy = 'p.created_at ASC';
  sql += ' ORDER BY ' + orderBy;

  const products = db.query(sql, params);

  res.render('index', {
    title: 'SeraTecnologia',
    products,
    categories,
    search: search || '',
    selectedCategory: category || '',
    selectedCondition: cond || '',
    priceMin: price_min || '',
    priceMax: price_max || '',
    selectedSort: sort || ''
  });
});

router.get('/produto/:id', (req, res) => {
  const product = db.get(
    'SELECT p.*, c.name as category_name, c.icon as category_icon FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?',
    [req.params.id]
  );

  if (!product) return res.status(404).render('404', { title: 'Produto não encontrado' });

  let seller = null;
  if (product.seller_id) {
    seller = db.get(
      'SELECT id, name, avatar, sales_count FROM sellers WHERE id = ? AND status = ?',
      [product.seller_id, 'active']
    );
  }

  const rating = db.get(
    'SELECT COUNT(*) as count, AVG(rating) as avg FROM reviews WHERE product_id = ?',
    [product.id]
  );

  const reviews = db.query(
    'SELECT rating, comment, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 10',
    [product.id]
  );

  const related = db.query(
    'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.category_id = ? AND p.id != ? AND p.status = ? LIMIT 4',
    [product.category_id, product.id, 'active']
  );

  res.render('product', {
    title: product.name,
    product,
    seller,
    rating,
    reviews,
    related,
    userRating: null
  });
});

router.post('/produto/:id/avaliar', (req, res) => {
  const { rating, comment } = req.body;
  const productId = req.params.id;

  const product = db.get('SELECT p.*, s.id as sid FROM products p LEFT JOIN sellers s ON p.seller_id = s.id WHERE p.id = ?', [productId]);
  if (!product || !product.sid) {
    return res.status(404).json({ error: 'Produto ou vendedor não encontrado' });
  }

  const stars = parseInt(rating);
  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Avaliação deve ser entre 1 e 5 estrelas' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

  const existing = db.get(
    'SELECT id FROM reviews WHERE product_id = ? AND reviewer_ip = ?',
    [productId, ip]
  );

  if (existing) {
    db.run('UPDATE reviews SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?',
      [stars, (comment || '').toString().trim().slice(0, 500), existing.id]);
  } else {
    db.run(
      'INSERT INTO reviews (product_id, seller_id, rating, comment, reviewer_ip) VALUES (?, ?, ?, ?, ?)',
      [productId, product.sid, stars, (comment || '').toString().trim().slice(0, 500), ip]
    );
  }

  res.redirect('/produto/' + productId);
});

module.exports = router;
