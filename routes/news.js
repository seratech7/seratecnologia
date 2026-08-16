const express = require('express');
const router = express.Router();
const db = require('../database/db');

// API de notícias (usada pelo "Carregar mais" e filtro por tema)
router.get('/api', (req, res) => {
  try {
    const category = req.query.category || '';
    const search = req.query.search || '';
    const onlyVideo = req.query.video === '1';
    const offset = parseInt(req.query.offset || '0', 10);
    const limit = parseInt(req.query.limit || '9', 10);
    const opts = { limit, offset };
    if (category) opts.category = category;
    if (search) opts.search = search;
    if (onlyVideo) opts.video = true;
    const news = db.getNews(opts) || [];
    const countOpts = {};
    if (category) countOpts.category = category;
    if (search) countOpts.search = search;
    if (onlyVideo) countOpts.video = true;
    const total = db.getNewsCount(countOpts);
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
    const videos = db.getNews({ video: true, limit: 4 }) || [];
    const trending = db.getNews({ limit: 5, orderByViews: true }) || [];
    const bsRow = db.get("SELECT value FROM config WHERE key = 'news_banner_speed'");
    const bannerSpeed = bsRow ? (parseInt(bsRow.value) || 7) : 7;
    const hasMore = news.length < total;
    res.render('news', {
      title: 'Notícias - Games & Hacking',
      news,
      categories: cats,
      categoryCounts,
      featured,
      featuredNews: db.getFeaturedNews(5) || [],
      videos,
      trending,
      bannerSpeed: bannerSpeed,
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
      image: article.image && article.image.indexOf('/') === 0 ? (base + article.image) : (base + '/img/news-thumb?cat=' + encodeURIComponent(article.category || 'Geral') + '&w=800&h=500'),
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
