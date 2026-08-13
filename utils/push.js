require('dotenv').config();
const webpush = require('web-push');

// Configura VAPID se as chaves estiverem no .env
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@' + (process.env.SITE_URL || 'localhost').replace(/^https?:\/\//, '').replace(/\/.*/, '');

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

function getPublicKey() {
  if (VAPID_PUBLIC) return VAPID_PUBLIC;
  // Gera em memória se não configurado (para dev)
  const { publicKey } = webpush.generateVAPIDKeys();
  return publicKey;
}

function hasKeys() {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

async function sendPushNotification(subscription, title, body, url) {
  if (!subscription || !subscription.endpoint) return false;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  let keys;
  try { keys = JSON.parse(subscription.keys_json || '{}'); } catch (e) { keys = {}; }
  const sub = {
    endpoint: subscription.endpoint,
    keys: keys || {}
  };
  const payload = JSON.stringify({ title, body: body || '', icon: '/favicon.ico', url: url || '/' });
  try {
    await webpush.sendNotification(sub, payload);
    return true;
  } catch (e) {
    if (e && e.statusCode === 404) {
      // Assinatura expirada — remove
      try {
        const attraction = require('./attraction');
        attraction.deletePushSubscription(subscription.endpoint);
      } catch (err) {}
    }
    return false;
  }
}

async function sendPushToAll(title, body, url) {
  const attraction = require('./attraction');
  const subs = attraction.getPushSubscriptions();
  let sent = 0;
  for (const s of subs) {
    const ok = await sendPushNotification(s, title, body, url);
    if (ok) sent++;
  }
  return { sent, total: subs.length };
}

module.exports = { getPublicKey, hasKeys, sendPushNotification, sendPushToAll };
