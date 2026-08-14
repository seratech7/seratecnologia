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
    const reactionRows = db.getNewsReactionCounts(article.id) || [];
    const reactions = {};
    reactionRows.forEach(r => { reactions[r.type] = r.c; });
    const userReaction = db.getUserNewsReaction(article.id, req.ip) || null;
    res.render('news-detail', {
      title: article.title,
      article,
      related,
      reactions,
      userReaction
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
