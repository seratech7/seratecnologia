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

module.exports = function() {
  const router = express.Router();
  router.use(requireAdmin);
  const db = require('../database/db');

  function getBaseUrl() { return process.env.SITE_URL || 'https://seratecnologia-1.onrender.com'; }

  // === DASHBOARD PRINCIPAL ===
  router.get('/marketing', (req, res) => {
    const stats = db.getMarketingFullStats();
    const campaigns = db.getMarketingCampaigns(5);
    const templates = db.getMarketingTemplates();
    res.render('admin/marketing/index', {
      title: 'Marketing Central', currentPath: '/admin/marketing',
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      emailConfigured: !!process.env.SENDGRID_API_KEY,
      stats, campaigns, templates,
      error: null, success: null
    });
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
      campaigns, templates,
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
          try { var sn = db.get("SELECT value FROM config WHERE key = 'site_name'"); var siteName = sn ? sn.value : 'Marketplace'; sendEmail(e, siteName + ' - Novidade!', message); db.addMarketingCampaignResult(campaignId, 'email', e, 'sent', ''); s++; } catch (err) { db.addMarketingCampaignResult(campaignId, 'email', e, 'failed', err.message); }
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
  //  AUTO-RESPOSTA (regras de resposta automática)
  // ============================================================
  router.get('/marketing/autoreply', (req, res) => {
    const replies = db.getAutoReplies();
    res.render('admin/marketing/autoreply', {
      title: 'Auto-Resposta', currentPath: '/admin/marketing/autoreply',
      replies,
      error: null, success: null
    });
  });

  router.post('/marketing/autoreply/save', (req, res) => {
    const { id, keyword, reply, match_type, active } = req.body;
    if (!keyword || !reply) return res.redirect('/admin/marketing/autoreply?error=Preencha palavra-chave e resposta');
    if (id) db.updateAutoReply(id, keyword.trim(), reply.trim(), match_type || 'exact', active === '1' || active === 'on');
    else db.saveAutoReply(keyword.trim(), reply.trim(), match_type || 'exact', active === '1' || active === 'on');
    res.redirect('/admin/marketing/autoreply?success=Regra salva');
  });

  router.post('/marketing/autoreply/delete/:id', (req, res) => {
    db.deleteAutoReply(req.params.id);
    res.redirect('/admin/marketing/autoreply?success=Regra removida');
  });

  router.post('/marketing/autoreply/toggle/:id', (req, res) => {
    const r = db.getAutoReply(req.params.id);
    if (r) db.toggleAutoReply(req.params.id, !r.active);
    res.redirect('/admin/marketing/autoreply?success=Status atualizado');
  });

  // ============================================================
  //  AUTO-PROMO (Gerar divulgação de produtos)
  // ============================================================
  router.get('/marketing/autopromo', (req, res) => {
    const products = db.query("SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM sales s WHERE s.product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT 30");
    var sn = db.get("SELECT value FROM config WHERE key = 'site_name'");
    var siteName = sn ? sn.value : 'Marketplace';
    res.render('admin/marketing/autopromo', {
      title: 'Auto-Promo', currentPath: '/admin/marketing/autopromo',
      products, baseUrl: getBaseUrl(),
      siteName: siteName,
      error: null, success: null
    });
  });

  router.post('/marketing/autopromo/send', async (req, res) => {
    const { productId, message, platform } = req.body;
    if (!productId || !message) return res.redirect('/admin/marketing/autopromo?error=Selecione um produto');
    const product = db.get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) return res.redirect('/admin/marketing/autopromo?error=Produto não encontrado');

    if (platform === 'discord') {
      const url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try { const d = JSON.stringify({ content: message }); await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' }); res.redirect('/admin/marketing/autopromo?success=Enviado ao Discord'); } catch (e) { res.redirect('/admin/marketing/autopromo?error=' + e.message); }
      } else { res.redirect('/admin/marketing/autopromo?error=Discord não configurado'); }
    } else {
      res.redirect('/admin/marketing/autopromo?error=Selecione uma plataforma válida');
    }
  });

  // ============================================================
  //  BROADCAST LISTS
  // ============================================================
  router.get('/marketing/lists', (req, res) => {
    const lists = db.getMarketingLists();
    res.render('admin/marketing/lists', {
      title: 'Listas de Transmissão', currentPath: '/admin/marketing/lists',
      lists,
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
    const lists = db.getMarketingLists();
    let contacts = [];
    try {
      contacts = db.query("SELECT DISTINCT name, phone FROM customers WHERE phone IS NOT NULL AND phone != '' ORDER BY name LIMIT 200") || [];
    } catch (e) { contacts = []; }
    res.render('admin/marketing/list-detail', {
      title: 'Lista: ' + list.name, currentPath: '/admin/marketing/lists',
      list, members, lists, contacts,
      csrfToken: req.session.csrfToken,
      error: null, success: null
    });
  });

  router.post('/marketing/lists/:id/add-from-contacts', (req, res) => {
    try {
      const contacts = db.query("SELECT DISTINCT name, phone FROM customers WHERE phone IS NOT NULL AND phone != ''") || [];
      let added = 0;
      contacts.forEach(function(c) {
        try {
          const existing = db.get("SELECT id FROM marketing_list_members WHERE list_id = ? AND phone = ?", [req.params.id, c.phone.replace(/\D/g, '')]);
          if (!existing) {
            db.addMarketingListMember(req.params.id, c.phone.replace(/\D/g, ''), c.name || '');
            added++;
          }
        } catch (e) {}
      });
      res.redirect('/admin/marketing/lists/' + req.params.id + '?success=' + encodeURIComponent(added + ' contatos importados da base'));
    } catch (e) {
      res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Erro ao importar contatos');
    }
  });

  router.post('/marketing/lists/:id/send', async (req, res) => {
    const { message } = req.body;
    const list = db.getMarketingList(req.params.id);
    if (!list) return res.redirect('/admin/marketing/lists?error=Lista não encontrada');
    if (!message || !message.trim()) return res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Mensagem obrigatória');
    const members = db.getMarketingListMembers(req.params.id) || [];
    if (members.length === 0) return res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Lista vazia');
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Discord não configurado para envio');
    let sent = 0, failed = 0;
    for (const m of members) {
      try {
        const text = message.replace('{nome}', m.name || '').replace('{telefone}', m.phone || '');
        await reqPromise(url, 'POST', JSON.stringify({ content: text }), { 'Content-Type': 'application/json' });
        sent++;
      } catch (e) { failed++; }
      await new Promise(r => setTimeout(r, 150));
    }
    res.redirect('/admin/marketing/lists/' + req.params.id + '?success=' + encodeURIComponent('Enviado para ' + sent + ' membros' + (failed ? ', ' + failed + ' falharam' : '')));
  });

  router.post('/marketing/lists/:id/add', (req, res) => {
    const { phone, name } = req.body;
    if (!phone) return res.redirect('/admin/marketing/lists/' + req.params.id + '?error=Telefone obrigatório');
    db.addMarketingListMember(req.params.id, phone.replace(/\D/g, ''), name||'');
    res.redirect('/admin/marketing/lists/' + req.params.id + '?success=Membro adicionado');
  });

  router.post('/marketing/lists/member/delete/:memberId', (req, res) => {
    const member = db.get("SELECT list_id FROM marketing_list_members WHERE id = ?", [req.params.memberId]);
    if (!member) return res.redirect('/admin/marketing/lists?error=Membro não encontrado');
    db.deleteMarketingListMember(req.params.memberId);
    res.redirect('/admin/marketing/lists/' + member.list_id + '?success=Membro removido');
  });

  // ============================================================
  //  COUPON DISTRIBUTION
  // ============================================================
  router.get('/marketing/coupons', (req, res) => {
    const coupons = db.getAllCoupons();
    const lists = db.getMarketingLists();
    var sn = db.get("SELECT value FROM config WHERE key = 'site_name'");
    var siteName = sn ? sn.value : 'Marketplace';
    res.render('admin/marketing/coupon-dist', {
      title: 'Distribuir Cupons', currentPath: '/admin/marketing/coupons',
      coupons, lists, baseUrl: getBaseUrl(),
      siteName: siteName,
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

    if (target === 'discord') {
      var url = process.env.DISCORD_WEBHOOK_URL;
      if (url) {
        try { var d = JSON.stringify({ content: msg }); await reqPromise(url, 'POST', d, { 'Content-Type': 'application/json' }); res.redirect('/admin/marketing/coupons?success=Cupom enviado ao Discord'); } catch(e) { res.redirect('/admin/marketing/coupons?error=' + e.message); }
      } else { res.redirect('/admin/marketing/coupons?error=Discord não configurado'); }
    } else {
      res.redirect('/admin/marketing/coupons?error=Selecione um destino válido');
    }
  });

  // ============================================================
  //  REPORTS & EXPORT
  // ============================================================
  router.get('/marketing/reports', (req, res) => {
    var stats = db.getMarketingFullStats();
    var campaigns = db.getMarketingCampaigns(10);
    var schedules = db.getMarketingSchedules(10);
    res.render('admin/marketing/reports', {
      title: 'Relatórios', currentPath: '/admin/marketing/reports',
      stats, campaigns, schedules,
      error: null, success: null
    });
  });

  router.get('/marketing/reports/export/:type', (req, res) => {
    var rows, filename, header;
    if (req.params.type === 'campaigns') {
      rows = db.query("SELECT id, name, platforms, total_sent, total_failed, created_at FROM marketing_campaigns ORDER BY created_at DESC");
      header = 'ID,Nome,Plataformas,Enviadas,Falhas,Data';
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
    var sn = db.get("SELECT value FROM config WHERE key = 'site_name'");
    var sd = db.get("SELECT value FROM config WHERE key = 'site_description'");
    const name = sn ? sn.value : 'Marketplace';
    const desc = sd ? sd.value : '';
    res.render('admin/marketing/social', {
      title: 'Links de Compartilhamento', currentPath: '/admin/marketing/social',
      baseUrl, name, desc,
      error: null, success: null
    });
  });

  // ============================================================
  //  AUTOMAÇÃO (agendador, indexação, promoção automática)
  // ============================================================
  router.get('/marketing/automation', (req, res) => {
    const automation = require('../utils/automation');
    let state = {};
    try {
      const fs = require('fs');
      state = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'automation-state.json'), 'utf8'));
    } catch (e) {}
    res.render('admin/marketing/automation', {
      title: 'Automação', currentPath: '/admin/marketing/automation',
      baseUrl: automation.SITE_URL,
      siteName: automation.SITE_NAME,
      indexNowConfigured: !!process.env.INDEXNOW_KEY,
      indexNowKeyFile: process.env.INDEXNOW_KEY ? (process.env.INDEXNOW_KEY + '.txt') : 'SUA-CHAVE.txt',
      googleConfigured: !!process.env.GOOGLE_INDEXING_KEY,
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      autoDisabled: process.env.AUTO_DISABLED === 'true',
      promoteHour: process.env.AUTO_PROMOTE_HOUR || '9',
      annHour: process.env.AUTO_ANN_HOUR || '18',
      state,
      error: null, success: null
    });
  });

  router.post('/marketing/automation/index', async (req, res) => {
    try {
      const { autoIndexNewProducts } = require('../utils/scheduler');
      const r = await autoIndexNewProducts();
      const detail = [];
      if (r.indexNow) detail.push('IndexNow: ' + (r.indexNow.ok ? 'ok (' + r.indexNow.status + ')' : r.indexNow.reason || r.indexNow.status));
      if (r.google) detail.push('Google: ' + (r.google.ok ? 'ok (' + r.google.results.length + ' URLs)' : r.google.reason || ''));
      res.redirect('/admin/marketing/automation?success=' + encodeURIComponent((r.indexed + ' produtos indexados. ' + detail.join(' | '))));
    } catch (e) {
      res.redirect('/admin/marketing/automation?error=' + encodeURIComponent(e.message));
    }
  });

  router.post('/marketing/automation/promote', async (req, res) => {
    try {
      const { autoPromoteDaily } = require('../utils/scheduler');
      const results = await autoPromoteDaily();
      res.redirect('/admin/marketing/automation?success=' + encodeURIComponent('Promoção executada: ' + results.join(' | ')));
    } catch (e) {
      res.redirect('/admin/marketing/automation?error=' + encodeURIComponent(e.message));
    }
  });

  // ============================================================
  //  ATRAÇÃO DE VISITANTES (referral, sorteio, recuperação, push)
  // ============================================================
  router.get('/marketing/attraction', (req, res) => {
    const attraction = require('../utils/attraction');
    const refStats = attraction.getReferralStats();
    const gaStats = attraction.getGiveawayStats();
    const abandoned = db.query('SELECT COUNT(*) as c FROM abandoned_visits') || [];
    const abandonedCount = abandoned.length ? abandoned[0].c : 0;
    const pushCount = (db.get('SELECT COUNT(*) as c FROM push_subscriptions') || {}).c || 0;
    const top = attraction.getTopSellers(5);
    const generatedKeys = req.session.vapidGenerated || null;
    req.session.vapidGenerated = null;
    res.render('admin/marketing/attraction', {
      title: 'Atração de Visitantes', currentPath: '/admin/marketing/attraction',
      refStats, gaStats, abandonedCount, pushCount, top,
      siteUrl: attraction.SITE_URL,
      discordConfigured: !!process.env.DISCORD_WEBHOOK_URL,
      pushConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      generatedKeys,
      error: null, success: null
    });
  });

  // Executar sorteio agora
  router.post('/marketing/attraction/draw', (req, res) => {
    try {
      const attraction = require('../utils/attraction');
      const winner = attraction.drawGiveawayWinner();
      if (!winner) return res.redirect('/admin/marketing/attraction?error=Nenhum participante ainda');
      res.redirect('/admin/marketing/attraction?success=' + encodeURIComponent('Vencedor sorteado: ' + (winner.name || 'Participante') + ' (notificado no Discord)'));
    } catch (e) {
      res.redirect('/admin/marketing/attraction?error=' + encodeURIComponent(e.message));
    }
  });

  // Limpar participantes do sorteio
  router.post('/marketing/attraction/giveaway/reset', (req, res) => {
    db.run('DELETE FROM giveaway_entries');
    res.redirect('/admin/marketing/attraction?success=Participantes do sorteio limpos');
  });

  // Gerar VAPID keys
  router.post('/marketing/attraction/vapid', (req, res) => {
    try {
      const webpush = require('web-push');
      const keys = webpush.generateVAPIDKeys();
      req.session.vapidGenerated = { publicKey: keys.publicKey, privateKey: keys.privateKey };
      res.redirect('/admin/marketing/attraction?success=1');
    } catch (e) {
      res.redirect('/admin/marketing/attraction?error=' + encodeURIComponent(e.message));
    }
  });

  return router;
};
