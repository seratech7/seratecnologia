var https = require('https');

function sendEmail(to, subject, html) {
  var apiKey = process.env.SENDGRID_API_KEY || '';
  var fromEmail = process.env.SMTP_FROM || 'noreply@seratecnologia.com';
  var fromName = 'SeraTecnologia';

  if (apiKey) {
    var data = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject: subject,
      content: [{ type: 'text/html', value: html }]
    });

    var opts = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    var req = https.request(opts, function(res) {
      console.log('[email] Enviado para ' + to + ' - status ' + res.statusCode);
    });
    req.on('error', function(e) {
      console.error('[email] Erro: ' + e.message);
    });
    req.write(data);
    req.end();
  } else {
    console.log('[email] Sem SENDGRID_API_KEY configurada. Log: Para ' + to + ' - ' + subject);
  }
}

function sendTrackingUpdate(sale, statusLabel, message) {
  if (!sale || !sale.buyer_email) return;
  var subject = '📦 Atualização do seu pedido ' + sale.tracking_code;
  var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
    '<div style="background:#1565c0;color:#fff;padding:24px;text-align:center;border-radius:8px 8px 0 0;">' +
    '<h1 style="margin:0;font-size:20px;">Atualização de Pedido</h1>' +
    '<p style="margin:4px 0 0;opacity:0.9;">' + sale.tracking_code + '</p>' +
    '</div>' +
    '<div style="background:#fff;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">' +
    '<p>Olá <strong>' + (sale.buyer_name || '') + '</strong>,</p>' +
    '<p>Seu pedido <strong>' + sale.product_code + '</strong> (' + sale.product_name + ') foi atualizado.</p>' +
    '<div style="background:#e3f2fd;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">' +
    '<div style="font-size:18px;font-weight:700;color:#1565c0;">' + statusLabel + '</div>' +
    '<div style="font-size:14px;color:#666;margin-top:4px;">' + message + '</div>' +
    '</div>' +
    '<a href="https://seratecnologia-1.onrender.com/rastreio?codigo=' + sale.tracking_code + '" style="display:block;text-align:center;background:#1565c0;color:#fff;text-decoration:none;padding:12px;border-radius:8px;font-weight:600;margin:16px 0;">Acompanhar Pedido</a>' +
    '<p style="font-size:12px;color:#999;">Este é um e-mail automático. Não responda.</p>' +
    '</div></div>';
  sendEmail(sale.buyer_email, subject, html);
}

module.exports = { sendEmail, sendTrackingUpdate };