// Mocked UI integration only: does not prove hosted Supabase/provider configuration.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const server = spawn(process.execPath, ['scripts/preview.mjs', '--port', '4197'], { stdio: 'ignore' });
  let browser;
  try {
    for (let i=0;i<50;i++) { try { if ((await fetch('http://127.0.0.1:4197/login.html')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    let completions=0, beginnings=0, cancelCount=0;
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),setSession:async()=>({error:null}),signInWithOtp:async()=>({data:{}})}})};` }));
    await page.route('**/api/config?*', route => route.fulfill({ json: { ok: true, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test', appUrl: 'http://127.0.0.1:4197' } }));
    await page.route('**/api/eligibility-policy', route => route.fulfill({ json: { ok: true, countries: [{ code:'US',name:'United States' }] } }));
    await page.route('**/api/account-registration', async route => {
      const body=route.request().postDataJSON();
      if(body.action==='cancel') { cancelCount++; return route.fulfill({json:{ok:true}}); }
      if(body.action==='begin') { beginnings++; return route.fulfill({json:{ok:true,provider:body.provider,nonce:'mocknonce',clientId:'mock-client'}}); }
      completions++; await new Promise(r=>setTimeout(r,200)); return route.fulfill({json:{ok:true,emailSent:true}});
    });
    await page.goto('http://127.0.0.1:4197/login.html');
    await page.locator('#registration-panel summary').click();
    await page.locator('#registration-birthdate').fill('2000-01-01');
    await page.locator('#registration-country').selectOption('US');
    await page.locator('#registration-method').selectOption('email');
    await page.locator('#registration-continue').click();
    await page.locator('#registration-email').fill('test@example.com');
    await page.locator('#registration-email-submit').click();
    await page.waitForFunction(()=>document.getElementById('registration-status').textContent.includes('Check your inbox'));
    assert.equal(beginnings,1); assert.equal(completions,1);
    assert.equal(await page.locator('#registration-birthdate').inputValue(),'');
    assert.equal(await page.locator('#registration-email').inputValue(),'');
    await page.locator('#registration-birthdate').fill('2000-01-01');
    await page.locator('#registration-cancel').click();
    assert.equal(await page.locator('#registration-panel').getAttribute('open'),null);
    assert.equal(await page.locator('#registration-birthdate').inputValue(),'');
    assert.equal(await page.locator('#registration-email').inputValue(),'');
    assert.ok(cancelCount>=1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    console.log('PASS: mocked email registration, sensitive-input clearing, cancel/reset, mobile width');
  } finally { if(browser) await browser.close(); server.kill(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
