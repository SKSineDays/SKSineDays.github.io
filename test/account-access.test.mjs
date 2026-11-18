import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAccountEligibility } from '../api/_lib/account-access.js';
const admin=row=>({from(name){assert.equal(name,'account_eligibility');return {select(){return this},eq(key,id){assert.equal(id,'owner');return this},async maybeSingle(){return {data:row,error:null}}}}});
test('privileged app access denies missing, review and stale records and trusts no user metadata',async()=>{
 process.env.AGE_EXISTING_ENFORCEMENT_READY='true';
 try {
 const good={status:'eligible',country:'US',minimum_age:13,policy_version:'us-independent-13-v1',age_band:'adult'};
 for(const row of [null,{...good,status:'review_required'},{...good,policy_version:'old'},{...good,age_band:'under13'}]) {
  await assert.rejects(()=>requireAccountEligibility(admin(row),'owner'),e=>e.status===403);
 }
 await requireAccountEligibility(admin(good),'owner');
 } finally {delete process.env.AGE_EXISTING_ENFORCEMENT_READY;}
});
