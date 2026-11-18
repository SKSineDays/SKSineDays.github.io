import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../js/daily-signup.js',import.meta.url),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
function setup(mode){
 const elements=new Map(), requests=[],sections=[{hidden:true},{hidden:true}];
 function element(id){if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,disabled:false,validity:{valid:true},dataset:{},listeners:{},parent:{hidden:false},
 addEventListener(k,fn){this.listeners[k]=fn;},setAttribute(){},removeAttribute(){},focus(){},scrollIntoView(){},append(){},replaceChildren(){},closest(){return this.parent;}});return elements.get(id);}
 element('daily-signup').elements={company:{value:''}};
 const context=vm.createContext({console,Date,Intl,URLSearchParams,window:{location:{search:''},addEventListener(){}},document:{getElementById:element,createElement:()=>({}),createDocumentFragment:()=>({append(){}}),querySelectorAll:()=>sections},
 fetch:async(url,options)=>{requests.push({url,body:options?.body&&JSON.parse(options.body)});
 if(url==='/api/config'){if(mode==='error')throw new Error();return {ok:true,json:async()=>({ok:true,mailerEligibilityEnabled:mode})};}
 if(url==='/api/eligibility-policy')return {ok:true,json:async()=>({ok:true,countries:[{code:'US',name:'United States'}]})};
 return {ok:true,json:async()=>({ok:true,message:'Check your email'})};}});
 vm.runInContext(source,context);return {element,requests,sections};
}
test('daily legacy UI shows original fields and submits without country or preliminary age request',async()=>{
 const app=setup(false);await flush();
 assert.equal(app.element('daily-country').parent.hidden,true);assert.equal(app.element('daily-country').required,false);
 assert.ok(app.sections.every(s=>!s.hidden));
 app.element('daily-email').value='person@example.com';app.element('daily-birthdate').value='2000-01-01';app.element('daily-consent').checked=true;
 await app.element('daily-signup').listeners.submit({preventDefault(){}});
 const posts=app.requests.filter(r=>r.url==='/api/mailer-signup');assert.equal(posts.length,1);assert.equal(posts[0].body.action,undefined);
});
test('daily enabled UI screens age and country before collecting email',async()=>{
 const app=setup(true);await flush();assert.ok(app.sections.every(s=>s.hidden));
 app.element('daily-birthdate').value='2000-01-01';app.element('daily-country').value='US';
 await app.element('daily-signup').listeners.submit({preventDefault(){}});
 const posts=app.requests.filter(r=>r.url==='/api/mailer-signup');assert.equal(posts[0].body.action,'screen');assert.equal(posts[0].body.email,undefined);
 assert.ok(app.sections.every(s=>!s.hidden));
});
test('daily configuration failure never silently falls back to legacy signup',async()=>{
 const app=setup('error');await flush();assert.equal(app.element('daily-submit').disabled,true);
 await app.element('daily-signup').listeners.submit({preventDefault(){}});assert.ok(!app.requests.some(r=>r.url==='/api/mailer-signup'));
});
