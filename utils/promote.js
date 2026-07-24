require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const SITE_URL = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
const SITE_NAME = process.env.SITE_NAME || 'Martplace';
const SITE_DESC = process.env.SITE_DESC || 'Marketplace completo - compre e venda com facilidade';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// ===== HELPERS =====
function request(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const options = { method, hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers: {} };
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = mod.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function timestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function log(platform, status, msg) {
  const line = `[${timestamp()}] [${platform}] ${status ? 'OK' : 'FAIL'}: ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'promote.log'), line + '\n');
  } catch (e) {}
}

// ===== MODULES =====

// 1. TELEGRAM
async function promoteTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('Telegram', false, 'Token ou Chat ID não configurados');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: false });
    const res = await request(url, 'POST', data);
    if (res.status === 200) {
      log('Telegram', true, 'Mensagem enviada');
      return true;
    }
    log('Telegram', false, `Erro ${res.status}: ${res.body}`);
    return false;
  } catch (e) {
    log('Telegram', false, e.message);
    return false;
  }
}

// 2. DISCORD
async function promoteDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) {
    log('Discord', false, 'Webhook URL não configurada');
    return false;
  }
  try {
    const data = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
    const res = await request(DISCORD_WEBHOOK_URL, 'POST', data);
    if (res.status === 204 || res.status === 200) {
      log('Discord', true, 'Mensagem enviada');
      return true;
    }
    log('Discord', false, `Erro ${res.status}: ${res.body}`);
    return false;
  } catch (e) {
    log('Discord', false, e.message);
    return false;
  }
}

// 3. WHATSAPP (gera link, não envia automaticamente)
function generateWhatsAppLink(message) {
  const text = encodeURIComponent(message);
  return `https://wa.me/?text=${text}`;
}

// 4. FACEBOOK SHARE LINK
function generateFacebookLink() {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE_URL)}&quote=${encodeURIComponent(SITE_DESC)}`;
}

// 5. TWITTER / X SHARE LINK
function generateTwitterLink(message) {
  const text = encodeURIComponent(message);
  return `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(SITE_URL)}`;
}

// 6. LINKEDIN SHARE LINK
function generateLinkedInLink() {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`;
}

// 7. PINTEREST SHARE LINK
function generatePinterestLink() {
  return `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(SITE_URL)}&description=${encodeURIComponent(SITE_DESC)}`;
}

// 8. TELEGRAM SHARE LINK
function generateTelegramShareLink(message) {
  const text = encodeURIComponent(message);
  return `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}&text=${text}`;
}

// 9. SEO - PING GOOGLE
async function pingGoogle() {
  try {
    const sitemapUrl = `${SITE_URL}/sitemap.xml`;
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const res = await request(pingUrl);
    log('Google Ping', res.status < 400, `Status: ${res.status}`);
    return res.status < 400;
  } catch (e) {
    log('Google Ping', false, e.message);
    return false;
  }
}

// 10. SEO - PING BING
async function pingBing() {
  try {
    const sitemapUrl = `${SITE_URL}/sitemap.xml`;
    const pingUrl = `https://www.bing.com/webmaster/ping.aspx?siteMap=${encodeURIComponent(sitemapUrl)}`;
    const res = await request(pingUrl);
    log('Bing Ping', res.status < 400, `Status: ${res.status}`);
    return res.status < 400;
  } catch (e) {
    log('Bing Ping', false, e.message);
    return false;
  }
}

// 11. GERAR SITEMAP
function generateSitemap(routes) {
  const urls = routes.map(route => {
    const changefreq = route.changefreq || 'weekly';
    const priority = route.priority || '0.5';
    return `
  <url>
    <loc>${SITE_URL}${route.path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

// ===== MAIN =====
async function promoteAll(options = {}) {
  console.log(`\n========================================`);
  console.log(`  DIVULGADOR AUTOMÁTICO - ${SITE_NAME}`);
  console.log(`  ${SITE_URL}`);
  console.log(`  ${timestamp()}`);
  console.log(`========================================\n`);

  const defaultMessage = options.message || `🚀 *${SITE_NAME}* - ${SITE_DESC}\n\nAcesse: ${SITE_URL}`;
  const shortMessage = options.shortMessage || `${SITE_NAME} - ${SITE_DESC}\n${SITE_URL}`;
  const htmlMessage = options.htmlMessage ||
    `<b>🚀 ${SITE_NAME}</b>\n\n${SITE_DESC}\n\n<a href="${SITE_URL}">Acesse agora</a>`;

  const results = {};

  // --- APIs Reais ---
  if (options.telegram !== false) {
    console.log('\n--- Telegram ---');
    results.telegram = await promoteTelegram(htmlMessage);
  }

  if (options.discord !== false) {
    console.log('\n--- Discord ---');
    results.discord = await promoteDiscord(shortMessage);
  }

  // --- SEO ---
  if (options.seo !== false) {
    console.log('\n--- SEO / Search Engines ---');
    results.googlePing = await pingGoogle();
    results.bingPing = await pingBing();
  }

  // --- Links de Compartilhamento ---
  if (options.links !== false) {
    console.log('\n--- Links de Compartilhamento ---');
    console.log('(Abra estes links manualmente para compartilhar)\n');
    const links = {
      whatsapp: generateWhatsAppLink(shortMessage),
      facebook: generateFacebookLink(),
      twitter: generateTwitterLink(shortMessage),
      linkedin: generateLinkedInLink(),
      pinterest: generatePinterestLink(),
      telegram_share: generateTelegramShareLink(shortMessage),
    };
    for (const [name, url] of Object.entries(links)) {
      console.log(`  ${name.padEnd(15)}: ${url}`);
    }
    results.links = links;
  }

  // --- Resumo ---
  console.log(`\n========================================`);
  console.log(`  RESUMO`);
  console.log(`========================================`);
  const apis = ['telegram', 'discord', 'googlePing', 'bingPing'];
  for (const key of apis) {
    if (key in results) {
      console.log(`  ${key.padEnd(15)}: ${results[key] ? '✅ OK' : '❌ FALHOU / NÃO CONFIGURADO'}`);
    }
  }
  if (results.links) {
    console.log(`  links           : ✅ Gerados (${Object.keys(results.links).length} plataformas)`);
  }
  console.log(`========================================\n`);

  return results;
}

// ===== CLI =====
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  if (args.includes('--no-telegram')) options.telegram = false;
  if (args.includes('--no-discord')) options.discord = false;
  if (args.includes('--no-seo')) options.seo = false;
  if (args.includes('--no-links')) options.links = false;
  if (args.includes('--links-only')) { options.telegram = false; options.discord = false; options.seo = false; }
  if (args.includes('--apis-only')) { options.links = false; }
  if (args.includes('--seo-only')) { options.telegram = false; options.discord = false; options.links = false; }

  promoteAll(options).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { promoteAll, generateSitemap, generateWhatsAppLink, generateFacebookLink, generateTwitterLink, generateLinkedInLink, generatePinterestLink, generateTelegramShareLink };
