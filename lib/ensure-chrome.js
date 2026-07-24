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

async function ensureChrome() {
  if (findChrome()) return console.log('[chrome] Chrome ja instalado');
  var cacheDir = getCacheDir();
  console.log('[chrome] Baixando Chrome para', cacheDir);
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    var { install, resolveBuildId, detectBrowserPlatform, Browser } = require('@puppeteer/browsers');
    var platform = detectBrowserPlatform();
    var buildId = await resolveBuildId(Browser.CHROME, platform, '146.0.7680.31');
    var result = await install({ browser: Browser.CHROME, buildId: buildId, cacheDir: cacheDir, unpack: true, platform: platform, downloadProgressCallback: 'default' });
    console.log('[chrome] Chrome instalado:', result.executablePath);
  } catch (e) {
    console.error('[chrome] Falha ao baixar Chrome:', e.message);
  }
}

module.exports = ensureChrome;
