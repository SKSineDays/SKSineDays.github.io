import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { DAY_DATA, DAY_DETAILS, calculateSineDayForYmd } from '../js/sineday-engine.js';
import { duckUrlFromSinedayNumber, duckSvgUrlFromSinedayNumber } from '../js/sineducks.js';

test('all eighteen dates keep their production copy, numbered assets and fallback pairs', async () => {
  const source = JSON.parse(await readFile(new URL('../docs/art-direction/day-background-prompts.json', import.meta.url)));
  const assets = JSON.parse(await readFile(new URL('../docs/art-direction/day-background-assets.json', import.meta.url)));
  assert.equal(source.days.length, 18);
  assert.equal(assets.length, 18);
  for (let day = 1; day <= 18; day++) {
    const result = calculateSineDayForYmd('2000-01-01', `2000-01-${String(day).padStart(2, '0')}`);
    const original = source.days[day - 1];
    assert.equal(result.day, day);
    assert.equal(duckUrlFromSinedayNumber(result.day), `assets/sineducks/SineDuck${day}@3x.png`);
    const duckSvg = duckSvgUrlFromSinedayNumber(result.day);
    assert.equal(duckSvg, `assets/sineducks/SineDuck${day}.svg`);
    assert.match(await readFile(new URL(`../${duckSvg}`, import.meta.url), 'utf8'), /viewBox="0 0 57\.6 28\.8"/);
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
  const old = await caches.open('sineday-v20');
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
  assert.deepEqual(await caches.keys(), ['sineday-v21']);
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
  const active = stores.get('sineday-v21');
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
