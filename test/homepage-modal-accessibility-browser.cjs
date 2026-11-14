const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const server = spawn(process.execPath, ['scripts/preview.mjs', '--port', '4195'], { stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch('http://127.0.0.1:4195')).ok) break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.goto('http://127.0.0.1:4195');
    await page.locator('#input-container.visible').waitFor();
    // Real controls: keyboard focus cannot enter footer/main/skip link while open.
    for (let i = 0; i < 3; i++) {
      await page.locator('#info-btn').click();
      assert.equal(await page.locator('#info-modal-close').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('footer').evaluate(el => el.inert), true);
      assert.equal(await page.locator('.skip-link').evaluate(el => el.inert), true);
      await page.locator('footer a').first().evaluate(el => el.focus());
      assert.equal(await page.locator('#info-modal-close').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#info-modal-close').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#info-btn').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('footer').evaluate(el => el.inert), false);
      assert.equal(await page.locator('#background-image').getAttribute('aria-hidden'), 'true');
    }
    // Explicit reentrant calls must not overwrite the opener or prior inert state.
    assert.equal(await page.evaluate(async () => {
      const { default: UI } = await import('/js/ui.js');
      const ui = Object.create(UI.prototype);
      ui.elements = { infoModal: document.getElementById('info-modal'), infoModalClose: document.getElementById('info-modal-close'), infoBtn: document.getElementById('info-btn') };
      const main = document.querySelector('main');
      main.inert = true;
      ui.elements.infoBtn.focus();
      ui.openInfoModal();
      const handler = ui._boundModalKeydown;
      ui.openInfoModal();
      const sameHandler = handler === ui._boundModalKeydown;
      ui.closeInfoModal();
      const restored = main.inert && document.activeElement === ui.elements.infoBtn;
      main.inert = false;
      return sameHandler && restored && !ui._boundModalKeydown;
    }), true);
    console.log('Homepage modal accessibility regression: passed');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
