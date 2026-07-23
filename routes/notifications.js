const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/notificacoes', function(req, res) {
  var ip = req.ip || req.connection.remoteAddress || '';
  var page = parseInt(req.query.page) || 1;
  var limit = 30;
  var offset = (page - 1) * limit;
  var all = db.getNotifications(ip, limit, offset);
  var count = db.get("SELECT COUNT(*) as c FROM notifications WHERE ip = ?", [ip]);
  var total = count ? count.c : 0;
  var totalPages = Math.ceil(total / limit);
  var unread = db.getNotificationCount(ip);

  res.render('notificacoes', {
    title: 'Notificações',
    notifications: all,
    page: page,
    totalPages: totalPages,
    total: total,
    unread: unread
  });
});

router.get('/api/notifications', function(req, res) {
  var ip = req.ip || req.connection.remoteAddress || '';
  var unread = db.getUnreadNotifications(ip);
  var count = db.getNotificationCount(ip);
  res.json({ count: count, notifications: unread });
});

router.post('/api/notifications/read/:id', function(req, res) {
  var ip = req.ip || req.connection.remoteAddress || '';
  db.markNotificationRead(req.params.id, ip);
  res.json({ ok: true });
});

router.post('/api/notifications/read-all', function(req, res) {
  var ip = req.ip || req.connection.remoteAddress || '';
  db.markAllNotificationsRead(ip);
  res.json({ ok: true });
});

module.exports = router;