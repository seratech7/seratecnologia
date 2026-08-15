const db = require('./database/db');
const puppeteer = require('puppeteer');
(async () => {
  await db.initDb();
  const prod = db.query("SELECT dp.*, (SELECT COUNT(*) FROM digital_stock ds WHERE ds.product_id=dp.id AND ds.status='available') as sc FROM digital_products dp ORDER BY sc DESC LIMIT 1")[0];
  const slug = prod.slug;
  console.log('produto teste:', prod.name, '| slug:', slug, '| estoque:', prod.sc);

  const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await p.goto('http://localhost:3000/logins/' + slug, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 600));
  const form = await p.evaluate(() => ({
    channels: document.querySelectorAll('input[name=delivery_channel]').length,
    obs: !!document.querySelector('textarea[name=observation]'),
    contactWrapHidden: document.getElementById('deliveryContactWrap') ? document.getElementById('deliveryContactWrap').style.display : 'N/A',
    action: document.querySelector('form') ? document.querySelector('form').getAttribute('action') : null
  }));
  console.log('FORM', JSON.stringify(form));

  // preencher e enviar
  await p.type('input[name=buyer_name]', 'Teste Comprador');
  await p.type('input[name=buyer_email]', 'teste@example.com');
  await p.evaluate(() => {
    const tel = document.querySelector('input[name=delivery_channel][value=telegram]');
    tel.checked = true; tel.dispatchEvent(new Event('change'));
  });
  await new Promise(r => setTimeout(r, 200));
  await p.type('#deliveryContactInput', '@meuteste');
  await p.type('textarea[name=observation]', 'observacao livre teste');
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    p.click('button[type=submit]')
  ]);
  const url = p.url();
  const delivery = await p.evaluate(() => ({
    body: document.body.innerText,
    hasTelegram: document.body.innerText.indexOf('Telegram') !== -1,
    hasObs: document.body.innerText.indexOf('observacao livre teste') !== -1,
    hasContact: document.body.innerText.indexOf('@meuteste') !== -1
  }));
  console.log('REDIRECT', url);
  console.log('DELIVERY', JSON.stringify(delivery));
  console.log('ERRORS', JSON.stringify(errs));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
