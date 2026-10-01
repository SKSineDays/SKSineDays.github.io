// Local HTTP + real worker, with no production requests or membership data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };

(async () => {
  let current = false;
  let apiRequests = 0;
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/__worker_test__') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Local PWA verification</title>');
    }
    if (pathname.startsWith('/api/')) {
      apiRequests++;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ groups: [] }));
    }
    if (pathname.startsWith('/assets/globe/')) {
      res.writeHead(503);
      return res.end('Optional Earth asset unavailable');
    }
    try {
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const body = !current && ['service-worker.js', 'js/duck-carousel.js', 'css/dashboard.css'].includes(file)
        ? execFileSync('git', ['show', `${process.env.GLOBE_BASE_REF || '5fa74d1'}:${file}`], { cwd: root })
        : fs.readFileSync(path.join(root, file));
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    ...(process.env.GLOBE_BROWSER_EXECUTABLE ? { executablePath: process.env.GLOBE_BROWSER_EXECUTABLE } : {}),
    headless: true, args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/__worker_test__`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/service-worker.js');
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    const old = await page.evaluate(async () => (await fetch('/js/duck-carousel.js')).text());
    assert.ok(old.includes('new OriginGlobe'));
    assert.ok((await page.evaluate(async()=>caches.keys())).includes('sineday-v34'));
    current = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      await registration.update();
      await changed;
    });
    // Deliberately recreate a retired cache: the current worker must ignore it.
    await page.evaluate(async () => {
      const retired = await caches.open('sineday-v34');
      await retired.put('/js/origin-globe.js', new Response('stale module'));
    });
    const assets = await page.evaluate(async () => {
      const read = async url => (await fetch(url)).text();
      return {
        carousel: await read('/js/duck-carousel.js?v=earth-2'),
        controller: await read('/js/origin-globe.js'),
        css: await read('/css/dashboard.css?v=earth-2'),
        three: await read('/assets/vendor/three-r180/three.module.min.js'),
        textureStatus: (await fetch('/assets/globe/earth-july-2004.jpg')).status
      };
    });
    assert.ok(assets.carousel.includes('new OriginGlobe'));
    assert.ok(assets.controller.includes('export class OriginGlobe'));
    assert.ok(assets.css.includes('.origin-earth'));
    assert.ok(assets.css.includes('grid-area: 1 / 1'));
    assert.ok(assets.three.includes('./three.core.min.js'));
    assert.equal(assets.textureStatus, 503);
    await page.evaluate(async () => { await fetch('/api/globe/groups'); await fetch('/api/globe/groups'); });
    assert.equal(apiRequests, 2);
    const cachedApi = await page.evaluate(async () => {
      for (const key of await caches.keys()) {
        if ((await (await caches.open(key)).keys()).some(request => new URL(request.url).pathname.startsWith('/api/'))) return true;
      }
      return false;
    });
    assert.equal(cachedApi, false);
    assert.ok((await page.evaluate(async()=>caches.keys())).includes('sineday-v35'));
    const result = { checks: 'Passed: v34→v35 worker update, matching earth-2 carousel/CSS, local native-module dependency, retired-cache isolation, API bypass, optional Earth/city assets do not block worker installation.' };
    fs.writeFileSync(path.join(root, 'docs/globe/pwa-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
