import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateEligibility} from '../api/_lib/age-eligibility.js';
import {DEFAULT_MAILER_POLICIES,evaluateMailerEligibility,getConfiguredMailerPolicies} from '../api/_lib/mailer-eligibility.js';
import endpoint from '../api/eligibility-policy.js';
const now=new Date('2026-11-18T12:00:00Z');
test('mailer threshold map hasUS+27EU and checks exact declared age, not coarse accountband',()=>{
 assert.equal(Object.keys(DEFAULT_MAILER_POLICIES).length,28);
 for(const [country,policy] of Object.entries(DEFAULT_MAILER_POLICIES)){
  const birthdate=`${2026-policy.minimumAge}-11-18`;
  assert.equal(evaluateMailerEligibility({country,birthdate,now}).eligible,true);
  assert.equal(evaluateMailerEligibility({country,birthdate:`${2026-policy.minimumAge}-11-19`,now}).eligible,false);
 }
 for(const country of ['ES','FR','DK','DE']){
  const input={country,birthdate:'2013-11-18',now};
  assert.equal(evaluateEligibility(input).eligible,true);assert.equal(evaluateMailerEligibility(input).eligible,false);
 }
 assert.equal(evaluateMailerEligibility({country:'FR',birthdate:'2011-11-18',now}).ageBand,'13-15');
 assert.equal(evaluateMailerEligibility({country:'FR',birthdate:'2011-11-18',now}).eligible,true);
 assert.equal(evaluateMailerEligibility({country:'FR',birthdate:'2012-11-18',now}).ageBand,'13-15');
 assert.equal(evaluateMailerEligibility({country:'FR',birthdate:'2012-11-18',now}).eligible,false);
});
test('nonEU nonUS account availability doesnot silently enable independent mailer',()=>{
 for(const country of ['CA','GB','AU','JP','BR']){
  assert.equal(evaluateEligibility({country,birthdate:'2000-01-01',now}).eligible,true);
  const decision=evaluateMailerEligibility({country,birthdate:'2000-01-01',now});assert.equal(decision.code,'policy_unavailable');assert.match(decision.error,/account is separate/);
 }
});
test('mailer policy config is separate and cannot weaken verified thresholds oraddunsupported country',()=>{
 const old=process.env.AGE_MAILER_POLICIES_JSON;
 try{for(const value of ['null','[]','oops',JSON.stringify({DE:{minimumAge:13,version:'v1'}}),JSON.stringify({CA:{minimumAge:13,version:'v1'}})]){process.env.AGE_MAILER_POLICIES_JSON=value;assert.throws(()=>getConfiguredMailerPolicies());}}
 finally{if(old===undefined)delete process.env.AGE_MAILER_POLICIES_JSON;else process.env.AGE_MAILER_POLICIES_JSON=old;}
});
test('mailer countryselector is separately scoped and accountselector remainscomplete',()=>{
 function query(purpose){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};endpoint({method:'GET',query:{purpose}},res);return res.body.countries;}
 assert.equal(query('mailer').length,28);assert.equal(query('account').length,249);
});
