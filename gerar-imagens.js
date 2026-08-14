const db = require('./database/db');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'news');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function gerarSVG(titulo, categoria, slug, id) {
  var c1 = categoria === 'Hacking' ? '#0b1f3a' : '#2a1055';
  var c2 = categoria === 'Hacking' ? '#00d4ff' : '#ff5e9c';
  var c3 = categoria === 'Hacking' ? '#0066ff' : '#ff9a3c';
  var title = escapeXml((titulo || '').slice(0, 60));
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">' +
    '<defs>' +
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + c1 + '"/>' +
    '<stop offset="1" stop-color="' + c2 + '"/>' +
    '</linearGradient>' +
    '<radialGradient id="r" cx="0.8" cy="0.2" r="0.7">' +
    '<stop offset="0" stop-color="' + c3 + '" stop-opacity="0.55"/>' +
    '<stop offset="1" stop-color="' + c3 + '" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect width="900" height="600" fill="url(#g)"/>' +
    '<rect width="900" height="600" fill="url(#r)"/>' +
    '<g fill="#ffffff" opacity="0.08">' +
    '<circle cx="120" cy="120" r="90"/>' +
    '<circle cx="760" cy="480" r="140"/>' +
    '<circle cx="620" cy="90" r="50"/>' +
    '</g>' +
    '<text x="60" y="120" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff" opacity="0.85" letter-spacing="3">' + escapeXml(categoria.toUpperCase()) + '</text>' +
    '<text x="60" y="500" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#ffffff">' + title + '</text>' +
    '</svg>';
  var file = path.join(UPLOAD_DIR, slug + '.svg');
  fs.writeFileSync(file, svg);
  var rel = '/uploads/news/' + slug + '.svg';
  db.run('UPDATE news SET image = ? WHERE id = ?', [rel, id]);
  return rel;
}

async function gerarImagem(titulo, categoria, slug, id) {
  var base = categoria === 'Hacking'
    ? 'cybersecurity hacking, dark tech, code, neon'
    : 'video game, gaming setup, esports, colorful';
  var prompt = encodeURIComponent(base + ', news illustration, ' + titulo + ', cinematic, highly detailed');
  var url = 'https://image.pollinations.ai/prompt/' + prompt + '?width=900&height=600&nologo=true&model=flux&seed=' + id;
  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    var resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('status ' + resp.status);
    var buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 5000) throw new Error('imagem muito pequena');
    var file = path.join(UPLOAD_DIR, slug + '.jpg');
    fs.writeFileSync(file, buf);
    var rel = '/uploads/news/' + slug + '.jpg';
    db.run('UPDATE news SET image = ? WHERE id = ?', [rel, id]);
    return rel;
  } catch (e) {
    return gerarSVG(titulo, categoria, slug, id);
  }
}

(async () => {
  try { await db.initDb(); } catch (e) { console.log('init err', e.message); }
  var news = db.query("SELECT id, title, category, slug, image FROM news WHERE image IS NULL OR image = ''") || [];
  console.log('Notícias sem imagem:', news.length);
  for (var i = 0; i < news.length; i++) {
    var n = news[i];
    console.log('(' + (i + 1) + '/' + news.length + ') ' + n.title);
    var img = await gerarImagem(n.title, n.category, n.slug, n.id);
    console.log('  ->', img);
    await new Promise(function (r) { setTimeout(r, 400); });
  }
  try { db.saveDb(); } catch (e) { console.log('saveDb err', e.message); }
  console.log('Concluído.');
})();
