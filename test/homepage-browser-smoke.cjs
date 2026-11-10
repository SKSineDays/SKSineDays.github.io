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
    for (const { width, reducedMotion } of [{ width: 375, reducedMotion: 'no-preference' }, { width: 1440, reducedMotion: 'reduce' }]) {
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion,serviceWorkers:'block'});
      const errors=[],media=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(r.url().endsWith('.mp4'))media.push(r.url());});
      await page.goto('http://127.0.0.1:4189');
      await page.locator('#input-container.visible').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
      await page.locator('.home-film__visual img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      await page.screenshot({path:`artifacts/homepage/${width}-landing.png`,fullPage:true});
      assert.equal(media.length,0,'video must not download on arrival');
      assert.equal(await page.locator('.home-hero__art').count(),0,'full-bleed hero must not duplicate the artwork');
      const hero = await page.locator('.home-hero').boundingBox();
      const copy = await page.locator('.home-hero__content').boundingBox();
      const canvas = await page.locator('#wave-canvas').boundingBox();
      const background = await page.locator('#background-image').evaluate(e => {
        const art = getComputedStyle(e, '::before');
        return { image: art.backgroundImage, size: art.backgroundSize, depth: e.style.getPropertyValue('--hero-depth') || '0px' };
      });
      assert.ok(Math.abs(hero.width-width)<=1,'introduction must be full bleed');
      assert.match(background.image,/og-hero\.png/);
      assert.equal(background.size,'cover');
      assert.ok(Math.abs((canvas.x+(canvas.width/2))-(width/2))<=1,'wave must remain centered');
      assert.ok(copy.x>=0 && copy.x+copy.width<=width,'hero copy must stay in the viewport');
      if (width === 375) assert.ok(copy.y>450,'mobile copy must sit below the artwork focal point');
      if (width === 1440) assert.ok(copy.x+copy.width<width/2,'desktop copy must leave the centered focal point clear');
      for (const button of await page.locator('.hero-btn').all()) {
        const box=await button.boundingBox();
        assert.ok(box.x>=0 && box.x+box.width<=width,`CTA overflow ${width}`);
      }
      if (reducedMotion === 'reduce') {
        assert.equal(background.depth,'0px','reduced motion keeps hero depth static');
      } else {
        await page.waitForTimeout(50);
        const before=await page.locator('#background-image').evaluate(e=>e.style.getPropertyValue('--hero-depth'));
        await page.evaluate(()=>window.scrollTo(0,180));
        await page.waitForTimeout(50);
        const after=await page.locator('#background-image').evaluate(e=>e.style.getPropertyValue('--hero-depth'));
        assert.notEqual(after,before,'visible hero depth should update on scroll');
        await page.evaluate(()=>window.scrollTo(0,0));
      }
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
      assert.equal(await page.locator('#wave-intro.bottom-placement').count(),1);
      await page.locator('#home-find-wave').click();
      await page.locator('#input-container.visible').waitFor();
      assert.equal(await page.locator('#wave-intro.bottom-placement').count(),0);
      await page.waitForTimeout(200);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:`artifacts/homepage/${width}.png`,fullPage:true});
      assert.deepEqual(errors,[],`browser errors ${width}`);
      await page.close();
    }
    console.log('Homepage mobile/desktop full-bleed, reduced-motion, opt-in media and wave reset checks passed.');
  } finally { await browser?.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
