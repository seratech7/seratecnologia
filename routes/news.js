const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Lista de notícias
router.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    const news = db.getNews({ category, search, limit: 50 }) || [];
    const categories = db.getNewsCategories() || [];
    const featured = db.getFeaturedNews(3) || [];
    res.render('news', {
      title: 'Notícias - Games & Hacking',
      news,
      categories,
      featured,
      selectedCategory: category || '',
      search: search || ''
    });
  } catch (e) {
    console.error('News list error:', e);
    res.render('news', { title: 'Notícias', news: [], categories: [], featured: [], selectedCategory: '', search: '' });
  }
});

// Detalhe da notícia
router.get('/:slug', (req, res) => {
  try {
    const article = db.getNewsBySlug(req.params.slug);
    if (!article) return res.status(404).render('404', { title: 'Notícia não encontrada' });
    db.incrementNewsViews(article.id);
    const related = db.getNews({ limit: 5 }).filter(n => n.id !== article.id).slice(0, 4);
    res.render('news-detail', {
      title: article.title,
      article,
      related
    });
  } catch (e) {
    console.error('News detail error:', e);
    res.status(404).render('404', { title: 'Notícia não encontrada' });
  }
});

module.exports = router;
