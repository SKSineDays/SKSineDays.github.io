import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFlow,hash,signFlow,flowCookie} from '../api/_lib/account-registration.js';
process.env.SIGNUP_CANARY_ENABLED='true';
process.env.SIGNUP_APP_URL='https://www.sineday.app';
process.env.SIGNUP_CANARY_SECRET='separate-canary-secret-with-at-least-32-characters';
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_ANON_KEY='test-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
delete process.env.AGE_AUTH_HOOK_READY;
const calls=[];let operator='authorized-operator',active=true,issued=false,otpError=false,admittedEmail;
const target='canary@example.invalid',id='canary-scope';
mock.module('@supabase/supabase-js',{namedExports:{createClient(_url,key){return {
 auth:{async getUser(){return {data:{user:{id:operator}}};},async signInWithOtp(args){calls.push({kind:'otp',args,key});return {error:otpError?{message:'private'}:null};}},
 async rpc(name,args){calls.push({name,args,key});
 if(name==='get_signup_canary')return {data:active&&!issued&&operator==='authorized-operator'?[{canary_id:id,target_email:target,expires_at:new Date(Date.now()+600000).toISOString()}]:[]};
 if(name==='issue_signup_canary_admission'){if(issued)return {error:{message:'used'}};issued=true;return {data:admittedEmail||target};}
 throw new Error('Unexpected RPC');}
};}}});
const {default:handler}=await import('../api/signup-canary.js');
function reset(){calls.length=0;operator='authorized-operator';active=true;issued=false;otpError=false;admittedEmail=undefined;}
async function send(body,cookie,headers={}){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{authorization:'Bearer operator-token',origin:'https://www.sineday.app','content-type':'application/json',cookie,...headers},body},res);return res;}
const begin=()=>send({action:'begin',provider:'email',birthdate:'2000-01-01',country:'US'});
test('only verified authorized operator with active scope may start, not body operator or globaloff flag',async()=>{
 reset();operator='other';assert.equal((await send({action:'status',operator:'authorized-operator'})).statusCode,403);
 assert.equal(calls.some(c=>c.name==='issue_signup_canary_admission'),false);
 reset();assert.equal((await send({action:'status'},null,{authorization:''})).statusCode,401);assert.equal(calls.length,0);
 assert.equal((await send({action:'status'},null,{origin:'https://evil.example'})).statusCode,400);
 reset();active=false;assert.equal((await begin()).statusCode,403);
});
test('underage, unsupported country and nonemail provider never create admission or mail',async()=>{
 for(const body of [{birthdate:'2020-01-01',country:'US'},{birthdate:'2000-01-01',country:'DE'},{birthdate:'2000-01-01',country:'US',provider:'google'}]){
 reset();const res=await send({action:'begin',...body});assert.ok([400,403].includes(res.statusCode));assert.equal(calls.filter(c=>c.name==='issue_signup_canary_admission'||c.kind==='otp').length,0);
 assert.ok(!JSON.stringify(res).includes(body.birthdate));}
});
test('begin stores no DOB; complete binds operator/scope/target and sends once only to server target',async()=>{
 reset();const started=await begin();assert.equal(started.statusCode,200);const cookie=started.headers['Set-Cookie'];
 const flow=readFlow(cookie,process.env.SIGNUP_CANARY_SECRET,Date.now(),'__Host-sineday-signup-canary');assert.equal(flow.operator,operator);assert.equal(flow.targetHash,hash(target));assert.ok(!JSON.stringify(flow).includes('2000-01-01'));
 const res=await send({action:'complete',email:'attacker@example.invalid',user_id:'other'},cookie);assert.equal(res.statusCode,200);
 const otp=calls.find(c=>c.kind==='otp');assert.equal(otp.args.email,target);assert.equal(otp.key,'test-anon');assert.equal(otp.args.options.shouldCreateUser,true);
 assert.equal(calls.find(c=>c.name==='issue_signup_canary_admission').args.p_operator_id,'authorized-operator');
 assert.equal((await send({action:'complete'},cookie)).statusCode,403);assert.equal(calls.filter(c=>c.kind==='otp').length,1);
});
test('missing, tampered, crossoperator, wrongpurpose cookies cannot issue admission',async()=>{
 reset();const started=await begin();const cookie=started.headers['Set-Cookie'];
 for(const candidate of [undefined,cookie.replace('=', '=tampered')])assert.equal((await send({action:'complete'},candidate)).statusCode,409);
 const flow=readFlow(cookie,process.env.SIGNUP_CANARY_SECRET,Date.now(),'__Host-sineday-signup-canary');
 for(const patch of [{operator:'other'},{purpose:'registration'},{canaryId:'replacement'},{targetHash:hash('other@example.invalid')}]){
 const altered=flowCookie(signFlow({...flow,...patch},process.env.SIGNUP_CANARY_SECRET),300,'__Host-sineday-signup-canary');
 assert.equal((await send({action:'complete'},altered)).statusCode,409);}
 assert.equal(calls.filter(c=>c.name==='issue_signup_canary_admission').length,0);
});
test('mismatched returned admission target or uncertain OTP result never retries or deletes',async()=>{
 reset();let started=await begin();admittedEmail='other@example.invalid';assert.equal((await send({action:'complete'},started.headers['Set-Cookie'])).statusCode,409);assert.equal(calls.some(c=>c.kind==='otp'),false);
 reset();started=await begin();otpError=true;const result=await send({action:'complete'},started.headers['Set-Cookie']);assert.equal(result.statusCode,409);assert.match(result.body.error,/may already exist/);
 assert.equal(calls.filter(c=>c.kind==='otp').length,1);assert.ok(calls.every(c=>!c.name||['get_signup_canary','issue_signup_canary_admission'].includes(c.name)));
});

test('canary kill switch is off by default and blocks before Auth/DB/email',async()=>{
 reset();delete process.env.SIGNUP_CANARY_ENABLED;
 try{assert.equal((await begin()).statusCode,404);assert.equal(calls.length,0);}
 finally{process.env.SIGNUP_CANARY_ENABLED='true';}
});
