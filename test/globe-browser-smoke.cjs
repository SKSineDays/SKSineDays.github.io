// Local-only browser exercise. Every network request is intercepted: no production auth/data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/css/dashboard.css"><body class="dashboard-body"><main style="max-width:780px;margin:auto"><section class="dashboard-page feature-screen feature-screen--origin is-active" aria-hidden="false"><div class="container dashboard-page__card feature-screen__content"><section class="origin-identity"><div id="duck-carousel-wrap" class="duck-carousel-wrap"><div class="duck-carousel-header"><div><p class="feature-hero__eyebrow">Personal rhythm</p><h2 class="duck-carousel-title">Your Origin</h2></div></div></div></section></div></section></main><script type="module">
import {DuckCarousel} from '/js/duck-carousel.js';
window.carousel = new DuckCarousel(document.querySelector('#duck-carousel-wrap'),{getAccessToken:async()=> 'local-test-only'});
carousel.setProfiles([{id:'local-a',display_name:'Sample profile',birthdate:'1985-04-20',timezone:'America/Chicago'},{id:'local-b',display_name:'Second sample',birthdate:'1990-08-12',timezone:'America/Chicago'}]);
carousel.setActive?.(true);
</script></body></html>`;
const types = {'.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.html':'text/html'};
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const browser = await chromium.launch({ ...(process.env.GLOBE_BROWSER_EXECUTABLE ? {executablePath:process.env.GLOBE_BROWSER_EXECUTABLE} : {}), headless:true,
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const results = {};
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
    const state = { before:true, failData:false, offlineData:false, failSave:false, failTexture:false, failModule:false, failCities:false, cityLoads:0, puts:0, gets:0,
      membership:{enabled:false,regionKey:null,consentVersion:null}, groups:[{regionKey:'US',count:3},{regionKey:'CA',count:2},{regionKey:'BR',count:4},{regionKey:'FR',count:2},{regionKey:'ZA',count:1}] };
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());const pathname=decodeURIComponent(url.pathname);
      if (pathname==='/__fixture__.html') return route.fulfill({contentType:'text/html',body:fixture});
      if (pathname.startsWith('/api/globe/')) {
        if(state.offlineData)return route.abort('internetdisconnected');
        const method=route.request().method();if(method==='GET')state.gets++;
        if(state.failData || (method!=='GET'&&state.failSave))return route.fulfill({status:503,body:'Unavailable'});
        if(method==='PUT'){state.puts++;state.membership=route.request().postDataJSON();}
        if(method==='DELETE')state.membership={enabled:false,regionKey:null,consentVersion:null};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(pathname.endsWith('groups')?{groups:state.groups,generatedAt:new Date().toISOString(),precision:'region',participation:'opt-in'}:{membership:state.membership})});
      }
      if(pathname==='/shared/globe-cities.js'){state.cityLoads++;if(state.failCities)return route.fulfill({status:503,body:'Unavailable'});}
      if(state.failTexture&&pathname==='/assets/globe/earth-july-2004.jpg'||state.failModule&&pathname==='/js/globe-renderer.js')return route.fulfill({status:503,body:'Unavailable'});
      try {
        const body=state.before&&['/js/duck-carousel.js','/css/dashboard.css','/js/globe-renderer.js'].includes(pathname)
          ?execFileSync('git',['show',`${process.env.GLOBE_BASE_REF||'5fa74d1'}:${pathname.slice(1)}`],{cwd:root})
          :fs.readFileSync(path.join(root,pathname));
        return route.fulfill({contentType:types[path.extname(pathname)]||'application/octet-stream',body});
      } catch {return route.fulfill({status:404,body:'Not found'});}
    });
    const ready=async()=>{await page.goto('http://sineday.test/__fixture__.html');await page.locator('.origin-earth').scrollIntoViewIfNeeded();await page.waitForFunction(()=>window.carousel?.globe?.renderer?.ready);await page.waitForFunction(()=>window.carousel.globe.membership);};
    const ducks=()=>page.evaluate(()=>[...document.querySelectorAll('.duck-stack.is-active img')].map(img=>({src:img.getAttribute('src'),width:parseFloat(getComputedStyle(img).width),height:parseFloat(getComputedStyle(img).height)})));
    await ready();await page.getByRole('button',{name:'Pause Earth rotation'}).click();await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));await sleep(350);const beforeDucks=await ducks();
    await page.screenshot({path:path.join(root,'docs/globe/before-mobile.png'),fullPage:true,scale:"css"});
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(root,'docs/globe/before-desktop.png'),fullPage:true,scale:"css"});
    state.before=false;await page.setViewportSize({width:390,height:844});await ready();
    assert.deepEqual(await ducks(),beforeDucks);
    await page.getByRole('button',{name:'Pause Earth rotation'}).click();
    const angle=await page.evaluate(()=>carousel.globe.renderer.earth.rotation.y);await sleep(100);assert.equal(await page.evaluate(()=>carousel.globe.renderer.earth.rotation.y),angle);
    await page.screenshot({path:path.join(root,'docs/globe/after-mobile.png'),fullPage:true,scale:"css"});
    const centered=async()=>{
      const boxes=await page.evaluate(()=>{
        const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
        return {earth:box('.origin-earth'),profile:box('.duck-stack.is-active'),nav:box('.duck-ring__nav--next'),counter:box('.duck-ring__counter')};
      });
      assert.ok(Math.abs(boxes.earth.y+boxes.earth.height/2-boxes.profile.y-boxes.profile.height/2)<2,JSON.stringify(boxes));
      assert.ok(Math.abs(boxes.earth.x+boxes.earth.width/2-boxes.profile.x-boxes.profile.width/2)<2,JSON.stringify(boxes));
      assert.ok(Math.abs(boxes.earth.y+boxes.earth.height/2-boxes.nav.y-boxes.nav.height/2)<2);
      assert.ok(boxes.counter.y>=Math.max(boxes.earth.y+boxes.earth.height,boxes.profile.y+boxes.profile.height));
      return boxes;
    };
    results.centering={mobile:await centered()};
    for(const [width,height,name] of [[320,568,'small-mobile'],[844,390,'landscape'],[1280,900,'desktop']]){
      await page.setViewportSize({width,height});await sleep(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      results.centering[name]=await centered();
      await page.screenshot({path:path.join(root,`docs/globe/after-${name}.png`),fullPage:true,scale:"css"});
    }
    await page.getByRole('button',{name:'Next profile'}).click();assert.equal(await page.evaluate(()=>carousel.currentIndex),1);
    await page.getByRole('button',{name:'Previous profile'}).click();assert.equal(await page.evaluate(()=>carousel.currentIndex),0);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.duck-ring__scene').scrollIntoViewIfNeeded();
    await sleep(350); // Let ResizeObserver layout and the prior card transition settle.
    const scene=await page.locator('.duck-ring__scene').boundingBox();
    await page.mouse.move(scene.x+scene.width/2+80,scene.y+260);await page.mouse.down();
    await page.mouse.move(scene.x+scene.width/2-80,scene.y+260,{steps:8});await page.mouse.up();
    assert.equal(await page.evaluate(()=>carousel.currentIndex),1);
    await page.getByRole('button',{name:'Previous profile'}).focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>carousel.currentIndex),0);
    await sleep(350);
    await page.locator('.duck-stack').nth(1).click({position:{x:5,y:180}});assert.equal(await page.evaluate(()=>carousel.currentIndex),1);
    await page.getByRole('button',{name:'Previous profile'}).click();
    assert.equal(await page.locator('.duck-ring__scene').evaluate(el=>getComputedStyle(el).touchAction),'pan-y');
    assert.equal(await page.locator('.origin-earth').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    // The tighter composition fits a typical iPhone; use small mobile to exercise scrolling.
    await page.setViewportSize({width:320,height:568});await page.evaluate(()=>scrollTo(0,0));
    const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,240);await sleep(150);
    assert.ok(await page.evaluate(before=>scrollY>before,scrollBefore));
    await page.setViewportSize({width:390,height:844});
    await page.locator('.origin-earth').scrollIntoViewIfNeeded();
    await page.getByRole('button',{name:'Play Earth rotation'}).click();
    const performanceSample=await page.evaluate(async()=>{const renderer=carousel.globe.renderer;const samples=[];const original=renderer.draw.bind(renderer);renderer.draw=function(){const t=performance.now();original();samples.push(performance.now()-t)};await new Promise(r=>setTimeout(r,2100));renderer.draw=original;return {viewport:[innerWidth,innerHeight],sampleSeconds:2.1,frames:samples.length,meanSubmitMs:samples.reduce((a,b)=>a+b,0)/samples.length,drawCalls:renderer.renderer.info.render.calls,triangles:renderer.renderer.info.render.triangles,dpr:renderer.dpr,backing:[renderer.canvas.width,renderer.canvas.height]};});
    results.performance=performanceSample;
    const gets=state.gets;
    await page.evaluate(()=>carousel.setActive(false));const stopped=await page.evaluate(()=>carousel.globe.renderer.earth.rotation.y);await sleep(100);assert.equal(await page.evaluate(()=>carousel.globe.renderer.earth.rotation.y),stopped);
    await page.evaluate(()=>carousel.setActive(true));await sleep(100);assert.equal(state.gets,gets);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'Earth rotation paused for reduced motion',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>carousel.globe.paused && !carousel.globe.renderer.rotating),true);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('button',{name:'Play Earth rotation',exact:true}).click();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>carousel.globe.renderer.visible),false);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(state.cityLoads,0); // Optional catalog is not a startup dependency.
    await page.getByRole('button',{name:'Add my light',exact:true}).click();assert.equal(await page.getByLabel('Show my light').isChecked(),false);
    await page.getByLabel('Country or territory').selectOption('US');await page.getByLabel('Show my light').check();
    state.failSave=true;await page.getByRole('button',{name:'Save light',exact:true}).click();await page.getByText('We could not confirm the change.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.membership.enabled),false);
    state.failSave=false;await page.getByRole('button',{name:'Save light',exact:true}).click();await page.getByRole('button',{name:'Manage my light',exact:true}).waitFor();assert.equal(state.puts,1);
    await page.getByRole('button',{name:'Manage my light',exact:true}).click();
    assert.equal(await page.getByLabel('Country or territory').inputValue(),'US');
    await page.getByRole('combobox',{name:'City (optional)',exact:true}).fill('Springdale');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Show my light').isChecked(),false);
    assert.equal(await page.evaluate(()=>carousel.globe.cityKey),'us-census-0566080');
    await page.getByRole('button',{name:'Save light',exact:true}).click();
    await page.getByText('Check “Show my light” to share',{exact:false}).waitFor();
    await page.getByLabel('Show my light').check();await page.getByRole('button',{name:'Save light',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('dialog').open);
    assert.equal(state.membership.consentVersion,'2026-10-01');
    await page.waitForFunction(()=>carousel.globe.renderer.cities);
    assert.equal(await page.evaluate(()=>carousel.globe.groups.find(g=>g.cityKey==='us-census-0566080').count),1);
    await page.getByRole('button',{name:'Manage my light',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'City (optional)',exact:true}).inputValue(),'Springdale, Arkansas');
    await page.getByRole('combobox',{name:'City (optional)',exact:true}).fill('Fayetteville');
    await page.getByRole('option',{name:'Fayetteville, Arkansas',exact:true}).tap();
    await page.getByLabel('Show my light').check();await page.getByRole('button',{name:'Save light',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('dialog').open);
    assert.equal(state.membership.cityKey,'ne-1159132889');
    assert.equal(await page.evaluate(()=>carousel.globe.groups.some(g=>g.cityKey==='us-census-0566080')),false);
    await page.getByRole('button',{name:'Manage my light',exact:true}).click();
    await page.getByLabel('Country or territory').selectOption('CA');
    assert.equal(await page.getByRole('combobox',{name:'City (optional)',exact:true}).inputValue(),'');
    assert.equal(await page.evaluate(()=>carousel.globe.cityKey),null);
    await page.getByRole('combobox',{name:'City (optional)',exact:true}).fill('Unlisted place');
    await page.getByText('No matching city.',{exact:false}).waitFor();
    await page.getByLabel('Show my light').check();await page.getByRole('button',{name:'Save light',exact:true}).click();
    await page.getByText('Select a city from the list',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Use country only',exact:true}).click();
    await page.getByLabel('Show my light').check();await page.getByRole('button',{name:'Save light',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
    await page.getByRole('button',{name:'Manage my light',exact:true}).click();state.failSave=true;await page.getByRole('button',{name:'Remove my light',exact:true}).click();await page.getByText('We could not confirm the change.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.membership.enabled),true);
    state.failSave=false;await page.getByRole('button',{name:'Remove my light',exact:true}).click();await page.getByRole('button',{name:'Add my light',exact:true}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.groups.find(g=>g.regionKey==='CA').count),2);
    await page.evaluate(()=>carousel.setProfiles([]));assert.equal(await page.locator('.duck-ring__empty').isVisible(),true);assert.equal(await page.locator('.origin-earth canvas').isVisible(),true);
    await page.evaluate(()=>carousel.globe.renderer.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());await page.waitForFunction(()=>!carousel.globe.renderer);assert.equal(await page.locator('.origin-earth-fallback').isVisible(),true);
    await page.evaluate(()=>carousel.destroy());assert.equal(await page.locator('.origin-earth canvas').count(),0);assert.equal(await page.locator('dialog').count(),0);
    state.failData=true;await page.reload();await page.waitForFunction(()=>window.carousel?.globe?.renderer?.ready);await page.getByText('Member lights are temporarily unavailable.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.renderer.pointsGeometry.attributes.position.count),0);
    state.failData=false;state.offlineData=true;await page.reload();await page.locator('.origin-earth').scrollIntoViewIfNeeded();await page.waitForFunction(()=>window.carousel?.globe?.renderer?.ready);await page.getByText('Member lights are temporarily unavailable.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.renderer.pointsGeometry.attributes.position.count),0);state.offlineData=false;
    state.failData=false;state.groups=[];await ready();await page.getByText('No member lights yet.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>carousel.globe.renderer.pointsGeometry.attributes.position.count),0);
    state.failCities=true;state.groups=[{precision:'city',regionKey:'US',cityKey:'us-census-0566080',count:3},{precision:'region',regionKey:'CA',count:2}];
    await ready();await page.getByText('City lights are temporarily unavailable.',{exact:true}).waitFor();
    assert.equal(await page.locator('.duck-stack').count(),2);
    assert.equal(await page.evaluate(()=>carousel.globe.renderer.pointsGeometry.attributes.position.count),2);
    await page.getByRole('button',{name:'Add my light',exact:true}).click();
    await page.getByText('Cities are temporarily unavailable.',{exact:false}).waitFor();
    state.failCities=false;
    await page.getByRole('button',{name:'Retry cities',exact:true}).click();
    await page.waitForFunction(()=>carousel.globe.cities);
    assert.equal(await page.evaluate(()=>carousel.globe.renderer.pointsGeometry.attributes.position.count),3);
    await page.getByLabel('Country or territory').selectOption('US');
    await page.getByLabel('Show my light').check();await page.getByRole('button',{name:'Save light',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('dialog').open);
    state.failCities=false;state.groups=[];state.membership={enabled:false,regionKey:null,cityKey:null};
    state.failTexture=true;await page.reload();await page.getByRole('button',{name:'Still Earth',exact:true}).waitFor();assert.equal(await page.locator('.origin-earth-fallback').isVisible(),true);
    state.failTexture=false;state.failModule=true;await page.reload();await page.getByRole('button',{name:'Still Earth',exact:true}).waitFor();assert.equal(await page.locator('.duck-stack').count(),2);
    state.failModule=false;
    await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};});
    await page.reload();await page.getByRole('button',{name:'Still Earth',exact:true}).waitFor();assert.equal(await page.locator('.origin-earth-fallback').isVisible(),true);
    assert.deepEqual(errors,[]);
    results.checks='Passed: centered profile/Earth/nav and lower counter at 320/390/844/1280, unchanged ducks, arrows/drag/keyboard/side click, lazy city catalog, keyboard/touch city choice, country restoration, fresh city consent, saved city restoration/change, country change clears city, no-match validation, country-only and city catalog failure, immediate mixed opt-out delta; existing lifecycle/fallback/account smoke.';
    fs.writeFileSync(path.join(root,'docs/globe/browser-results.json'),JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
