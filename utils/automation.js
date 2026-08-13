const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
const SITE_NAME = process.env.SITE_NAME || 'Marketplace';
const SITE_DESC = process.env.SITE_DESC || '';

function request(url, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = { method, hostname: u.hostname, path: u.pathname + u.search, headers };
    if (data) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = mod.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function base64url(s) {
  return Buffer.from(s).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(privateKeyPem, header, claims) {
  const sign = crypto.createSign('RSA-SHA256');
  const input = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  sign.update(input);
  const sig = sign.sign(privateKeyPem, 'base64');
  return input + '.' + base64url(sig);
}

// === GOOGLE INDEXING API ===
// Precisa: GOOGLE_INDEXING_KEY com o JSON do Service Account (client_email + private_key)
// e o domínio verificado no Google Search Console.
async function googleGetAccessToken() {
  let raw = process.env.GOOGLE_INDEXING_KEY || '';
  if (!raw) return null;
  raw = raw.trim();
  // Se for caminho de arquivo, lê o arquivo
  if (!raw.startsWith('{') && fs.existsSync(path.resolve(raw))) {
    raw = fs.readFileSync(path.resolve(raw), 'utf8');
  }
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { return null; }
  if (!sa.client_email || !sa.private_key) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const assertion = signJwt(sa.private_key, header, claims);
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' + encodeURIComponent(assertion);
  try {
    const r = await request('https://oauth2.googleapis.com/token', 'POST', body,
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    const j = JSON.parse(r.body);
    return j.access_token || null;
  } catch (e) { return null; }
}

async function googleIndex(urls, type = 'URL_UPDATED') {
  const token = await googleGetAccessToken();
  if (!token) return { ok: false, reason: 'GOOGLE_INDEXING_KEY não configurado ou inválido' };
  const results = [];
  for (const url of urls) {
    try {
      const r = await request('https://indexing.googleapis.com/v3/urlNotifications:publish', 'POST',
        JSON.stringify({ url, type }),
        { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });
      results.push({ url, status: r.status });
    } catch (e) { results.push({ url, status: 'erro: ' + e.message }); }
  }
  return { ok: true, results };
}

// === INDEXNOW (Bing, Seznam, Naver, Yandex) ===
// Usa INDEXNOW_KEY. O arquivo /{KEY}.txt precisa estar publicamente acessível no site.
async function indexNow(urls) {
  const key = process.env.INDEXNOW_KEY || '';
  if (!key) return { ok: false, reason: 'INDEXNOW_KEY não configurado' };
  try {
    const data = JSON.stringify({ host: SITE_URL.replace(/^https?:\/\//, ''), key, keyLocation: SITE_URL + '/' + key + '.txt', urlList: urls.slice(0, 1000) });
    const r = await request('https://api.indexnow.org/indexnow', 'POST', data, { 'Content-Type': 'application/json' });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function pingSitemap() {
  const sitemapUrl = SITE_URL + '/sitemap.xml';
  const pings = [
    ['Google', 'https://www.google.com/ping?sitemap=' + encodeURIComponent(sitemapUrl)],
    ['Bing', 'https://www.bing.com/webmaster/ping.aspx?siteMap=' + encodeURIComponent(sitemapUrl)]
  ];
  const results = [];
  for (const [engine, url] of pings) {
    try {
      const r = await request(url);
      results.push(engine + ': ' + r.status + (r.status < 500 ? ' ok' : ''));
    } catch (e) { results.push(engine + ': erro ' + e.message); }
  }
  return results;
}

async function sendDiscord(message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return { ok: false, reason: 'DISCORD_WEBHOOK_URL não configurado' };
  try {
    const data = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
    const r = await request(url, 'POST', data, { 'Content-Type': 'application/json' });
    return { ok: r.status < 300, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}

function formatPrice(v) {
  const n = Number(v || 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

// Divulgação completa (equivalente ao promote.js, mas chamável em memória)
async function runPromote(db) {
  const results = [];
  const products = db.query("SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM sales s WHERE s.product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT 10");
  const top = products.slice(0, 5);
  if (!top.length) return results;

  const mainMsg = '*🛒 ' + SITE_NAME + '*\n\n' + (SITE_DESC ? SITE_DESC + '\n\n' : '') +
    'Confira nossas ofertas:\n\n' +
    top.map(p => '• *' + p.name + '* — ' + formatPrice(p.price) + '\n👉 ' + SITE_URL + '/produto/' + p.id).join('\n\n') +
    '\n\n📍 ' + SITE_URL;

  const discord = await sendDiscord(mainMsg);
  results.push('discord: ' + (discord.ok ? 'enviado' : discord.reason));

  const seo = await pingSitemap();
  results.push('sitemap: ' + seo.join(' | '));

  return results;
}

// Envia uma mensagem para Discord quando um produto novo é aprovado
async function announceNewProduct(db, productId) {
  const p = db.get("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?", [productId]);
  if (!p) return { ok: false, reason: 'produto não encontrado' };
  const msg = '🆕 *NOVO PRODUTO NO ' + SITE_NAME + '*\n\n*' + p.name + '*\n💰 ' + formatPrice(p.price) +
    (p.category_name ? '\n📁 ' + p.category_name : '') +
    '\n\n👉 ' + SITE_URL + '/produto/' + p.id;
  const d = await sendDiscord(msg);
  const idx = await indexNow([SITE_URL + '/produto/' + p.id]);
  return { ok: d.ok, discord: d.ok, indexNow: idx.ok, product: p.name };
}

module.exports = { request, sendDiscord, pingSitemap, runPromote, googleIndex, indexNow, announceNewProduct, formatPrice, SITE_URL, SITE_NAME, SITE_DESC };
