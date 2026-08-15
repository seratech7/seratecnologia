const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:3000/logins', { waitUntil: 'networkidle0' });

  const before = await page.evaluate(() => {
    const body = document.body;
    const mc = document.querySelector('.main-content');
    const price = document.querySelector('.dfg-price');
    const cs = getComputedStyle(body);
    return {
      bodyClass: body.className,
      bodyBg: cs.backgroundColor,
      mcBg: mc ? getComputedStyle(mc).backgroundColor : 'NO MC',
      priceColor: price ? getComputedStyle(price).color : 'NO PRICE',
      hasToggle: typeof window.toggleHackerTheme
    };
  });

  // click toggle
  await page.click('#themeToggle');
  await new Promise(r => setTimeout(r, 300));

  const after = await page.evaluate(() => {
    const body = document.body;
    const mc = document.querySelector('.main-content');
    const price = document.querySelector('.dfg-price');
    const cs = getComputedStyle(body);
    return {
      bodyClass: body.className,
      bodyBg: cs.backgroundColor,
      mcBg: mc ? getComputedStyle(mc).backgroundColor : 'NO MC',
      priceColor: price ? getComputedStyle(price).color : 'NO PRICE'
    };
  });

  console.log('=== BEFORE click ===');
  console.log(JSON.stringify(before, null, 2));
  console.log('=== AFTER click ===');
  console.log(JSON.stringify(after, null, 2));
  console.log('=== JS errors ===');
  console.log(errors.length ? errors.join('\n') : 'none');

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
