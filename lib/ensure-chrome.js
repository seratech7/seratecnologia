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
        for (var k = 0; k < 3; k++) {
          var bin = d + ['/chrome', '/chrome.exe', '/chromium-browser'][k];
          if (fs.existsSync(bin)) return bin;
        }
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
    var installer = path.join(__dirname, '..', 'node_modules', 'puppeteer', 'install.mjs');
    execSync('node "' + installer + '"', { stdio: 'inherit', timeout: 300000, cwd: __dirname, env: Object.assign({}, process.env, { PUPPETEER_SKIP_DOWNLOAD: 'false' }) });
    found = findChrome();
    if (found) process.env.PUPPETEER_EXECUTABLE_PATH = found;
    console.log('[chrome] OK:', found || 'nao encontrado apos install');
  } catch (e) {
    console.error('[chrome] Falha:', e.message);
  }
}

module.exports = ensureChrome;
