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
  var found = findChrome();
  if (found) {
    process.env.PUPPETEER_EXECUTABLE_PATH = found;
    return console.log('[chrome] Chrome:', found);
  }
  console.log('[chrome] Baixando Chrome via @puppeteer/browsers...');
  try {
    var { install, resolveBuildId, detectBrowserPlatform, Browser } = require('@puppeteer/browsers');
    var cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    var platform = detectBrowserPlatform();
    resolveBuildId(Browser.CHROME, platform, '146.0.7680.31').then(function(buildId) {
      return install({ browser: Browser.CHROME, buildId: buildId, cacheDir: cacheDir, unpack: true, platform: platform, downloadProgressCallback: 'default' });
    }).then(function(result) {
      process.env.PUPPETEER_EXECUTABLE_PATH = result.executablePath;
      console.log('[chrome] OK:', result.executablePath);
    }).catch(function(e) {
      console.error('[chrome] Falha ao baixar:', e.message);
    });
  } catch (e) {
    console.error('[chrome] Erro:', e.message);
  }
}

module.exports = ensureChrome;
