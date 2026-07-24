const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');
const waManager = require('../lib/whatsapp-manager');

module.exports = function() {
  const router = express.Router();
  router.use(requireAdmin);

  // === DASHBOARD ===
  router.get('/whatsapp', async (req, res) => {
    const db = require('../database/db');
    const accounts = db.getWaAccounts();
    const stats = db.getWaStats();
    const recent = db.getWaMessages(10, 0);
    const contacts = db.getWaContacts();
    const accountsWithState = accounts.map(function(a) {
      var state = waManager.getState(a.id);
      return Object.assign({}, a, { waReady: state.ready, waQr: state.qr });
    });
    res.render('admin/whatsapp', {
      title: 'WhatsApp - Painel Admin',
      accounts: accountsWithState,
      stats, recent, contacts,
      error: req.query.error || null,
      success: req.query.success || null
    });
  });

  // === GERENCIAR CONTAS ===
  router.post('/whatsapp/account/new', (req, res) => {
    const db = require('../database/db');
    var id = db.saveWaAccount(null, req.body.name || 'WhatsApp', req.body.phone || '');
    req.flash('Conta "' + (req.body.name || 'WhatsApp') + '" criada!', 'success');
    res.redirect('/admin/whatsapp');
  });

  router.post('/whatsapp/account/rename/:id', (req, res) => {
    const db = require('../database/db');
    db.saveWaAccount(req.params.id, req.body.name, req.body.phone || '');
    req.flash('Conta renomeada!', 'success');
    res.redirect('/admin/whatsapp');
  });

  router.post('/whatsapp/account/delete/:id', (req, res) => {
    const db = require('../database/db');
    waManager.destroyClient(req.params.id);
    db.deleteWaAccount(req.params.id);
    try {
      const waSessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(__dirname, '..', 'wa_session');
      const dir = path.join(waSessionPath, 'wa_' + req.params.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
    req.flash('Conta removida!', 'success');
    res.redirect('/admin/whatsapp');
  });

  // === CONECTAR / DESCONECTAR ===
  router.post('/whatsapp/connect/:id', async (req, res) => {
    const db = require('../database/db');
    const account = db.getWaAccount(req.params.id);
    if (!account) return res.redirect('/admin/whatsapp?error=Conta n\u00e3o encontrada');
    try {
      db.setWaAccountStatus(req.params.id, 'connecting', '');
      const entry = await waManager.initClient(req.params.id, 'wa_' + req.params.id);
      if (entry) {
        db.setWaAccountStatus(req.params.id, entry.ready ? 'connected' : 'waiting_qr', '');
      } else {
        db.setWaAccountStatus(req.params.id, 'error', 'Erro ao iniciar cliente');
      }
    } catch (e) {
      db.setWaAccountStatus(req.params.id, 'error', e.message);
    }
    res.redirect('/admin/whatsapp');
  });

  router.post('/whatsapp/disconnect/:id', (req, res) => {
    const db = require('../database/db');
    waManager.destroyClient(req.params.id);
    db.setWaAccountStatus(req.params.id, 'disconnected', '');
    req.flash('WhatsApp desconectado!', 'info');
    res.redirect('/admin/whatsapp');
  });

  router.get('/whatsapp/qr/:id', (req, res) => {
    const state = waManager.getState(req.params.id);
    if (!state.qr) return res.json({ qr: null, ready: state.ready });
    res.json({ qr: state.qr, ready: state.ready });
  });

  // === ENVIAR MENSAGEM ===
  router.post('/whatsapp/send', async (req, res) => {
    const { phone, message, account_id } = req.body;
    const db = require('../database/db');
    const aid = account_id || (db.getWaAccounts().filter(a => a.status === 'connected')[0] || {}).id;
    if (!aid) return res.redirect('/admin/whatsapp?error=' + encodeURIComponent('Nenhuma conta conectada'));
    const state = waManager.getState(aid);
    if (!state.ready) return res.redirect('/admin/whatsapp?error=' + encodeURIComponent('WhatsApp desconectado. Conecte primeiro.'));
    if (!phone || !message) return res.redirect('/admin/whatsapp?error=' + encodeURIComponent('Preencha telefone e mensagem.'));
    try {
      const cleaned = phone.replace(/\D/g, '');
      const chatId = cleaned.length >= 10 ? cleaned + '@c.us' : phone;
      var client = waManager.getClient(aid);
      if (!client) throw new Error('Cliente n\u00e3o dispon\u00edvel');
      await client.sendMessage(chatId, message);
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
      title: 'Contatos WhatsApp - Painel Admin',
      contacts, search,
      error: req.query.error || null, success: req.query.success || null
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
    const { message, account_id } = req.body;
    const aid = account_id || (db.getWaAccounts().filter(a => a.status === 'connected')[0] || {}).id;
    if (!aid) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('Nenhuma conta conectada'));
    const state = waManager.getState(aid);
    if (!state.ready) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('WhatsApp desconectado'));
    if (!message) return res.redirect('/admin/whatsapp/contacts?error=' + encodeURIComponent('Digite a mensagem'));
    const contacts = db.getWaContacts();
    let sent = 0; let failed = 0;
    for (const c of contacts) {
      try {
        const cleaned = c.phone.replace(/\D/g, '');
        if (cleaned.length >= 10) {
          var client = waManager.getClient(aid);
      if (client) await client.sendMessage(cleaned + '@c.us', message);
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
      title: 'Hist\u00f3rico WhatsApp - Painel Admin',
      messages, page, total, pages: Math.ceil(total / limit),
      error: req.query.error || null, success: req.query.success || null
    });
  });

  // === AGENDADOS ===
  router.get('/whatsapp/schedules', (req, res) => {
    const db = require('../database/db');
    const schedules = db.getWaSchedules();
    res.render('admin/whatsapp-schedule', {
      title: 'Agendamentos WhatsApp',
      schedules,
      error: req.query.error || null, success: req.query.success || null
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

  // === EXECUTAR AGENDADOS ===
  router.post('/whatsapp/run-schedules', async (req, res) => {
    const db = require('../database/db');
    const accounts = db.getWaAccounts();
    const connected = accounts.filter(function(a) {
      var state = waManager.getState(a.id);
      return state.ready;
    });
    if (connected.length === 0) return res.json({ ok: false, error: 'Nenhuma conta conectada' });
    const pending = db.getPendingWaSchedules();
    let done = 0;
    for (const s of pending) {
      const clientInfo = connected[0];
      try {
        var cl = waManager.getClient(clientInfo.id);
        if (cl) await cl.sendMessage(s.phone.replace(/\D/g, '') + '@c.us', s.message);
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
