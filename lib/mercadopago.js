const db = require('../database/db');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function getCreds() {
  const envAt = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const envPk = process.env.MERCADOPAGO_PUBLIC_KEY;
  const cfgAt = db.get("SELECT value FROM config WHERE key = 'mp_access_token'");
  const cfgPk = db.get("SELECT value FROM config WHERE key = 'mp_public_key'");
  return {
    accessToken: envAt || (cfgAt ? cfgAt.value : null),
    publicKey: envPk || (cfgPk ? cfgPk.value : null)
  };
}

function enabled() {
  return db.getToggle('mercado_pago') === '1';
}

async function createPreference({ title, price, payerEmail, externalRef }) {
  const { accessToken } = getCreds();
  if (!accessToken) throw new Error('MERCADO_PAGO_SEM_CREDENCIAIS');
  const body = {
    items: [{
      id: String(externalRef),
      title: String(title || 'Compra').slice(0, 200),
      quantity: 1,
      currency_id: 'BRL',
      unit_price: Number(price)
    }],
    payer: payerEmail ? { email: String(payerEmail).slice(0, 160) } : undefined,
    external_reference: String(externalRef),
    notification_url: BASE_URL + '/api/webhook/mercadopago',
    back_urls: {
      success: BASE_URL + '/entrega/' + encodeURIComponent(externalRef) + '?mp=1',
      failure: BASE_URL + '/entrega/' + encodeURIComponent(externalRef) + '?mp=0',
      pending: BASE_URL + '/entrega/' + encodeURIComponent(externalRef) + '?mp=2'
    },
    auto_return: 'approved'
  };
  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'MERCADO_PAGO_ERRO_PREFERENCIA');
  return data; // { id, init_point, sandbox_init_point }
}

async function getPayment(paymentId) {
  const { accessToken } = getCreds();
  if (!accessToken) throw new Error('MERCADO_PAGO_SEM_CREDENCIAIS');
  const r = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  return await r.json();
}

async function getPaymentsByExternalRef(externalRef) {
  const { accessToken } = getCreds();
  if (!accessToken) throw new Error('MERCADO_PAGO_SEM_CREDENCIAIS');
  const r = await fetch('https://api.mercadopago.com/v1/payments/search?external_reference=' + encodeURIComponent(externalRef), {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await r.json();
  return data.results || [];
}

async function getMerchantOrder(orderId) {
  const { accessToken } = getCreds();
  if (!accessToken) throw new Error('MERCADO_PAGO_SEM_CREDENCIAIS');
  const r = await fetch('https://api.mercadopago.com/merchant_orders/' + orderId, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  return await r.json();
}

// Aplica o resultado de um pagamento do MP sobre a venda e notifica o admin
async function applyPayment(sale, payment) {
  const st = (payment && payment.status) || 'pending';
  const pid = payment && payment.id ? String(payment.id) : null;
  // Não reverte uma venda já confirmada por uma notificação atrasada de recusa
  if (sale.status === 'confirmed' && (st === 'rejected' || st === 'cancelled')) return;
  if (st === 'approved') {
    db.updateDigitalSalePayment(sale.id, {
      payment_status: 'approved', status: 'confirmed', mp_payment_id: pid, paid_at: new Date().toISOString()
    });
    db.addNotification('', 'payment',
      'Venda aprovada (#' + sale.id + ') - ' + (sale.product_name || 'Produto') + ' - R$ ' + Number(sale.price).toFixed(2),
      'credit-card', '/admin/digital/vendas');
  } else if (st === 'rejected' || st === 'cancelled') {
    db.updateDigitalSalePayment(sale.id, { payment_status: st, status: 'cancelled', mp_payment_id: pid });
    if (sale.stock_id) db.run('UPDATE digital_stock SET status = ? WHERE id = ? AND status = ?', ['available', sale.stock_id, 'sold']);
    db.addNotification('', 'alert',
      'Pagamento NAO concluido (#' + sale.id + ') - ' + (sale.product_name || 'Produto') + ' - status: ' + st,
      'exclamation-triangle', '/admin/digital/vendas');
  } else if (st === 'refunded' || st === 'charged_back') {
    db.updateDigitalSalePayment(sale.id, { payment_status: st, status: 'cancelled', mp_payment_id: pid });
    if (sale.stock_id) db.run('UPDATE digital_stock SET status = ? WHERE id = ? AND status = ?', ['available', sale.stock_id, 'sold']);
    db.addNotification('', 'alert',
      'Pagamento estornado (#' + sale.id + ') - ' + (sale.product_name || 'Produto'),
      'exclamation-triangle', '/admin/digital/vendas');
  }
  // pending / in_process: mantém pendente, sem ação
}

module.exports = { getCreds, enabled, createPreference, getPayment, getPaymentsByExternalRef, getMerchantOrder, applyPayment, BASE_URL };
