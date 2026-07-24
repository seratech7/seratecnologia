const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');

let WA_CLIENT = null;
let WA_READY = false;
let WA_QR = '';

function log(msg) { console.log('[wa-panel] ' + msg); }

async function getWaClient() {
  if (WA_CLIENT && WA_READY) return WA_CLIENT;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const waSessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');
    WA_CLIENT = new Client({
      authStrategy: new LocalAuth({ clientId: 'admin', dataPath: waSessionPath }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        headless: true
      }
    });
    WA_CLIENT.on('qr', qr => { WA_QR = qr; WA_READY = false; log('QR atualizado'); });
    WA_CLIENT.on('ready', () => { WA_READY = true; WA_QR = ''; log('Cliente pronto'); });
    WA_CLIENT.on('disconnected', r => { WA_READY = false; log('Desconectado: ' + r); });
    WA_CLIENT.on('auth_failure', m => { WA_READY = false; log('Falha auth: ' + m); });
    log('Inicializando cliente...');
    await WA_CLIENT.initialize();
    return WA_CLIENT;
  } catch (e) {
    log('Erro: ' + e.message);
    return null;
  }
}

function destroyWaClient() {
  if (WA_CLIENT) {
    try { WA_CLIENT.destroy(); } catch (e) {}
    WA_CLIENT = null; WA_READY = false; WA_QR = '';
  }
}

module.exports = function() {
  const router = express.Router();
  router.use(requireAdmin);

  // === DASHBOARD ===
  router.get('/whatsapp', async (req, res) => {
    const db = require('../database/db');
    const stats = db.getWaStats();
    const recent = db.getWaMessages(10, 0);
    const contacts = db.getWaContacts();
    res.render('admin/whatsapp', {
      title: 'WhatsApp - Painel Admin', currentPath: '/admin/whatsapp',
      stats, recent, contacts, waReady: WA_READY, waQr: WA_QR,
      error: null, success: null
    });
  });

  // === CONECTAR / DESCONECTAR ===
  router.post('/whatsapp/connect', async (req, res) => {
    try {
      if (WA_READY) return res.redirect('/admin/whatsapp');
      destroyWaClient();
      await getWaClient();
      res.redirect('/admin/whatsapp');
    } catch (e) {
      res.redirect('/admin/whatsapp?error=' + encodeURIComponent(e.message));
    }
  });

  router.post('/whatsapp/disconnect', (req, res) => {
    destroyWaClient();
    try {
      const waSessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');
      const dir = path.join(waSessionPath, 'admin');
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
    res.redirect('/admin/whatsapp');
  });

  router.get('/whatsapp/qr', (req, res) => {
    if (!WA_QR) return res.json({ qr: null, ready: WA_READY });
    res.json({ qr: WA_QR, ready: WA_READY });
  });

  // === ENVIAR MENSAGEM ===
  router.post('/whatsapp/send', async (req, res) => {
    const { phone, message } = req.body;
    const db = require('../database/db');
    try {
      if (!WA_READY) return res.redirect('/admin/whatsapp?error=' + encodeURIComponent('WhatsApp desconectado. Conecte primeiro.'));
      if (!phone || !message) return res.redirect('/admin/whatsapp?error=' + encodeURIComponent('Preencha telefone e mensagem.'));
      const cleaned = phone.replace(/\D/g, '');
      const chatId = cleaned.length >= 10 ? cleaned + '@c.us' : phone;
      await WA_CLIENT.sendMessage(chatId, message);
      db.addWaMessage(cleaned, '', message, 'sent');
      res.redirect('/admin/whatsapp?success=' + encodeURIComponent('Mensagem enviada para ' + phone));
    } catch (e) {
      db.addWaMessage(phone, '', message, 'failed');
      res.redirect('/admin/whatsapp?error=' + encodeURIComponent('Erro: ' + e.message));
    }
  });

  // === CONTATOS ===
  router.get('/whatsapp/contacts', (req, res) => {
    const db = require('../database/db');
    const search = req.query.search || '';
    const contacts = db.getWaContacts(search);
    res.render('admin/whatsapp-contacts', {
      title: 'Contatos WhatsApp - Painel Admin', currentPath: '/admin/whatsapp/contacts',
      contacts, search, error: null, success: null
    });
  });

  router.post('/whatsapp/contacts/add', (req, res) => {
    const db = require('../database/db');
    const { name, phone, notes } = req.body;
    if (!phone) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('Telefone obrigatório'));
    db.addWaContact(name||'', phone.replace(/\D/g, ''), notes||'');
    res.redirect('/admin/whatsapp/contacts?success=' + encodeURIComponent('Contato adicionado'));
  });

  router.post('/whatsapp/contacts/delete/:id', (req, res) => {
    const db = require('../database/db');
    db.deleteWaContact(req.params.id);
    res.redirect('/admin/whatsapp/contacts?success=' + encodeURIComponent('Contato removido'));
  });

  router.post('/whatsapp/contacts/import', (req, res) => {
    const db = require('../database/db');
    const { csv } = req.body;
    if (!csv) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('Cole os dados'));
    var lines = csv.split('\n').filter(Boolean);
    var parsed = [];
    lines.forEach(function(line) {
      var parts = line.split(/[,;\t]/);
      if (parts.length >= 1) {
        var p = parts[0].trim().replace(/\D/g, '');
        if (p.length >= 10) parsed.push({ name: parts[1]?.trim() || '', phone: p, notes: parts[2]?.trim() || '' });
      }
    });
    var count = db.importWaContacts(parsed);
    res.redirect('/admin/whatsapp/contacts?success=' + encodeURIComponent(count + ' contatos importados'));
  });

  router.post('/whatsapp/contacts/send-all', async (req, res) => {
    const db = require('../database/db');
    const { message } = req.body;
    if (!WA_READY) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('WhatsApp desconectado'));
    if (!message) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('Digite a mensagem'));
    const contacts = db.getWaContacts();
    let sent = 0; let failed = 0;
    for (const c of contacts) {
      try {
        const cleaned = c.phone.replace(/\D/g, '');
        if (cleaned.length >= 10) {
          await WA_CLIENT.sendMessage(cleaned + '@c.us', message);
          db.addWaMessage(cleaned, c.name, message, 'sent');
          sent++;
        }
      } catch (e) {
        db.addWaMessage(c.phone, c.name, message, 'failed');
        failed++;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    res.redirect('/admin/whatsapp/contacts?success=' + encodeURIComponent(sent + ' enviadas, ' + failed + ' falhas'));
  });

  // === HISTÓRICO ===
  router.get('/whatsapp/history', (req, res) => {
    const db = require('../database/db');
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const messages = db.getWaMessages(limit, offset);
    const total = db.getWaMessagesCount();
    res.render('admin/whatsapp-history', {
      title: 'Histórico WhatsApp - Painel Admin', currentPath: '/admin/whatsapp/history',
      messages, page, total, pages: Math.ceil(total / limit),
      error: null, success: null
    });
  });

  // === AGENDADOS ===
  router.get('/whatsapp/schedules', (req, res) => {
    const db = require('../database/db');
    const schedules = db.getWaSchedules();
    res.render('admin/whatsapp-schedule', {
      title: 'Agendamentos WhatsApp', currentPath: '/admin/whatsapp/schedules',
      schedules, error: null, success: null
    });
  });

  router.post('/whatsapp/schedules/add', (req, res) => {
    const db = require('../database/db');
    const { phone, message, scheduled_for } = req.body;
    if (!phone || !message || !scheduled_for) return res.redirect('/admin/whatsapp/schedules?error=' + encodeURIComponent('Preencha todos os campos'));
    db.addWaSchedule(phone.replace(/\D/g, ''), message, scheduled_for);
    res.redirect('/admin/whatsapp/schedules?success=' + encodeURIComponent('Agendado com sucesso'));
  });

  router.post('/whatsapp/schedules/delete/:id', (req, res) => {
    const db = require('../database/db');
    db.deleteWaSchedule(req.params.id);
    res.redirect('/admin/whatsapp/schedules');
  });

  // === EXECUTAR AGENDADOS (chamado via cron) ===
  router.post('/whatsapp/run-schedules', async (req, res) => {
    const db = require('../database/db');
    if (!WA_READY) return res.json({ ok: false, error: 'WhatsApp desconectado' });
    const pending = db.getPendingWaSchedules();
    let done = 0;
    for (const s of pending) {
      try {
        await WA_CLIENT.sendMessage(s.phone.replace(/\D/g, '') + '@c.us', s.message);
        db.addWaMessage(s.phone, '', s.message, 'sent');
        db.markWaScheduleDone(s.id);
        done++;
      } catch (e) { db.markWaScheduleDone(s.id); }
      await new Promise(r => setTimeout(r, 3000));
    }
    res.json({ ok: true, executed: done });
  });

  return router;
};
