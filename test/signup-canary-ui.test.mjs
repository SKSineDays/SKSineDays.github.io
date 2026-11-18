import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const source=(await readFile(new URL('../js/signup-canary.js',import.meta.url),'utf8')).replace(/^import.*\n/,'');
const flush=()=>new Promise(r=>setImmediate(r));
function setup(authorized=true){const els=new Map(),requests=[];function el(id){if(!els.has(id))els.set(id,{id,value:'',hidden:true,disabled:false,listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},reportValidity(){return true;},append(){}});return els.get(id);}
const context=vm.createContext({document:{getElementById:el,createElement:()=>({})},window:{addEventListener(){}},getCurrentSession:async()=>authorized?{access_token:'operator-token'}:null,fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});return {ok:true,json:async()=>url==='/api/eligibility-policy'?{ok:true,countries:[{code:'US',name:'United States'}]}:{ok:true,targetEmail:'test@example.invalid',emailSent:true}};}});vm.runInContext(source,context);return {el,requests};}
test('authorized page never sends email until real declaration and explicit complete click',async()=>{
 const app=setup();await flush();assert.deepEqual(app.requests.filter(r=>r.body).map(r=>r.body.action),['status']);
 app.el('canary-birthdate').value='2000-01-01';app.el('canary-country').value='US';
 await app.el('canary-form').listeners.submit({preventDefault(){}});assert.equal(app.el('canary-birthdate').value,'');assert.equal(app.el('canary-send').hidden,false);
 assert.equal(app.requests.some(r=>r.body?.action==='complete'),false);
 await app.el('canary-send').listeners.click();await app.el('canary-send').listeners.click();
 assert.equal(app.requests.filter(r=>r.body?.action==='complete').length,1);assert.equal(app.el('canary-form').hidden,true);
});
test('unauthenticated page cannot show declaration/send or invoke test endpoint',async()=>{
 const app=setup(false);await flush();assert.equal(app.el('canary-form').hidden,true);assert.equal(app.requests.length,0);assert.match(app.el('canary-status').textContent,/sign in/i);
});
test('cancel clears declaration and prevents later submit',async()=>{
 const app=setup();await flush();app.el('canary-birthdate').value='2000-01-01';app.el('canary-cancel').listeners.click();await flush();
 await app.el('canary-form').listeners.submit({preventDefault(){}});assert.equal(app.el('canary-birthdate').value,'');assert.ok(!app.requests.some(r=>r.body?.action==='begin'||r.body?.action==='complete'));
});
test('canary page is unindexed, uncached, unembeddable and tracker-free',async()=>{
 const html=await readFile(new URL('../signup-canary.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/vercel-analytics|serviceWorker\.register/);
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const headers=config.headers.find(x=>x.source==='/signup-canary.html').headers;
 assert.ok(headers.some(x=>x.key==='Cache-Control'&&x.value.includes('no-store')));
 assert.ok(headers.some(x=>x.key==='Content-Security-Policy'&&x.value.includes("frame-ancestors 'none'")));
 const sw=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
 assert.match(sw,/url\.pathname === '\/signup-canary\.html' \|\| url\.pathname === '\/js\/signup-canary\.js'/);
});
