const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');

function reqPromise(url, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = { method, hostname: u.hostname, path: u.pathname + u.search, headers };
    if (data) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = mod.request(opts, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// WhatsApp client (shared across routes)
let WA_CLIENT = null;
let WA_READY = false;
let WA_QR = '';

async function getWaClient() {
  if (WA_CLIENT && WA_READY) return WA_CLIENT;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const sessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');
    WA_CLIENT = new Client({
      authStrategy: new LocalAuth({ clientId: 'admin', dataPath: sessionPath }),
      puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], headless: true }
    });
    WA_CLIENT.on('qr', qr => { WA_QR = qr; WA_READY = false; });
    WA_CLIENT.on('ready', () => { WA_READY = true; WA_QR = ''; });
    WA_CLIENT.on('disconnected', () => { WA_READY = false; });
    WA_CLIENT.on('auth_failure', () => { WA_READY = false; });
    await WA_CLIENT.initialize();
    return WA_CLIENT;
  } catch (e) { return null; }
}

function destroyWaClient() {
  if (WA_CLIENT) { try { WA_CLIENT.destroy(); } catch (e) {} WA_CLIENT = null; WA_READY = false; WA_QR = ''; }
}

module.exports = function() {
  const router = express.Router();
  router.use(requireAdmin);
  const db = require('../database/db');

  // === DASHBOARD PRINCIPAL ===
  router.get('/marketing', (req, res) => {
    const waStats = db.getWaStats();
    const msgCount = db.getWaMessagesCount();
    const contactCount = db.getWaContactsCount();
    const sellerCount = (db.get("SELECT COUNT(*) as c FROM sellers")||{}).c||0;
    const buyerCount = (db.get("SELECT COUNT(DISTINCT buyer_email) as c FROM sales WHERE buyer_email != ''")||{}).c||0;
    res.render('admin/marketing/index', {
      title: 'Marketing - Painel Admin', currentPath: '/admin/marketing',
      waReady: WA_READY, waQr: WA_QR,
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      emailConfigured: !!process.env.SENDGRID_API_KEY,
      msgCount, contactCount, sellerCount, buyerCount,
      error: null, success: null
    });
  });

  // ============================================================
  //  WHATSAPP
  // ============================================================
  router.get('/marketing/whatsapp', (req, res) => {
    const stats = db.getWaStats();
    const recent = db.getWaMessages(10, 0);
    const contacts = db.getWaContacts();
    res.render('admin/marketing/whatsapp', {
      title: 'WhatsApp Marketing', currentPath: '/admin/marketing/whatsapp',
      stats, recent, contacts, waReady: WA_READY, waQr: WA_QR,
      error: null, success: null
    });
  });

  router.post('/marketing/whatsapp/connect', async (req, res) => {
    if (WA_READY) return res.redirect('/admin/marketing/whatsapp');
    destroyWaClient();
    await getWaClient();
    res.redirect('/admin/marketing/whatsapp');
  });

  router.post('/marketing/whatsapp/disconnect', (req, res) => {
    destroyWaClient();
    try { const d = path.join(process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session'), 'admin'); if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    res.redirect('/admin/marketing/whatsapp');
  });

  router.get('/marketing/whatsapp/qr', (req, res) => res.json({ qr: WA_QR, ready: WA_READY }));

  router.post('/marketing/whatsapp/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!WA_READY) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('WhatsApp desconectado'));
    if (!phone || !message) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('Preencha telefone e mensagem'));
    try {
      await WA_CLIENT.sendMessage(phone.replace(/\D/g, '') + '@c.us', message);
      db.addWaMessage(phone.replace(/\D/g, ''), '', message, 'sent');
      res.redirect('/admin/marketing/whatsapp?success=' + encodeURIComponent('Enviado para ' + phone));
    } catch (e) {
      db.addWaMessage(phone, '', message, 'failed');
      res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('Erro: ' + e.message));
    }
  });

  router.post('/marketing/whatsapp/contacts/add', (req, res) => {
    const { name, phone, notes } = req.body;
    if (!phone) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('Telefone obrigatório'));
    db.addWaContact(name||'', phone.replace(/\D/g, ''), notes||'');
    res.redirect('/admin/marketing/whatsapp?success=' + encodeURIComponent('Contato adicionado'));
  });

  router.post('/marketing/whatsapp/contacts/delete/:id', (req, res) => {
    db.deleteWaContact(req.params.id);
    res.redirect('/admin/marketing/whatsapp?success=Contato removido');
  });

  router.post('/marketing/whatsapp/contacts/import', (req, res) => {
    const { csv } = req.body;
    if (!csv) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('Cole os dados'));
    const lines = csv.split('\n').filter(Boolean);
    const parsed = [];
    lines.forEach(line => {
      const parts = line.split(/[,;\t]/);
      if (parts.length >= 1) {
        const p = parts[0].trim().replace(/\D/g, '');
        if (p.length >= 10) parsed.push({ name: parts[1]?.trim() || '', phone: p, notes: parts[2]?.trim() || '' });
      }
    });
    const count = db.importWaContacts(parsed);
    res.redirect('/admin/marketing/whatsapp?success=' + count + ' contatos importados');
  });

  router.post('/marketing/whatsapp/send-all', async (req, res) => {
    const { message } = req.body;
    if (!WA_READY) return res.redirect('/admin/marketing/whatsapp?error=WhatsApp desconectado');
    if (!message) return res.redirect('/admin/marketing/whatsapp?error=Digite a mensagem');
    const contacts = db.getWaContacts();
    let sent = 0, failed = 0;
    for (const c of contacts) {
      try {
        const cleaned = c.phone.replace(/\D/g, '');
        if (cleaned.length >= 10) { await WA_CLIENT.sendMessage(cleaned + '@c.us', message); db.addWaMessage(cleaned, c.name, message, 'sent'); sent++; }
      } catch (e) { db.addWaMessage(c.phone, c.name, message, 'failed'); failed++; }
      await new Promise(r => setTimeout(r, 3000));
    }
    res.redirect('/admin/marketing/whatsapp?success=' + sent + ' enviadas, ' + failed + ' falhas');
  });

  // ============================================================
  //  TELEGRAM
  // ============================================================
  router.get('/marketing/telegram', (req, res) => {
    res.render('admin/marketing/telegram', {
      title: 'Telegram Marketing', currentPath: '/admin/marketing/telegram',
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      error: null, success: null
    });
  });

  router.post('/marketing/telegram/send', async (req, res) => {
    const { message } = req.body;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return res.redirect('/admin/marketing/telegram?error=Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
    if (!message) return res.redirect('/admin/marketing/telegram?error=Digite a mensagem');
    try {
      const data = JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML', disable_web_page_preview: false });
      const r = await reqPromise(`https://api.telegram.org/bot${token}/sendMessage`, 'POST', data);
      if (r.status === 200) res.redirect('/admin/marketing/telegram?success=Mensagem enviada ao Telegram');
      else res.redirect('/admin/marketing/telegram?error=Erro Telegram: ' + r.status);
    } catch (e) { res.redirect('/admin/marketing/telegram?error=' + e.message); }
  });

  router.post('/marketing/telegram/test', async (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.json({ ok: false, error: 'Token não configurado' });
    try {
      const r = await reqPromise(`https://api.telegram.org/bot${token}/getMe`);
      const d = JSON.parse(r.body);
      res.json({ ok: r.status === 200, bot: d.ok ? d.result.username : null, error: d.description });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ============================================================
  //  DISCORD
  // ============================================================
  router.get('/marketing/discord', (req, res) => {
    res.render('admin/marketing/discord', {
      title: 'Discord Marketing', currentPath: '/admin/marketing/discord',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      error: null, success: null
    });
  });

  router.post('/marketing/discord/send', async (req, res) => {
    const { message } = req.body;
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return res.redirect('/admin/marketing/discord?error=Configure DISCORD_WEBHOOK_URL no .env');
    if (!message) return res.redirect('/admin/marketing/discord?error=Digite a mensagem');
    try {
      const data = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
      const r = await reqPromise(url, 'POST', data, { 'Content-Type': 'application/json' });
      if (r.status === 204 || r.status === 200) res.redirect('/admin/marketing/discord?success=Mensagem enviada ao Discord');
      else res.redirect('/admin/marketing/discord?error=Erro Discord: ' + r.status);
    } catch (e) { res.redirect('/admin/marketing/discord?error=' + e.message); }
  });

  router.post('/marketing/discord/test', async (req, res) => {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return res.json({ ok: false, error: 'Webhook não configurado' });
    try {
      const r = await reqPromise(url, 'GET');
      res.json({ ok: r.status < 400, error: r.status === 404 ? 'Webhook inválido' : 'Status: ' + r.status });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ============================================================
  //  EMAIL MARKETING
  // ============================================================
  router.get('/marketing/email', (req, res) => {
    const { sendEmail } = require('../utils/email');
    const sellers = db.query("SELECT id, name, email FROM sellers WHERE status = 'active'");
    const buyers = db.query("SELECT DISTINCT buyer_name, buyer_email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
    res.render('admin/marketing/email', {
      title: 'Email Marketing', currentPath: '/admin/marketing/email',
      sendgridKey: process.env.SENDGRID_API_KEY ? '****' + process.env.SENDGRID_API_KEY.slice(-4) : '',
      sellers, buyers, sellerCount: sellers.length, buyerCount: buyers.length,
      error: null, success: null
    });
  });

  router.post('/marketing/email/send', async (req, res) => {
    const { subject, html, target } = req.body;
    if (!subject || !html) return res.redirect('/admin/marketing/email?error=Preencha assunto e mensagem');
    const { sendEmail } = require('../utils/email');
    let recipients = [];
    if (target === 'sellers') {
      recipients = db.query("SELECT email FROM sellers WHERE status = 'active' AND email NOT NULL AND email != ''");
    } else if (target === 'buyers') {
      recipients = db.query("SELECT DISTINCT buyer_email as email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
    } else {
      const s = db.query("SELECT email FROM sellers WHERE status = 'active' AND email NOT NULL AND email != ''");
      const b = db.query("SELECT DISTINCT buyer_email as email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
      const seen = {};
      recipients = [...s, ...b].filter(r => { if (seen[r.email]) return false; seen[r.email] = true; return true; });
    }
    let sent = 0;
    for (const r of recipients) {
      try { sendEmail(r.email, subject, html); sent++; } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    res.redirect('/admin/marketing/email?success=' + sent + ' emails enviados para ' + target);
  });

  // ============================================================
  //  SEO & INDEXING
  // ============================================================
  router.get('/marketing/seo', (req, res) => {
    const baseUrl = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
    let sitemapContent = '';
    try {
      const products = db.query("SELECT id, updated_at FROM products WHERE status = 'active' ORDER BY id DESC LIMIT 50");
      const pages = db.getAllPages();
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      xml += '  <url><loc>' + baseUrl + '/</loc><priority>1.0</priority></url>\n';
      products.forEach(p => { xml += '  <url><loc>' + baseUrl + '/produto/' + p.id + '</loc><lastmod>' + (p.updated_at || '').slice(0,10) + '</lastmod><priority>0.8</priority></url>\n'; });
      (pages||[]).forEach(p => { xml += '  <url><loc>' + baseUrl + '/pagina/' + p.slug + '</loc><priority>0.5</priority></url>\n'; });
      xml += '</urlset>';
      sitemapContent = xml;
    } catch (e) { sitemapContent = 'Erro ao gerar sitemap: ' + e.message; }
    res.render('admin/marketing/seo', {
      title: 'SEO & Indexação', currentPath: '/admin/marketing/seo',
      sitemapContent, baseUrl,
      googleKey: process.env.GOOGLE_INDEXING_KEY ? '****' + process.env.GOOGLE_INDEXING_KEY.slice(-4) : '',
      error: null, success: null
    });
  });

  router.post('/marketing/seo/ping', async (req, res) => {
    const baseUrl = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
    const sitemapUrl = baseUrl + '/sitemap.xml';
    let results = [];
    try {
      const g = await reqPromise('https://www.google.com/ping?sitemap=' + encodeURIComponent(sitemapUrl));
      results.push({ engine: 'Google', status: g.status < 500 ? 'OK' : 'Falha' });
    } catch (e) { results.push({ engine: 'Google', status: 'Erro: ' + e.message }); }
    try {
      const b = await reqPromise('https://www.bing.com/webmaster/ping.aspx?siteMap=' + encodeURIComponent(sitemapUrl));
      results.push({ engine: 'Bing', status: b.status < 500 ? 'OK' : 'Falha' });
    } catch (e) { results.push({ engine: 'Bing', status: 'Erro: ' + e.message }); }
    res.redirect('/admin/marketing/seo?success=' + encodeURIComponent(results.map(r => r.engine + ': ' + r.status).join(' | ')));
  });

  // ============================================================
  //  CAMPANHAS MULTIPLATAFORMA
  // ============================================================
  router.get('/marketing/campaigns', (req, res) => {
    res.render('admin/marketing/campaigns', {
      title: 'Campanhas', currentPath: '/admin/marketing/campaigns',
      waReady: WA_READY,
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      emailConfigured: !!process.env.SENDGRID_API_KEY,
      error: null, success: null
    });
  });

  router.post('/marketing/campaigns/disparar', async (req, res) => {
    const { message, platforms, target } = req.body;
    if (!message) return res.redirect('/admin/marketing/campaigns?error=Digite a mensagem');
    const selected = Array.isArray(platforms) ? platforms : [platforms];
    const results = [];

    // WhatsApp
    if (selected.includes('whatsapp') && WA_READY) {
      try {
        const contacts = target === 'all' ? db.getWaContacts() : [];
        if (contacts.length > 0) {
          let s = 0; for (const c of contacts) { try { await WA_CLIENT.sendMessage(c.phone.replace(/\D/g, '') + '@c.us', message); db.addWaMessage(c.phone, c.name, message, 'sent'); s++; } catch (e) {} await new Promise(r => setTimeout(r, 2000)); }
          results.push('WhatsApp: ' + s + ' mensagens');
        } else {
          results.push('WhatsApp: sem contatos');
        }
      } catch (e) { results.push('WhatsApp: erro'); }
    } else if (selected.includes('whatsapp')) { results.push('WhatsApp: desconectado'); }

    // Telegram
    if (selected.includes('telegram')) {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (token && chat) {
        try {
          const d = JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' });
          const r = await reqPromise(`https://api.telegram.org/bot${token}/sendMessage`, 'POST', d);
          results.push('Telegram: ' + (r.status === 200 ? 'OK' : 'Status ' + r.status));
        } catch (e) { results.push('Telegram: erro'); }
      } else { results.push('Telegram: não configurado'); }
    }

    // Discord
    if (selected.includes('discord')) {
      const url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try {
          const d = JSON.stringify({ content: message });
          const r = await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' });
          results.push('Discord: ' + (r.status < 300 ? 'OK' : 'Status ' + r.status));
        } catch (e) { results.push('Discord: erro'); }
      } else { results.push('Discord: não configurado'); }
    }

    // Email
    if (selected.includes('email')) {
      const { sendEmail } = require('../utils/email');
      if (process.env.SENDGRID_API_KEY) {
        let recipients = [];
        if (target === 'sellers' || target === 'all') {
          recipients = recipients.concat(db.query("SELECT email FROM sellers WHERE status = 'active' AND email NOT NULL AND email != ''").map(r => r.email));
        }
        if (target === 'buyers' || target === 'all') {
          recipients = recipients.concat(db.query("SELECT DISTINCT buyer_email as email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''").map(r => r.email));
        }
        recipients = [...new Set(recipients)];
        let s = 0; for (const e of recipients) { try { sendEmail(e, process.env.SITE_NAME + ' - Novidade!', message); s++; } catch (e) {} }
        results.push('Email: ' + s + ' enviados');
      } else { results.push('Email: não configurado'); }
    }

    res.redirect('/admin/marketing/campaigns?success=' + encodeURIComponent(results.join(' | ')));
  });

  // ============================================================
  //  SOCIAL SHARE LINKS
  // ============================================================
  router.get('/marketing/social', (req, res) => {
    const baseUrl = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
    const name = process.env.SITE_NAME || 'Martplace';
    const desc = process.env.SITE_DESC || '';
    res.render('admin/marketing/social', {
      title: 'Links de Compartilhamento', currentPath: '/admin/marketing/social',
      baseUrl, name, desc,
      error: null, success: null
    });
  });

  return router;
};
