// Local-only full-dashboard fixture; every network response is intercepted.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
const stub=`window.testUser={id:'local-test-account',email:'local@example.test'};
export async function getCurrentSession(){return {user:window.testUser,access_token:'test-only'}};
export async function getCurrentUser(){return window.testUser};
export async function getAccessToken(){return 'test-only'};
export async function fetchConfig(){return {affiliateProgramEnabled:false}};
export async function getLinkedIdentities(){return []};
export async function linkAppleIdentity(){}; export async function signInWithApple(){}; export async function signInWithGoogle(){};
export async function signOut(){window.testAuthCallback('SIGNED_OUT',null)};
export async function onAuthStateChange(fn){window.testAuthCallback=fn};
export async function getSupabaseClient(){return {from(table){const chain={select(){return chain},eq(){return chain},order(){return chain},maybeSingle(){return chain},upsert(){return chain},then(resolve){return Promise.resolve({data:table==='profiles'?[{id:'test-profile',display_name:'Sample profile',birthdate:'1985-04-20',timezone:'America/Chicago',is_owner:true}]:{language:'en',region:'US',week_start:0},error:null}).then(resolve)}};return chain}}};`;
(async()=>{const b=await chromium.launch({...(process.env.GLOBE_BROWSER_EXECUTABLE?{executablePath:process.env.GLOBE_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});const errors=[];p.on('pageerror',e=>errors.push(e.message));let groups=0;
await p.route('**/*',async r=>{const u=new URL(r.request().url());const f=decodeURIComponent(u.pathname);
if(f==='/js/supabase-client.js')return r.fulfill({contentType:'application/javascript',body:stub});
if(f==='/js/duck-carousel.js'){let s=fs.readFileSync('js/duck-carousel.js','utf8').replace('this.wrapEl = wrapEl;','this.wrapEl = wrapEl; window.testCarousel = this;');return r.fulfill({contentType:'application/javascript',body:s})}
if(f.startsWith('/api/')){if(f==='/api/globe/groups')groups++;const body=f==='/api/globe/groups'?{groups:[],precision:'region',participation:'opt-in',generatedAt:new Date().toISOString()}:f==='/api/globe/me'?{membership:{enabled:false,regionKey:null}}:{ok:true,premium:false,subscribed:false,profileConfigured:false};return r.fulfill({contentType:'application/json',body:JSON.stringify(body)})}
if(u.hostname!=='sineday.test')return r.fulfill({contentType:'application/javascript',body:''});
try{const body=fs.readFileSync(path.join(process.cwd(),f));const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};return r.fulfill({contentType:types[path.extname(f)]||'application/octet-stream',body})}catch{return r.fulfill({status:404,body:''})}});
await p.goto('http://sineday.test/dashboard.html');await p.locator('.origin-earth').scrollIntoViewIfNeeded();await p.waitForFunction(()=>window.testCarousel?.globe?.renderer?.ready);
await p.screenshot({path:'docs/globe/dashboard-mobile.png',fullPage:true});
for(const name of ['Journal','Journal History','Journal Printables']){await p.getByRole('button',{name,exact:true}).click();assert.equal(await p.evaluate(()=>testCarousel.globe.active),false);assert.equal(await p.evaluate(()=>testCarousel.globe.renderer.rotating),false)}
await p.getByRole('button',{name:'Your Origin Ducks',exact:true}).click();await p.locator('.origin-earth').scrollIntoViewIfNeeded();assert.equal(await p.locator('.origin-earth canvas').count(),1);assert.equal(groups,1);
await p.evaluate(()=>{window.oldGlobe=testCarousel.globe;testUser={id:'second-local-account',email:'second@example.test'};testAuthCallback('SIGNED_IN',{user:testUser,access_token:'second-token'})});await p.waitForFunction(()=>window.oldGlobe.destroyed);assert.equal(await p.locator('.origin-earth canvas').count()<=1,true);
await p.evaluate(()=>testAuthCallback('SIGNED_OUT',null));await p.waitForURL('**/login.html');assert.equal(await p.locator('.origin-earth canvas').count(),0);
assert.deepEqual(errors,[]);const result={errors,groups,checks:'Real dashboard: Origin/Journal/History/Printables activity, single instance, fresh-snapshot reuse, account switch teardown and sign-out passed.'};fs.writeFileSync('docs/globe/dashboard-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await b.close()})().catch(e=>{console.error(e);process.exit(1)});
