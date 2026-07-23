const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', (req, res) => {
  const { search, category, condition: cond } = req.query;
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

  sql += ' ORDER BY p.featured DESC, p.created_at DESC';

  const products = db.query(sql, params);

  res.render('index', {
    title: 'SeraTecnologia',
    products,
    categories,
    search: search || '',
    selectedCategory: category || '',
    selectedCondition: cond || ''
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

  const related = db.query(
    'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.category_id = ? AND p.id != ? AND p.status = ? LIMIT 4',
    [product.category_id, product.id, 'active']
  );

  res.render('product', { title: product.name, product, seller, related });
});

module.exports = router;
