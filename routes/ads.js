const express = require('express');
const router = express.Router();
const db = require('../database/db');

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
    text: ad.text,
    link: ad.link,
    image: ad.image,
    display_duration: ad.display_duration || 15,
    cooldown: ad.cooldown || 86400
  });
});

module.exports = router;
