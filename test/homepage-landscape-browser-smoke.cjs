const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');

(async () => {
  const server = spawn(process.execPath, ['scripts/preview.mjs', '--port', '4192'], { stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch('http://127.0.0.1:4192')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch();
    await mkdir('artifacts/homepage', { recursive: true });
    // Include the browser toolbar's lost height, the original screenshot's
    // proportions, and mini/Air/Pro sizes. Rotation is tested without a reload.
    for (const [width, height] of [[1024, 648], [1133, 644], [1180, 688], [1194, 714], [1366, 912], [1376, 912]]) {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion, serviceWorkers: 'block' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:4192');
        await page.locator('#input-container.visible').waitFor();
        await page.evaluate(async () => { const image = new Image(); image.src = '/assets/og-hero.png'; await image.decode(); });
        const inspect = () => page.evaluate(() => {
          const background = document.getElementById('background-image');
          const art = getComputedStyle(background, '::before');
          const matrix = new DOMMatrix(art.transform);
          const canvas = document.getElementById('wave-canvas').getBoundingClientRect();
          const container = background.getBoundingClientRect();
          return {
            size: art.backgroundSize, width: parseFloat(art.width), height: parseFloat(art.height),
            scaleX: matrix.m11, scaleY: matrix.m22, offsetY: matrix.m42,
            containerHeight: container.height, waveY: canvas.y + canvas.height / 2,
            headerBottom: document.querySelector('.top-bar').getBoundingClientRect().bottom,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const checkLandscape = async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          const art = await inspect();
          assert.equal(art.size, 'contain', `uncropped tablet art at ${width}x${height}`);
          assert.ok(Math.abs(art.width / art.height - 2 / 3) < .001, 'art retains its original proportions');
          assert.equal(art.scaleX, 1, 'do not zoom back into the image');
          assert.equal(art.scaleY, 1);
          assert.ok(Math.abs(art.height - art.containerHeight) < 1, 'art fits the current viewport height');
          assert.ok(art.height * .118 + art.offsetY >= art.headerBottom - 3, 'artwork headline is below the header');
          assert.ok(art.height * .24 + art.offsetY < height, 'complete tagline remains on screen');
          assert.ok(Math.abs(art.waveY - (art.height * .495 + art.offsetY)) < 8, 'wave follows the resized wing junction');
          assert.equal(art.overflow, false, 'no horizontal overflow');
          for (const button of await page.locator('.hero-btn').all()) {
            const box = await button.boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width, 'CTAs remain inside viewport');
          }
          if (reducedMotion === 'reduce') assert.equal(art.offsetY, 0, 'reduced-motion framing stays still');
        };
        await checkLandscape();
        await page.screenshot({ path: `artifacts/homepage/ipad-${width}x${height}-${reducedMotion}.png` });
        await page.setViewportSize({ width: height, height: width });
        assert.equal((await inspect()).size, 'cover', 'rotation back restores original portrait composition');
        await page.setViewportSize({ width, height });
        await checkLandscape();
        // Calculate, rotate with a result showing, and reset. The landscape
        // rule must never reposition calculated-day waves or backgrounds.
        await page.locator('#birthdate-input').fill('1990-01-01');
        await page.locator('#calculate-btn').click();
        await page.locator('.result-card.visible').waitFor();
        assert.equal(await page.locator('.wave-container').evaluate(el => getComputedStyle(el).transform), 'none');
        await page.setViewportSize({ width: height, height: width });
        await page.setViewportSize({ width, height });
        assert.equal(await page.locator('.wave-container').evaluate(el => getComputedStyle(el).transform), 'none');
        await page.locator('#home-find-wave').click();
        await page.locator('#input-container.visible').waitFor();
        await page.waitForFunction(() => document.getElementById('background-image').classList.contains('hero-mode'));
        await checkLandscape();
        assert.deepEqual(errors, [], 'no browser errors');
        await page.close();
      }
    }
    // Pointer-equipped desktop/laptop windows retain the existing cover design,
    // even at the same dimensions as the iPad screenshot.
    const desktop = await browser.newPage({ viewport: { width: 1180, height: 688 }, serviceWorkers: 'block' });
    await desktop.goto('http://127.0.0.1:4192');
    await desktop.locator('#input-container.visible').waitFor();
    assert.equal(await desktop.locator('#background-image').evaluate(el => getComputedStyle(el, '::before').backgroundSize), 'cover');
    await desktop.close();
    console.log('iPad landscape artwork, both motion settings, repeated rotation, calculation/reset and desktop regression checks passed.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
