const { webkit,chromium,devices }=require('playwright'); const assert=require('node:assert/strict');const {mkdirSync}=require('node:fs');
(async()=>{mkdirSync('provider-qa',{recursive:true});for(const [name,engine,device,width] of [['small',webkit,'iPhone SE',320],['iphone',webkit,'iPhone 13',390],['android',chromium,'Pixel 7',390],['desktop',chromium,'Desktop Chrome',1280]]){
  const b=await engine.launch();try{
    const p=await b.newPage({...devices[device],viewport:{width,height:844},deviceScaleFactor:1,serviceWorkers:'block'});
    await p.route('**/api/config?*',r=>r.fulfill({json:{ok:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'fixture',accountRegistrationEnabled:true,appUrl:'http://127.0.0.1:4197'}}));
    await p.route('**/api/eligibility-policy',r=>r.fulfill({json:{ok:true,countries:[{code:'US',name:'United States'}]}}));
    let completes=0;
    await p.route('**/api/account-registration',r=>{const a=r.request().postDataJSON();if(a.action==='complete')completes++;return r.fulfill({json:a.action==='begin'?{ok:true,provider:a.provider,nonce:'localfixture',clientId:'111111111111-localfixture.apps.googleusercontent.com',redirectUri:'http://127.0.0.1:4197/login.html'}:{ok:true}})});
    await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})};'}));
    await p.route('https://appleid.cdn-apple.com/appleauth/**',r=>r.fulfill({contentType:'text/javascript',body:'window.AppleID={auth:{init(){},signIn(){throw Error("must not activate")}}};'}));
    await p.goto('http://127.0.0.1:4197/login.html');
    let later=p.getByRole('button',{name:'Not now'});if(await later.isVisible())await later.click();
    const login=p.locator('#login-panel summary'),reg=p.locator('#registration-panel summary'),card=p.locator('#registration-provider');
    await login.press('Enter');const g=p.locator('#google-signin-btn'),a=p.locator('#apple-signin-btn');await g.focus();await p.keyboard.press('Tab');assert.equal(await a.evaluate(e=>e===document.activeElement),true);assert.equal(await a.locator('img').evaluate(i=>i.complete&&i.naturalWidth===420),true);
    await p.locator('#login-panel').screenshot({path:'provider-qa/'+name+'-login.png'});await login.press('Enter');
    for(const provider of ['apple','google']){
      await reg.press('Enter');await p.locator('#registration-birthdate').fill('2000-01-01');await p.locator('#registration-country').selectOption('US');await p.locator('#registration-method').selectOption(provider);await p.locator('#registration-continue').press('Enter');
      const control=p.locator(provider==='apple'?'#registration-apple-button':'#registration-google-button iframe');
      await control.first().waitFor({state:'attached'});await p.getByText('Complete this step within five minutes.').waitFor();
      if(provider==='google'){await p.frameLocator('#registration-google-button iframe').getByRole('button').first().waitFor({timeout:12000}).catch(()=>{});}
      await p.locator('#registration-provider-heading').focus();await p.keyboard.press('Tab');
      let focus=await p.evaluate(()=>document.activeElement?.closest('#registration-apple-button,#registration-google-button')?.id||document.activeElement?.tagName);
      console.log(name,provider,'next focus:',focus);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const cr=await card.boundingBox(),rr=await p.locator('#registration-cancel').boundingBox();assert.ok(rr.y>=cr.y+cr.height+12);
      await p.locator('#registration-panel').screenshot({path:'provider-qa/'+name+'-'+provider+'.png'});
      assert.equal(completes,0);await p.locator('#registration-cancel').click();
    }
  }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});