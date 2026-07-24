const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');
const waManager = require('../lib/whatsapp-manager');

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

module.exports = function() {
  const router = express.Router();
  router.use(requireAdmin);
  const db = require('../database/db');

  function getBaseUrl() { return process.env.SITE_URL || 'https://seratecnologia-1.onrender.com'; }

  // Compat helpers using shared waManager
  function getFirstConnectedAccount() {
    var accs = db.getWaAccounts();
    for (var i = 0; i < accs.length; i++) {
      var st = waManager.getState(accs[i].id);
      if (st.ready) return { id: accs[i].id, state: st };
    }
    return null;
  }
  function getMarketingWaReady() {
    var c = getFirstConnectedAccount();
    return c ? c.state.ready : false;
  }
  function getMarketingWaQr() {
    // Return QR from the first account that has a QR
    var accs = db.getWaAccounts();
    for (var i = 0; i < accs.length; i++) {
      var st = waManager.getState(accs[i].id);
      if (st.qr) return st.qr;
    }
    return '';
  }
  async function getMarketingWaClient() {
    var c = getFirstConnectedAccount();
    return c ? waManager.getClient(c.id) : null;
  }

  // === DASHBOARD PRINCIPAL ===
  router.get('/marketing', (req, res) => {
    const stats = db.getMarketingFullStats();
    const campaigns = db.getMarketingCampaigns(5);
    const templates = db.getMarketingTemplates();
    res.render('admin/marketing/index', {
      title: 'Marketing Central', currentPath: '/admin/marketing',
      waReady: getMarketingWaReady(), waQr: getMarketingWaQr(),
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      emailConfigured: !!process.env.SENDGRID_API_KEY,
      stats, campaigns, templates,
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
    const templates = db.getMarketingTemplates('whatsapp');
    res.render('admin/marketing/whatsapp', {
      title: 'WhatsApp Marketing', currentPath: '/admin/marketing/whatsapp',
      stats, recent, contacts, templates,
      waReady: getMarketingWaReady(), waQr: getMarketingWaQr(), baseUrl: getBaseUrl(),
      error: null, success: null
    });
  });

  router.post('/marketing/whatsapp/connect', async (req, res) => {
    if (getMarketingWaReady()) return res.redirect('/admin/marketing/whatsapp');
    waManager.destroyAll();
    // Conectar via /admin/whatsapp (gestão de contas)
    res.redirect('/admin/marketing/whatsapp');
  });

  router.post('/marketing/whatsapp/disconnect', (req, res) => {
    waManager.destroyAll();
    try { const d = path.join(process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session'), 'admin'); if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    res.redirect('/admin/marketing/whatsapp');
  });

  router.get('/marketing/whatsapp/qr', (req, res) => res.json({ qr: getMarketingWaQr(), ready: getMarketingWaReady() }));

  router.post('/marketing/whatsapp/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!getMarketingWaReady()) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('WhatsApp desconectado'));
    if (!phone || !message) return res.redirect('/admin/marketing/whatsapp?error=' + encodeURIComponent('Preencha telefone e mensagem'));
    try {
      var waCli = await getMarketingWaClient();
      if (waCli) await waCli.sendMessage(phone.replace(/\D/g, '') + '@c.us', message);
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
    if (!getMarketingWaReady()) return res.redirect('/admin/marketing/whatsapp?error=WhatsApp desconectado');
    if (!message) return res.redirect('/admin/marketing/whatsapp?error=Digite a mensagem');
    const contacts = db.getWaContacts();
    let sent = 0, failed = 0;
    for (const c of contacts) {
      try {
        const cleaned = c.phone.replace(/\D/g, '');
        if (cleaned.length >= 10) { var waCli = await getMarketingWaClient(); if (waCli) await waCli.sendMessage(cleaned + '@c.us', message); db.addWaMessage(cleaned, c.name, message, 'sent'); sent++; }
      } catch (e) { db.addWaMessage(c.phone, c.name, message, 'failed'); failed++; }
      await new Promise(r => setTimeout(r, 3000));
    }
    res.redirect('/admin/marketing/whatsapp?success=' + sent + ' enviadas, ' + failed + ' falhas');
  });

  // ============================================================
  //  TELEGRAM
  // ============================================================
  router.get('/marketing/telegram', (req, res) => {
    const templates = db.getMarketingTemplates('telegram');
    res.render('admin/marketing/telegram', {
      title: 'Telegram Marketing', currentPath: '/admin/marketing/telegram',
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      templates,
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
    const templates = db.getMarketingTemplates('discord');
    res.render('admin/marketing/discord', {
      title: 'Discord Marketing', currentPath: '/admin/marketing/discord',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      templates,
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
    const templates = db.getMarketingTemplates('email');
    const sellers = db.query("SELECT id, name, email FROM sellers WHERE status = 'active'");
    const buyers = db.query("SELECT DISTINCT buyer_name, buyer_email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
    res.render('admin/marketing/email', {
      title: 'Email Marketing', currentPath: '/admin/marketing/email',
      sendgridKey: process.env.SENDGRID_API_KEY ? '****' + process.env.SENDGRID_API_KEY.slice(-4) : '',
      sellers, buyers, sellerCount: sellers.length, buyerCount: buyers.length,
      templates,
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
    const campaigns = db.getMarketingCampaigns(20);
    const templates = db.getMarketingTemplates();
    res.render('admin/marketing/campaigns', {
      title: 'Campanhas', currentPath: '/admin/marketing/campaigns',
      waReady: getMarketingWaReady(), campaigns, templates,
      telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      emailConfigured: !!process.env.SENDGRID_API_KEY,
      error: null, success: null
    });
  });

  router.post('/marketing/campaigns/disparar', async (req, res) => {
    const { message, platforms, target, name } = req.body;
    if (!message) return res.redirect('/admin/marketing/campaigns?error=Digite a mensagem');
    const selected = Array.isArray(platforms) ? platforms : [platforms];
    const campaignId = db.createMarketingCampaign(name||'Campanha ' + new Date().toLocaleString(), message, selected.join(','), target||'all', req.session.adminId||0);
    const results = [];

    // WhatsApp
    if (selected.includes('whatsapp') && getMarketingWaReady()) {
      try {
        const contacts = db.getWaContacts();
        let s = 0, f = 0;
        for (const c of contacts) {
          try { var waCli = await getMarketingWaClient(); if (waCli) await waCli.sendMessage(c.phone.replace(/\D/g, '') + '@c.us', message); db.addWaMessage(c.phone, c.name, message, 'sent'); db.addMarketingCampaignResult(campaignId, 'whatsapp', c.phone, 'sent', ''); s++; } catch (e) { db.addMarketingCampaignResult(campaignId, 'whatsapp', c.phone, 'failed', e.message); f++; }
          await new Promise(r => setTimeout(r, 2000));
        }
        db.updateMarketingCampaignStats(campaignId, s, f);
        results.push('WhatsApp: ' + s + ' enviadas, ' + f + ' falhas');
      } catch (e) { results.push('WhatsApp: erro'); }
    } else if (selected.includes('whatsapp')) { results.push('WhatsApp: desconectado'); }

    // Telegram
    if (selected.includes('telegram')) {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (token && chat) {
        try {
          const d = JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' });
          const r = await reqPromise(`https://api.telegram.org/bot${token}/sendMessage`, 'POST', d);
          const ok = r.status === 200;
          db.addMarketingCampaignResult(campaignId, 'telegram', chat, ok ? 'sent' : 'failed', ok ? '' : 'Status ' + r.status);
          if (ok) db.updateMarketingCampaignStats(campaignId, 1, 0);
          else db.updateMarketingCampaignStats(campaignId, 0, 1);
          results.push('Telegram: ' + (ok ? 'OK' : 'Status ' + r.status));
        } catch (e) { db.addMarketingCampaignResult(campaignId, 'telegram', chat, 'failed', e.message); db.updateMarketingCampaignStats(campaignId, 0, 1); results.push('Telegram: erro'); }
      } else { results.push('Telegram: não configurado'); }
    }

    // Discord
    if (selected.includes('discord')) {
      const url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try {
          const d = JSON.stringify({ content: message });
          const r = await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' });
          const ok = r.status < 300;
          db.addMarketingCampaignResult(campaignId, 'discord', '', ok ? 'sent' : 'failed', ok ? '' : 'Status ' + r.status);
          if (ok) db.updateMarketingCampaignStats(campaignId, 1, 0);
          else db.updateMarketingCampaignStats(campaignId, 0, 1);
          results.push('Discord: ' + (ok ? 'OK' : 'Status ' + r.status));
        } catch (e) { db.addMarketingCampaignResult(campaignId, 'discord', '', 'failed', e.message); db.updateMarketingCampaignStats(campaignId, 0, 1); results.push('Discord: erro'); }
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
        let s = 0;
        for (const e of recipients) {
          try { sendEmail(e, process.env.SITE_NAME + ' - Novidade!', message); db.addMarketingCampaignResult(campaignId, 'email', e, 'sent', ''); s++; } catch (err) { db.addMarketingCampaignResult(campaignId, 'email', e, 'failed', err.message); }
        }
        db.updateMarketingCampaignStats(campaignId, s, recipients.length - s);
        results.push('Email: ' + s + ' enviados');
      } else { results.push('Email: não configurado'); }
    }

    res.redirect('/admin/marketing/campaigns?success=' + encodeURIComponent(results.join(' | ')));
  });

  // Campaign detail
  router.get('/marketing/campaigns/:id', (req, res) => {
    const campaign = db.getMarketingCampaign(req.params.id);
    if (!campaign) return res.redirect('/admin/marketing/campaigns?error=Campanha não encontrada');
    const results = db.getMarketingCampaignResults(req.params.id);
    res.render('admin/marketing/campaign-detail', {
      title: 'Campanha #' + campaign.id, currentPath: '/admin/marketing/campaigns',
      campaign, results,
      error: null, success: null
    });
  });

  // ============================================================
  //  TEMPLATES
  // ============================================================
  router.get('/marketing/templates', (req, res) => {
    const platform = req.query.platform || '';
    const templates = db.getMarketingTemplates(platform || null);
    res.render('admin/marketing/templates', {
      title: 'Modelos de Mensagem', currentPath: '/admin/marketing/templates',
      templates, platform,
      error: null, success: null
    });
  });

  router.post('/marketing/templates/save', (req, res) => {
    const { id, name, platform, subject, content } = req.body;
    if (!name || !content || !platform) return res.redirect('/admin/marketing/templates?error=Nome, plataforma e conteúdo são obrigatórios');
    db.saveMarketingTemplate(name, platform, subject||'', content, id || null);
    res.redirect('/admin/marketing/templates?success=Modelo salvo');
  });

  router.post('/marketing/templates/delete/:id', (req, res) => {
    db.deleteMarketingTemplate(req.params.id);
    res.redirect('/admin/marketing/templates?success=Modelo removido');
  });

  // ============================================================
  //  QR CODE GENERATOR
  // ============================================================
  router.get('/marketing/qrcode', (req, res) => {
    res.render('admin/marketing/qrcode', {
      title: 'Gerador de QR Code', currentPath: '/admin/marketing/qrcode',
      baseUrl: getBaseUrl(),
      error: null, success: null
    });
  });

  // ============================================================
  //  AUTO-PROMO (Gerar divulgação de produtos)
  // ============================================================
  router.get('/marketing/autopromo', (req, res) => {
    const products = db.query("SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM sales s WHERE s.product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT 30");
    res.render('admin/marketing/autopromo', {
      title: 'Auto-Promo', currentPath: '/admin/marketing/autopromo',
      products, waReady: getMarketingWaReady(), baseUrl: getBaseUrl(),
      siteName: process.env.SITE_NAME || 'Martplace',
      error: null, success: null
    });
  });

  router.post('/marketing/autopromo/send', async (req, res) => {
    const { productId, message, platform } = req.body;
    if (!productId || !message) return res.redirect('/admin/marketing/autopromo?error=Selecione um produto');
    const product = db.get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) return res.redirect('/admin/marketing/autopromo?error=Produto não encontrado');

    if (platform === 'whatsapp' && getMarketingWaReady()) {
      const contacts = db.getWaContacts();
      let sent = 0;
      for (const c of contacts) {
        try { var waCli = await getMarketingWaClient(); if (waCli) await waCli.sendMessage(c.phone.replace(/\D/g, '') + '@c.us', message); db.addWaMessage(c.phone, c.name, message, 'sent'); sent++; } catch (e) {}
        await new Promise(r => setTimeout(r, 2000));
      }
      res.redirect('/admin/marketing/autopromo?success=' + sent + ' mensagens enviadas via WhatsApp');
    } else if (platform === 'telegram') {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (token && chat) {
        try { const d = JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }); await reqPromise(`https://api.telegram.org/bot${token}/sendMessage`, 'POST', d); res.redirect('/admin/marketing/autopromo?success=Enviado ao Telegram'); } catch (e) { res.redirect('/admin/marketing/autopromo?error=' + e.message); }
      } else { res.redirect('/admin/marketing/autopromo?error=Telegram não configurado'); }
    } else if (platform === 'discord') {
      const url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try { const d = JSON.stringify({ content: message }); await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' }); res.redirect('/admin/marketing/autopromo?success=Enviado ao Discord'); } catch (e) { res.redirect('/admin/marketing/autopromo?error=' + e.message); }
      } else { res.redirect('/admin/marketing/autopromo?error=Discord não configurado'); }
    } else {
      res.redirect('/admin/marketing/autopromo?error=WhatsApp desconectado ou plataforma inválida');
    }
  });

  // ============================================================
  //  BROADCAST LISTS
  // ============================================================
  router.get('/marketing/lists', (req, res) => {
    const lists = db.getMarketingLists();
    res.render('admin/marketing/lists', {
      title: 'Listas de Transmissão', currentPath: '/admin/marketing/lists',
      lists, waReady: getMarketingWaReady(),
      error: null, success: null
    });
  });

  router.post('/marketing/lists/create', (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.redirect('/admin/marketing/lists?error=Nome obrigatório');
    db.createMarketingList(name, description);
    res.redirect('/admin/marketing/lists?success=Lista criada');
  });

  router.post('/marketing/lists/delete/:id', (req, res) => {
    db.deleteMarketingList(req.params.id);
    res.redirect('/admin/marketing/lists?success=Lista removida');
  });

  router.get('/marketing/lists/:id', (req, res) => {
    const list = db.getMarketingList(req.params.id);
    if (!list) return res.redirect('/admin/marketing/lists?error=Lista não encontrada');
    const members = db.getMarketingListMembers(req.params.id);
    const contacts = db.getWaContacts();
    const lists = db.getMarketingLists();
    res.render('admin/marketing/list-detail', {
      title: 'Lista: ' + list.name, currentPath: '/admin/marketing/lists',
      list, members, contacts, lists, waReady: getMarketingWaReady(),
      error: null, success: null
    });
  });

  router.post('/marketing/lists/:id/add', (req, res) => {
    const { phone, name } = req.body;
    if (!phone) return res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Telefone obrigatório');
    db.addMarketingListMember(req.params.id, phone.replace(/\D/g, ''), name||'');
    res.redirect('/admin/marketing/lists/' + req.params.id + '?success=Membro adicionado');
  });

  router.post('/marketing/lists/:id/add-from-contacts', (req, res) => {
    const count = db.addWaContactsToList(req.params.id);
    res.redirect('/admin/marketing/lists/' + req.params.id + '?success=' + count + ' contatos importados');
  });

  router.post('/marketing/lists/member/delete/:memberId', (req, res) => {
    const member = db.get("SELECT list_id FROM marketing_list_members WHERE id = ?", [req.params.memberId]);
    if (!member) return res.redirect('/admin/marketing/lists?error=Membro não encontrado');
    db.deleteMarketingListMember(req.params.memberId);
    res.redirect('/admin/marketing/lists/' + member.list_id + '?success=Membro removido');
  });

  router.post('/marketing/lists/:id/send', async (req, res) => {
    const { message } = req.body;
    const listId = req.params.id;
    if (!getMarketingWaReady()) return res.redirect('/admin/marketing/lists/' + listId + '?error=WhatsApp desconectado');
    if (!message) return res.redirect('/admin/marketing/lists/' + listId + '?error=Digite a mensagem');
    const members = db.getMarketingListMembers(listId);
    let sent = 0, failed = 0;
    for (const m of members) {
      try { var waCli = await getMarketingWaClient(); if (waCli) await waCli.sendMessage(m.phone.replace(/\D/g, '') + '@c.us', message); db.addWaMessage(m.phone, m.name, message, 'sent'); sent++; } catch (e) { failed++; }
      await new Promise(r => setTimeout(r, 2000));
    }
    res.redirect('/admin/marketing/lists/' + listId + '?success=' + sent + ' enviadas, ' + failed + ' falhas');
  });

  // ============================================================
  //  WHATSAPP AUTO REPLY
  // ============================================================
  router.get('/marketing/autoreply', (req, res) => {
    const replies = db.getWaAutoReplies();
    res.render('admin/marketing/autoreply', {
      title: 'Respostas Automáticas', currentPath: '/admin/marketing/autoreply',
      replies, waReady: getMarketingWaReady(),
      error: null, success: null
    });
  });

  router.post('/marketing/autoreply/save', (req, res) => {
    const { id, keyword, reply, match_type } = req.body;
    if (!keyword || !reply) return res.redirect('/admin/marketing/autoreply?error=Palavra-chave e resposta obrigatórias');
    db.saveWaAutoReply(keyword.trim(), reply, match_type || 'exact', id || null);
    res.redirect('/admin/marketing/autoreply?success=Resposta salva');
  });

  router.post('/marketing/autoreply/delete/:id', (req, res) => {
    db.deleteWaAutoReply(req.params.id);
    res.redirect('/admin/marketing/autoreply?success=Resposta removida');
  });

  router.post('/marketing/autoreply/toggle/:id', (req, res) => {
    var r = db.getWaAutoReply(req.params.id);
    if (r) { db.run("UPDATE wa_autoreply SET active = ? WHERE id = ?", [r.active ? 0 : 1, req.params.id]); }
    res.redirect('/admin/marketing/autoreply');
  });

  // ============================================================
  //  COUPON DISTRIBUTION
  // ============================================================
  router.get('/marketing/coupons', (req, res) => {
    const coupons = db.getAllCoupons();
    const lists = db.getMarketingLists();
    res.render('admin/marketing/coupon-dist', {
      title: 'Distribuir Cupons', currentPath: '/admin/marketing/coupons',
      coupons, lists, waReady: getMarketingWaReady(), baseUrl: getBaseUrl(),
      siteName: process.env.SITE_NAME || 'Martplace',
      error: null, success: null
    });
  });

  router.post('/marketing/coupons/send', async (req, res) => {
    const { couponId, target, listId, message } = req.body;
    if (!couponId) return res.redirect('/admin/marketing/coupons?error=Selecione um cupom');
    var coupon = db.getCoupon(couponId);
    if (!coupon) return res.redirect('/admin/marketing/coupons?error=Cupom não encontrado');
    var code = coupon.code;
    var msg = (message || 'Cupom exclusivo: ' + code).replace('{code}', code).replace('{valor}', coupon.discount_value || '');

    if (target === 'whatsapp' && getMarketingWaReady()) {
      var phones = [];
      if (listId) { phones = db.getMarketingListMembers(listId); }
      else { phones = db.getWaContacts(); }
      var sent = 0;
      for (var p of phones) {
        try { var waCli = await getMarketingWaClient(); if (waCli) await waCli.sendMessage(p.phone.replace(/\D/g, '') + '@c.us', msg); db.addWaMessage(p.phone, p.name||'', msg, 'sent'); sent++; } catch(e) {}
        await new Promise(r => setTimeout(r, 2000));
      }
      res.redirect('/admin/marketing/coupons?success=Cupom ' + code + ' enviado para ' + sent + ' contatos');
    } else if (target === 'telegram') {
      var token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
      if (token && chat) {
        try { var d = JSON.stringify({ chat_id: chat, text: msg, parse_mode: 'HTML' }); await reqPromise('https://api.telegram.org/bot' + token + '/sendMessage', 'POST', d); res.redirect('/admin/marketing/coupons?success=Cupom enviado ao Telegram'); } catch(e) { res.redirect('/admin/marketing/coupons?error=' + e.message); }
      } else { res.redirect('/admin/marketing/coupons?error=Telegram não configurado'); }
    } else if (target === 'discord') {
      var url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try { var d = JSON.stringify({ content: msg }); await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' }); res.redirect('/admin/marketing/coupons?success=Cupom enviado ao Discord'); } catch(e) { res.redirect('/admin/marketing/coupons?error=' + e.message); }
      } else { res.redirect('/admin/marketing/coupons?error=Discord não configurado'); }
    } else {
      res.redirect('/admin/marketing/coupons?error=WhatsApp desconectado ou destino inválido');
    }
  });

  // ============================================================
  //  REPORTS & EXPORT
  // ============================================================
  router.get('/marketing/reports', (req, res) => {
    var stats = db.getMarketingFullStats();
    var campaigns = db.getMarketingCampaigns(10);
    var recentMsgs = db.getWaMessages(20, 0);
    var schedules = db.getMarketingSchedules(10);
    res.render('admin/marketing/reports', {
      title: 'Relatórios', currentPath: '/admin/marketing/reports',
      stats, campaigns, recentMsgs, schedules,
      error: null, success: null
    });
  });

  router.get('/marketing/reports/export/:type', (req, res) => {
    var rows, filename, header;
    if (req.params.type === 'whatsapp') {
      rows = db.query("SELECT phone, contact_name, message, status, sent_at FROM wa_messages ORDER BY sent_at DESC LIMIT 1000");
      header = 'Telefone,Nome,Mensagem,Status,Data';
    } else if (req.params.type === 'campaigns') {
      rows = db.query("SELECT id, name, platforms, total_sent, total_failed, created_at FROM marketing_campaigns ORDER BY created_at DESC");
      header = 'ID,Nome,Plataformas,Enviadas,Falhas,Data';
    } else if (req.params.type === 'contacts') {
      rows = db.query("SELECT name, phone, notes, created_at FROM wa_contacts ORDER BY name");
      header = 'Nome,Telefone,Observacoes,Data';
    } else { return res.redirect('/admin/marketing/reports?error=Tipo inválido'); }
    var csv = header + '\n';
    rows.forEach(function(r) {
      var vals = Object.values(r).map(function(v) { var s = String(v||''); return s.indexOf(',') !== -1 ? '"' + s.replace(/"/g,'""') + '"' : s; });
      csv += vals.join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=' + req.params.type + '-' + new Date().toISOString().slice(0,10) + '.csv');
    res.send('\uFEFF' + csv);
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