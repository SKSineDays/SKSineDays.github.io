/* Offline-only UI regression checks. No application, analytics, or other request leaves this test. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = process.env.AFFILIATE_REVIEW_OUTPUT || '/tmp/sineday-affiliate-review';
const ORIGIN = 'http://affiliate.test';
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const allowed = new Set(['affiliate.html', 'styles.css', 'css/affiliate-public.css', 'js/affiliate-application.js', 'assets/brand/sineday-wordmark.svg', 'assets/sineducks/SineDuckFinale8.svg', 'favicon.ico', 'breathingicon.svg', 'site.webmanifest']);
const valid = { displayName: 'Review Creator', email: 'review@example.test', instagram: '@review', introduction: 'I share thoughtful journaling prompts with a small creative community.' };
(async () => {
  await fs.mkdir(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.AFFILIATE_BROWSER_EXECUTABLE ? { executablePath: process.env.AFFILIATE_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  let posts = 0, reply = 'success', pendingRoute;
  const errors = [];
  async function prepare(viewport, reducedMotion = 'no-preference') {
    const page = await browser.newPage({ viewport, reducedMotion, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === '/api/affiliate/application') {
        posts++;
        assert.equal(route.request().method(), 'POST');
        const payload = route.request().postDataJSON();
        assert.deepEqual(Object.keys(payload).sort(), ['company', 'displayName', 'email', 'instagram', 'introduction', 'otherSocial', 'tiktok', 'website', 'youtube'].sort());
        if (reply === 'pending') { pendingRoute = route; return; }
        if (reply === 'network') return route.abort('internetdisconnected');
        return route.fulfill({ status: reply === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(reply === 'error' ? { ok: false, error: 'Temporarily unavailable.' } : { ok: true }) });
      }
      // Keep unrelated scripts, including analytics and authenticated dashboard code, offline.
      if (url.pathname === '/js/vercel-analytics.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (url.pathname === '/dashboard.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline dashboard placeholder</title><h1>Dashboard destination</h1>' });
      const file = url.pathname.slice(1);
      if (!allowed.has(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: contentTypes[path.extname(file)], body: await fs.readFile(path.join(ROOT, file)) });
    });
    await page.goto(`${ORIGIN}/affiliate.html`);
    return page;
  }
  async function fill(page) { for (const [name, value] of Object.entries(valid)) await page.locator(`[name="${name}"]`).fill(value); }
  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await prepare({ width, height: 900 });
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, h1: document.querySelectorAll('h1').length, imagesLoaded: [...document.images].every(i => i.complete && i.naturalWidth > 0), fields: [...document.querySelectorAll('.affiliate-public__field input, textarea')].map(e => ({ font: parseFloat(getComputedStyle(e).fontSize), height: e.getBoundingClientRect().height })) }));
      assert.equal(metrics.scrollWidth, width, `overflow at ${width}`);
      assert.equal(metrics.h1, 1); assert.ok(metrics.imagesLoaded);
      assert.ok(metrics.fields.every(f => f.font >= 16 && f.height >= 44));
      assert.equal(await page.locator('#affiliate-public-success').isVisible(), false);
      assert.equal(await page.locator('#affiliate-public-error').isVisible(), false);
      await page.screenshot({ path: path.join(OUTPUT, `affiliate-${width}.png`), fullPage: true });
      await page.getByRole('link', { name: 'Become an affiliate' }).click();
      assert.ok(page.url().endsWith('#apply'));
      assert.ok(await page.locator('#apply').evaluate(e => Math.abs(e.getBoundingClientRect().top) <= 32));
      await page.getByRole('button', { name: 'Send application' }).click();
      assert.equal(posts, 0, 'invalid form must never post');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'affiliate-public-name');
      assert.equal(await page.locator('#affiliate-public-name').getAttribute('aria-invalid'), 'true');
      await page.screenshot({ path: path.join(OUTPUT, `affiliate-${width}-errors.png`), fullPage: true });
      await fill(page);
      assert.equal(await page.locator('#affiliate-public-name').getAttribute('aria-invalid'), null);
      await page.close();
    }
    const page = await prepare({ width: 390, height: 844 }, 'reduce');
    await fill(page);
    reply = 'error';
    await page.getByRole('button', { name: 'Send application' }).click();
    await page.locator('#affiliate-public-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name="displayName"]').inputValue(), valid.displayName);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'affiliate-public-error');
    reply = 'network';
    await page.getByRole('button', { name: 'Send application' }).click();
    await page.waitForFunction(() => !document.querySelector('[type="submit"]').disabled);
    assert.equal(await page.locator('[name="introduction"]').inputValue(), valid.introduction);
    reply = 'pending';
    await page.getByRole('button', { name: 'Send application' }).click();
    await page.waitForFunction(() => document.querySelector('[type="submit"]').disabled);
    assert.equal(await page.getByRole('button', { name: 'Sending application…' }).isDisabled(), true);
    const currentPosts = posts;
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(posts, currentPosts);
    await page.screenshot({ path: path.join(OUTPUT, 'affiliate-mobile-sending.png'), fullPage: true });
    await pendingRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    await page.locator('#affiliate-public-success').waitFor({ state: 'visible' });
    assert.equal(await page.locator('form').isVisible(), false);
    assert.equal(await page.locator('.affiliate-public__form-heading').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Application received');
    await page.screenshot({ path: path.join(OUTPUT, 'affiliate-mobile-success.png'), fullPage: true });
    await page.getByRole('link', { name: 'Open Dashboard' }).click();
    await page.goBack();
    assert.ok(page.url().includes('/affiliate.html'));
    assert.equal(posts, currentPosts, 'Back navigation never resubmits');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', viewports: [320, 390, 768, 1440], mockedPosts: posts, realPosts: 0, output: OUTPUT }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
