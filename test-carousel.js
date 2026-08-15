const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('429') && !m.text().includes('404')) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:3000/logins', { waitUntil: 'networkidle2', timeout: 30000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 800));

  const info = await page.evaluate(() => {
    const car = document.getElementById('dfgTopCarousel');
    if (!car) return { ok:false, reason:'no carousel' };
    const slides = car.querySelectorAll('.dfg-slide');
    const dots = car.querySelectorAll('.dfg-dot');
    const active = car.querySelector('.dfg-slide.dfg-active');
    const heroText = document.querySelector('.dfg-hero h1');
    return {
      ok:true,
      slideCount: slides.length,
      dotCount: dots.length,
      activeIndex: Array.from(slides).indexOf(active),
      hasHero: !!heroText && /ENTREGA AUTOM/i.test(heroText.textContent),
      heroText: heroText ? heroText.textContent.trim() : null,
      hasInfo: !!document.querySelector('.dfg-ver-btn'),
      hasProdSlide: !!document.querySelector('.dfg-prod-slide'),
      prodName: (document.querySelector('.dfg-prod-slide .dfg-card-title')||{}).textContent || null
    };
  });

  // wait for auto-rotation (~5s interval) and re-check active index
  await new Promise(r => setTimeout(r, 5200));
  const after = await page.evaluate(() => {
    const car = document.getElementById('dfgTopCarousel');
    const slides = car.querySelectorAll('.dfg-slide');
    const active = car.querySelector('.dfg-slide.dfg-active');
    return { activeIndex: Array.from(slides).indexOf(active) };
  });

  console.log('INFO:', JSON.stringify(info, null, 2));
  console.log('AFTER 5.2s auto-rotate activeIndex:', after.activeIndex);
  console.log('JS errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
