const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findChrome() {
  var cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(require('os').homedir(), '.cache', 'puppeteer');
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
  console.log('[chrome] Baixando Chrome...');
  try {
    execSync('npx --yes @puppeteer/browsers install chrome@146.0.7680.31', { stdio: 'inherit', timeout: 180000, cwd: __dirname });
    found = findChrome();
    if (found) {
      process.env.PUPPETEER_EXECUTABLE_PATH = found;
      console.log('[chrome] OK:', found);
    } else {
      console.log('[chrome] Baixado mas nao encontrado no cache');
    }
  } catch (e) {
    console.error('[chrome] Falha:', e.message);
  }
}

module.exports = ensureChrome;
