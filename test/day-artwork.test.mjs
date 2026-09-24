import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { DAY_DATA, DAY_DETAILS, calculateSineDayForYmd } from '../js/sineday-engine.js';
import {
  duckPlacementOnDayArtwork,
  duckUrlFromSinedayNumber,
  duckSvgUrlFromSinedayNumber,
  duckPngUrlFromSinedayNumber
} from '../js/sineducks.js';

test('all eighteen dates keep their production copy, numbered assets and fallback pairs', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/art-direction/day-background-prompts.json', import.meta.url)));
  const assets = JSON.parse(await readFile(new URL('../docs/art-direction/day-background-assets.json', import.meta.url)));
  assert.equal(source.days.length, 18);
  assert.equal(assets.length, 18);
  for (let day = 1; day <= 18; day++) {
    const result = calculateSineDayForYmd('2000-01-01', `2000-01-${String(day).padStart(2, '0')}`);
    const original = source.days[day - 1];
    assert.equal(result.day, day);
    assert.equal(duckUrlFromSinedayNumber(result.day), `assets/sineducks/SineDuckFinale${day}.svg`);
    const duckSvg = duckSvgUrlFromSinedayNumber(result.day);
    assert.equal(duckSvg, `assets/sineducks/SineDuckFinale${day}.svg`);
    assert.equal(duckPlacementOnDayArtwork(day), [1, 2, 4, 10, 11, 12, 15, 17, 18].includes(day) ? 'top' : 'bottom');
    assert.match(await readFile(new URL(`../${duckSvg}`, import.meta.url), 'utf8'), /viewBox="0 0 1920 1080"/);
    const mailerArtwork = duckPngUrlFromSinedayNumber(result.day);
    assert.equal(mailerArtwork, `assets/email/20260923/sineducks/SineDuckFinale${day}.png`);
    assert.ok((await readFile(new URL(`../${mailerArtwork}`, import.meta.url))).length > 10_000);
    assert.equal(result.imageUrl, `Day${day}.jpeg?v=20260910`);
    assert.equal(result.imageAvifUrl, `Day${day}.avif?v=20260910`);
    assert.equal(result.phase, original.phase);
    assert.equal(result.description, original.supportingLine);
    assert.equal(DAY_DETAILS[day].paragraph, original.productionCopy);
    assert.deepEqual(DAY_DETAILS[day].bullets, original.bullets);
    assert.ok(DAY_DATA[day - 1].imageAlt.length > 20);
    for (const asset of [assets[day - 1], assets[day - 1].avif]) {
      const bytes = await readFile(new URL(`../${asset.file}`, import.meta.url));
      assert.equal(bytes.length, asset.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    }
  }
  assert.equal(calculateSineDayForYmd('2000-01-01', '2000-01-19').day, 1);
});

test('homepage uses separate nature artwork and official Finale marks', async () => {
  const [html, ui, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(html, /sineduck-plate/);
  assert.match(html, /class="daily-email-banner__duck"\s+src="\/assets\/sineducks\/SineDuckFinale17\.svg"/);
  assert.match(html, /class="day-artwork-duck"[\s\S]*id="dayImageDuck"/);
  assert.match(ui, /const natureArtworkUrl = result\.imageAvifUrl \|\| result\.imageUrl/);
  assert.match(ui, /duckPlacementOnDayArtwork\(result\.day\)/);
  assert.match(ui, /duckSvgUrlFromSinedayNumber\(result\.day\)/);
  assert.match(styles, /\.duck-image\s*\{[^}]*width:\s*min\(80vw,\s*320px\)/);
  assert.match(styles, /\.day-artwork-duck\s*\{[^}]*left:\s*9%;[^}]*width:\s*82%/);
  assert.match(styles, /\.day-artwork-duck img\s*\{[^}]*aspect-ratio:\s*16 \/ 9;[^}]*object-fit:\s*contain;/);
  assert.doesNotMatch(styles, /\.duck-image\s*\{[^}]*filter:/);
  assert.doesNotMatch(styles, /\.duck-image\s*\{[^}]*background:\s*(?:#fff|white|rgba\(255)/);
});

test('dashboard identity surfaces use individual SineDucks while Explore layers one over nature artwork', async () => {
  const [dashboard, carousel, styles] = await Promise.all([
    readFile(new URL('../js/dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/duck-carousel.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/dashboard.css', import.meta.url), 'utf8')
  ]);
  const hero = dashboard.split('function renderTodayWaveSection()')[1].split('function ')[0];
  const details = dashboard.split('function renderTodayDayDetailsSection(result)')[1].split('function renderTodayWaveSection()')[0];
  assert.match(hero, /duckSvgUrlFromSinedayNumber\(result\.day\)/);
  assert.match(hero, /duckPngUrlFromSinedayNumber\(result\.day\)/);
  assert.match(hero, /fallbackUrl:\s*fallbackDuckUrl/);
  assert.doesNotMatch(hero, /mailerArtworkUrlFromSinedayNumber/);
  assert.match(details, /resolveDayImageUrl\(result\.imageAvifUrl \|\| result\.imageUrl\)/);
  assert.match(details, /resolveDayImageUrl\(result\.imageUrl\)/);
  assert.match(details, /duckSvgUrlFromSinedayNumber\(result\.day\)/);
  assert.match(details, /duckPlacementOnDayArtwork\(result\.day\)/);
  assert.match(details, /class="day-artwork-duck today-wave-details__duck"/);
  assert.match(carousel, /duckSvgUrlFromSinedayNumber\(energyDay\)/);
  assert.match(carousel, /duckSvgUrlFromSinedayNumber\(originDay\)/);
  assert.match(carousel, /duckPngUrlFromSinedayNumber\(energyDay\)/);
  assert.match(carousel, /duckPngUrlFromSinedayNumber\(originDay\)/);
  assert.doesNotMatch(carousel, /mailerArtworkUrlFromSinedayNumber|is-duck-fallback|--identity-duck-image/);
  for (const selector of ['.today-wave-hero__artwork', '.today-wave-hero__image', '.duck-stack__today-artwork', '.duck-stack__origin-artwork']) {
    const rule = styles.slice(styles.indexOf(selector + ' {')).split('}')[0];
    assert.match(rule, /aspect-ratio:\s*16 \/ 9/);
    assert.match(rule, /background:\s*transparent/);
    assert.doesNotMatch(rule, /object-fit:\s*cover|overflow:\s*hidden|border-radius/);
  }
  const profileImages = styles.split('.duck-stack__origin-artwork img {')[1].split('}')[0];
  assert.match(profileImages, /object-fit:\s*contain/);
  assert.match(profileImages, /aspect-ratio:\s*16 \/ 9/);
  assert.match(styles.split('.today-wave-hero__image {')[1].split('}')[0], /object-fit:\s*contain/);
  assert.match(styles.split('.today-wave-hero__artwork {')[1].split('}')[0], /width:\s*min\(100%,\s*400px\)/);
  assert.match(styles.split('.duck-stack__today-artwork {')[1].split('}')[0], /width:\s*min\(100%,\s*240px\)/);
  assert.match(styles.split('.duck-stack__origin-artwork {')[1].split('}')[0], /flex:\s*0 0 112px/);

  for (const [selector, size] of [
    ['.duck-icon-badge', '32px'],
    ['.duck-avatar', '40px'],
    ['.sdcal__duck', '48px'],
    ['.planner__duck', '56px']
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(styles, new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{[^}]*width:\\s*${size}`));
  }
});

test('worker updates old artwork, caches viewed formats offline, and never caches APIs', async () => {
  const origin = 'https://sineday.test';
  class BrowserRequest extends Request {
    constructor(input, options) {
      super(typeof input === 'string' ? new URL(input, origin) : input, options);
    }
  }
  const events = new Map();
  const stores = new Map();
  const fetched = [];
  let offline = false;
  let skipped = false;
  let claimed = false;
  let storageFull = false;
  const key = request => new BrowserRequest(request).url;
  const fetchMock = async (input, options = {}) => {
    const request = new BrowserRequest(input);
    fetched.push({ url: request.url, cache: options.cache || request.cache });
    if (offline) throw new Error('Offline');
    const dayImage = /\/Day\d+\.(jpeg|avif)$/.test(new URL(request.url).pathname);
    return new Response(dayImage ? (options.cache === 'reload' ? 'new artwork' : 'stale HTTP artwork') : 'asset');
  };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) {
          if (storageFull) throw new Error('Storage full');
          store.set(key(request), response);
        },
        async add(request) { store.set(key(request), await fetchMock(request)); },
        async addAll(requests) {
          for (const request of requests) store.set(key(request), await fetchMock(request));
        }
      };
    },
    async match(request) {
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request)).clone();
    }
  };
  const old = await caches.open('sineday-v22');
  await old.put('/Day1.jpeg', new Response('old installed artwork'));
  vm.runInNewContext(await readFile(new URL('../service-worker.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener(name, callback) { events.set(name, callback); },
      async skipWaiting() { skipped = true; },
      clients: { async claim() { claimed = true; } }
    },
    location: { origin }, caches, fetch: fetchMock, URL, Request: BrowserRequest, Response,
    console: { log() {}, error() {} }
  });
  async function lifecycle(name) {
    let pending;
    events.get(name)({ waitUntil(promise) { pending = promise; } });
    await pending;
  }
  async function request(path) {
    let response;
    events.get('fetch')({ request: new BrowserRequest(path), respondWith(promise) { response = promise; } });
    return response;
  }
  await lifecycle('install');
  assert.ok(skipped);
  assert.ok(!fetched.some(item => /\/Day\d+\./.test(item.url)), 'installation must not download the collection');
  await lifecycle('activate');
  assert.ok(claimed);
  assert.deepEqual(await caches.keys(), ['sineday-v29']);
  for (const path of ['/Day1.jpeg', '/Day18.avif?v=20260910']) {
    assert.equal(await (await request(path)).text(), 'new artwork');
    const requestsBeforeOffline = fetched.length;
    offline = true;
    assert.equal(await (await request(path)).text(), 'new artwork');
    assert.equal(fetched.length, requestsBeforeOffline);
    offline = false;
  }
  offline = true;
  assert.equal((await request('/Day2.avif?v=20260910')).status, 503);
  offline = false;
  const active = stores.get('sineday-v29');
  const beforeApi = active.size;
  assert.equal((await request('/api/health')).status, 200);
  assert.equal(fetched.at(-1).cache, 'no-store');
  assert.equal(active.size, beforeApi);
  assert.equal(await caches.match('/api/health'), undefined);
  storageFull = true;
  assert.equal(await (await request('/Day3.avif?v=20260910')).text(), 'new artwork');
});

test('reduced motion presents artwork immediately and scrolls without animation', async (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  let scroll;
  let children;
  globalThis.window = {
    matchMedia: () => ({ matches: true }), pageYOffset: 20,
    scrollTo: options => { scroll = options; }
  };
  globalThis.document = {
    readyState: 'loading', addEventListener() {},
    createElement: () => ({ style: {} })
  };
  const { SineDayUI } = await import('../js/ui.js');
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Unexpected animated delay'); });
  const ui = Object.create(SineDayUI.prototype);
  ui.elements = {
    backgroundImage: { classList: { remove() {} }, replaceChildren: (...nodes) => { children = nodes; } }
  };
  ui.updateBackgroundImage('Day14.avif?v=20260910');
  assert.equal(children.length, 1);
  assert.equal(children[0].style.opacity, '1');
  assert.equal(children[0].style.backgroundImage, "url('Day14.avif?v=20260910')");
  ui.scrollToElement({ getBoundingClientRect: () => ({ top: 200 }) });
  assert.deepEqual(scroll, { top: 140, behavior: 'auto' });
});

 test('generic public surfaces use Celebrity and day 17 remains numbered', async () => {
  for (const file of ['index.html', 'daily.html', 'daily-confirm.html', 'dashboard.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /SineDuck%20Celebrity\.svg/);
    assert.doesNotMatch(html, /SineDuck\d+(?:@3x)?\.(?:svg|png)/);
  }
  assert.match(await readFile(new URL('../daily.html', import.meta.url), 'utf8'), /SineDuckFinale17\.svg/);
});

test('email raster manifest matches approved SVGs and full 16:9 PNGs', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/email-templates/20260923/asset-manifest.json', import.meta.url)));
  assert.equal(manifest.assets.length, 19);
  for (const asset of manifest.assets) {
    const svg = await readFile(new URL(`../${asset.source}`, import.meta.url));
    const png = await readFile(new URL(`../${asset.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(svg).digest('hex'), asset.source_sha256);
    assert.equal(createHash('sha256').update(png).digest('hex'), asset.sha256);
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
  }
});
