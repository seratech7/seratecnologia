const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function getCacheDir() {
  return process.env.PUPPETEER_CACHE_DIR || path.join(require('os').homedir(), '.cache', 'puppeteer');
}

function findChrome() {
  var cacheDir = getCacheDir();
  var chromeDir = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeDir)) return '';
  var versions = fs.readdirSync(chromeDir);
  versions.sort().reverse();
  for (var i = 0; i < versions.length; i++) {
    try {
      var inner = fs.readdirSync(path.join(chromeDir, versions[i]));
      inner.sort().reverse();
      for (var j = 0; j < inner.length; j++) {
        var d = path.join(chromeDir, versions[i], inner[j]);
        if (!fs.statSync(d).isDirectory()) continue;
        var bin = d + '/chrome';
        if (fs.existsSync(bin)) return bin;
        bin = d + '/chrome.exe';
        if (fs.existsSync(bin)) return bin;
      }
    } catch (e) {}
  }
  return '';
}

function ensureChrome() {
  if (findChrome()) return console.log('[chrome] Chrome ja instalado:', findChrome());
  var cacheDir = getCacheDir();
  console.log('[chrome] Baixando Chrome para', cacheDir);
  try {
    execSync('npx @puppeteer/browsers install chrome --path "' + cacheDir + '"', { stdio: 'inherit', timeout: 120000 });
    var found = findChrome();
    if (found) console.log('[chrome] Chrome instalado em:', found);
    else console.log('[chrome] Chrome baixado mas nao encontrado no cache');
  } catch (e) {
    console.error('[chrome] Falha ao baixar Chrome:', e.message);
  }
}

if (require.main === module) ensureChrome();
module.exports = ensureChrome;
