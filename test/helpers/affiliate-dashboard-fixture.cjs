/* Entirely offline fixture: no session, real API, analytics, or remote asset request. */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
module.exports = function affiliateFixture() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/affiliate/assets.json')));
  const groupManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/affiliate/groups/assets.json')));
  const assetData = Object.fromEntries([...manifest, ...groupManifest].map(asset => [asset.path, `data:image/${asset.format === 'SVG' ? 'svg+xml' : 'png'};base64,${fs.readFileSync(path.join(ROOT, asset.path)).toString('base64')}`]));
  assetData['/assets/affiliate/groups/sineday-group-flyer.pdf'] = `data:application/pdf;base64,${fs.readFileSync(path.join(ROOT, 'assets/affiliate/groups/sineday-group-flyer.pdf')).toString('base64')}`;
  const css = ['styles.css', 'css/dashboard.css'].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n').replace(/url\([^)]*\)/g, 'none');
  const source = fs.readFileSync(path.join(ROOT, 'js/affiliate-ui.js'), 'utf8').replaceAll('export ', '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Affiliate dashboard offline review</title><style>${css}</style></head><body>
  <main><h1>Affiliate dashboard review</h1><button id="toggle" aria-expanded="false">Open affiliate dashboard</button><button id="run-checks">Run regression checks</button><output id="results">Ready</output></main><div id="preserved-inert" inert></div>
  <div id="backdrop" class="sheet-backdrop affiliate-backdrop" hidden></div><section id="sheet" class="sheet affiliate-sheet" role="dialog" aria-modal="true" aria-labelledby="title" hidden><div class="sheet__content affiliate-sheet__content"><h2 id="title" class="sr-only">Affiliate program</h2><button class="affiliate-sheet__close" type="button" data-affiliate-close aria-label="Close Affiliate program">×</button><div id="mount"></div></div></section>
  <script type="module">
  ${source}
  const affiliate = {status:'active',displayName:'Sample Creator',code:'WRITE-18',affiliateUrl:'https://www.sineday.app/?ref=WRITE-18',recipientPayoutsStatus:'active',taxSetupStatus:'complete',payoutsEnabled:true};
  const manifest = ${JSON.stringify(manifest)};
  const groupManifest = ${JSON.stringify(groupManifest)};
  const assetData = ${JSON.stringify(assetData)};
  const baseSummary = {ok:true,summary:{activeSupporters:12,estimatedThisMonthCents:1200,availableBalanceCents:2400,pendingBalanceCents:1200,lifetimePaidCents:4200},monthly:Array.from({length:12},(_,i)=>({month:'2026-'+String(i+1).padStart(2,'0'),earnedCents:i<4?0:i*100,supporterCount:i})),payouts:[{month:'2026-10',amountCents:2400,status:'paid',commissionCount:24}]};
  let state = {affiliate}, summaryFails = false, assetsFail = false, clipboardFails = false, legacyCopy = false, shareResult = 'ok', copied = [], shared = [], success = [], errors = [], pendingResolve, posts = 0;
  const nativeFetch = window.fetch;
  window.fetch = async (url,options={}) => {
    const value = String(url);
    if(value.startsWith('data:')) return nativeFetch(url,options);
    if(value.endsWith('/status')) return {ok:true,json:async()=>({ok:true,...state})};
    if(value.endsWith('/summary')) return {ok:!summaryFails,json:async()=>summaryFails?{ok:false,error:'Summary offline'}:baseSummary};
    if(value.endsWith('/groups/assets.json')) return {ok:!assetsFail,json:async()=>groupManifest};
    if(value.endsWith('assets.json')) return {ok:!assetsFail,json:async()=>manifest};
    if(value.endsWith('/login-link')) { posts++; return new Promise(resolve=>{pendingResolve=()=>resolve({ok:false,json:async()=>({ok:false,error:'Fixture: no Stripe navigation'})});}); }
    throw new Error('Fixture blocked unexpected request: '+value);
  };
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(clipboardFails)throw new Error('blocked');copied.push(text);}}});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{shared.push(data);if(shareResult==='cancel')throw new DOMException('Cancelled','AbortError');if(shareResult==='error')throw new Error('unavailable');}});
  document.execCommand=()=>legacyCopy;
  function createView() {
    const next = new AffiliateUI({mount:document.querySelector('#mount'),toggle:document.querySelector('#toggle'),sheet:document.querySelector('#sheet'),backdrop:document.querySelector('#backdrop'),getAccessToken:async()=>'offline-test-only',entitlement:{affiliateStatus:'active'},showSuccess:text=>success.push(text),showError:text=>errors.push(text)});
    // Data URLs keep real artwork pixels in the fixture without any network requests.
    const renderActive = next.renderActive.bind(next);
    next.renderActive = aff => {renderActive(aff);document.querySelectorAll('.affiliate-asset-card img').forEach(img=>img.src=assetData[img.getAttribute('src')]);document.querySelectorAll('.affiliate-asset-card a, [data-group-pdf]').forEach(link=>link.href=assetData[link.getAttribute('href')]);};
    return next;
  }
  let view = createView();
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const click=async selector=>{document.querySelector(selector).click();await tick();};
  let tests=[];
  async function check(name,fn){await fn();tests.push(name);document.querySelector('#results').textContent=JSON.stringify({status:'running',width:innerWidth,checks:tests});}
  async function run(){
    tests=[];
    try {
      await view.open();
      await check('Responsive panel and uncropped previews',async()=>{
        await click('[data-affiliate-tab="share"]');
        assert(document.documentElement.scrollWidth<=innerWidth,'Document overflow');
        assert(view.sheet.scrollWidth<=view.sheet.clientWidth,'Panel overflow');
        assert([...document.querySelectorAll('.affiliate-asset-card img')].every(img=>getComputedStyle(img).objectFit==='contain'),'Preview crop');
        assert(document.querySelectorAll('[role="tab"]').length===3,'Redundant tabs');
      });
      await check('Long creator name and code fit the panel',async()=>{
        const originalName=affiliate.displayName,originalCode=affiliate.code;
        affiliate.displayName='W'.repeat(80);affiliate.code='W'.repeat(20);view.render();
        assert(document.querySelector('#mount').scrollWidth<=document.querySelector('#mount').clientWidth,'Long identity overflows content');
        assert(view.sheet.scrollWidth<=view.sheet.clientWidth,'Long identity overflows panel');
        affiliate.displayName=originalName;affiliate.code=originalCode;view.render();
      });
      await check('Complete disclosed copy',async()=>{await click('[data-copy-label="Full post"]');assert(copied.at(-1).startsWith(AFFILIATE_DISCLOSURE),'Missing disclosure');assert(copied.at(-1).includes(affiliate.affiliateUrl),'Missing link');assert(copied.at(-1).includes(affiliate.code),'Missing code');});
      await check('Copy failure offers selected text, never false success',async()=>{clipboardFails=true;const count=success.length;await click('[data-copy-label="Code"]');assert(success.length===count,'False copy success');assert(!document.querySelector('.affiliate-manual-copy').hidden,'No manual fallback');assert(document.activeElement.id==='affiliate-manual-copy-text','Fallback not focused');assert(document.activeElement.value===affiliate.code,'Wrong fallback');legacyCopy=true;await click('[data-copy-label="Link"]');assert(success.length===count+1,'Legacy success not reported');clipboardFails=false;legacyCopy=false;});
      await check('Native sharing includes disclosure and cancellation is quiet',async()=>{shareResult='cancel';const count=copied.length;await click('[data-affiliate-action="share"]');assert(shared.at(-1).text.startsWith(AFFILIATE_DISCLOSURE),'Native disclosure missing');assert(shared.at(-1).url===affiliate.affiliateUrl,'Native URL missing');assert(copied.length===count,'Cancelled share copied unexpectedly');shareResult='error';await click('[data-affiliate-action="share"]');assert(copied.length===count+1,'Share failure did not copy');shareResult='ok';});
      await check('Arrow, Home, End tab navigation',async()=>{const tab=document.querySelector('[data-affiliate-tab="share"]');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));assert(view.activeTab==='payouts','End failed');document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert(view.activeTab==='overview','Home failed');document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(view.activeTab==='share','Arrow failed');});
      await check('Switching from deep assets shows the new tab from its beginning',async()=>{
        const scroller=document.querySelector('.affiliate-sheet__content');
        const pageX=scrollX,pageY=scrollY;
        for(const tab of ['overview','payouts']) {
          await click('[data-affiliate-tab="share"]');scroller.scrollTop=scroller.scrollHeight;
          await click('[data-affiliate-tab="'+tab+'"]');
          const panel=document.querySelector('#affiliate-panel-'+tab).getBoundingClientRect();
          const navigation=document.querySelector('.affiliate-sheet__tabs').getBoundingClientRect();
          const bounds=scroller.getBoundingClientRect();
          const close=document.querySelector('[data-affiliate-close]').getBoundingClientRect();
          assert(panel.top>=navigation.bottom-1,'New tab starts behind sticky navigation');
          assert(panel.top<bounds.bottom-44,'New tab beginning is below the viewport');
          assert(close.top>=bounds.top-1 && close.bottom<=bounds.bottom,'Close control left the viewport');
          assert(document.activeElement.dataset.affiliateTab===tab,'Tab focus was lost');
          assert(scrollX===pageX && scrollY===pageY,'Tab switch moved the page behind the dialog');
        }
        await click('[data-affiliate-tab="share"]');
      });
      await check('Repeated payout clicks create one request',async()=>{await click('[data-affiliate-tab="payouts"]');await click('[data-affiliate-action="login"]');await click('[data-affiliate-action="login"]');assert(posts===1,'Duplicate payout request');pendingResolve();await tick();assert(!document.querySelector('[data-affiliate-action="login"]').disabled,'Payout button stayed disabled');});
      await check('Summary failure leaves sharing and Stripe controls available',async()=>{summaryFails=true;await view.refresh();assert(document.querySelector('#affiliate-panel-payouts').textContent.includes('temporarily unavailable'),'Missing financial error');assert(!document.querySelector('#affiliate-panel-payouts').textContent.includes('$0.00'),'False zero balance');await click('[data-affiliate-tab="share"]');assert(document.querySelector('[data-copy-label="Full post"]'),'Sharing blocked');summaryFails=false;await view.refresh();});
      await check('Reload earnings keeps keyboard focus in the dashboard',async()=>{summaryFails=true;await view.refresh();await click('[data-affiliate-tab="overview"]');document.querySelector('#affiliate-panel-overview [data-affiliate-action="reload"]').focus();summaryFails=false;await click('#affiliate-panel-overview [data-affiliate-action="reload"]');assert(document.activeElement.id==='affiliate-tab-overview','Reload lost keyboard focus');await click('[data-affiliate-tab="share"]');});
      await check('Asset failure and retry preserve caption',async()=>{assetsFail=true;await view.refresh();assert(document.querySelector('[data-affiliate-action="reload-assets"]'),'No asset retry');assert(document.querySelector('#affiliate-share-caption').value.includes(AFFILIATE_DISCLOSURE),'Caption lost');assetsFail=false;await click('[data-affiliate-action="reload-assets"]');assert(document.querySelectorAll('.affiliate-asset-card').length===4,'Asset recovery failed');});
      await check('Rapid close/reopen restores original scroll and inert states',async()=>{view.close();assert(view.sheet.inert,'Closing panel still accepts focus');await view.open();assert(!view.sheet.inert,'Reopened panel stayed inert');view.close();assert(document.body.style.overflow==='','Body locked');assert(document.documentElement.style.overflow==='','Document locked');assert(!document.querySelector('main').inert,'Background inert');assert(document.querySelector('#preserved-inert').inert,'Original inert lost');assert(document.activeElement.id==='toggle','Focus not restored');await view.open();});
      await check('Application and onboarding fields remain in focus trap',async()=>{state={affiliate:null,viewerEmail:'sample@example.test'};await view.refresh();assert(focusableElements(view.sheet).some(el=>el.tagName==='TEXTAREA'),'Textarea omitted');state={affiliate:{...affiliate,status:'onboarding'}};await view.refresh();assert(focusableElements(view.sheet).some(el=>el.tagName==='SELECT'),'Select omitted');const first=focusableElements(view.sheet)[0],last=focusableElements(view.sheet).at(-1);first.focus();first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert(document.activeElement===last,'Focus did not wrap');});
      await check('Paused and closed accounts never expose sharing',async()=>{for(const status of ['paused','closed']){state={affiliate:{...affiliate,status}};await view.refresh();assert(!document.querySelector('[data-copy-label]'),'Inactive sharing exposed');}});
      await check('Destroying the view silences a pending payout request',async()=>{const count=errors.length;const pending=view.openStripeRoute('/api/affiliate/login-link');await tick();view.destroy();document.querySelector('#mount').innerHTML='<p data-next-view>Next account</p>';pendingResolve();await pending;assert(errors.length===count,'Destroyed view reported a late error');assert(document.querySelector('[data-next-view]'),'Destroyed view overwrote the next account');state={affiliate};view=createView();await view.open();});
      await check('Community kit stays inside the dashboard and requires group authority',async()=>{
        view.activeTab='share';view.render();
        await click('[data-affiliate-kit="community"]');
        assert(!document.querySelector('#affiliate-group-caption'),'Unconfirmed group copy exposed');
        assert(getComputedStyle(document.querySelector('.affiliate-group-intro h3')).color==='rgb(51, 45, 59)','Ivory intro heading has insufficient contrast');
        assert(document.querySelectorAll('[role="tab"]').length===3,'New dashboard tabs added');
        document.querySelector('#affiliate-group-name').value='River Community';document.querySelector('#affiliate-group-approved').checked=true;
        document.querySelector('[data-affiliate-form="group-kit"]').requestSubmit();await tick();
        assert(document.querySelector('#affiliate-group-caption').value.includes('River Community'),'Group name missing');
        assert(document.querySelectorAll('.affiliate-asset-card').length===4,'Wrong community assets');
        assert(document.querySelector('[data-group-pdf]'),'Missing flyer PDF');
        await click('[data-copy-label="Group copy"]');assert(copied.at(-1).includes(GROUP_AFFILIATE_DISCLOSURE),'Group disclosure missing');assert(copied.at(-1).includes(affiliate.affiliateUrl),'Group URL missing');
        const template=document.querySelector('#affiliate-group-template');template.value='email';template.dispatchEvent(new Event('change',{bubbles:true}));
        assert(document.querySelector('#affiliate-group-caption').value.startsWith('Subject:'),'Format selection failed');
        assert(document.activeElement.id==='affiliate-group-template','Format lost focus');
        assert(view.sheet.scrollWidth<=view.sheet.clientWidth,'Group panel overflow');
        await click('[data-affiliate-tab="overview"]');await click('[data-affiliate-tab="share"]');assert(view.shareAudience==='community','Mode lost across tabs');
        const approval=document.querySelector('#affiliate-group-approved');approval.checked=false;approval.dispatchEvent(new Event('change',{bubbles:true}));
        assert(!document.querySelector('#affiliate-group-caption'),'Revoked approval left group copy visible');
      });
      await check('PTA uses neutral notices, separate artwork, and independent approval',async()=>{
        await click('[data-affiliate-kit="pta"]');
        assert(document.querySelector('.affiliate-pta-note').textContent.includes('Policies and approved arrangements vary'),'Opening PTA note missing');
        assert(!document.querySelector('#affiliate-group-caption'),'Community approval leaked to PTA');
        document.querySelector('#affiliate-group-approved').checked=true;document.querySelector('[data-affiliate-form="group-kit"]').requestSubmit();await tick();
        const text=document.querySelector('#affiliate-group-caption').value;
        assert(text.includes('does not endorse, warrant or recommend'),'PTA nonendorsement missing');assert(text.includes('Participation is optional'),'Optional choice missing');
        assert(document.querySelectorAll('.affiliate-asset-card').length===1,'PTA promotional assets leaked');
        assert(document.querySelector('.affiliate-asset-card h4').textContent==='PTA information notice','Wrong PTA asset');
        assetsFail=true;await view.refresh();assert(document.querySelector('[data-affiliate-action="reload-group-assets"]'),'No group retry');assert(document.querySelector('#affiliate-group-caption'),'Image failure lost group copy');
        assetsFail=false;await click('[data-affiliate-action="reload-group-assets"]');assert(document.querySelectorAll('.affiliate-asset-card').length===1,'Group retry failed');
        await click('[data-affiliate-kit="personal"]');
        assert(document.querySelector('#affiliate-share-caption').value.startsWith(AFFILIATE_DISCLOSURE),'Personal copy changed');
      });
      state={affiliate};await view.refresh();view.activeTab='share';view.render();
      document.querySelector('#results').textContent=JSON.stringify({status:'passed',width:innerWidth,checks:tests});
      document.body.dataset.testResult='passed';
    } catch(error){document.querySelector('#results').textContent=JSON.stringify({status:'failed',checks:tests,error:error.message});document.body.dataset.testResult='failed';console.error(error);}
  }
  document.querySelector('#run-checks').addEventListener('click',run);
  window.addEventListener('error',event=>{document.body.dataset.pageError=event.message;});
  await view.open();
  // Keep test controls outside the modal focus trap; regression checks are triggered by the harness.
  view.close();
  document.body.dataset.fixtureReady='true';
  </script></body></html>`;
};
