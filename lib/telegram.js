var https = require('https');
var db = require('../database/db');

var polling = false;
var pollTimeout = null;
var pollInterval = null;
var lastOffset = 0;
var currentToken = '';

function getConfig() {
  var token = process.env.TELEGRAM_BOT_TOKEN || '';
  var groupId = process.env.TELEGRAM_GROUP_ID || '';
  var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_bot_token'");
  if (!token && cfg && cfg.value) token = cfg.value;
  cfg = db.get("SELECT value FROM config WHERE key = 'telegram_group_id'");
  if (!groupId && cfg && cfg.value) groupId = cfg.value;
  return { token, groupId };
}

function apiCall(method, params, callback) {
  var token = getConfig().token;
  if (!token) { if (callback) callback(null); return; }
  var data = JSON.stringify(params || {});
  var url = 'https://api.telegram.org/bot' + token + '/' + method;
  var options = {
    hostname: 'api.telegram.org',
    path: '/bot' + token + '/' + method,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try { var r = JSON.parse(body); if (callback) callback(r); }
      catch(e) { if (callback) callback(null); }
    });
  });
  req.on('error', function(err) { console.error('[Telegram] Erro ' + method + ':', err.message); if (callback) callback(null); });
  req.write(data);
  req.end();
}

function sendMessage(chatId, text, opts) {
  var params = { chat_id: chatId, text: text };
  if (opts && opts.parse_mode) params.parse_mode = opts.parse_mode;
  apiCall('sendMessage', params);
}

function pollLoop() {
  if (!polling) return;
  var token = getConfig().token;
  if (!token) { polling = false; console.log('[Telegram] Token vazio, parando polling'); return; }
  var params = { offset: lastOffset + 1, timeout: 30, allowed_updates: ['message'] };
  var data = JSON.stringify(params);
  var options = {
    hostname: 'api.telegram.org',
    path: '/bot' + token + '/getUpdates',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    timeout: 35000
  };
  var req = https.request(options, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      if (!polling) return;
      try {
        var r = JSON.parse(body);
        if (r.ok && r.result) {
          r.result.forEach(function(upd) {
            if (upd.message) handleMessage(upd.message);
            if (upd.update_id > lastOffset) lastOffset = upd.update_id;
          });
        }
      } catch(e) { console.error('[Telegram] Erro parsing updates:', e.message); }
      pollTimeout = setTimeout(pollLoop, 1000);
    });
  });
  req.on('error', function(err) { console.error('[Telegram] Polling error:', err.message); pollTimeout = setTimeout(pollLoop, 5000); });
  req.on('timeout', function() { req.destroy(); pollTimeout = setTimeout(pollLoop, 1000); });
  req.write(data);
  req.end();
}

function startBot() {
  var { token, groupId } = getConfig();
  if (!token) { console.log('[Telegram] Nenhum token configurado'); return; }
  stopBot();
  currentToken = token;
  polling = true;
  console.log('[Telegram] Bot iniciado' + (groupId ? ' (grupo: ' + groupId + ')' : ''));
  pollLoop();
  pollInterval = setInterval(function() {
    var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_bot_token'");
    var newToken = cfg && cfg.value ? cfg.value : '';
    if (newToken !== currentToken && newToken) {
      console.log('[Telegram] Token alterado, reiniciando bot');
      startBot();
    }
  }, 60000);
}

function stopBot() {
  polling = false;
  if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function handleMessage(msg) {
  if (!msg || !msg.text) return;
  var chatId = msg.chat.id;
  var text = msg.text.trim();
  var from = msg.from;
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    console.log('[Telegram] Mensagem recebida do grupo ID:', msg.chat.id, '- Nome:', msg.chat.title);
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('telegram_last_group_id', ?)", [String(msg.chat.id)]);
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('telegram_last_group_name', ?)", [msg.chat.title || '']);
  }
  if (text === '/id') {
    sendMessage(chatId, '\uD83D\uDCCC ID deste chat: `' + chatId + '`' + (msg.chat.title ? '\nNome: ' + msg.chat.title : ''), { parse_mode: 'Markdown' });
  } else if (text === '/start') {
    sendMessage(chatId,
      '\uD83E\uDD16 *Bot SeraTecnologia*\n\n' +
      'Comandos dispon\u00EDveis:\n' +
      '/start - Mostrar esta mensagem\n' +
      '/status - Status do marketplace\n' +
      '/vendedor\\_id \\<email\\> - Vincular sua conta de vendedor\n' +
      '/ajuda - Ajuda',
      { parse_mode: 'Markdown' }
    );
  } else if (text === '/status') {
    var total = db.get('SELECT COUNT(*) as c FROM products') || {c:0};
    var active = db.get("SELECT COUNT(*) as c FROM products WHERE status='active'") || {c:0};
    var sellers = db.get('SELECT COUNT(*) as c FROM sellers') || {c:0};
    var sales = db.get("SELECT COUNT(*) as c FROM sales WHERE status NOT IN ('cancelled','pending')") || {c:0};
    sendMessage(chatId,
      '\uD83D\uDCCA *Status do Marketplace*\n\n' +
      '\uD83D\uDCE6 Produtos: ' + total.c + '\n' +
      '\u2705 Ativos: ' + active.c + '\n' +
      '\uD83C\uDFEA Vendedores: ' + sellers.c + '\n' +
      '\uD83D\uDCB0 Vendas: ' + sales.c,
      { parse_mode: 'Markdown' }
    );
  } else if (text === '/ajuda') {
    sendMessage(chatId, 'Comandos: /start /status /vendedor_id /ajuda');
  } else if (text.indexOf('/vendedor_id ') === 0) {
    var email = text.substring(13).trim();
    var seller = db.get('SELECT id, name FROM sellers WHERE email = ?', [email]);
    if (seller) {
      db.run("UPDATE sellers SET telegram_id = ? WHERE id = ?", [String(from.id), seller.id]);
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('telegram_chat_' + ?, ?)", [seller.id, String(chatId)]);
      sendMessage(chatId, '\u2705 Conta vinculada com sucesso, ' + seller.name + '!');
    } else {
      sendMessage(chatId, '\u274C Vendedor n\u00E3o encontrado com este email.');
    }
  }
}

function sendToGroup(message, parseMode) {
  var { groupId } = getConfig();
  if (!groupId) return false;
  try { sendMessage(groupId, message, parseMode ? { parse_mode: parseMode } : {}); return true; }
  catch(e) { console.error('[Telegram] Erro ao enviar:', e.message); return false; }
}

function sendToSeller(sellerId, message) {
  var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_chat_" + sellerId + "'");
  if (!cfg || !cfg.value) return false;
  try { sendMessage(cfg.value, message, { parse_mode: 'Markdown' }); return true; }
  catch(e) { console.error('[Telegram] Erro ao enviar para vendedor:', e.message); return false; }
}

function sendToUser(chatId, message) {
  try { sendMessage(chatId, message, { parse_mode: 'Markdown' }); return true; }
  catch(e) { console.error('[Telegram] Erro ao enviar para usuário:', e.message); return false; }
}

function getBotStatus() {
  return { running: polling, token: !!getConfig().token, groupId: getConfig().groupId || '' };
}

function notifyNewSale(sale) {
  var msg = '\uD83D\uDED2 *Nova Venda!*\n\n' +
    'Produto: ' + (sale.product_name || '') + '\n' +
    'Valor: R$ ' + (parseFloat(sale.product_price) || 0).toFixed(2) + '\n' +
    'Comprador: ' + (sale.buyer_name || '') + '\n' +
    'C\u00F3digo: ' + (sale.product_code || '');
  sendToGroup(msg, 'Markdown');
  if (sale.seller_id) sendToSeller(sale.seller_id, msg);
}

function notifyNewProduct(product) {
  var msg = '\uD83D\uDCE6 *Novo Produto*\n\n' +
    'Produto: ' + (product.name || '') + '\n' +
    'Pre\u00E7o: R$ ' + (parseFloat(product.price) || 0).toFixed(2) + '\n' +
    'Vendedor: ' + (product.seller_name || product.seller_id || '');
  sendToGroup(msg, 'Markdown');
}

module.exports = { startBot, stopBot, getConfig, sendToGroup, sendToSeller, sendToUser, getBotStatus, notifyNewSale, notifyNewProduct };