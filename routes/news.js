const express = require('express');
const router = express.Router();
const db = require('../database/db');

// API de notícias (usada pelo "Carregar mais" e filtro por tema)
router.get('/api', (req, res) => {
  try {
    const category = req.query.category || '';
    const search = req.query.search || '';
    const offset = parseInt(req.query.offset || '0', 10);
    const limit = parseInt(req.query.limit || '9', 10);
    const news = db.getNews({ category: category || undefined, search: search || undefined, limit, offset }) || [];
    const total = db.getNewsCount({ category: category || undefined, search: search || undefined });
    const hasMore = (offset + news.length) < total;
    res.json({ items: news, hasMore, total, nextOffset: offset + news.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Lista de notícias
router.get('/', (req, res) => {
  try {
    const { category, search } = req.query;
    const limit = 9;
    const cats = db.getNewsCategories() || [];
    const categoryCounts = {};
    cats.forEach(c => { categoryCounts[c.category] = db.getNewsCount({ category: c.category }); });
    const total = db.getNewsCount({ category, search });
    const news = db.getNews({ category, search, limit, offset: 0 }) || [];
    const featured = db.getFeaturedNews(3) || [];
    const hasMore = news.length < total;
    res.render('news', {
      title: 'Notícias - Games & Hacking',
      news,
      categories: cats,
      categoryCounts,
      featured,
      selectedCategory: category || '',
      search: search || '',
      initialLimit: limit,
      hasMore,
      total
    });
  } catch (e) {
    console.error('News list error:', e);
    res.render('news', { title: 'Notícias', news: [], categories: [], categoryCounts: {}, featured: [], selectedCategory: '', search: '', initialLimit: 9, hasMore: false, total: 0 });
  }
});

// Detalhe da notícia
router.get('/:slug', (req, res) => {
  try {
    const article = db.getNewsBySlug(req.params.slug);
    if (!article) return res.status(404).render('404', { title: 'Notícia não encontrada' });
    db.incrementNewsViews(article.id);
    const related = db.getNews({ limit: 5 }).filter(n => n.id !== article.id).slice(0, 4);
    const reactionRows = db.getNewsReactionCounts(article.id) || [];
    const reactions = {};
    reactionRows.forEach(r => { reactions[r.type] = r.c; });
    const userReaction = db.getUserNewsReaction(article.id, req.ip) || null;
    const base = req.protocol + '://' + req.get('host');
    const og = {
      title: article.title,
      description: (article.excerpt || '').slice(0, 200),
      image: article.image ? (article.image.indexOf('http') === 0 ? article.image : base + article.image) : base + '/img/og-default.png',
      url: base + req.originalUrl
    };
    res.render('news-detail', {
      title: article.title,
      article,
      related,
      reactions,
      userReaction,
      og
    });
  } catch (e) {
    console.error('News detail error:', e);
    res.status(404).render('404', { title: 'Notícia não encontrada' });
  }
});

// Registrar reação
router.post('/:slug/react', (req, res) => {
  try {
    const article = db.getNewsBySlug(req.params.slug);
    if (!article) return res.status(404).json({ error: 'noticia_nao_encontrada' });
    const type = (req.body && req.body.type) || (req.query && req.query.type);
    const action = (req.body && req.body.action) || 'add';
    const valid = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    if (valid.indexOf(type) < 0) return res.status(400).json({ error: 'tipo_invalido' });
    const existing = db.getUserNewsReaction(article.id, req.ip);
    if (action === 'remove') {
      db.removeNewsReaction(article.id, existing, req.ip);
    } else {
      if (existing && existing !== type) db.removeNewsReaction(article.id, existing, req.ip);
      if (!existing || existing !== type) db.addNewsReaction(article.id, type, req.ip);
    }
    const reactionRows = db.getNewsReactionCounts(article.id) || [];
    const reactions = {};
    reactionRows.forEach(r => { reactions[r.type] = r.c; });
    res.json({ ok: true, reactions });
  } catch (e) {
    console.error('News react error:', e);
    res.status(500).json({ error: 'erro_interno' });
  }
});

module.exports = router;
