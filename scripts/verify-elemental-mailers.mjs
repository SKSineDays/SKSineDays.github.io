/** Offline browser QA only. No provider calls, sends, subscriptions or live writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures/elemental-mailers');
const OUTPUT = join(ROOT, 'artifacts/elemental-mailers');
const ORIGIN = 'http://elemental-mailer.test';
const sha = value => createHash('sha256').update(value).digest('hex');
const stem = day => `day-${String(day).padStart(2, '0')}`;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const manifest = JSON.parse(await readFile(join(ROOT, 'docs/email-templates/20261111-elements/manifest.json')));
const contracts = JSON.parse(await readFile(join(FIXTURES, 'contracts.json')));
const receipts = JSON.parse(await readFile(join(ROOT, 'docs/email-templates/20261111-elements/scene-receipts.json')));
const fixtures = new Map();
const images = new Map();
const report = {
  scope: 'Offline Chromium rendering, not native Gmail, Apple Mail or Outlook certification.',
  network: 'All requests fulfilled from checked-in bytes or aborted. No live network, provider calls or email sends.',
  checks: [], imageBlockedChecks: [], screenshots: [], failures: [],
};

async function preflight() {
  assert.equal(manifest.length, 18);
  assert.deepEqual(manifest.map(item => item.day), Array.from({ length: 18 }, (_, i) => i + 1));
  for (const item of manifest) {
    const contract = contracts.find(value => value.day === item.day);
    const html = await readFile(join(FIXTURES, `${stem(item.day)}.html`), 'utf8');
    const plain = await readFile(join(FIXTURES, `${stem(item.day)}.txt`), 'utf8');
    assert.equal(sha(html), item.draftHtmlSha256, `Day ${item.day}: draft changed`);
    assert.equal(sha(plain), item.textSha256, `Day ${item.day}: plain text changed`);
    assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b|\son[a-z]+\s*=/i, 'Email fixture must not contain active content');
    const heroes = html.match(new RegExp(`<img\\b[^>]*src="${escape(item.proposedHeroUrl)}"[^>]*>`, 'g')) || [];
    const credits = html.match(/<p data-sineday-photo-credit="true"[^>]*>[\s\S]*?<\/p>/g) || [];
    assert.equal(heroes.length, 1); assert.equal(credits.length, 1);
    // Reversing exactly the authorized hero src/alt and attribution insertion
    // must recover every byte of the original provider HTML. This catches any
    // copy, colors, layout, blog links or template-variable changes.
    const restored = html.replace(heroes[0] + credits[0], contract.baselineHeroTag);
    assert.equal(sha(restored), item.baselineHtmlSha256, `Day ${item.day}: non-photo HTML changed`);
    assert.deepEqual([...new Set(html.match(/\{\{\{[^}]+\}\}\}/g))].sort(), contract.variables);
    assert.deepEqual(contract.variables, ['{{{OPT_OUT_URL}}}']);
    const scenePath = new URL(item.proposedHeroUrl).pathname;
    assert.equal(scenePath, `/assets/email/20261111-elements/scenes/SineDayScene${item.day}.jpg`);
    const scene = await readFile(join(ROOT, scenePath));
    const receipt = receipts.find(value => value.day === item.day);
    assert.equal(sha(scene), receipt.jpegSha256, `Day ${item.day}: derivative bytes changed`);
    assert.ok(scene.length < 300_000, 'Mailer JPEG should stay below 300KB');
    images.set(item.proposedHeroUrl, { body: scene, contentType: 'image/jpeg' });
    const waveUrl = `https://sineday.app/assets/email/20260911/wave-${String(item.day).padStart(2, '0')}.png`;
    images.set(waveUrl, { body: await readFile(join(ROOT, new URL(waveUrl).pathname)), contentType: 'image/png' });
    fixtures.set(item.day, html);
  }
  return { days: fixtures.size, imageAssets: images.size, exactBaselineRestorations: fixtures.size };
}

const preflightResult = await preflight();
if (process.argv.includes('--validate')) {
  console.log(JSON.stringify({ status: 'preflight-passed', ...preflightResult, browser: 'not run' }));
} else {
  const { chromium } = await import('playwright');
  await mkdir(OUTPUT, { recursive: true });
  let browser;
  const rejected = new Set(), intercepted = new Set();
  try {
    browser = await chromium.launch({ ...(process.env.MAILER_BROWSER_EXECUTABLE ? { executablePath: process.env.MAILER_BROWSER_EXECUTABLE } : {}) });
    report.browser = browser.version();
    for (const width of [320, 375, 520, 1280]) {
      for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: 1, serviceWorkers: 'block' });
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          intercepted.add(url.href);
          if (request.method() !== 'GET') { rejected.add(`${request.method()} ${url.href}`); return route.abort('blockedbyclient'); }
          const day = url.origin === ORIGIN && url.pathname.match(/^\/day-(\d{2})\.html$/)?.[1];
          if (day && fixtures.has(Number(day))) return route.fulfill({ contentType: 'text/html', body: fixtures.get(Number(day)) });
          const image = request.resourceType() === 'image' && images.get(url.href);
          if (image) return route.fulfill(image);
          rejected.add(url.href); return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        for (const item of manifest) {
          try {
            await page.goto(`${ORIGIN}/${stem(item.day)}.html`, { waitUntil: 'load' });
            await page.locator('img').evaluateAll(items => Promise.all(items.map(image => image.decode())));
            const result = await page.evaluate(() => {
              const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
              const wrapper = document.querySelector('[data-sineday-email-wrapper]');
              const hero = document.querySelector('[data-sineday-surface="day-scene"] img');
              const credit = document.querySelector('[data-sineday-photo-credit]');
              const blog = document.querySelector('[data-sineday-surface="blog"] a');
              const button = [...document.querySelectorAll('a')].find(a => a.textContent === 'Open Today’s SineDay');
              const overflows = [];
              for (const element of document.querySelectorAll('p,h1,h2,li,a')) {
                const range = document.createRange(); range.selectNodeContents(element);
                for (const r of range.getClientRects()) if (r.width && (r.left < -1 || r.right > innerWidth + 1)) overflows.push(element.textContent);
              }
              return {
                scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, wrapper: box(wrapper),
                imageCount: document.images.length, loaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
                hero: { ...box(hero), naturalWidth: hero.naturalWidth, naturalHeight: hero.naturalHeight, src: hero.currentSrc, alt: hero.alt },
                credit: { ...box(credit), text: credit.textContent, links: [...credit.querySelectorAll('a')].map(a => ({ text: a.textContent, href: a.href })) },
                colors: { outer: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(wrapper).backgroundColor, cta: getComputedStyle(button.parentElement).backgroundColor, ctaInk: getComputedStyle(button).color, heading: getComputedStyle(document.querySelector('h1')).color, credit: getComputedStyle(credit).color },
                blogHref: blog.getAttribute('href'), blogTapHeight: box(blog).height, optOut: [...document.querySelectorAll('a')].find(a => a.textContent === 'Stop daily emails')?.getAttribute('href'), overflows,
              };
            });
            assert.equal(result.scrollWidth, width, `${width}px document overflow`);
            assert.deepEqual(result.overflows, [], `${width}px text overflow`);
            assert.equal(result.wrapper.width, Math.min(width, 520));
            assert.equal(result.imageCount, 2); assert.ok(result.loaded);
            assert.equal(result.hero.naturalWidth, 752); assert.equal(result.hero.naturalHeight, 752);
            assert.ok(Math.abs(result.hero.width - result.hero.height) < 1);
            assert.ok(result.hero.left >= 0 && result.hero.right <= width && result.hero.width <= 464);
            assert.equal(result.hero.src, item.proposedHeroUrl);
            assert.equal(result.hero.alt, `Day ${item.day}: ${item.theme} scene with SineDuck`);
            assert.ok(result.credit.left >= 0 && result.credit.right <= width);
            assert.equal(result.credit.text, `Photo by ${item.photographer} on Unsplash; SineDuck artwork by SineDay.`);
            assert.deepEqual(result.credit.links, [{ text: item.photographer, href: item.profileUrl }, { text: 'Unsplash', href: 'https://unsplash.com/?utm_source=sineday&utm_medium=referral' }]);
            assert.deepEqual(result.colors, { outer: 'rgb(36, 35, 44)', card: 'rgb(59, 57, 72)', cta: 'rgb(237, 172, 158)', ctaInk: 'rgb(46, 36, 41)', heading: 'rgb(246, 238, 223)', credit: 'rgb(199, 194, 209)' });
            assert.equal(result.blogHref, 'https://www.sineday.blog/'); assert.ok(result.blogTapHeight >= 44);
            assert.equal(result.optOut, '{{{OPT_OUT_URL}}}');
            assert.deepEqual(errors, []);
            report.checks.push({ day: item.day, width, colorScheme, ...result });
            if (colorScheme === 'light' && [375, 1280].includes(width)) {
              const name = `${stem(item.day)}-${width}px.png`;
              await page.screenshot({ path: join(OUTPUT, name), fullPage: true }); report.screenshots.push(name);
            }
          } catch (error) {
            report.failures.push({ day: item.day, width, colorScheme, error: error.stack || String(error) });
            await page.screenshot({ path: join(OUTPUT, `FAIL-${stem(item.day)}-${width}-${colorScheme}.png`), fullPage: true }).catch(() => {});
            throw error;
          }
        }
        await context.close();
      }
    }
    const context = await browser.newContext({ viewport: { width: 320, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    for (const item of manifest) {
      await page.setContent(fixtures.get(item.day), { waitUntil: 'load' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
      assert.ok(await page.getByRole('link', { name: 'Explore the SineDay blog', exact: true }).isVisible());
      assert.ok(await page.getByRole('link', { name: 'Stop daily emails', exact: true }).isVisible());
      assert.ok(await page.locator('[data-sineday-photo-credit]').isVisible());
      assert.equal(await page.locator('[data-sineday-surface="notice"] li').count(), 4);
      report.imageBlockedChecks.push({ day: item.day, width: 320, status: 'passed' });
      if ([1, 9, 18].includes(item.day)) {
        const name = `${stem(item.day)}-images-blocked.png`;
        await page.screenshot({ path: join(OUTPUT, name), fullPage: true }); report.screenshots.push(name);
      }
    }
    await context.close();
    assert.deepEqual([...rejected], [], 'Unexpected network/API attempt');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error); process.exitCode = 1;
  } finally {
    await browser?.close();
    Object.assign(report, { preflight: preflightResult, renderedChecks: report.checks.length, blockedImageChecks: report.imageBlockedChecks.length, interceptedRequests: [...intercepted], rejectedRequests: [...rejected] });
    await writeFile(join(OUTPUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, renderedChecks: report.renderedChecks, blockedImageChecks: report.blockedImageChecks, screenshots: report.screenshots.length, error: report.error }));
  }
}
