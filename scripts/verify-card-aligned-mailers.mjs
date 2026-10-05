// Offline Chromium review: every request is fulfilled from checked-in bytes or blocked.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DAY_DATA, DAY_DETAILS } from '../js/sineday-engine.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORY = 'docs/email-templates/20261005-card-aligned';
const OUTPUT = join(ROOT, 'output/card-aligned-review');
const PDF_OUTPUT = join(ROOT, 'tmp/pdfs/card-aligned');
const args = process.argv.slice(2);
assert.ok(args.every((arg) => arg === '--pdf'), 'Only --pdf is supported');
const makePdfs = args.includes('--pdf');
await mkdir(OUTPUT, { recursive: true });
if (makePdfs) await mkdir(PDF_OUTPUT, { recursive: true });
const copy = JSON.parse(await readFile(join(ROOT, DIRECTORY, 'copy.json'), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.MAILER_BROWSER_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const checks = [], blockedChecks = [], previewChecks = [], pdfs = [];
const intercepted = new Set(), rejected = new Set();
async function offlineRoute(route) {
  const url = new URL(route.request().url());
  const pathname = url.pathname.slice(1);
  intercepted.add(url.href);
  if (url.hostname === 'mailer.test' && new RegExp(`^${DIRECTORY}/(?:day-\\d{2}|preview)\\.html$`).test(pathname)) return route.fulfill({ contentType: 'text/html', body: await readFile(join(ROOT, pathname)) });
  if (['sineday.app', 'mailer.test'].includes(url.hostname) && /^assets\/email\/(?:20260924\/scenes\/SineDayScene\d{1,2}|20260911\/wave-\d{2})\.png$/.test(pathname)) return route.fulfill({ contentType: 'image/png', body: await readFile(join(ROOT, pathname)) });
  rejected.add(url.href);
  return route.abort('blockedbyclient');
}
try {
  for (const width of [320, 375, 520]) {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: 1 });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', offlineRoute);
      for (let day = 1; day <= 18; day++) {
        const stem = `day-${String(day).padStart(2, '0')}`;
        const entry = copy.days.find((entry) => entry.day === day);
        await page.goto(`http://mailer.test/${DIRECTORY}/${stem}.html`, { waitUntil: 'load' });
        const result = await page.evaluate(() => {
          const reflection = document.querySelector('[data-sineday-surface="reflection"]');
          const notice = document.querySelector('[data-sineday-surface="notice"]');
          const blog = document.querySelector('[data-sineday-surface="blog"] a');
          const textOverflows = [];
          for (const element of document.querySelectorAll('p,h1,h2,li,a')) {
            const range = document.createRange(); range.selectNodeContents(element);
            for (const rect of range.getClientRects()) if (rect.width && (rect.left < -1 || rect.right > innerWidth + 1)) textOverflows.push(element.textContent);
          }
          return { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, viewportWidth: innerWidth, subtitle: document.querySelector('[data-sineday-surface="header"] > p:last-child').textContent, paragraphs: [...document.querySelectorAll('p')].filter((p) => p.style.fontSize === '17px' && p.style.color === 'rgb(232, 236, 247)').map((p) => p.textContent), bullets: [...notice.querySelectorAll('li')].map((li) => li.textContent), question: reflection.querySelector('h2').textContent, reflection: reflection.innerText, footer: document.querySelector('[data-sineday-surface="footer"]').innerText, imageCount: document.images.length, imagesLoaded: [...document.images].every((image) => image.complete && image.naturalWidth > 0), background: getComputedStyle(document.body).backgroundColor, blogHref: blog.getAttribute('href'), blogTapHeight: blog.getBoundingClientRect().height, textOverflows };
        });
        assert.equal(result.scrollWidth, width, `${stem} ${width}px overflow`);
        assert.deepEqual(result.textOverflows, [], `${stem} ${width}px text overflow`);
        assert.equal(result.subtitle, DAY_DATA[day - 1].description);
        assert.deepEqual(result.paragraphs, [DAY_DETAILS[day].paragraph]);
        assert.deepEqual(result.bullets, DAY_DETAILS[day].bullets);
        assert.equal(result.question, entry.question);
        assert.ok(!result.reflection.includes('Your writing'));
        assert.ok(result.footer.includes('Stop daily emails'));
        assert.equal(result.imageCount, 2); assert.ok(result.imagesLoaded);
        assert.equal(result.background, 'rgb(5, 6, 10)');
        assert.equal(result.blogHref, 'https://www.sineday.blog/'); assert.ok(result.blogTapHeight >= 44);
        assert.deepEqual(errors, []);
        checks.push({ day, width, colorScheme, ...result });
        if (colorScheme === 'light' && [375, 520].includes(width)) await page.screenshot({ path: join(OUTPUT, `${stem}-${width}px.png`), fullPage: true });
        if (colorScheme === 'light' && width === 520 && makePdfs) {
          await page.emulateMedia({ media: 'screen' });
          const path = join(PDF_OUTPUT, `${stem}.pdf`);
          await page.pdf({ path, printBackground: true, width: '520px', height: `${Math.ceil(result.scrollHeight) + 2}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 }, tagged: true });
          pdfs.push({ day, path, expectedHeightPx: Math.ceil(result.scrollHeight) + 2 });
        }
      }
      await page.close();
    }
  }
  const blocked = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await blocked.route('**/*', (route) => route.abort('blockedbyclient'));
  for (let day = 1; day <= 18; day++) {
    const stem = `day-${String(day).padStart(2, '0')}`;
    await blocked.setContent(await readFile(join(ROOT, DIRECTORY, `${stem}.html`), 'utf8'));
    assert.ok(await blocked.getByRole('link', { name: 'Explore the SineDay blog', exact: true }).isVisible());
    assert.ok(await blocked.getByRole('link', { name: 'mysine@sineday.app', exact: true }).isVisible());
    assert.equal(await blocked.evaluate(() => document.documentElement.scrollWidth), 375);
    assert.equal(await blocked.locator('[data-sineday-surface="notice"] li').count(), 4);
    assert.equal(await blocked.locator('[data-sineday-surface="reflection"] h2').textContent(), copy.days[day - 1].question);
    blockedChecks.push({ day, width: 375, passed: true });
    if ([1, 9, 18].includes(day)) await blocked.screenshot({ path: join(OUTPUT, `${stem}-images-blocked.png`), fullPage: true });
  }
  await blocked.close();
  const preview = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  await preview.route('**/*', offlineRoute);
  const previewErrors = []; preview.on('pageerror', (error) => previewErrors.push(error.message));
  await preview.goto(`http://mailer.test/${DIRECTORY}/preview.html`, { waitUntil: 'load' });
  for (let day = 1; day <= 18; day++) {
    await preview.getByRole('button', { name: `Day ${day}`, exact: true }).click();
    const frame = preview.frameLocator('iframe');
    await frame.locator('[data-sineday-surface="reflection"] h2').filter({ hasText: copy.days[day - 1].question }).waitFor();
    assert.equal(await preview.locator('#question').textContent(), copy.days[day - 1].question);
    assert.equal(await frame.locator('[data-sineday-surface="reflection"] h2').textContent(), copy.days[day - 1].question);
    for (const width of [320, 375, 520]) {
      await preview.locator('#width').selectOption(String(width));
      assert.equal(await preview.locator('iframe').evaluate((element) => element.clientWidth), width);
      previewChecks.push({ day, width, passed: true });
    }
  }
  await preview.getByRole('button', { name: 'Day 1', exact: true }).click();
  await preview.locator('#width').selectOption('375');
  await preview.waitForTimeout(200);
  await preview.screenshot({ path: join(OUTPUT, 'side-by-side-preview.png'), fullPage: true });
  assert.deepEqual(previewErrors, []);
  await preview.close();
  const report = { scope: 'Offline local Chromium rendering; not native Gmail, Apple Mail or Outlook certification', browser: await browser.version(), network: 'Every request intercepted; checked-in image bytes only; no live email or webpage modifications', renderedChecks: checks.length, imageBlockedChecks: blockedChecks.length, previewControlChecks: previewChecks.length, screenshots: 'All 18 full-height mobile 375px and desktop 520px screenshots, 3 image-blocked samples, and side-by-side preview', pdfs, checks, blockedChecks, previewChecks, interceptedRequests: [...intercepted], rejectedRequests: [...rejected] };
  await writeFile(join(OUTPUT, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Passed ${checks.length} renders, ${blockedChecks.length} image-blocked cases and ${previewChecks.length} preview interactions. ${pdfs.length} PDFs. Output: ${OUTPUT}`);
} finally { await browser.close(); }
