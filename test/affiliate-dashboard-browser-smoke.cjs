/* Mocked dashboard UI checks: zero real API calls or messages. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const fixture = require('./helpers/affiliate-dashboard-fixture.cjs');
const output = process.env.AFFILIATE_REVIEW_OUTPUT || 'artifacts/affiliate-dashboard';
const root = path.resolve(__dirname, '..');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.AFFILIATE_BROWSER_EXECUTABLE ? { executablePath: process.env.AFFILIATE_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      let result = { status: 'running', width, checks: [] };
      try {
        await page.route('**/*', route => route.fulfill({ status: 404, body: '' }));
        await page.setContent(fixture());
        await page.waitForFunction(() => document.body.dataset.fixtureReady === 'true');
        await page.getByRole('button', { name: 'Run regression checks' }).click();
        await page.waitForFunction(() => document.body.dataset.testResult);
        result = JSON.parse(await page.locator('#results').textContent());
        assert.equal(result.status, 'passed', JSON.stringify(result));
        assert.deepEqual(pageErrors, []);
        assert.equal(await page.locator('body').getAttribute('data-page-error'), null);
        const images = await page.locator('.affiliate-asset-card img').evaluateAll(async elements => {
          elements.forEach(image => { image.loading = 'eager'; });
          await Promise.all(elements.map(image => image.decode()));
          return elements.map(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
        });
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/affiliate/assets.json')));
        assert.deepEqual(images, manifest.map(asset => ({ width: asset.width, height: asset.height })));
        result.checks.push('All packaged images decode at published dimensions');
        if (width === 390) {
          for (const asset of manifest) {
            const downloadEvent = page.waitForEvent('download');
            await page.getByRole('link', { name: `Download ${asset.title}`, exact: true }).click();
            const download = await downloadEvent;
            assert.equal(download.suggestedFilename(), path.basename(asset.path));
            assert.equal(await download.failure(), null);
            assert.deepEqual(await fs.readFile(await download.path()), await fs.readFile(path.join(root, asset.path)));
          }
          result.checks.push('All PNG and SVG downloads match their packaged files and filenames');
        }
        await page.locator('.affiliate-sheet__content').evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: path.join(output, `share-${width}.png`), fullPage: true });
        await page.locator('.affiliate-assets').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `assets-${width}.png`), fullPage: true });
        await page.getByRole('tab', { name: 'Overview', exact: true }).click();
        await page.screenshot({ path: path.join(output, `overview-${width}.png`), fullPage: true });
        await page.getByRole('tab', { name: 'Payouts', exact: true }).click();
        await page.screenshot({ path: path.join(output, `payouts-${width}.png`), fullPage: true });
      } catch (error) {
        const fixtureResult = await page.locator('#results').textContent().catch(() => null);
        result = { ...result, status: 'failed', error: error.message, pageErrors, fixtureResult };
        await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true }).catch(() => {});
        throw error;
      } finally {
        results.push(result);
        await fs.writeFile(path.join(output, `result-${width}.json`), `${JSON.stringify(result, null, 2)}\n`);
        await fs.writeFile(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
        await page.close();
      }
    }
    console.log(JSON.stringify({ status: 'passed', results, realApiCalls: 0, output }, null, 2));
  } finally { await browser.close(); }
})().catch(async error => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'runner-error.json'), `${JSON.stringify({ status: 'failed', error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
});
