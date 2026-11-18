import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../js/account-eligibility.js',import.meta.url),'utf8')).replace(/export /g,'');
const flush=()=>new Promise(r=>setImmediate(r));
function harness(states) {
  const requests=[],elements=new Map(),redirects=[];let shown=0,removed=0;
  function element(name) { if(!elements.has(name)) elements.set(name,{hidden:false,value:'',disabled:false,textContent:'',listeners:{},children:[],style:{},
    addEventListener(k,v){this.listeners[k]=v;},setAttribute(){},appendChild(x){this.children.push(x);},focus(){},reportValidity(){return true;},
    querySelector(k){return element(k);},showModal(){shown++;},close(){},remove(){removed++;}});return elements.get(name); }
  const context=vm.createContext({console,URL,window:{location:{assign(url){redirects.push(url);}}},document:{body:{appendChild(){}},createElement:tag=>element(tag)},fetch:async(url,options)=>{
    requests.push({url,options});
    if(url==='/api/eligibility-policy')return{ok:true,json:async()=>({ok:true,countries:[{code:'US',name:'United States'}]})};
    const next=states.shift();if(next instanceof Error)throw next;
    return{ok:next.status?next.status<400:true,status:next.status||200,json:async()=>next.body||next};
  }});
  vm.runInContext(source,context);
  return{context,element,requests,redirects,shown:()=>shown,removed:()=>removed};
}
test('saved server eligibility skips dialog and all DOB collection',async()=>{
  const h=harness([{ok:true,state:'eligible'}]);assert.equal(await h.context.ensureAccountEligibility({accessToken:'token'}),true);
  assert.equal(h.shown(),0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.headers.Authorization,'Bearer token');
});
test('underage response closes form and cannot invite a different declaration; Exit never returns true',async()=>{
  const h=harness([{ok:true,state:'required'},{status:403,body:{ok:true,state:'review_required',message:'Contact support.'}}]);
  const pending=h.context.ensureAccountEligibility({accessToken:'token'});await flush();
  h.element('[data-birthdate]').value='2020-01-01';h.element('[data-country]').value='US';
  await h.element('[data-form]').listeners.submit({preventDefault(){}});
  assert.equal(h.element('[data-form]').hidden,true);assert.equal(h.element('[data-retry]').hidden,true);
  assert.equal(h.element('[data-birthdate]').value,'');assert.equal(h.element('[data-status]').textContent,'Contact support.');
  h.element('[data-exit]').listeners.click();assert.equal(await pending,false);
});
test('ambiguous POST failure requires server re-read, not a new age declaration',async()=>{
  const h=harness([{ok:true,state:'required'},new Error('network'),{ok:true,state:'review_required'}]);
  const pending=h.context.ensureAccountEligibility({accessToken:'token'});await flush();
  h.element('[data-birthdate]').value='2020-01-01';h.element('[data-country]').value='US';
  await h.element('[data-form]').listeners.submit({preventDefault(){}});
  assert.equal(h.element('[data-form]').hidden,true);assert.equal(h.element('[data-retry]').hidden,false);
  await h.element('[data-retry]').listeners.click();
  assert.equal(h.element('[data-form]').hidden,true);assert.equal(h.element('[data-retry]').hidden,true);
  const calls=h.requests.filter(x=>x.url==='/api/account-eligibility');assert.deepEqual(calls.map(x=>x.options.method),['GET','POST','GET']);
  h.element('[data-exit]').listeners.click();assert.equal(await pending,false);
});
test('identity change abort dismisses gate without granting access',async()=>{
  const h=harness([{ok:true,state:'required'}]);const controller=new AbortController();
  const pending=h.context.ensureAccountEligibility({accessToken:'token',signal:controller.signal});await flush();
  controller.abort();assert.equal(await pending,false);assert.equal(h.removed(),1);
});

test('reviewed owner can open existing billing without being admitted to dashboard',async()=>{
  const h=harness([{ok:true,state:'review_required'},{ok:true,url:'https://billing.stripe.com/p/session/test'}]);
  const pending=h.context.ensureAccountEligibility({accessToken:'owner-token'});await flush();
  await h.element('[data-billing]').listeners.click();
  assert.deepEqual(h.redirects,['https://billing.stripe.com/p/session/test']);
  const request=h.requests.find(x=>x.url==='/api/create-portal-session');
  assert.equal(request.options.method,'POST');assert.equal(request.options.headers.Authorization,'Bearer owner-token');
  assert.equal(request.options.body,undefined);
  assert.equal(h.requests.some(x=>x.url.includes('checkout')),false);
  assert.equal(h.removed(),0);
  h.element('[data-exit]').listeners.click();assert.equal(await pending,false);
});
test('billing failure never offers upgrade and untrusted redirects are rejected',async()=>{
  for(const response of [{status:400,body:{ok:false,error:'Please upgrade to Premium first.'}},
    {ok:true,url:'https://evil.test/session'}, {ok:true,url:'javascript:alert(1)'}]) {
    const h=harness([{ok:true,state:'review_required'},response]);
    const pending=h.context.ensureAccountEligibility({accessToken:'token'});await flush();
    await h.element('[data-billing]').listeners.click();
    assert.deepEqual(h.redirects,[]);
    assert.match(h.element('[data-billing-status]').textContent,/Contact support/);
    assert.equal(h.element('[data-billing-status]').textContent.includes('upgrade'),false);
    assert.equal(h.element('[data-billing]').disabled,false);
    h.element('[data-exit]').listeners.click();assert.equal(await pending,false);
  }
});
