const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');

let bot = null;
let botInterval = null;

function getConfig() {
  var token = process.env.TELEGRAM_BOT_TOKEN || '';
  var groupId = process.env.TELEGRAM_GROUP_ID || '';
  var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_bot_token'");
  if (cfg && cfg.value) token = cfg.value;
  cfg = db.get("SELECT value FROM config WHERE key = 'telegram_group_id'");
  if (cfg && cfg.value) groupId = cfg.value;
  return { token, groupId };
}

function startBot() {
  var { token, groupId } = getConfig();
  if (!token) { console.log('[Telegram] Nenhum token configurado'); return; }
  if (bot) { stopBot(); }
  try {
    bot = new TelegramBot(token, { polling: true });
    bot.on('message', handleMessage);
    bot.on('polling_error', function(err) { console.error('[Telegram] Polling error:', err.message); });
    console.log('[Telegram] Bot iniciado' + (groupId ? ' (grupo: ' + groupId + ')' : ''));
    botInterval = setInterval(function() {
      var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_bot_token'");
      var newToken = cfg && cfg.value ? cfg.value : '';
      var envToken = process.env.TELEGRAM_BOT_TOKEN || '';
      if (newToken !== token && newToken) {
        console.log('[Telegram] Token alterado, reiniciando bot');
        startBot();
      }
    }, 60000);
  } catch (e) {
    console.error('[Telegram] Erro ao iniciar bot:', e.message);
  }
}

function stopBot() {
  if (botInterval) { clearInterval(botInterval); botInterval = null; }
  if (bot) {
    try { bot.stopPolling(); } catch(e) {}
    bot = null;
  }
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
    bot.sendMessage(chatId, '📌 ID deste chat: `' + chatId + '`' + (msg.chat.title ? '\nNome: ' + msg.chat.title : ''), { parse_mode: 'Markdown' });
  } else if (text === '/start') {
    bot.sendMessage(chatId,
      '🤖 *Bot SeraTecnologia*\n\n' +
      'Comandos disponíveis:\n' +
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
    bot.sendMessage(chatId,
      '📊 *Status do Marketplace*\n\n' +
      '📦 Produtos: ' + total.c + '\n' +
      '✅ Ativos: ' + active.c + '\n' +
      '🏪 Vendedores: ' + sellers.c + '\n' +
      '💰 Vendas: ' + sales.c,
      { parse_mode: 'Markdown' }
    );
  } else if (text === '/ajuda') {
    bot.sendMessage(chatId, 'Comandos: /start /status /vendedor_id /ajuda');
  } else if (text.indexOf('/vendedor_id ') === 0) {
    var email = text.substring(13).trim();
    var seller = db.get('SELECT id, name FROM sellers WHERE email = ?', [email]);
    if (seller) {
      db.run("UPDATE sellers SET telegram_id = ? WHERE id = ?", [String(from.id), seller.id]);
      db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('telegram_chat_' + ?, ?)", [seller.id, String(chatId)]);
      bot.sendMessage(chatId, '✅ Conta vinculada com sucesso, ' + seller.name + '!');
    } else {
      bot.sendMessage(chatId, '❌ Vendedor não encontrado com este email.');
    }
  }
}

function sendToGroup(message, parseMode) {
  var { groupId } = getConfig();
  if (!bot || !groupId) return false;
  try {
    bot.sendMessage(groupId, message, parseMode ? { parse_mode: parseMode } : {});
    return true;
  } catch(e) {
    console.error('[Telegram] Erro ao enviar:', e.message);
    return false;
  }
}

function sendToSeller(sellerId, message) {
  if (!bot) return false;
  var cfg = db.get("SELECT value FROM config WHERE key = 'telegram_chat_" + sellerId + "'");
  if (!cfg || !cfg.value) return false;
  try {
    bot.sendMessage(cfg.value, message, { parse_mode: 'Markdown' });
    return true;
  } catch(e) {
    console.error('[Telegram] Erro ao enviar para vendedor:', e.message);
    return false;
  }
}

function sendToUser(chatId, message) {
  if (!bot) return false;
  try {
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return true;
  } catch(e) {
    console.error('[Telegram] Erro ao enviar para usuário:', e.message);
    return false;
  }
}

function getBotStatus() {
  return { running: bot !== null, token: !!getConfig().token, groupId: getConfig().groupId || '' };
}

function notifyNewSale(sale) {
  var msg = '🛒 *Nova Venda!*\n\n' +
    'Produto: ' + (sale.product_name || '') + '\n' +
    'Valor: R$ ' + (parseFloat(sale.product_price) || 0).toFixed(2) + '\n' +
    'Comprador: ' + (sale.buyer_name || '') + '\n' +
    'Código: ' + (sale.product_code || '');
  sendToGroup(msg, 'Markdown');
  if (sale.seller_id) sendToSeller(sale.seller_id, msg);
}

function notifyNewProduct(product) {
  var msg = '📦 *Novo Produto*\n\n' +
    'Produto: ' + (product.name || '') + '\n' +
    'Preço: R$ ' + (parseFloat(product.price) || 0).toFixed(2) + '\n' +
    'Vendedor: ' + (product.seller_name || product.seller_id || '');
  sendToGroup(msg, 'Markdown');
}

module.exports = { startBot, stopBot, getConfig, sendToGroup, sendToSeller, sendToUser, getBotStatus, notifyNewSale, notifyNewProduct };
