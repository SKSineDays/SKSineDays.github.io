// Isolated welcome layout: no auth, account, profile storage, or network traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/css/dashboard.css?v=origin-welcome-1">
</head><body class="dashboard-body">
<main style="max-width:780px;margin:auto">
<section class="dashboard-page feature-screen feature-screen--origin is-active" aria-hidden="false">
<div class="container dashboard-page__card feature-screen__content"><div class="origin-identity">
<div class="duck-carousel-wrap"><div class="duck-carousel-header"><h2 class="duck-carousel-title">Your Origin</h2></div></div>
</div></div></section></main>
<script type="module">
import { DuckCarousel } from '/js/duck-carousel.js?v=origin-welcome-1';
window.carousel = new DuckCarousel(document.querySelector('.duck-carousel-wrap'));
carousel.setProfiles([]);
</script></body></html>`;
const mime = { '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };

(async () => {
  const browser = await chromium.launch({
    ...(process.env.GLOBE_BROWSER_EXECUTABLE ? {executablePath:process.env.GLOBE_BROWSER_EXECUTABLE} : {}),
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}, hasTouch:true});
    const exceptions = [];
    page.on('pageerror', err => exceptions.push(err.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'sineday.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:fixture});
      if (url.pathname === '/js/origin-globe.js') {
        return route.fulfill({contentType:'application/javascript',body:'export class OriginGlobe {}'});
      }
      const filename = path.join(root,url.pathname);
      if (!fs.existsSync(filename)) return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:mime[path.extname(filename)] || 'application/octet-stream',path:filename});
    });
    await page.goto('http://sineday.test/');
    const welcome = page.locator('.duck-ring__empty');
    const bubble = welcome.locator('.duck-ring__welcome-bubble');
    const portrait = welcome.locator('.duck-ring__welcome-duck');
    const art = portrait.locator('img');
    await welcome.waitFor();
    assert.equal(await art.getAttribute('src'), '/assets/sineducks/SineDuckFinale17.svg');
    assert.equal(await art.getAttribute('alt'), '');
    await art.evaluate(image => image.decode());
    assert.equal(await bubble.locator('.duck-ring__welcome-name').textContent(), 'SineDuck 17');
    assert.equal(await bubble.locator('p').textContent(), 'Add a profile to see your first Origin Duck.');

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({width,height:844});
      const scene = await welcome.boundingBox();
      const dialog = await bubble.boundingBox();
      const duck = await portrait.boundingBox();
      assert.ok(duck.x >= scene.x && duck.x + duck.width < dialog.x);
      assert.ok(dialog.x + dialog.width <= scene.x + scene.width);
      assert.ok(await bubble.evaluate(el => el.scrollWidth <= el.clientWidth));
      const output = process.env.ORIGIN_WELCOME_QA_OUTPUT;
      if (output) {
        fs.mkdirSync(output,{recursive:true});
        await page.locator('.duck-ring__scene').screenshot({path:path.join(output,width+'.png'),scale:'css'});
      }
    }

    await page.evaluate(() => carousel.setProfiles([{
      id:'qa-profile',display_name:'Sample profile',birthdate:'1985-04-20',timezone:'America/Chicago'
    }]));
    assert.equal(await welcome.isVisible(), false);
    assert.equal(await page.locator('.duck-stack').count(), 1);
    await page.evaluate(() => carousel.setProfiles([]));
    assert.equal(await welcome.isVisible(), true);
    assert.deepEqual(exceptions, []);
    console.log('Origin welcome: official artwork, no clipping at 320/390/1280 px, and profile transition passed.');
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
