const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
(async () => {
  const server = spawn(process.execPath, ['scripts/preview.mjs','--port','4189'], {stdio:'ignore'});
  let browser;
  try {
    for (let i=0; i<40; i++) { try { if ((await fetch('http://127.0.0.1:4189')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
    browser = await chromium.launch();
    await mkdir('artifacts/homepage',{recursive:true});
    for (const width of [375,768,1440]) {
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
      const errors=[],media=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(r.url().endsWith('.mp4'))media.push(r.url());});
      await page.goto('http://127.0.0.1:4189');
      await page.locator('#input-container.visible').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
      await page.locator('.home-film__visual img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      await page.screenshot({path:`artifacts/homepage/${width}-landing.png`,fullPage:true});
      assert.equal(media.length,0,'video must not download on arrival');
      const art = await page.locator('.home-hero__art').boundingBox();
      const copy = await page.locator('.home-hero__content').boundingBox();
      assert.ok(art.width > 100 && art.height > 200, 'original artwork needs visible space');
      assert.ok(art.x + art.width <= copy.x + 1 || copy.x + copy.width <= art.x + 1 || art.y + art.height <= copy.y + 1 || copy.y + copy.height <= art.y + 1, 'hero copy must not obscure artwork');
      assert.match(await page.locator('.home-hero__art').evaluate(e => getComputedStyle(e).backgroundImage), /og-hero\.png/);
      assert.equal(await page.locator('[data-home-video]').count(),2);
      await page.locator('[data-home-video]').first().click();
      await page.locator('#home-video-dialog[open]').waitFor();
      assert.equal(await page.locator('#home-video-player').evaluate(v=>v.paused),true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('home-video-player').hasAttribute('src'));
      assert.equal(await page.locator('#home-video-player').getAttribute('src'),null);
      assert.equal(await page.locator('[data-home-video]').first().evaluate(e=>e===document.activeElement),true);
      await page.locator('#birthdate-input').fill('1990-01-01');
      await page.locator('#calculate-btn').click();
      await page.locator('.result-card.visible').waitFor();
      await page.locator('#home-find-wave').click();
      await page.locator('#input-container.visible').waitFor();
      await page.waitForTimeout(200);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:`artifacts/homepage/${width}.png`,fullPage:true});
      assert.deepEqual(errors,[],`browser errors ${width}`);
      await page.close();
    }
    console.log('Homepage responsive, opt-in media, focus and wave reset checks passed.');
  } finally { await browser?.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
