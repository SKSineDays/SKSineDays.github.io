const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:4196';
(async () => {
  const server = spawn(process.execPath, ['scripts/preview.mjs', '--port', '4196'], { stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/login.html')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch();
    await mkdir('artifacts/privacy', { recursive: true });
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage(); const errors = []; let analyticsLoads = 0;
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: `window.supabase={createClient:(url,key,options)=>{window.testAuthOptions=options;return {auth:{getSession:async()=>({data:{session:null}}),signInWithOtp:async(value)=>{window.testOtp=value;return {error:null}}}}}};` });
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/api/config') return route.fulfill({ json: { ok: true, supabaseUrl: 'https://fixture.invalid', supabaseAnonKey: 'test', appUrl: base } });
        if (url.pathname === '/_vercel/insights/script.js') { analyticsLoads++; return route.fulfill({ contentType: 'application/javascript', body: `window.testBeforeSend=window.vaq.find(v=>v[0]==='beforeSend')[1];` }); }
        return route.continue();
      });
      await page.goto(base + '/login.html?ref=TEST-18');
      await page.locator('#sd-privacy-panel').waitFor();
      // Real modules exercised without contacting production auth/Stripe/analytics.
      await page.evaluate(async () => {
        localStorage.setItem('sb-test-auth-token', 'necessary-session');
        localStorage.setItem('sd:user_settings:fixture', 'necessary-settings');
        const { selectDayPhoto } = await import('/js/day-photo-view.js'); selectDayPhoto(1);
      });
      const optional = () => page.evaluate(() => [localStorage.getItem('sineday_pending_affiliate_code'), localStorage.getItem('sineday:photo-history:v1'), sessionStorage.getItem('sineday:photo-visit:v1')]);
      assert.deepEqual(await optional(), [null, null, null]); assert.equal(analyticsLoads, 0);
      const accept = page.locator('[data-choice="accept"]'), reject = page.locator('[data-choice="reject"]');
      const styles = await page.evaluate(() => ['accept', 'reject'].map(key => { const s = getComputedStyle(document.querySelector(`[data-choice="${key}"]`)); return [s.backgroundColor, s.color, s.fontSize, s.padding]; }));
      assert.deepEqual(styles[0], styles[1]);
      assert.equal(await accept.isVisible(), true); assert.equal(await reject.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `artifacts/privacy/choices-${width}.png`, fullPage: true });
      const initialScroll = await page.evaluate(() => scrollY);
      await reject.click(); assert.deepEqual(await optional(), [null, null, null]);
      assert.equal(await page.evaluate(() => scrollY), initialScroll, 'dismissing privacy must not jump to footer');
      await page.locator('#signin-email').fill('fixture@example.com');
      await page.locator('#email-signin-btn').click();
      await page.waitForFunction(() => window.testOtp?.email === 'fixture@example.com');
      assert.equal(await page.evaluate(() => window.testAuthOptions.auth.persistSession), true);
      assert.equal(analyticsLoads, 0);
      await page.getByRole('button', { name: 'Privacy choices', exact: true }).click();
      await accept.click();
      await page.waitForFunction(() => Boolean(window.testBeforeSend));
      assert.equal(analyticsLoads, 1);
      const [ref, history, visit] = await optional(); assert.equal(ref, 'TEST-18'); assert.ok(history); assert.ok(visit);
      assert.equal(await page.evaluate(async () => (await import('/js/affiliate-ui.js')).getPendingAffiliateCode()), 'TEST-18');
      assert.equal(await page.evaluate(() => window.testBeforeSend({ type: 'pageview', url: location.href + '#private' }).url), base + '/login.html');
      assert.equal(await page.evaluate(() => window.testBeforeSend({ type: 'event', url: location.href })), null);
      await page.getByRole('button', { name: 'Privacy choices', exact: true }).click();
      await page.screenshot({ path: `artifacts/privacy/settings-${width}.png`, fullPage: true });
      await Promise.all([page.waitForEvent('load'), reject.click()]);
      assert.deepEqual(await optional(), [null, null, null]); assert.equal(analyticsLoads, 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('sb-test-auth-token')), 'necessary-session');
      assert.equal(await page.evaluate(() => localStorage.getItem('sd:user_settings:fixture')), 'necessary-settings');
      assert.equal(await page.evaluate(async () => (await import('/js/affiliate-ui.js')).getPendingAffiliateCode()), '');
      await page.reload(); assert.equal(analyticsLoads, 1);
      assert.equal(await page.locator('#sd-privacy-panel').isVisible(), false);
      await page.getByRole('button', { name: 'Privacy choices', exact: true }).click();
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#sd-privacy-panel').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Privacy choices', exact: true }).evaluate(el => document.activeElement === el), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: mobile/desktop consent default deny, equivalent controls, referral preservation, real photo module writes, auth form with mocked provider, analytics gating/redaction, withdrawal+reload, optional-only clearing, persistent decline, Escape/focus. No production accounts or events used.');
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
