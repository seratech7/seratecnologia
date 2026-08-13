require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const SITE_URL = process.env.SITE_URL || 'https://seratecnologia-1.onrender.com';
const SITE_NAME = process.env.SITE_NAME || 'Marketplace';
const SITE_DESC = process.env.SITE_DESC || '';

const log = [];
function out(msg) { console.log(msg); log.push(msg); }
function divider() { out('='.repeat(60)); }

function req(url, method = 'GET', data = null, headers = {}) {
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

async function initDb() {
  const { initDb, query, get } = require('./database/db');
  await initDb();
  return { query, get };
}

function formatPrice(v) {
  const n = Number(v || 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function cleanDesc(d) { return (d || '').replace(/\s+/g, ' ').slice(0, 120); }

function gerarMensagens(p, siteName) {
  const preco = formatPrice(p.price);
  const link = SITE_URL + '/produto/' + p.id;
  const cat = p.category_name || 'categoria';
  const sales = p.sales_count || 0;
  const desc = cleanDesc(p.description);

  return {
    profissional: '*[' + siteName + ']*\n\nOlá! 👋\n\nTemos um produto que pode interessar você:\n\n*' + p.name + '*\n💰 *' + preco + '*\n\n✅ Qualidade garantida\n✅ Entrega rápida\n✅ Parcelamos no cartão\n\n👉 ' + link,
    convincente: '🔥 *ATENÇÃO* 🔥\n\nVocê ainda não conferiu o *' + p.name + '*?\n\n💥 Pelo preço de *' + preco + '*, você leva:\n   ✅ Produto de altíssima qualidade\n   ✅ Suporte completo pós-venda\n   ✅ Garantia de satisfação\n\n⏳ Essa oportunidade não dura para sempre.\n🚀 Clique e garanta o seu agora:\n' + link,
    urgente: '⚡ *PROMOÇÃO RELÂMPAGO* ⚡\n\n‼️ *ÚLTIMAS UNIDADES* ‼️\n\n*' + p.name + '*\n💰 *' + preco + '*\n\n⏰ Oferta por tempo limitado!\n📦 Estoque se esgotando!\n\n🏃‍♂️ Não fique de fora!\n\n👉 ' + link + '\n\n⚠️ *Garanta o seu antes que acabe!*',
    prova: '⭐ *PRODUTO MAIS QUERIDO* ⭐\n\n*' + p.name + '*\n💰 *' + preco + '*\n\n' + (sales > 0 ? '📊 ' + sales + ' pessoas já compraram!\n\n' : '') + '🗣️ "Produto incrível, superou expectativas!" ⭐⭐⭐⭐⭐\n"Entrega rápida e qualidade impecável!" ⭐⭐⭐⭐⭐\n\n🏆 Destaque em ' + cat + '\n\n👉 ' + link,
    exclusivo: '👑 *OFERTA EXCLUSIVA* 👑\n\nPreparamos algo especial para você:\n\n*' + p.name + '*\n💎 *' + preco + '*\n\n🔸 Condição especial para você\n🔸 Frete rápido e seguro\n🔸 Garantia total\n\nEssa oferta é pessoal e intransferível 💌\n\n👉 Aproveite agora:\n' + link,
    historias: '📖 *A HISTÓRIA POR TRÁS DESTE PRODUTO* 📖\n\nVocê sabia que o *' + p.name + '* foi desenvolvido pensando em cada detalhe?\n\n' + (desc ? '💡 ' + desc + '\n\n' : '') + '🎯 Perfeito para quem busca:\n✅ Qualidade excepcional\n✅ Custo-benefício incomparável\n✅ Satisfação garantida\n\n💰 Tudo por apenas *' + preco + '*\n\n🔗 ' + link,
    comparacao: '🧮 *VALE A PENA?* 🧮\n\nVamos fazer as contas:\n\n❌ Em outros lugares: preços altos\n❌ Qualidade duvidosa\n❌ Sem garantia\n\n✅ No ' + siteName + ': *' + preco + '*\n✅ Qualidade garantida\n✅ Suporte completo\n\nA escolha é óbvia! 🎯\n\n*' + p.name + '*\n👉 ' + link + '\n\nInvista em qualidade. Você merece! 💪'
  };
}

function gerarLinksSociais(msg) {
  const url = SITE_URL;
  const text = encodeURIComponent(msg);
  const encodedUrl = encodeURIComponent(url);
  return {
    WhatsApp: 'https://wa.me/?text=' + text + '%20' + encodedUrl,
    Telegram: 'https://t.me/share/url?url=' + encodedUrl + '&text=' + text,
    Facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl + '&quote=' + text,
    'X/Twitter': 'https://twitter.com/intent/tweet?text=' + text + '&url=' + encodedUrl,
    LinkedIn: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodedUrl,
    Pinterest: 'https://pinterest.com/pin/create/button/?url=' + encodedUrl + '&description=' + text
  };
}

async function pingSitemap() {
  divider();
  out('🔍 SEO & INDEXAÇÃO');
  const sitemapUrl = SITE_URL + '/sitemap.xml';
  const pings = [
    ['Google', 'https://www.google.com/ping?sitemap=' + encodeURIComponent(sitemapUrl)],
    ['Bing', 'https://www.bing.com/webmaster/ping.aspx?siteMap=' + encodeURIComponent(sitemapUrl)],
    ['IndexNow (Bing/Seznam)', 'https://api.indexnow.org/indexnow?url=' + encodeURIComponent(SITE_URL) + '&key=undefined&urlList=' + encodeURIComponent(JSON.stringify([SITE_URL]))]
  ];
  for (const [engine, url] of pings) {
    try {
      const r = await req(url);
      out('  ' + engine + ': status ' + r.status + (r.status < 500 ? ' ✅' : ' ⚠️'));
    } catch (e) {
      out('  ' + engine + ': erro (' + e.message + ')');
    }
  }
}

async function sendDiscord(message) {
  divider();
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    out('💬 Discord: não configurado (DISCORD_WEBHOOK_URL vazio no .env)');
    return false;
  }
  try {
    const data = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
    const r = await req(url, 'POST', data, { 'Content-Type': 'application/json' });
    out('💬 Discord: status ' + r.status + (r.status < 300 ? ' ✅' : ' ⚠️'));
    return r.status < 300;
  } catch (e) {
    out('💬 Discord: erro (' + e.message + ')');
    return false;
  }
}

async function sendEmailCampaign(subject, html) {
  divider();
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    out('📧 Email: não configurado (SENDGRID_API_KEY vazio no .env)');
    return 0;
  }
  const db = await initDb();
  const sellers = db.query("SELECT email FROM sellers WHERE status='active' AND email NOT NULL AND email != ''");
  const buyers = db.query("SELECT DISTINCT buyer_email as email FROM sales WHERE buyer_email NOT NULL AND buyer_email != ''");
  const seen = {};
  const recipients = [...sellers, ...buyers].filter(r => { if (seen[r.email]) return false; seen[r.email] = true; return true; });
  const { sendEmail } = require('./utils/email');
  let sent = 0;
  for (const r of recipients) {
    try { sendEmail(r.email, subject, html); sent++; } catch (e) {}
    await new Promise(res => setTimeout(res, 200));
  }
  out('📧 Email: ' + sent + ' enviados (lista de ' + recipients.length + ')');
  return sent;
}

async function generateQRCodes(products) {
  divider();
  out('📱 QR CODES');
  const dir = path.join(__dirname, 'public', 'qrcodes');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let count = 0;
  const targets = [
    { name: 'site', url: SITE_URL },
    ...products.slice(0, 10).map(p => ({ name: 'produto-' + p.id, url: SITE_URL + '/produto/' + p.id }))
  ];
  for (const t of targets) {
    try {
      const file = path.join(dir, t.name + '.png');
      await QRCode.toFile(file, t.url, { width: 400, margin: 2 });
      count++;
    } catch (e) {
      out('  erro gerando ' + t.name + ': ' + e.message);
    }
  }
  out('  Gerados ' + count + ' QR Codes em public/qrcodes/');
}

async function buildReport(products) {
  divider();
  out('📄 RELATÓRIO');
  const totalActive = products.length;
  const totalValue = products.reduce((s, p) => s + Number(p.price || 0), 0);
  out('  Produtos ativos: ' + totalActive);
  out('  Valor total em estoque: ' + formatPrice(totalValue));
  out('  Média de preço: ' + formatPrice(totalActive ? totalValue / totalActive : 0));
  const featured = products.filter(p => p.featured).length;
  out('  Destaques: ' + featured);

  const file = path.join(__dirname, 'promote-last.log');
  const stamp = new Date().toISOString();
  const content = ['# Divulgação ' + SITE_NAME + ' — ' + stamp, 'URL: ' + SITE_URL, '', ...log].join('\n');
  fs.writeFileSync(file, content, 'utf8');
  out('  Log salvo em promote-last.log');
}

async function main() {
  divider();
  out('🚀 DIVULGAÇÃO AUTOMÁTICA — ' + SITE_NAME);
  out('   Site: ' + SITE_URL);
  out('   Início: ' + new Date().toISOString());
  divider();

  const db = await initDb();
  const products = db.query("SELECT p.*, c.name as category_name, (SELECT COUNT(*) FROM sales s WHERE s.product_id = p.id) as sales_count FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT 30");

  const top = products.slice(0, 5);
  out('📦 Produtos para divulgar: ' + products.length + ' (top 5 abaixo)');
  top.forEach((p, i) => out('  ' + (i + 1) + '. ' + p.name + ' — ' + formatPrice(p.price)));

  await pingSitemap();

  const htmlIntro = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
    '<div style="background:#1565c0;color:#fff;padding:24px;text-align:center;border-radius:8px 8px 0 0;">' +
    '<h1 style="margin:0;font-size:22px;">' + SITE_NAME + '</h1>' +
    '<p style="margin:4px 0 0;opacity:0.9;">' + (SITE_DESC || 'Novidades quentes chegaram!') + '</p></div>' +
    '<div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">';
  let htmlProducts = '';
  top.forEach(p => {
    htmlProducts += '<div style="border:1px solid #eee;border-radius:8px;padding:12px;margin:10px 0;">' +
      '<strong>' + p.name + '</strong><br><span style="color:#1565c0;font-size:18px;font-weight:700;">' + formatPrice(p.price) + '</span>' +
      '<br><a href="' + SITE_URL + '/produto/' + p.id + '" style="display:inline-block;margin-top:8px;background:#1565c0;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;">Ver produto</a></div>';
  });
  const html = htmlIntro + htmlProducts + '</div></div>';

  await sendEmailCampaign('🔥 ' + SITE_NAME + ' — Novidades imperdíveis!', html);

  const mainMsg = '*🛒 ' + SITE_NAME + '*\n\n' + (SITE_DESC ? SITE_DESC + '\n\n' : '') +
    'Confira nossas ofertas:\n\n' +
    top.slice(0, 3).map(p => '• *' + p.name + '* — ' + formatPrice(p.price) + '\n👉 ' + SITE_URL + '/produto/' + p.id).join('\n\n') +
    '\n\n📍 ' + SITE_URL;

  await sendDiscord(mainMsg);

  divider();
  out('🔗 LINKS DE COMPARTILHAMENTO (cole em suas redes)');
  const social = gerarLinksSociais(mainMsg);
  for (const [name, link] of Object.entries(social)) out('  ' + name + ': ' + link);

  divider();
  out('✍️ MENSAGENS PRONTAS POR PRODUTO (top 3)');
  top.slice(0, 3).forEach((p, i) => {
    out('');
    out('  --- Produto: ' + p.name + ' ---');
    const msgs = gerarMensagens(p, SITE_NAME);
    const estilos = ['profissional', 'urgente', 'prova', 'exclusivo'];
    estilos.forEach(est => {
      out('  [' + est.toUpperCase() + ']');
      msgs[est].split('\n').forEach(line => out('    ' + line));
      out('');
    });
  });

  await generateQRCodes(products);
  await buildReport(products);

  divider();
  out('✅ DIVULGAÇÃO CONCLUÍDA — ' + new Date().toISOString());
  divider();
}

main().catch(e => {
  console.error('❌ Erro fatal:', e);
  process.exit(1);
});
