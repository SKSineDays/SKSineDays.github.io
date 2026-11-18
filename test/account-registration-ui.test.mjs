import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../js/account-registration.js', import.meta.url),'utf8')).replace(/^import .*;\n/, '');
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
const flush = () => new Promise(r=>setImmediate(r));
function setup(completeResponse, enabled = true) {
  const elements=new Map(), requests=[], scripts=[], redirects=[];
  let sessions=0;
  function element(id) {
    if(!elements.has(id)) elements.set(id,{ id,value:'',hidden:false,disabled:false,open:true,children:[],listeners:{},textContent:'',
      addEventListener(name,fn){ this.listeners[name]=fn; }, setAttribute(){}, reportValidity(){return true;},focus(){},
      replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);} });
    return elements.get(id);
  }
  const window={ addEventListener(){},location:{assign(url){redirects.push(url);}} };
  const context=vm.createContext({console,window,document:{ getElementById:element,createElement:()=>element(`new-${elements.size}`),head:{appendChild(s){scripts.push(s);}} },
    fetchConfig:async()=>{ if (enabled === 'error') throw new Error(); return {accountRegistrationEnabled:enabled}; },
    getSupabaseClient:async()=>({auth:{async setSession(){sessions++;return {error:null};}}}),
    fetch:async(url,options)=>{
      if(url==='/api/eligibility-policy') return {ok:true,json:async()=>({ok:true,countries:[{code:'US',name:'United States'}]})};
      const body=JSON.parse(options.body);requests.push(body);
      const result=body.action==='complete' && completeResponse ? await completeResponse.promise :
        body.action==='begin'?{ok:true,provider:body.provider,nonce:'test',clientId:'test'}:{ok:true};
      return {ok:true,json:async()=>result};
    }});
  vm.runInContext(source,context);
  element('registration-method').value='email';element('registration-birthdate').value='2000-01-01';
  element('registration-country').value='US';element('registration-email').value='test@example.com';
  return {element,requests,scripts,redirects,window,context,sessions:()=>sessions};
}
test('duplicate submit is ignored and email success clears sensitive inputs',async()=>{
  const result=deferred();const app=setup(result);await flush();
  const submit=app.element('registration-form').listeners.submit;
  const pending=submit({preventDefault(){}});
  await submit({preventDefault(){}});await pending;await flush();
  const emailForm=app.element('registration-email-form');
  const finishing=emailForm.listeners.submit({preventDefault(){},currentTarget:emailForm});
  await emailForm.listeners.submit({preventDefault(){},currentTarget:emailForm});
  assert.equal(app.requests.filter(x=>x.action==='begin').length,1);
  assert.equal(app.requests.filter(x=>x.action==='complete').length,1);
  result.resolve({ok:true,emailSent:true});await finishing;
  assert.equal(app.element('registration-birthdate').value,'');
  assert.equal(app.element('registration-email').value,'');
  assert.match(app.element('registration-status').textContent,/Check your inbox/);
});
test('cancel during completion ignores late session and clears DOB/email',async()=>{
  const result=deferred();const app=setup(result);await flush();
  const pending=app.element('registration-form').listeners.submit({preventDefault(){}});
  await pending;await flush();
  const emailForm=app.element('registration-email-form');
  const finishing=emailForm.listeners.submit({preventDefault(){},currentTarget:emailForm});
  await flush();
  app.element('registration-cancel').listeners.click();
  result.resolve({ok:true,session:{access_token:'access',refresh_token:'refresh'}});
  await finishing;
  assert.equal(app.sessions(),0);assert.deepEqual(app.redirects,[]);
  assert.equal(app.element('registration-birthdate').value,'');
  assert.equal(app.element('registration-email').value,'');
  assert.equal(app.element('registration-provider').hidden,true);
});
test('provider SDK is not loaded before eligibility flow and canceled late completion cannot navigate',async()=>{
  const app=setup();await flush();
  assert.equal(app.scripts.length,0);
  app.element('registration-panel').open=false;
  app.element('registration-panel').listeners.toggle();
  assert.equal(app.requests.filter(x=>x.action==='cancel').length,1);
  assert.equal(app.element('registration-birthdate').value,'');
});

 test('dormant and config-failed registration stays hidden and never begins a provider flow', async()=>{
   for (const enabled of [false, null, 'error']) {
     const app=setup(null,enabled);app.element('registration-panel').hidden=true;await flush();
     await app.element('registration-form').listeners.submit({preventDefault(){}});
     assert.equal(app.element('registration-panel').hidden,true);
     assert.equal(app.requests.length,0);assert.equal(app.scripts.length,0);
   }
 });

async function appleSetup(signIn) {
  const app=setup();await flush();
  app.window.AppleID={auth:{init(){},signIn}};
  app.element('registration-method').value='apple';
  const pending=app.element('registration-form').listeners.submit({preventDefault(){}});
  await flush();app.scripts[0].onload();await pending;
  return app;
}
test('Apple errors show only fixed allowlisted references, never raw SDK or personal data',async()=>{
  for(const [error,code] of [
    [{error:'user_cancelled_authorize',message:'private@example.invalid'},'APPLE_CANCELED'],
    [{error:'popup_closed_by_user'},'APPLE_POPUP_CLOSED'],
    [{error:'popup_blocked_by_browser'},'APPLE_POPUP_BLOCKED'],
    [{error:'invalid_client',error_description:'private-token'},'APPLE_INVALID_CLIENT'],
    [{error:'unauthorized_client',error_description:'private-return-uri'},'APPLE_UNAUTHORIZED_CLIENT'],
    [{error:'private@example.invalid',message:'private-token',authorization:{id_token:'private-token'}},'APPLE_UNKNOWN']
  ]){
    const app=await appleSetup(async()=>{throw error;});
    await app.element('registration-apple-button').listeners.click();
    const text=app.element('registration-status').textContent;
    assert.match(text,new RegExp(code));assert.doesNotMatch(text,/private@|private-token|private-return/);
    assert.equal(app.requests.some(r=>r.action==='complete'),false);
  }
});
test('Apple missing/mismatched state and absent token fail closed with distinct safe references',async()=>{
  for(const [authorization,code] of [[{id_token:'private-token'},'APPLE_STATE_MISSING'],[{state:'wrong',id_token:'private-token'},'APPLE_STATE_MISMATCH'],[{state:'test'},'APPLE_TOKEN_MISSING']]){
    const app=await appleSetup(async()=>({authorization}));
    await app.element('registration-apple-button').listeners.click();
    assert.match(app.element('registration-status').textContent,new RegExp(code));
    assert.equal(app.requests.some(r=>r.action==='complete'),false);
  }
});
test('valid Apple state and token proceed to the existing server admission endpoint',async()=>{
 const app=await appleSetup(async()=>({authorization:{state:'test',id_token:'synthetic-token'}}));
 await app.element('registration-apple-button').listeners.click();
 const complete=app.requests.filter(r=>r.action==='complete');assert.equal(complete.length,1);assert.equal(complete[0].token,'synthetic-token');
});

test('Apple SDK initialization failure also uses safe allowlisted copy',async()=>{
 const app=setup();await flush();app.element('registration-method').value='apple';
 app.window.AppleID={auth:{init(){throw {error:'invalid_redirect_uri',message:'private@example.invalid',error_description:'secret-return-query'};}}};
 const pending=app.element('registration-form').listeners.submit({preventDefault(){}});await flush();app.scripts[0].onload();await pending;
 assert.match(app.element('registration-status').textContent,/APPLE_INVALID_REDIRECT/);
 assert.doesNotMatch(app.element('registration-status').textContent,/private@|secret-return/);
 assert.equal(app.requests.some(r=>r.action==='complete'),false);
});
