const path = require('path');
const fs = require('fs');

const clients = new Map();

function log(msg) { console.log('[wa-manager] ' + msg); }

function findChromeInPuppeteerCache() {
  var cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(require('os').homedir(), '.cache', 'puppeteer');
  var chromeDir = path.join(cacheDir, 'chrome');
  if (!fs.existsSync(chromeDir)) return '';
  var versions = fs.readdirSync(chromeDir).filter(function(d) { return d.startsWith('win64-') || d.startsWith('linux-') || d.startsWith('mac-') || d.startsWith('chrome-linux'); });
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

async function initClient(accountId, sessionId) {
  const key = String(accountId);
  if (clients.has(key)) {
    try { await clients.get(key).client.destroy(); } catch (e) {}
    clients.delete(key);
  }
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const waSessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');
    var puppeteerOpts = {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: true
    };
    var chromePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || findChromeInPuppeteerCache() || '';
    if (!chromePath) { require('./ensure-chrome')(); chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || ''; }
    if (chromePath) puppeteerOpts.executablePath = chromePath;
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId || 'wa_' + accountId, dataPath: waSessionPath }),
      puppeteer: puppeteerOpts
    });
    const entry = { client, ready: false, qr: '' };
    client.on('qr', qr => { entry.qr = qr; entry.ready = false; });
    client.on('ready', () => { entry.ready = true; entry.qr = ''; });
    client.on('disconnected', r => { entry.ready = false; });
    client.on('auth_failure', m => { entry.ready = false; });
    clients.set(key, entry);
    await client.initialize();
    return { entry: entry, error: null };
  } catch (e) {
    log('Erro ao iniciar cliente ' + accountId + ': ' + e.message);
    return { entry: null, error: e.message };
  }
}

function destroyClient(accountId) {
  const key = String(accountId);
  if (clients.has(key)) {
    try { clients.get(key).client.destroy(); } catch (e) {}
    clients.delete(key);
  }
}

function destroyAll() {
  for (const key of clients.keys()) destroyClient(key);
}

function getState(accountId) {
  const key = String(accountId);
  if (clients.has(key)) {
    const entry = clients.get(key);
    return { ready: entry.ready, qr: entry.qr };
  }
  return { ready: false, qr: '' };
}

function getClient(accountId) {
  const key = String(accountId);
  return clients.has(key) ? clients.get(key).client : null;
}

function getReadyAccounts() {
  const result = [];
  for (const [key, entry] of clients) {
    if (entry.ready) result.push(parseInt(key));
  }
  return result;
}

module.exports = { initClient, destroyClient, destroyAll, getState, getClient, getReadyAccounts };
