/**
 * Browser-only, read-only QA of the actual website photo integration.
 *
 *   node test/day-photo-browser-smoke.mjs
 *   PHOTO_QA_REAL_IMAGES=1 node test/day-photo-browser-smoke.mjs
 *   DAY_PHOTO_BROWSER_EXECUTABLE=/path/to/chromium node test/day-photo-browser-smoke.mjs
 *   node test/day-photo-browser-smoke.mjs --validate
 *
 * Default: real Chromium layout/image decoding, but Unsplash requests receive the
 * existing DayN.jpeg fixture bytes. This does NOT validate the real photo crops
 * or CDN availability. Opt in to real photos to validate those and review the
 * screenshots. Only GET image requests to images.unsplash.com can leave this
 * fixture; all APIs, authentication, analytics and other external requests are
 * intercepted. No production account or server is used.
 *
 * Screenshots + JSON: artifacts/day-photos (gitignored), or DAY_PHOTO_OUTPUT.
 * The normal node --test suite skips this explicit browser command.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { calculateSineDayForYmd } from '../js/sineday-engine.js';
import { PHOTO_VISIT_KEY, PHOTO_HISTORY_KEY, PHOTO_VISIT_IDLE_MS } from '../js/day-photo-selection.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://sineday-photo.test';
const OUTPUT = resolve(process.env.DAY_PHOTO_OUTPUT || resolve(ROOT, 'artifacts/day-photos'));
const REAL_IMAGES = process.env.PHOTO_QA_REAL_IMAGES === '1' || process.env.DAY_PHOTO_REAL_IMAGES === '1';
const FIXED_TIME = '2026-10-20T12:00:00Z';
const TODAY = FIXED_TIME.slice(0, 10);
const HOME_IMAGE = '#dayImage';
const DASH_IMAGE = '.today-wave-details__image';
const DAYS = Array.from({ length: 18 }, (_, index) => index + 1);
const SAMPLES = new Set([1, 6, 12, 18]);
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

let collection;
let version;
let authStub;
const fixtures = new Map();
const births = Object.fromEntries(DAYS.map(day => {
  // Find ordinary synthetic DOBs using the unchanged engine, not a second copy
  // of its day formula. UTC removes host-timezone dependence from the fixture.
  for (let offset = 0; offset < 18; offset++) {
    const birthdate = new Date(Date.UTC(1985, 3, 1 + offset)).toISOString().slice(0, 10);
    if (calculateSineDayForYmd(birthdate, TODAY).day === day) return [day, birthdate];
  }
  throw new Error(`No fixture DOB for day ${day}`);
}));
const report = {
  startedAt: new Date().toISOString(),
  imageMode: REAL_IMAGES ? 'real Unsplash CDN images' : 'local JPEG fixture bytes at the selected CDN URLs',
  limitations: [
    ...(REAL_IMAGES ? [] : ['Fixture mode does not verify the 180 real photo crops, their content, or CDN availability. Run PHOTO_QA_REAL_IMAGES=1 and review screenshots for visual approval.']),
    'Authentication, entitlements, journal and API responses are synthetic. No real accounts or external writes are exercised.',
    'Service workers are blocked so routing stays isolated. Service-worker behavior belongs to the separate existing tests.',
  ],
  screenshots: [], tests: [],
};

async function preflight() {
  const manifest = await import(pathToFileURL(resolve(ROOT, 'js/day-photo-collection.js')).href);
  collection = manifest.DAY_PHOTOS;
  version = manifest.DAY_PHOTO_COLLECTION_VERSION;
  assert.ok(version, 'DAY_PHOTO_COLLECTION_VERSION must be exported');
  assert.equal(Object.keys(collection).length, 18);
  for (const day of DAYS) {
    assert.equal(collection[day]?.length, 10, `Day ${day} must contain exactly 10 approved records`);
    assert.equal(new Set(collection[day].map(photo => photo.id)).size, 10, `Day ${day} IDs must be distinct`);
    for (const photo of collection[day]) {
      for (const field of ['id', 'url', 'alt', 'photographer', 'photographerUrl', 'photoUrl']) {
        assert.ok(typeof photo[field] === 'string' && photo[field].trim(), `Day ${day}: missing ${field}`);
      }
      assert.ok(photo.width > 0 && photo.height > 0, `Day ${day}: missing dimensions`);
      assert.equal(new URL(photo.url).hostname, 'images.unsplash.com');
      assert.equal(new URL(photo.url).protocol, 'https:');
      for (const field of ['photographerUrl', 'photoUrl']) {
        const url = new URL(photo[field]);
        assert.equal(url.protocol, 'https:');
        assert.ok(['unsplash.com', 'www.unsplash.com'].includes(url.hostname), `Unexpected credit host: ${url.hostname}`);
      }
    }
    fixtures.set(day, await readFile(resolve(ROOT, `Day${day}.jpeg`)));
  }
  // Reuse the established full-dashboard fixture, rather than introducing a real
  // sign-in or maintaining a second mock client with different behavior.
  const existing = await readFile(resolve(ROOT, 'test/globe-dashboard-smoke.cjs'), 'utf8');
  authStub = existing.match(/const stub=`([\s\S]*?)`;/)?.[1];
  assert.ok(authStub, 'Cannot find the synthetic auth stub in globe-dashboard-smoke.cjs');
  assert.ok(authStub.includes("birthdate:'1985-04-20'"), 'Dashboard fixture DOB changed; update the smoke fixture deliberately');
  authStub = authStub.replace("birthdate:'1985-04-20'", `birthdate:'${births[1]}'`)
    .replace("timezone:'America/Chicago'", "timezone:'UTC'");
  const [ui, dashboard] = await Promise.all(['js/ui.js', 'js/dashboard.js'].map(file => readFile(resolve(ROOT, file), 'utf8')));
  assert.match(ui, /let uiInstance = null;/, 'Homepage test-only hook no longer matches the app');
  for (const name of ['getOwnerProfile', 'renderTodayWaveSection', 'clearTodayDayDetailsSection']) {
    assert.match(dashboard, new RegExp(`function ${name}\\(`), `Dashboard test-only hook no longer matches ${name}`);
  }
  report.collectionVersion = version;
  report.collectionRecords = DAYS.reduce((count, day) => count + collection[day].length, 0);
}

function photoPath(photo) { return new URL(photo.url).pathname; }
function findPhoto(pathname) {
  for (const day of DAYS) {
    const photo = collection[day].find(item => photoPath(item) === pathname);
    if (photo) return { day, photo };
  }
  return null;
}
function transformedSource(pathname, source) {
  if (pathname === '/js/ui.js') {
    return `${source}\n// Browser-smoke-only hook, injected by route fulfillment.\nObject.defineProperty(window.__dayPhotoQA, 'ui', { get: () => uiInstance });\n`;
  }
  if (pathname === '/js/dashboard.js') {
    return `${source}\n// Browser-smoke-only hooks; never written to production source.\nObject.assign(window.__dayPhotoQA, {\n  dashboardReady: () => Boolean(getOwnerProfile() && currentUser && currentEntitlement),\n  renderDashboardDay: (birthdate) => {\n    const owner = getOwnerProfile();\n    if (!owner) throw new Error('Synthetic owner profile is not ready');\n    owner.birthdate = birthdate;\n    renderTodayWaveSection();\n  },\n  renderDashboard: renderTodayWaveSection,\n  clearDashboard: clearTodayDayDetailsSection\n});\n`;
  }
  return source;
}

async function makeFixture(browser, { width = 390, reducedMotion = 'reduce', policy = {}, storageBlocked = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width >= 1000 ? 1000 : 844 }, deviceScaleFactor: 1,
    timezoneId: 'UTC', locale: 'en-US', reducedMotion, serviceWorkers: 'block',
  });
  const state = { context, page: null, policy, requests: [], errors: [], routeErrors: [], pages: [], unknownPhotos: [] };
  await context.addInitScript(({ blocked }) => {
    window.__dayPhotoQA = { decodeWaiters: [], deferDecodeId: null, scrollCalls: [] };
    const originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (...args) {
      const qa = window.__dayPhotoQA;
      const decoded = originalDecode.apply(this, args);
      if (this.dataset.photoId !== qa.deferDecodeId || !qa.deferDecodeId) return decoded;
      return decoded.then(() => new Promise(resolve => qa.decodeWaiters.push(resolve)));
    };
    const scrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      window.__dayPhotoQA.scrollCalls.push(args[0]);
      return scrollTo(...args);
    };
    if (blocked) {
      Storage.prototype.getItem = function () { throw new DOMException('QA storage disabled', 'SecurityError'); };
      Storage.prototype.setItem = function () { throw new DOMException('QA storage disabled', 'SecurityError'); };
    }
  }, { blocked: storageBlocked });
  await context.route('**/*', async route => {
    try {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = decodeURIComponent(url.pathname);
      const record = { url: url.href, pathname, method: request.method(), resource: request.resourceType() };
      state.requests.push(record);
      if (url.hostname === 'images.unsplash.com') {
        const entry = findPhoto(url.pathname);
        if (!entry) state.unknownPhotos.push(url.href);
        if (policy.failRemote) return route.abort('failed');
        if (REAL_IMAGES && request.resourceType() === 'image' && request.method() === 'GET') return route.continue();
        return route.fulfill({ contentType: 'image/jpeg', body: fixtures.get(entry?.day || 1) });
      }
      // Every other origin is closed. Font styles and third-party scripts are
      // benign empty fixtures; they cannot authenticate, beacon or write.
      if (url.origin !== ORIGIN) {
        const contentType = request.resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript';
        return route.fulfill({ contentType, body: '' });
      }
      if (pathname.startsWith('/api/')) {
        const body = pathname === '/api/globe/groups'
          ? { groups: [], precision: 'region', participation: 'opt-in', generatedAt: FIXED_TIME }
          : pathname === '/api/globe/me'
            ? { membership: { enabled: false, regionKey: null } }
            : { ok: true, premium: false, subscribed: false, profileConfigured: false };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (pathname === '/__photo-qa.html') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Isolated photo storage fixture</title>' });
      }
      if (pathname === '/js/supabase-client.js') return route.fulfill({ contentType: 'application/javascript', body: authStub });
      if (/^\/Day\d+\.avif$/.test(pathname) && policy.failAvif) return route.abort('failed');
      if (/^\/Day\d+\.jpeg$/.test(pathname) && policy.failJpeg) return route.abort('failed');
      const file = resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(ROOT + sep) || /(?:^|\/)(?:\.[^/]+|node_modules)(?:\/|$)/.test(pathname)) {
        return route.fulfill({ status: 404, body: '' });
      }
      let body;
      try { body = await readFile(file); } catch { return route.fulfill({ status: 404, body: '' }); }
      if (pathname === '/js/ui.js' || pathname === '/js/dashboard.js') body = transformedSource(pathname, body.toString());
      return route.fulfill({ contentType: TYPES[extname(file)] || 'application/octet-stream', body });
    } catch (error) {
      // A source replacement/navigation may cancel an already-queued request.
      if (!/Target.*closed|page.*closed|context.*closed|already handled|Invalid InterceptionId/i.test(error.message)) state.routeErrors.push(error.message);
    }
  });
  state.newPage = async () => {
    const page = await context.newPage();
    state.pages.push(page);
    state.page = page;
    page.setDefaultTimeout(REAL_IMAGES ? 25_000 : 12_000);
    page.on('pageerror', error => state.errors.push(error.message));
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    return page;
  };
  state.assertClean = () => {
    assert.deepEqual(state.errors, [], 'Uncaught page errors');
    assert.deepEqual(state.routeErrors, [], 'Fixture routing errors');
    assert.deepEqual(state.unknownPhotos, [], 'The app requested photos outside the exact collection');
    assert.deepEqual(state.requests.filter(item => item.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(item.method)), [], 'The read-only fixture must not attempt API writes');
  };
  await state.newPage();
  return state;
}

async function goHome(fixture) {
  await fixture.page.goto(`${ORIGIN}/index.html`);
  await fixture.page.waitForFunction(() => Boolean(window.__dayPhotoQA?.ui));
}
async function goDashboard(fixture) {
  await fixture.page.goto(`${ORIGIN}/dashboard.html`);
  await fixture.page.waitForFunction(() => window.__dayPhotoQA?.dashboardReady?.());
}
async function showHomeDay(page, day) {
  // The real public input, button listener and unchanged core engine drive this.
  await page.evaluate(() => window.__dayPhotoQA.ui.resetToInput());
  await page.locator('#birthdate-input').fill(births[day]);
  await page.locator('#calculate-btn').click();
}
async function showDashboardDay(page, day) {
  await page.evaluate(birthdate => window.__dayPhotoQA.renderDashboardDay(birthdate), births[day]);
  await page.locator('#explore-today-wave').click();
  await page.locator(DASH_IMAGE).scrollIntoViewIfNeeded();
}
async function waitPhoto(page, selector, day) {
  await page.waitForFunction(({ selector, ids }) => {
    const image = document.querySelector(selector);
    return image && image.complete && image.naturalWidth > 0 && image.style.opacity === '1' && ids.includes(image.dataset.photoId);
  }, { selector, ids: collection[day].map(photo => photo.id) });
  return page.locator(selector).getAttribute('data-photo-id');
}
async function assertPhoto(page, { selector, creditSelector, day, homepage = false }) {
  const id = await waitPhoto(page, selector, day);
  const photo = collection[day].find(item => item.id === id);
  const data = await page.locator(selector).evaluate(image => {
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    return { src: image.currentSrc, alt: image.alt, srcset: image.srcset, sizes: image.sizes,
      objectFit: style.objectFit, width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      referrerPolicy: image.referrerPolicy };
  });
  assert.equal(new URL(data.src).pathname, photoPath(photo));
  assert.equal(new URL(data.src).hostname, 'images.unsplash.com');
  assert.equal(data.alt, photo.alt);
  assert.equal(data.objectFit, 'contain', 'Selected photographs must preserve their full portrait/landscape composition');
  assert.ok(Math.abs(data.width - data.height) < 3, 'The containing photo frame should remain square');
  assert.ok(data.width > 150 && data.left >= -1 && data.right <= page.viewportSize().width + 1, 'Photo must fit its viewport');
  for (const width of [480, 768, 960, 1440]) assert.ok(data.srcset.includes(` ${width}w`));
  assert.ok(data.sizes);
  assert.equal(data.referrerPolicy, 'strict-origin-when-cross-origin');
  const originalIxid = new URL(photo.url).searchParams.get('ixid');
  if (originalIxid) assert.equal(new URL(data.src).searchParams.get('ixid'), originalIxid, 'Unsplash tracking parameter was lost');
  const credit = page.locator(creditSelector);
  await credit.waitFor({ state: 'visible' });
  const links = await credit.locator('a').evaluateAll(items => items.map(link => ({
    text: link.textContent, href: link.href, target: link.target, rel: link.rel,
  })));
  assert.deepEqual(links.map(link => [link.text, link.href]), [[photo.photographer, new URL(photo.photographerUrl).href], ['Unsplash', new URL(photo.photoUrl).href]]);
  for (const link of links) {
    assert.equal(link.target, '_blank');
    assert.ok(link.rel.includes('noopener') && link.rel.includes('noreferrer'));
  }
  const creditBox = await credit.boundingBox();
  assert.ok(creditBox && creditBox.x >= -1 && creditBox.x + creditBox.width <= page.viewportSize().width + 1, 'Credits must fit even at 320px');
  const duck = page.locator(homepage ? '#dayImageDuck' : '.today-wave-details__duck img');
  await duck.waitFor({ state: 'visible' });
  assert.equal(new URL(await duck.getAttribute('src'), ORIGIN).pathname, `/assets/sineducks/SineDuckFinale${day}.svg`);
  assert.equal(await duck.evaluate(image => getComputedStyle(image).objectFit), 'contain');
  if (homepage) {
    await page.waitForFunction(src => [...document.querySelectorAll('#background-image .background-image-layer')]
      .some(layer => layer.style.backgroundImage.includes(src) && layer.style.opacity === '1'), data.src);
    assert.equal(await page.locator('#todayDuck').getAttribute('src'), `assets/sineducks/SineDuckFinale${day}.svg`);
  } else {
    assert.equal(new URL(await page.locator('.today-wave-hero__image').getAttribute('src'), ORIGIN).pathname, `/assets/sineducks/SineDuckFinale${day}.svg`);
  }
  return id;
}
async function assertNoOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(size.html <= size.viewport + 1 && size.body <= size.viewport + 1, `Horizontal overflow: ${JSON.stringify(size)}`);
}
async function screenshot(page, name, selector) {
  const path = resolve(OUTPUT, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  report.screenshots.push(relative(OUTPUT, path));
}
async function saveFailure(fixture, name) {
  if (!fixture?.page || fixture.page.isClosed()) return;
  const stem = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  await screenshot(fixture.page, `FAIL-${stem}`).catch(() => {});
  await writeFile(resolve(OUTPUT, `FAIL-${stem}.html`), await fixture.page.content()).catch(() => {});
  await writeFile(resolve(OUTPUT, `FAIL-${stem}-requests.json`), JSON.stringify(fixture.requests, null, 2)).catch(() => {});
}

async function runCase(browser, name, options, work) {
  const started = performance.now();
  let fixture;
  try {
    fixture = await makeFixture(browser, options);
    await work(fixture);
    fixture.assertClean();
    report.tests.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.tests.push({ name, status: 'failed', error: error.stack || String(error), durationMs: Math.round(performance.now() - started) });
    console.error(`FAIL ${name}: ${error.message}`);
    await saveFailure(fixture, name);
  } finally {
    await fixture?.context.close();
  }
}

async function visualMatrix(browser) {
  for (const width of [390, 1440, 320]) {
    await runCase(browser, `All 18 homepage and Explore scenes at ${width}px`, { width }, async fixture => {
      const { page } = fixture;
      await goHome(fixture);
      const seen = new Map();
      for (const day of DAYS) {
        await showHomeDay(page, day);
        seen.set(day, await assertPhoto(page, { selector: HOME_IMAGE, creditSelector: '#day-photo-credit', day, homepage: true }));
        await assertNoOverflow(page);
        if (width !== 320 && SAMPLES.has(day)) await screenshot(page, `homepage-${width}-day-${day}`, '#day-image-card');
        if (width === 320 && day === 18) await screenshot(page, 'homepage-320-day-18');
      }
      // Same-tab navigation must share the homepage selection, not advance it.
      await goDashboard(fixture);
      for (const day of DAYS) {
        await showDashboardDay(page, day);
        const id = await assertPhoto(page, { selector: DASH_IMAGE, creditSelector: '#today-day-details-section .day-photo-credit', day });
        assert.equal(id, seen.get(day), 'Homepage and Explore changed photos within one visit');
        await assertNoOverflow(page);
        if (width !== 320 && SAMPLES.has(day)) await screenshot(page, `dashboard-${width}-day-${day}`, '#today-day-details-section');
        if (width === 320 && day === 18) await screenshot(page, 'dashboard-320-day-18');
        await page.locator('#explore-today-wave').click();
        assert.equal(await page.locator('#today-day-details-section').isHidden(), true);
        await page.locator('#explore-today-wave').click();
        assert.equal(await waitPhoto(page, DASH_IMAGE, day), id, 'Explore reopening must not advance selection');
      }
      const remotePaths = new Set(fixture.requests.filter(item => new URL(item.url).hostname === 'images.unsplash.com').map(item => new URL(item.url).pathname));
      assert.ok(remotePaths.size <= 18, `Viewing 18 days fetched ${remotePaths.size} photos, not one per day`);
      assert.ok(remotePaths.size > 0);
      assert.equal(await page.locator('link[rel="preload"][as="image"][href*="images.unsplash.com"]').count(), 0);
    });
  }
}

async function visitSemantics(browser) {
  await runCase(browser, 'Stable recalculation, reload, navigation and one-photo request budget', {}, async fixture => {
    const { page } = fixture;
    await goHome(fixture);
    await showHomeDay(page, 1);
    const id = await waitPhoto(page, HOME_IMAGE, 1);
    const history = await page.evaluate(key => localStorage.getItem(key), PHOTO_HISTORY_KEY);
    for (let repeat = 0; repeat < 3; repeat++) {
      await showHomeDay(page, 1);
      assert.equal(await waitPhoto(page, HOME_IMAGE, 1), id);
    }
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__dayPhotoQA?.ui));
    assert.equal(await waitPhoto(page, HOME_IMAGE, 1), id, 'Saved DOB auto-reload changed the photo');
    await goDashboard(fixture);
    await showDashboardDay(page, 1);
    assert.equal(await waitPhoto(page, DASH_IMAGE, 1), id);
    await page.evaluate(() => window.__dayPhotoQA.renderDashboard());
    await page.locator('#explore-today-wave').click();
    assert.equal(await waitPhoto(page, DASH_IMAGE, 1), id, 'Dashboard rerender changed the photo');
    await goHome(fixture);
    assert.equal(await waitPhoto(page, HOME_IMAGE, 1), id);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), PHOTO_HISTORY_KEY), history, 'Renders advanced the persisted cursor');
    const remotePaths = new Set(fixture.requests.filter(item => new URL(item.url).hostname === 'images.unsplash.com').map(item => new URL(item.url).pathname));
    assert.equal(remotePaths.size, 1, 'A single-day visit must not preload the other nine or all 180');
    await page.locator('#day-photo-credit a').first().focus();
    await page.evaluate(() => window.__dayPhotoQA.ui.resetToInput());
    assert.equal(await page.locator('#day-image-card').getAttribute('inert'), '');
    assert.equal(await page.locator('#day-photo-credit a').count(), 0, 'Reset must remove invisible attribution links');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#day-image-card'))), false, 'Keyboard focus reached the hidden photo card');
  });
  await runCase(browser, 'All ten choices before repeating for every day across new documents', {}, async fixture => {
    const { page } = fixture;
    await page.goto(`${ORIGIN}/__photo-qa.html`);
    const visits = [];
    for (let visit = 0; visit < 11; visit++) {
      if (visit) {
        await page.evaluate(key => sessionStorage.removeItem(key), PHOTO_VISIT_KEY);
        await page.reload();
      }
      visits.push(await page.evaluate(async () => {
        const { selectDayPhoto } = await import('/js/day-photo-view.js');
        return Array.from({ length: 18 }, (_, index) => selectDayPhoto(index + 1).id);
      }));
    }
    for (const day of DAYS) {
      const ids = visits.map(visit => visit[day - 1]);
      assert.equal(new Set(ids.slice(0, 10)).size, 10, `Day ${day} repeated before all 10`);
      assert.deepEqual(new Set(ids.slice(0, 10)), new Set(collection[day].map(photo => photo.id)));
      assert.equal(ids[10], ids[0], `Day ${day} did not wrap after 10`);
    }
    assert.equal(fixture.requests.filter(item => new URL(item.url).hostname === 'images.unsplash.com').length, 0, 'Selecting metadata must not preload photo bytes');
  });
  await runCase(browser, 'Thirty-minute idle expiry only applies on a new document; new tabs advance', {}, async fixture => {
    const { page } = fixture;
    await page.goto(`${ORIGIN}/__photo-qa.html`);
    const selectOne = () => page.evaluate(async () => (await import('/js/day-photo-view.js')).selectDayPhoto(1).id);
    const first = await selectOne();
    const initial = Date.parse(FIXED_TIME);
    await page.clock.setFixedTime(new Date(initial + PHOTO_VISIT_IDLE_MS + 1));
    assert.equal(await selectOne(), first, 'A long-open document rotated its selected photo');
    await page.reload();
    assert.equal(await selectOne(), first, 'Recent same-document activity should preserve the visit on reload');
    await page.clock.setFixedTime(new Date(initial + 2 * PHOTO_VISIT_IDLE_MS + 2));
    await page.reload();
    const second = await selectOne();
    assert.notEqual(second, first, 'Idle new-document visit should advance');
    const another = await fixture.newPage();
    await another.goto(`${ORIGIN}/__photo-qa.html`);
    const third = await another.evaluate(async () => (await import('/js/day-photo-view.js')).selectDayPhoto(1).id);
    assert.notEqual(third, second, 'A fresh tab without an opener is a new visit');
    const history = await another.evaluate(key => JSON.parse(localStorage.getItem(key)), PHOTO_HISTORY_KEY);
    assert.deepEqual(Object.keys(history.indices), ['1'], 'Unviewed days must not consume a choice');
  });
  await runCase(browser, 'Storage-denied browsers keep a stable in-document selection', { storageBlocked: true }, async fixture => {
    await goHome(fixture);
    await showHomeDay(fixture.page, 3);
    const first = await waitPhoto(fixture.page, HOME_IMAGE, 3);
    await showHomeDay(fixture.page, 3);
    assert.equal(await waitPhoto(fixture.page, HOME_IMAGE, 3), first);
  });
}

async function fallbacks(browser) {
  for (const surface of ['homepage', 'dashboard']) {
    for (const fallback of ['avif', 'jpeg', 'neutral']) {
      const policy = { failRemote: true, failAvif: fallback !== 'avif', failJpeg: fallback === 'neutral' };
      await runCase(browser, `${surface}: remote failure → ${fallback} fallback`, { policy }, async fixture => {
        const { page } = fixture;
        const isHome = surface === 'homepage';
        if (isHome) { await goHome(fixture); await showHomeDay(page, 1); }
        else { await goDashboard(fixture); await showDashboardDay(page, 1); }
        const selector = isHome ? HOME_IMAGE : DASH_IMAGE;
        const creditSelector = isHome ? '#day-photo-credit' : '#today-day-details-section .day-photo-credit';
        if (fallback !== 'neutral') {
          await page.waitForFunction(({ selector, ending }) => {
            const image = document.querySelector(selector);
            return image?.complete && image.naturalWidth > 0 && image.style.opacity === '1' && new URL(image.currentSrc).pathname.endsWith(ending);
          }, { selector, ending: `Day1.${fallback}` });
          assert.equal(await page.locator(selector).getAttribute('srcset'), null);
          assert.equal(await page.locator(selector).getAttribute('data-photo-id'), null);
          assert.equal(await page.locator(selector).getAttribute('alt'), calculateSineDayForYmd(births[1], TODAY).imageAlt);
          if (isHome) {
            const src = await page.locator(selector).evaluate(image => image.currentSrc);
            await page.waitForFunction(url => document.querySelector('#background-image .background-image-layer')?.style.backgroundImage.includes(url), src);
          }
        } else if (isHome) {
          await page.waitForFunction(() => {
            const image = document.querySelector('#dayImage');
            return image.complete && image.naturalWidth === 0 && image.style.opacity === '0' && image.src.includes('Day1.jpeg');
          });
          assert.equal(await page.locator('#day-image-card').isVisible(), true);
          assert.equal(await page.locator('#background-image .background-image-layer').count(), 0);
          assert.equal(await page.locator('#day-details-paragraph').isVisible(), true);
        } else {
          await page.locator('.today-wave-details__figure').waitFor({ state: 'hidden' });
          assert.equal(await page.locator('.today-wave-details__copy').isVisible(), true);
          assert.equal(await page.locator('.today-wave-details--without-artwork').count(), 1);
        }
        assert.equal(await page.locator(creditSelector).isHidden(), true, 'Local/neutral fallback retained false Unsplash credits');
        const relevant = fixture.requests.filter(item => new URL(item.url).hostname === 'images.unsplash.com' || /^\/Day1\.(avif|jpeg)$/.test(item.pathname));
        const remoteIndex = relevant.findIndex(item => new URL(item.url).hostname === 'images.unsplash.com');
        const avifIndex = relevant.findIndex(item => item.pathname === '/Day1.avif');
        const jpegIndex = relevant.findIndex(item => item.pathname === '/Day1.jpeg');
        assert.ok(remoteIndex >= 0 && avifIndex > remoteIndex, 'Selected photo must fail before AVIF is requested');
        if (fallback !== 'avif') assert.ok(jpegIndex > avifIndex, 'JPEG must follow failed AVIF');
        else assert.equal(jpegIndex, -1, 'Successful AVIF must not fetch JPEG');
        const history = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PHOTO_HISTORY_KEY);
        assert.equal(history.indices[1], 0, 'Failures must not consume additional collection choices');
        await assertNoOverflow(page);
        await screenshot(page, `${surface}-fallback-${fallback}`, isHome ? '#day-image-card' : '#today-day-details-section');
      });
    }
  }
}

async function staleLoadsAndMotion(browser) {
  for (const action of ['reset', 'day-change']) {
    await runCase(browser, `Late image decode cannot undo homepage ${action}`, {}, async fixture => {
      const { page } = fixture;
      await goHome(fixture);
      await page.evaluate(id => { window.__dayPhotoQA.deferDecodeId = id; }, collection[1][0].id);
      await showHomeDay(page, 1);
      await page.waitForFunction(() => window.__dayPhotoQA.decodeWaiters.length > 0);
      if (action === 'reset') await page.evaluate(() => window.__dayPhotoQA.ui.resetToInput());
      else {
        await showHomeDay(page, 2);
        await assertPhoto(page, { selector: HOME_IMAGE, creditSelector: '#day-photo-credit', day: 2, homepage: true });
      }
      await page.evaluate(() => window.__dayPhotoQA.decodeWaiters.splice(0).forEach(resolve => resolve()));
      await page.waitForTimeout(100);
      if (action === 'reset') {
        assert.equal(await page.evaluate(() => window.__dayPhotoQA.ui.currentDay), null);
        assert.equal(await page.locator('#background-image').evaluate(element => element.classList.contains('hero-mode')), true);
        assert.equal(await page.locator('#background-image .background-image-layer').count(), 0);
        assert.equal(await page.locator('#day-image-card').evaluate(element => element.classList.contains('visible')), false);
        assert.equal(await page.locator('#day-photo-credit').isHidden(), true, 'A late decode restored cleared credits');
        assert.equal(await page.locator('#day-photo-credit a').count(), 0);
        assert.equal(await page.locator('#day-image-card').getAttribute('inert'), '');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#day-image-card'))), false);
      } else {
        assert.equal(await page.evaluate(() => window.__dayPhotoQA.ui.currentDay.day), 2);
        await assertPhoto(page, { selector: HOME_IMAGE, creditSelector: '#day-photo-credit', day: 2, homepage: true });
        const backgrounds = await page.locator('#background-image .background-image-layer').evaluateAll(items => items.map(item => item.style.backgroundImage));
        assert.ok(backgrounds.every(value => !value.includes(new URL(collection[1][0].url).pathname)));
      }
    });
  }
  await runCase(browser, 'Detached Explore image cannot restore cleared or replaced content', {}, async fixture => {
    const { page } = fixture;
    await goDashboard(fixture);
    await page.evaluate(id => { window.__dayPhotoQA.deferDecodeId = id; }, collection[2][0].id);
    await showDashboardDay(page, 2);
    await page.waitForFunction(() => window.__dayPhotoQA.decodeWaiters.length > 0);
    await page.evaluate(() => window.__dayPhotoQA.clearDashboard());
    await showDashboardDay(page, 3);
    const current = await assertPhoto(page, { selector: DASH_IMAGE, creditSelector: '#today-day-details-section .day-photo-credit', day: 3 });
    await page.evaluate(() => window.__dayPhotoQA.decodeWaiters.splice(0).forEach(resolve => resolve()));
    await page.waitForTimeout(100);
    assert.equal(await waitPhoto(page, DASH_IMAGE, 3), current);
    assert.equal(await page.locator('.today-wave-details').count(), 1);
    assert.equal(await page.locator('.today-wave-details__figure').isVisible(), true);
  });
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await runCase(browser, `${reducedMotion}: no timer-driven rotation and matching backdrop`, { reducedMotion }, async fixture => {
      const { page } = fixture;
      await goHome(fixture);
      await showHomeDay(page, 6);
      const id = await assertPhoto(page, { selector: HOME_IMAGE, creditSelector: '#day-photo-credit', day: 6, homepage: true });
      await page.waitForTimeout(950); // Includes the normal backdrop's 800ms cleanup.
      assert.equal(await page.locator('#background-image .background-image-layer').count(), 1);
      assert.equal(await waitPhoto(page, HOME_IMAGE, 6), id);
      const scroll = await page.evaluate(() => {
        window.__dayPhotoQA.scrollCalls.length = 0;
        window.__dayPhotoQA.ui.scrollToElement(document.getElementById('day-image-card'));
        return window.__dayPhotoQA.scrollCalls.at(-1);
      });
      assert.equal(scroll.behavior, reducedMotion === 'reduce' ? 'auto' : 'smooth');
      if (reducedMotion === 'reduce') {
        await page.evaluate(() => window.__dayPhotoQA.ui.updateBackgroundImage(document.getElementById('dayImage').currentSrc));
        assert.equal(await page.locator('#background-image .background-image-layer').count(), 1, 'Reduced motion should replace immediately, not crossfade');
        assert.equal(await page.locator('#background-image .background-image-layer').evaluate(element => element.style.opacity), '1');
      }
      await screenshot(page, `homepage-motion-${reducedMotion}`, '#day-image-card');
    });
  }
}

async function realPhotoContactSheet(browser) {
  if (!REAL_IMAGES) return;
  await runCase(browser, 'All 180 real photographs decode in the actual scene and official-duck CSS', { width: 2160 }, async fixture => {
    const { page } = fixture;
    await page.goto(`${ORIGIN}/__photo-qa.html`);
    // Intentionally load the whole collection ONLY inside this isolated QA
    // document. It is not served by the app and cannot affect the production
    // one-photo-per-day request-budget assertions in the separate contexts.
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <title>All 180 approved day photographs: real browser composition review</title>
      <link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/css/dashboard.css">
      <style>
        html, body { width: 2160px; max-width: none; overflow: visible; }
        body { margin: 0; padding: 16px; display: block; background: #07111c; color: #edf3ff; }
        #qa-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 12px; }
        #qa-grid > figure { margin: 0; min-width: 0; }
        #qa-grid .qa-label { margin: 0 0 6px; font: 12px/1.4 system-ui, sans-serif; }
        #qa-grid .day-photo-credit { font-size: 10px; padding: 7px; min-height: 44px; }
        #qa-title { margin: 0 0 16px; font: 20px/1.4 system-ui, sans-serif; }
      </style></head><body><h1 id="qa-title">Approved collection: 18 day rows × 10 photograph columns. Full composition, official duck overlay.</h1><main id="qa-grid"></main></body></html>`);
    await page.evaluate(async () => {
      const { DAY_PHOTOS } = await import('/js/day-photo-collection.js');
      const { photoImageUrl, renderPhotoCredit } = await import('/js/day-photo-view.js');
      const { duckPlacementOnDayArtwork, duckSvgUrlFromSinedayNumber } = await import('/js/sineducks.js');
      const grid = document.getElementById('qa-grid');
      for (let day = 1; day <= 18; day++) {
        for (const [index, photo] of DAY_PHOTOS[day].entries()) {
          const figure = document.createElement('figure');
          figure.dataset.qaDay = String(day);
          figure.dataset.qaPhoto = photo.id;
          const label = document.createElement('p');
          label.className = 'qa-label';
          label.textContent = `Day ${day} · ${index + 1}/10 · ${photo.id}`;
          const frame = document.createElement('div');
          frame.className = 'day-image-content';
          const image = document.createElement('img');
          image.className = 'day-full-image';
          image.dataset.photoId = photo.id;
          image.alt = photo.alt;
          image.width = 752;
          image.height = 752;
          image.decoding = 'async';
          image.src = photoImageUrl(photo, 480);
          const duckLayer = document.createElement('div');
          duckLayer.className = 'day-artwork-duck';
          duckLayer.dataset.placement = duckPlacementOnDayArtwork(day);
          const duck = document.createElement('img');
          duck.src = '/' + duckSvgUrlFromSinedayNumber(day);
          duck.alt = `SineDuck for SineDay ${day}`;
          duck.width = 576;
          duck.height = 324;
          duckLayer.append(duck);
          frame.append(image, duckLayer);
          const credit = document.createElement('figcaption');
          credit.className = 'day-photo-credit';
          renderPhotoCredit(credit, photo);
          figure.append(label, frame, credit);
          grid.append(figure);
        }
      }
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#qa-grid img')].every(image => image.complete), null, { timeout: 120_000 });
    const images = await page.locator('#qa-grid .day-full-image').evaluateAll(items => items.map(image => ({
      id: image.dataset.photoId, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      alt: image.alt, fit: getComputedStyle(image).objectFit, src: image.currentSrc,
    })));
    assert.equal(images.length, 180);
    for (const image of images) {
      const photo = Object.values(collection).flat().find(photo => photo.id === image.id);
      assert.ok(image.naturalWidth > 0 && image.naturalHeight > 0, `Real photo did not decode: ${image.id} ${image.src}`);
      assert.equal(image.fit, 'contain');
      assert.equal(image.alt, photo.alt);
      assert.ok(Math.abs(image.naturalWidth / image.naturalHeight - photo.width / photo.height) < 0.02, `CDN delivery unexpectedly cropped ${image.id}`);
    }
    const ducks = await page.locator('#qa-grid .day-artwork-duck img').evaluateAll(items => items.map(image => ({
      loaded: image.complete && image.naturalWidth > 0, fit: getComputedStyle(image).objectFit,
    })));
    assert.equal(ducks.length, 180);
    assert.ok(ducks.every(duck => duck.loaded && duck.fit === 'contain'));
    await screenshot(page, 'all-180-real-composition-contact-sheet');
    await writeFile(resolve(OUTPUT, 'all-180-real-images.json'), JSON.stringify(images, null, 2) + '\n');
    report.realPhotosDecoded = images.length;
  });
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  let browser;
  try {
    await preflight();
    if (process.argv.includes('--validate')) {
      console.log(`Preflight passed: exact ${report.collectionRecords}-record module, source hooks, local fixtures and synthetic auth stub. No browser launched; browser checks remain unrun.`);
      return;
    }
    const { chromium } = await import('playwright');
    const executablePath = process.env.DAY_PHOTO_BROWSER_EXECUTABLE || process.env.GLOBE_BROWSER_EXECUTABLE;
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    console.log(`Image mode: ${report.imageMode}`);
    await visualMatrix(browser);
    await visitSemantics(browser);
    await fallbacks(browser);
    await staleLoadsAndMotion(browser);
    await realPhotoContactSheet(browser);
    report.status = report.tests.some(test => test.status === 'failed') ? 'failed' : 'passed';
  } catch (error) {
    report.status = 'blocked';
    report.blocker = error.stack || String(error);
    console.error(error);
  } finally {
    await browser?.close();
    if (!process.argv.includes('--validate') || report.status === 'blocked') {
      report.finishedAt = new Date().toISOString();
      await writeFile(resolve(OUTPUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`${report.status}: ${report.tests.filter(test => test.status === 'passed').length}/${report.tests.length} browser checks passed. Results: ${resolve(OUTPUT, 'results.json')}`);
      if (report.status !== 'passed') process.exitCode = 1;
    }
  }
}

if (process.env.NODE_TEST_CONTEXT) {
  const { default: test } = await import('node:test');
  test('day photo browser smoke is an explicit standalone command', { skip: 'Run node test/day-photo-browser-smoke.mjs in a browser-capable environment.' }, () => {});
} else {
  await main();
}
