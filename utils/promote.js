require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('./email');

const SITE_URL = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
const SITE_NAME = process.env.SITE_NAME || 'Martplace';
const SITE_DESC = process.env.SITE_DESC || 'Marketplace completo - compre e venda com facilidade';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID || '';
const WHATSAPP_SESSION_PATH = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');

let WA_CLIENT = null;
let WA_READY = false;

function request(url, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = { method, hostname: u.hostname, path: u.pathname + u.search, headers };
    if (data) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = mod.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
//  MODULES
// ============================================================

// --- 1. TELEGRAM ---
async function promoteTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('Telegram', false, 'Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      disable_notification: false
    });
    const res = await request(url, 'POST', data);
    if (res.status === 200) {
      log('Telegram', true, 'Mensagem enviada');
      return true;
    }
    const err = JSON.parse(res.body);
    log('Telegram', false, `${err.description || res.body}`);
    return false;
  } catch (e) {
    log('Telegram', false, e.message);
    return false;
  }
}

// --- 2. DISCORD ---
async function promoteDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) {
    log('Discord', false, 'Configure DISCORD_WEBHOOK_URL no .env');
    return false;
  }
  try {
    const data = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
    const res = await request(DISCORD_WEBHOOK_URL, 'POST', data, { 'Content-Type': 'application/json' });
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

// --- 3. WHATSAPP WEB ---
async function initWhatsApp() {
  if (WA_CLIENT) return true;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    WA_CLIENT = new Client({
      authStrategy: new LocalAuth({ clientId: 'promote', dataPath: WHATSAPP_SESSION_PATH }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        headless: true
      }
    });

    WA_CLIENT.on('qr', qr => {
      console.log('\n========================================');
      console.log('  WHATSAPP - ESCANEIE O QR CODE');
      console.log('========================================');
      console.log('  1. Pega o CELULAR');
      console.log('  2. Abre o WhatsApp > Menu > WhatsApp Web');
      console.log('  3. Escaneia o QR que abriu no navegador');
      console.log('========================================\n');

      try {
        const QR = require('qrcode');
        const qrFile = path.join(__dirname, '..', 'whatsapp-qr.png');
        QR.toFile(qrFile, qr, { width: 400 }, err => {
          if (!err) {
            console.log('  📸 QR salvo: whatsapp-qr.png');
            try {
              const { exec } = require('child_process');
              exec(`cmd /c start "" "${qrFile}"`);
            } catch (e) {}
          }
        });
      } catch (e) {}

      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
      console.log(`  📱 QR no navegador: abrindo...`);
      try {
        const { exec } = require('child_process');
        exec(`cmd /c start "" "${qrUrl}"`);
      } catch (e) {}
    });

    WA_CLIENT.on('ready', () => {
      WA_READY = true;
      log('WhatsApp', true, 'Cliente pronto');
    });

    WA_CLIENT.on('disconnected', reason => {
      WA_READY = false;
      log('WhatsApp', false, `Desconectado: ${reason}`);
    });

    WA_CLIENT.on('auth_failure', msg => {
      WA_READY = false;
      log('WhatsApp', false, `Falha autenticação: ${msg}`);
    });

    log('WhatsApp', true, 'Inicializando cliente (pode levar alguns segundos)...');
    await WA_CLIENT.initialize();
    return true;
  } catch (e) {
    log('WhatsApp', false, `Erro ao iniciar: ${e.message}`);
    return false;
  }
}

async function waitWhatsAppReady(timeoutMs = 120000) {
  if (WA_READY) return true;
  console.log('\n⏳ Aguardando você escanear o QR code pelo celular...');
  console.log('   (O QR foi aberto como imagem ou no navegador)\n');
  const start = Date.now();
  while (!WA_READY && Date.now() - start < timeoutMs) {
    await sleep(1000);
  }
  if (!WA_READY) {
    console.log('\n⚠️  Tempo esgotado. Escaneie o QR e rode novamente.\n');
    return false;
  }
  return true;
}

async function promoteWhatsApp(message, phoneNumber) {
  try {
    if (!WA_READY) {
      log('WhatsApp', false, 'Cliente não está pronto');
      return false;
    }
    if (phoneNumber) {
      const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
      await WA_CLIENT.sendMessage(chatId, message);
      log('WhatsApp', true, `Mensagem enviada para ${phoneNumber}`);
      return true;
    }
    if (WHATSAPP_GROUP_ID) {
      await WA_CLIENT.sendMessage(WHATSAPP_GROUP_ID, message);
      log('WhatsApp', true, `Mensagem enviada para grupo ${WHATSAPP_GROUP_ID}`);
      return true;
    }
    log('WhatsApp', false, 'Nenhum destino configurado (WHATSSAPP_GROUP_ID ou phoneNumber)');
    return false;
  } catch (e) {
    log('WhatsApp', false, e.message);
    return false;
  }
}

async function promoteWhatsAppBroadcast(message, phoneList) {
  if (!WA_READY || !phoneList?.length) return 0;
  let sent = 0;
  for (const phone of phoneList) {
    try {
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length >= 10) {
        const chatId = `${cleaned}@c.us`;
        await WA_CLIENT.sendMessage(chatId, message);
        sent++;
        log('WhatsApp', true, `Enviado para ${cleaned}`);
        await sleep(3000);
      }
    } catch (e) {
      log('WhatsApp', false, `Falha ao enviar para ${phone}: ${e.message}`);
    }
  }
  return sent;
}

// --- 4. EMAIL NEWSLETTER ---
async function promoteEmail(emails, subject, html) {
  if (!emails?.length) {
    log('Email', false, 'Lista de emails vazia');
    return 0;
  }
  let sent = 0;
  for (const email of emails) {
    try {
      await sendEmail(email, subject, html);
      sent++;
      log('Email', true, `Enviado para ${email}`);
      await sleep(500);
    } catch (e) {
      log('Email', false, `Falha ao enviar para ${email}: ${e.message}`);
    }
  }
  return sent;
}

async function getSellerEmails() {
  try {
    const { initDb, query } = require('../database/db');
    await initDb();
    const sellers = query("SELECT email FROM sellers WHERE status = 'active'");
    return sellers.map(s => s.email).filter(Boolean);
  } catch (e) {
    log('Email', false, `Erro ao buscar vendedores: ${e.message}`);
    return [];
  }
}

async function getBuyerEmails() {
  try {
    const { initDb, query } = require('../database/db');
    await initDb();
    const buyers = query("SELECT DISTINCT buyer_email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
    return buyers.map(b => b.buyer_email).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// --- 5. IN-APP NOTIFICATION ---
async function promoteInApp(message) {
  try {
    const { initDb, query, run } = require('../database/db');
    await initDb();
    const sellers = query("SELECT id FROM sellers");
    sellers.forEach(s => {
      try {
        run('INSERT INTO notifications (ip, type, message, icon, link, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
          [String(s.id), 'promo', message, 'megaphone', '/']);
      } catch (e) {}
    });
    log('InApp', true, `Notificação enviada para ${sellers.length} vendedores`);
    return sellers.length;
  } catch (e) {
    log('InApp', false, e.message);
    return 0;
  }
}

// --- 6. GOOGLE INDEXING API ---
async function promoteGoogleIndexing(urls) {
  const key = process.env.GOOGLE_INDEXING_KEY || '';
  if (!key) {
    log('GoogleIndex', false, 'Configure GOOGLE_INDEXING_KEY no .env');
    return false;
  }
  let ok = 0;
  for (const url of urls) {
    try {
      const data = JSON.stringify({ url, type: 'URL_UPDATED' });
      const res = await request(
        `https://indexing.googleapis.com/v3/urlNotifications:publish?key=${key}`,
        'POST', data
      );
      if (res.status === 200) { ok++; log('GoogleIndex', true, url); }
      else log('GoogleIndex', false, `${url}: ${res.status}`);
    } catch (e) {
      log('GoogleIndex', false, `${url}: ${e.message}`);
    }
  }
  return ok;
}

// --- 7. SEO PINGS ---
async function pingSearchEngines(sitemapUrl) {
  const url = sitemapUrl || `${SITE_URL}/sitemap.xml`;
  const engines = [
    { name: 'Google', url: `https://www.google.com/ping?sitemap=${encodeURIComponent(url)}` },
    { name: 'Bing', url: `https://www.bing.com/webmaster/ping.aspx?siteMap=${encodeURIComponent(url)}` },
  ];
  for (const eng of engines) {
    try {
      const res = await request(eng.url);
      log(eng.name, res.status < 500, `${res.status}`);
    } catch (e) {
      log(eng.name, false, e.message);
    }
  }
}

// --- 8. SOCIAL SHARE LINKS ---
function generateShareLinks(message, url) {
  const u = url || SITE_URL;
  const text = encodeURIComponent(message || SITE_DESC);
  const encodedUrl = encodeURIComponent(u);
  return {
    whatsapp: `https://wa.me/?text=${text}%0A${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${text}`,
    twitter: `https://twitter.com/intent/tweet?text=${text}&url=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${text}`,
    pinterest: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${text}`,
    email: `mailto:?subject=${encodeURIComponent(SITE_NAME)}&body=${text}%0A${encodedUrl}`,
  };
}

// ============================================================
//  MAIN
// ============================================================

async function promoteAll(options = {}) {
  const message = options.message || `🚀 ${SITE_NAME}\n${SITE_DESC}\n\n${SITE_URL}`;
  const htmlMessage = options.htmlMessage ||
    `<h2>🚀 ${SITE_NAME}</h2><p>${SITE_DESC}</p><p><a href="${SITE_URL}">Acesse agora</a></p>`;
  const emailSubject = options.emailSubject || `🚀 ${SITE_NAME} - ${SITE_DESC}`;
  const phoneList = options.phoneList || [];
  const phoneNumbers = options.phoneNumbers || [];

  console.log(`\n========================================`);
  console.log(`  DIVULGADOR AUTOMÁTICO`);
  console.log(`  ${SITE_NAME}`);
  console.log(`  ${SITE_URL}`);
  console.log(`  ${timestamp()}`);
  console.log(`========================================\n`);

  const results = {};

  // --- Email para vendedores ---
  if (options.email !== false) {
    console.log('\n--- Email Newsletter ---');
    const emails = await getSellerEmails();
    const buyerEmails = await getBuyerEmails();
    const all = [...new Set([...emails, ...buyerEmails])];
    if (all.length > 0) {
      results.email = await promoteEmail(all, emailSubject, htmlMessage);
      console.log(`  Enviado para ${results.email} destinatários`);
    } else {
      console.log('  Nenhum email encontrado no banco');
      results.email = 0;
    }
  }

  // --- Telegram ---
  if (options.telegram !== false) {
    console.log('\n--- Telegram ---');
    results.telegram = await promoteTelegram(message);
  }

  // --- Discord ---
  if (options.discord !== false) {
    console.log('\n--- Discord ---');
    results.discord = await promoteDiscord(message);
  }

  // --- WhatsApp ---
  if (options.whatsapp !== false) {
    console.log('\n--- WhatsApp ---');
    const waOk = await initWhatsApp();
    if (waOk) {
      const ready = await waitWhatsAppReady();
      if (ready) {
        if (phoneNumbers.length > 0) {
          results.whatsapp = await promoteWhatsAppBroadcast(message, phoneNumbers);
        } else {
          results.whatsapp = await promoteWhatsApp(message);
        }
      } else {
        results.whatsapp = false;
      }
      if (WA_CLIENT) {
        try { await WA_CLIENT.destroy(); } catch (e) {}
        WA_CLIENT = null; WA_READY = false;
      }
    } else {
      results.whatsapp = false;
      console.log('  WhatsApp não disponível. Instale o Chrome/Chromium.');
    }
  }

  // --- Notificação In-App ---
  if (options.inApp !== false) {
    console.log('\n--- Notificação In-App ---');
      results.inApp = await promoteInApp(message);
  }

  // --- Google Indexing ---
  if (options.indexing !== false) {
    console.log('\n--- Google Indexing ---');
    if (options.urls?.length) {
      results.indexing = await promoteGoogleIndexing(options.urls);
    } else {
      results.indexing = await promoteGoogleIndexing([SITE_URL]);
    }
  }

  // --- SEO Pings ---
  if (options.seo !== false) {
    console.log('\n--- SEO Pings ---');
    await pingSearchEngines();
    results.seo = true;
  }

  // --- Links de Compartilhamento ---
  if (options.links !== false) {
    console.log('\n--- Links de Compartilhamento ---');
    console.log('  (Abra manualmente para compartilhar)\n');
    const links = generateShareLinks(message);
    for (const [k, v] of Object.entries(links)) {
      console.log(`  ${k.padEnd(12)}: ${v}`);
    }
    results.links = links;
  }

  // --- Resumo ---
  console.log(`\n========================================`);
  console.log(`  RESUMO`);
  console.log(`========================================`);
  const checks = {
    telegram: '❌', discord: '❌', whatsapp: '❌', email: '❌',
    inApp: '❌', indexing: '❌', seo: '❌', links: '❌'
  };
  for (const k of Object.keys(checks)) {
    const v = results[k];
    if (k === 'links' && v) checks[k] = '✅';
    else if (k === 'email' && v > 0) checks[k] = `✅ (${v})`;
    else if (k === 'indexing' && v > 0) checks[k] = `✅ (${v})`;
    else if (v === true) checks[k] = '✅';
    else if (v > 0) checks[k] = `✅ (${v})`;
  }
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${k.padEnd(12)}: ${v}`);
  }
  console.log(`========================================\n`);

  return results;
}

// ============================================================
//  CLI
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  const disable = ['--no-telegram', '--no-discord', '--no-whatsapp', '--no-email', '--no-inapp', '--no-indexing', '--no-seo', '--no-links'];
  const only = ['--telegram-only', '--discord-only', '--whatsapp-only', '--email-only', '--seo-only', '--links-only'];

  for (const flag of disable) {
    const key = flag.replace('--no-', '');
    if (args.includes(flag)) options[key] = false;
  }

  if (args.includes('--links-only')) {
    Object.assign(options, { telegram: false, discord: false, whatsapp: false, email: false, inApp: false, indexing: false, seo: false });
  } else if (args.includes('--seo-only')) {
    Object.assign(options, { telegram: false, discord: false, whatsapp: false, email: false, inApp: false, indexing: false, links: false });
  } else if (args.includes('--telegram-only')) {
    Object.assign(options, { discord: false, whatsapp: false, email: false, inApp: false, indexing: false, seo: false, links: false });
  } else if (args.includes('--discord-only')) {
    Object.assign(options, { telegram: false, whatsapp: false, email: false, inApp: false, indexing: false, seo: false, links: false });
  } else if (args.includes('--whatsapp-only')) {
    Object.assign(options, { telegram: false, discord: false, email: false, inApp: false, indexing: false, seo: false, links: false });
  } else if (args.includes('--email-only')) {
    Object.assign(options, { telegram: false, discord: false, whatsapp: false, inApp: false, indexing: false, seo: false, links: false });
  }

  const msgIndex = args.indexOf('--message');
  if (msgIndex !== -1 && args[msgIndex + 1]) options.message = args[msgIndex + 1];

  const phoneIndex = args.indexOf('--phones');
  if (phoneIndex !== -1 && args[phoneIndex + 1]) {
    options.phoneNumbers = args[phoneIndex + 1].split(',').map(p => p.trim());
  }

  promoteAll(options).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { promoteAll, generateShareLinks, pingSearchEngines, promoteEmail, getSellerEmails, getBuyerEmails, promoteTelegram, promoteDiscord, promoteInApp, initWhatsApp, promoteWhatsApp, promoteWhatsAppBroadcast };
