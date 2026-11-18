import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { diagnosticConfig, createDiagnosticFlow, encodeDiagnosticFlow, readDiagnosticFlow, diagnosticCookie, DIAGNOSTIC_COOKIE } from '../api/_lib/provider-diagnostic.js';
import { hash } from '../api/_lib/account-registration.js';
import handler from '../api/provider-diagnostic.js';
const origin='https://sineday-preview-test.vercel.app';
const secret='diagnostic-only-secret-at-least-32-chars';
const env={VERCEL_ENV:'preview',PROVIDER_DIAGNOSTIC_ENABLED:'true',PROVIDER_DIAGNOSTIC_APP_URL:origin,PROVIDER_DIAGNOSTIC_SECRET:secret,PROVIDER_DIAGNOSTIC_GOOGLE_CLIENT_ID:'test-google',PROVIDER_DIAGNOSTIC_APPLE_CLIENT_ID:'test-apple'};
Object.assign(process.env,env);
function response(){return{headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
async function send(body,cookie,requestOrigin=origin){const res=response();await handler({method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',cookie},body},res);return res;}
test('diagnostic requires preview, explicit flag, exact HTTPS origin and separate secret',()=>{
 assert.equal(diagnosticConfig(env).origin,origin);
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{PROVIDER_DIAGNOSTIC_ENABLED:'false'},{PROVIDER_DIAGNOSTIC_APP_URL:'http://test.vercel.app'},{PROVIDER_DIAGNOSTIC_APP_URL:'https://www.sineday.app'},{PROVIDER_DIAGNOSTIC_APP_URL:'https://sineday.app'},{PROVIDER_DIAGNOSTIC_APP_URL:'https://sineday.vercel.app'},{PROVIDER_DIAGNOSTIC_APP_URL:origin+'/path'},{PROVIDER_DIAGNOSTIC_APP_URL:'https://preview.example.com'},{SIGNUP_ADMISSION_SECRET:secret},{PROVIDER_DIAGNOSTIC_SECRET:'short'}]) assert.throws(()=>diagnosticConfig({...env,...change}));
});
test('diagnostic cookie is separate, signed, short-lived, and tamper resistant',()=>{
 const now=Date.now(),flow=createDiagnosticFlow('apple',now),value=encodeDiagnosticFlow(flow,secret);
 assert.deepEqual(readDiagnosticFlow(`${DIAGNOSTIC_COOKIE}=${value}`,secret,now),flow);
 assert.match(diagnosticCookie(value),/Secure; HttpOnly; SameSite=Strict; Max-Age=180/);
 assert.throws(()=>readDiagnosticFlow(`${DIAGNOSTIC_COOKIE}=${value}x`,secret,now));
 assert.throws(()=>readDiagnosticFlow(`${DIAGNOSTIC_COOKIE}=${value}`,secret,now+180000));
 assert.throws(()=>readDiagnosticFlow(`${DIAGNOSTIC_COOKIE}=${value}; ${DIAGNOSTIC_COOKIE}=${value}`,secret,now));
});
test('disabled endpoint and arbitrary origins fail before provider work',async()=>{
 process.env.VERCEL_ENV='production';try{assert.equal((await send({action:'begin',provider:'google'})).statusCode,404);}finally{process.env.VERCEL_ENV='preview';}
 assert.equal((await send({action:'begin',provider:'google'},undefined,'https://evil.test')).statusCode,400);
 assert.equal((await send({action:'begin',provider:'email'})).statusCode,400);
});
test('synthetic Google and Apple proof returns pass only, clears cookie, rejects replay and wrong state',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'diagnostic-key',alg:'RS256'};
 const originalFetch=globalThis.fetch,urls=[];
 globalThis.fetch=async url=>{urls.push(url);assert.ok(['https://www.googleapis.com/oauth2/v3/certs','https://appleid.apple.com/auth/keys'].includes(url));return{ok:true,json:async()=>({keys:[jwk]})};};
 try{
  for(const provider of ['google','apple']){
   const start=await send({action:'begin',provider});assert.equal(start.statusCode,200);
   const cookie=start.headers['Set-Cookie'].split(';')[0];
   const flow=readDiagnosticFlow(cookie,secret);const seconds=Math.floor(Date.now()/1000);
   const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'diagnostic-key'})).toString('base64url');
   const payload=Buffer.from(JSON.stringify({iss:provider==='google'?'https://accounts.google.com':'https://appleid.apple.com',aud:provider==='google'?'test-google':'test-apple',sub:'synthetic-subject-never-returned',iat:seconds,exp:seconds+300,nonce:hash(flow.nonce)})).toString('base64url');
   const token=`${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
   const body={action:'complete',provider,state:flow.state,token};
   const result=await send({...body},cookie);
   assert.deepEqual(result.body,{ok:true,passed:true,provider});assert.match(result.headers['Set-Cookie'],/Max-Age=0/);
   assert.equal(result.headers['Cache-Control'],'no-store, private');assert.equal(JSON.stringify(result).includes('synthetic-subject'),false);
   assert.equal((await send({...body},cookie)).body.passed,false);
   const fresh=await send({action:'begin',provider});
   assert.equal((await send({...body,state:'wrong'},fresh.headers['Set-Cookie'].split(';')[0])).body.passed,false);
  }
  assert.equal(urls.length,2);
 }finally{globalThis.fetch=originalFetch;}
});
test('diagnostic implementation has no Auth/mail/payment/client-storage calls and no analytics',async()=>{
 const server=await readFile(new URL('../api/provider-diagnostic.js',import.meta.url),'utf8');
 const client=await readFile(new URL('../js/provider-diagnostic.js',import.meta.url),'utf8');
 const html=await readFile(new URL('../provider-diagnostic.html',import.meta.url),'utf8');
 for(const text of [server,client])assert.doesNotMatch(text,/console\.|signInWithIdToken|createClient|getAdminClient|\.rpc\(|localStorage|sessionStorage|resend|stripe/i);
 assert.doesNotMatch(html,/<script[^>]+(?:supabase|analytics)|service-worker/i);
});

test('diagnostic page is tracker-free, unindexed, anti-embedded and network-only in worker', async () => {
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const headers=config.headers.find(x=>x.source==='/provider-diagnostic.html').headers;
 const value=name=>headers.find(x=>x.key===name)?.value;
 assert.match(value('Cache-Control'),/no-store/);assert.equal(value('Referrer-Policy'),'no-referrer');
 assert.match(value('X-Robots-Tag'),/noindex/);assert.match(value('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal(value('X-Frame-Options'),'DENY');
 const worker=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
 assert.match(worker,/if \(url\.pathname === '\/provider-diagnostic\.html' \|\| url\.pathname === '\/js\/provider-diagnostic\.js'/);
 const html=await readFile(new URL('../provider-diagnostic.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/<script[^>]+(?:supabase|analytics)|service-worker/i);
});
