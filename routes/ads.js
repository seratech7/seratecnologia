const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Sanitize HTML: strip script tags, event handlers, javascript: links
function sanitizeAdHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")
    .replace(/href\s*=\s*javascript:[^\s>]+/gi, 'href="#"');
}

router.get('/ads', (req, res) => {
  const now = new Date().toISOString();
  const ads = db.query(
    `SELECT * FROM ads WHERE status = 'active'
     AND (start_date IS NULL OR start_date <= ?)
     AND (end_date IS NULL OR end_date >= ?)
     ORDER BY sort_order ASC, id ASC`,
    [now, now]
  );
  if (ads.length === 0) return res.json(null);
  const ad = ads[Math.floor(Math.random() * ads.length)];
  res.json({
    id: ad.id,
    title: ad.title,
    text: sanitizeAdHtml(ad.text),
    link: ad.link || '',
    image: ad.image,
    display_duration: ad.display_duration || 15,
    cooldown: ad.cooldown || 86400
  });
});

module.exports = router;
