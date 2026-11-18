import test,{mock} from 'node:test';import assert from 'node:assert/strict';
const helpers=await import('../api/_lib/account-registration.js');
let failure='',calls=[];
const PRIVATE='private-person@example.invalid PRIVATE-TOKEN PRIVATE-SUBJECT PRIVATE-FLOW';
mock.module('../api/_lib/account-registration.js',{namedExports:{...helpers,verifyProviderProof:async()=>{
 if(failure==='proof')throw new Error(PRIVATE);return {subject:PRIVATE};
}}});
mock.module('@supabase/supabase-js',{namedExports:{createClient(){return {
 rpc:async(name)=>{calls.push(name);if(name==='account_signup_enforcement_is_enabled')return {data:true};return {error:failure==='admission'?{message:PRIVATE}:null};},
 auth:{signInWithIdToken:async()=>{calls.push('exchange');if(failure==='exchange')throw new Error(PRIVATE);return {data:{session:{access_token:'access',refresh_token:'refresh'}}};},signInWithOtp:async()=>({error:{message:PRIVATE}})}
};}}});
process.env.AGE_AUTH_HOOK_READY='true';process.env.SIGNUP_ADMISSION_SECRET='test-only-secret-with-more-than32characters';
process.env.APP_URL='https://sineday.app';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_ANON_KEY='test-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';process.env.APPLE_SIGNUP_CLIENT_ID='test-client';
const {default:handler}=await import('../api/account-registration.js');
async function send(body,cookie){const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{origin:'https://sineday.app','content-type':'application/json',cookie},body},res);return res;}
test('completion failures log only fixed phase codes, never request or caught error data',async()=>{
 const logs=[];const original=console.warn;console.warn=(...args)=>logs.push(args);
 try{
 for(const [phase,expected] of [['proof','PROVIDER_PROOF'],['admission','ADMISSION_ISSUE'],['exchange','PROVIDER_TOKEN_EXCHANGE']]){
  failure='';const start=await send({action:'begin',provider:'apple',birthdate:'2000-01-01',country:'US'});logs.length=0;calls=[];failure=phase;
  const result=await send({action:'complete',token:PRIVATE,email:PRIVATE},start.headers['Set-Cookie']);assert.equal(result.statusCode,400);
  assert.deepEqual(logs,[[`[signup-complete] ${expected}`]]);
  assert.doesNotMatch(JSON.stringify(logs)+JSON.stringify(result.body),/PRIVATE|private-person|2000-01-01/);
  if(phase==='proof')assert.ok(!calls.includes('issue_account_admission'));
  if(phase==='admission')assert.ok(!calls.includes('exchange'));
 }
 }finally{console.warn=original;failure='';}
});
test('invalid flow emits only constant reference and no cookie content',async()=>{
 const logs=[];const original=console.warn;console.warn=(...args)=>logs.push(args);
 try{const result=await send({action:'complete',token:PRIVATE},PRIVATE);assert.equal(result.statusCode,403);assert.deepEqual(logs,[['[signup-complete] FLOW_INVALID']]);}
 finally{console.warn=original;}
});
