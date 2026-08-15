const db = require('./database/db');
(async () => {
  await db.initDb();
  const prods = db.getDigitalProducts({ active: true }) || [];
  const top = prods.slice(0, 5);
  top.forEach(p => db.run('UPDATE digital_products SET featured = 1 WHERE id = ?', [p.id]));
  console.log('featured ids:', top.map(p => p.id + ':' + p.name).join(' | '));

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.goto('http://localhost:3000/logins', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  const data = await page.evaluate(() => {
    const slides = [...document.querySelectorAll('#dfgTopCarousel .dfg-slide')];
    const prodSlides = slides.filter(s => s.querySelector('.dfg-prod-card') || s.querySelector('[class*="prod"]'));
    return {
      slideCount: slides.length,
      prodSlideCount: prodSlides.length,
      prodSlideNames: prodSlides.map(s => { const t = s.querySelector('.dfg-prod-card-title') || s.querySelector('.dfg-card-title'); return t ? t.textContent.trim() : null; }),
      dots: document.querySelectorAll('#dfgTopCarousel .dfg-dot').length,
      destaqueCards: [...document.querySelectorAll('.dfg-section-title + .dfg-grid .dfg-card')].length
    };
  });
  console.log('CAROUSEL', JSON.stringify(data));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
