// Local HTTP + real worker, with no production requests or membership data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.avif': 'image/avif', '.jpeg': 'image/jpeg' };
const baseRef = process.env.GLOBE_BASE_REF || '5fa74d1';
const baseCache = process.env.GLOBE_BASE_CACHE || 'sineday-v34';
const photoModules = ['day-photo-collection', 'day-photo-selection', 'day-photo-view'].map(name => `/js/${name}.js`);

(async () => {
  const currentCache = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8')
    .match(/const\s+CACHE_NAME\s*=\s*(['"])([^'"]+)\1/)?.[2];
  assert.ok(currentCache, 'Current worker must declare a literal CACHE_NAME');
  assert.notEqual(baseCache, currentCache, 'A worker migration requires distinct base/current cache versions; skip unchanged workers or bump CACHE_NAME');
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
      const body = !current
        ? execFileSync('git', ['show', `${baseRef}:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
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
    const origin = `http://127.0.0.1:${server.address().port}`;
    const blockedExternal = [];
    await page.context().route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blockedExternal.push(route.request().url());
      return route.abort('failed');
    });
    await page.goto(`${origin}/__worker_test__`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/service-worker.js');
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    const old = await page.evaluate(async () => (await fetch('/js/duck-carousel.js')).text());
    assert.ok(old.includes('new OriginGlobe'));
    assert.ok((await page.evaluate(async()=>caches.keys())).includes(baseCache));
    current = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      await registration.update();
      await changed;
    });
    // Deliberately recreate a retired cache: the current worker must ignore it.
    await page.evaluate(async ({ baseCache, photoModules }) => {
      const retired = await caches.open(baseCache);
      await retired.put('/js/origin-globe.js', new Response('stale module'));
      for (const url of photoModules) await retired.put(url, new Response('stale photo module'));
    }, { baseCache, photoModules });
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
    assert.ok((await page.evaluate(async()=>caches.keys())).includes('sineday-v37'));
    const cachedModules = await page.evaluate(async urls => {
      const cache = await caches.open('sineday-v37');
      return Promise.all(urls.map(async url => ({
        url, cached: await (await cache.match(url))?.text(), fetched: await (await fetch(url)).text()
      })));
    }, photoModules);
    for (const module of cachedModules) {
      const source = fs.readFileSync(path.join(root, module.url), 'utf8');
      assert.equal(module.cached, source, `${module.url} was not installed with current bytes`);
      assert.equal(module.fetched, source, `${module.url} came from a retired cache`);
    }
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('sineday-v37')).match('/Day1.avif?v=20260910'))), false, 'Installation must not preload daily artwork');
    const showFallback = () => page.evaluate(async () => {
      const { presentDayPhoto } = await import('/js/day-photo-view.js');
      const { calculateSineDayForYmd } = await import('/js/sineday-engine.js');
      const image = document.createElement('img');
      document.body.append(image);
      return new Promise((resolve, reject) => presentDayPhoto({
        image, result: calculateSineDayForYmd('2000-01-01', '2000-01-01'),
        onLoad: url => resolve({ pathname: new URL(url).pathname, width: image.naturalWidth }),
        onUnavailable: () => reject(new Error('Viewed local photo fallback was unavailable'))
      }));
    });
    const onlineFallback = await showFallback();
    assert.equal(onlineFallback.pathname, '/Day1.avif');
    assert.ok(onlineFallback.width > 0);
    assert.ok(blockedExternal.some(url => new URL(url).hostname === 'images.unsplash.com'), 'Selected CDN photo should fail locally before fallback');
    const fallbackUrls = ['/Day1.avif?v=20260910', '/Day1.jpeg?v=20260910'];
    const readFallbacks = () => page.evaluate(async urls => Promise.all(urls.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    })), fallbackUrls);
    const onlineBytes = await readFallbacks();
    assert.deepEqual(onlineBytes, fallbackUrls.map(url => ({ status: 200, bytes: fs.statSync(path.join(root, url.split('?')[0])).size })));
    await page.context().setOffline(true);
    assert.deepEqual(await readFallbacks(), onlineBytes, 'Viewed AVIF and JPEG must remain available offline');
    assert.deepEqual(await showFallback(), onlineFallback, 'Offline selected-photo failure must display the cached local fallback');
    await page.context().setOffline(false);
    const externalCacheEntries = await page.evaluate(async () => {
      const entries = [];
      for (const key of await caches.keys()) {
        for (const request of await (await caches.open(key)).keys()) {
          if (new URL(request.url).origin !== location.origin) entries.push(request.url);
        }
      }
      return entries;
    });
    assert.deepEqual(externalCacheEntries, [], 'External photo URLs must never enter the worker cache');
    const result = { baseRef, baseCache, checks: `Passed: ${baseCache}→sineday-v37 worker update, matching earth-2 carousel/CSS, local native-module dependency, retired-cache isolation, API bypass, optional Earth/city assets do not block worker installation, all three current photo modules precached, viewed local AVIF/JPEG offline fallback, no external photo cache entries.` };
    fs.writeFileSync(path.join(root, 'docs/globe/pwa-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
