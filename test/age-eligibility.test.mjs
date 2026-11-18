import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEligibility, getConfiguredPolicies } from '../api/_lib/age-eligibility.js';
const now = new Date('2026-11-18T12:00:00Z');
const check = (birthdate, country='US', extra={}) => evaluateEligibility({ birthdate,country,now,...extra });
test('US exact 13th birthday boundary, full age bands and no DOB result', () => {
  assert.equal(check('2013-11-18').eligible,true);
  assert.equal(check('2013-11-19').eligible,false);
  assert.equal(check('2013-11-18','US',{now:new Date('2026-11-18T00:01Z')}).eligible,false);
  assert.equal(check('2014-01-01').ageBand,'under13');
  assert.equal(check('2010-01-01').ageBand,'16-17');
  assert.equal(check('2000-01-01').ageBand,'adult');
  assert.equal('birthdate' in check('2000-01-01'),false);
});
test('dates must be real, not future, and leap birthday waits until March in non-leap year', () => {
  for (const date of ['2013-02-29','2013-13-01','2027-01-01','2013-11-31','13','',null]) assert.equal(check(date).ok,false);
  assert.equal(check('2012-02-29','US',{now:new Date('2025-02-28T12:00Z')}).eligible,false);
  assert.equal(check('2012-02-29','US',{now:new Date('2025-03-01T12:00Z')}).eligible,true);
});
test('no silent US fallback for missing or unconfigured jurisdiction', () => {
  assert.equal(check('2000-01-01','').code,'country_required');
  assert.equal(check('2000-01-01','FR').code,'policy_unavailable');
  assert.equal(check('2000-01-01','us').ok,false);
});
test('explicit versioned country policy can be tested without changing approved US minimum', () => {
  const policies={US:{minimumAge:13,version:'us-v1'},XX:{minimumAge:16,version:'test-only'}};
  assert.equal(check('2012-01-01','XX',{policies}).eligible,false);
  assert.equal(check('2010-01-01','XX',{policies}).eligible,true);
});
test('malformed configuration and weakening US policy fail closed', () => {
  const original=process.env.AGE_ELIGIBILITY_POLICIES_JSON;
  try {
    for(const value of ['oops','null','[]','{}','{"US":{"minimumAge":12,"version":"v1"}}']) {
      process.env.AGE_ELIGIBILITY_POLICIES_JSON=value;
      assert.throws(()=>getConfiguredPolicies());
    }
  } finally { if(original===undefined) delete process.env.AGE_ELIGIBILITY_POLICIES_JSON; else process.env.AGE_ELIGIBILITY_POLICIES_JSON=original; }
});
