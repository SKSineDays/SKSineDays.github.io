import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
process.env.APP_URL = 'https://sineday.app';
let saved = null, invalidAuth = false, writeError = false, raceWinner = null;
const calls = [];
const ELIGIBLE = { country: 'US', policy_version: 'us-independent-13-v1', minimum_age: 13, age_band: 'adult', status: 'eligible' };
mock.module('@supabase/supabase-js', { namedExports: { createClient() { return {
  auth: { async getUser(token) { calls.push({ auth: token }); return invalidAuth ? { error: 'invalid' } : { data: { user: { id: 'verified-owner' } } }; } },
  from(table) { assert.equal(table, 'account_eligibility'); return { select() { return this; }, eq(column, id) { calls.push({ column, id }); return this; }, async maybeSingle() { return { data: saved }; } }; },
  async rpc(name, args) { calls.push({ name, args }); if (writeError) return { error: { message: 'private database error' } };
    saved = raceWinner || { country: args.p_country, policy_version: args.p_policy_version, minimum_age: args.p_minimum_age, age_band: args.p_age_band,
      status: args.p_eligible ? 'eligible' : 'review_required' };
    return { data: [saved] };
  }
}; } } });
const { default: handler, describeEligibility } = await import('../api/account-eligibility.js');
function reset() { saved = null; invalidAuth = false; writeError = false; raceWinner = null; calls.length = 0; }
async function send(method = 'GET', body, headers = {}) {
  const res = { headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } };
  await handler({ method, body, headers: { authorization: 'Bearer test-token', origin: 'https://sineday.app', 'content-type': 'application/json', ...headers } }, res);
  return res;
}
test('eligibility API authenticates before data access and never uses posted owner ID',async()=>{
  reset();invalidAuth=true;
  assert.equal((await send()).statusCode,401);assert.equal(calls.some(x=>x.column),false);
  reset();assert.equal((await send('GET',null,{authorization:''})).statusCode,401);assert.equal(calls.length,0);
  reset();const response=await send('POST',{birthdate:'2000-01-01',country:'US',user_id:'another-owner'});
  assert.equal(response.body.state,'eligible');
  assert.equal(calls.find(x=>x.name)?.args.p_user_id,'verified-owner');
  assert.equal(JSON.stringify(calls).includes('2000-01-01'),false);
});
test('GET distinguishes missing, eligible, review and changed policy without writing',async()=>{
  reset();assert.equal((await send()).body.state,'required');
  saved=ELIGIBLE;assert.equal((await send()).body.state,'eligible');
  saved={...ELIGIBLE,status:'review_required'};assert.equal((await send()).body.state,'review_required');
  saved={...ELIGIBLE,policy_version:'old'};assert.equal((await send()).body.state,'review_required');
  assert.equal(calls.some(x=>x.name),false);
});
test('valid underage declaration is recorded and cannot be overwritten on retry',async()=>{
  reset();const response=await send('POST',{birthdate:'2020-01-01',country:'US'});
  assert.equal(response.statusCode,403);assert.equal(response.body.state,'review_required');
  assert.equal(calls.find(x=>x.name)?.args.p_eligible,false);assert.equal(saved.age_band,'under13');
  const count=calls.filter(x=>x.name).length;
  const retry=await send('POST',{birthdate:'2000-01-01',country:'US'});
  assert.equal(retry.statusCode,409);assert.equal(retry.body.state,'review_required');
  assert.equal(calls.filter(x=>x.name).length,count);
});
test('concurrent opposing decision returns persisted winner, not submitted eligibility',async()=>{
  reset();raceWinner={...ELIGIBLE,age_band:'under13',status:'review_required'};
  const response=await send('POST',{birthdate:'2000-01-01',country:'US'});
  assert.equal(response.statusCode,403);assert.equal(response.body.state,'review_required');
});
test('invalid data and unsupported countries do not record an age decision',async()=>{
  for(const body of [{birthdate:'not-a-date',country:'US'},{birthdate:'2000-01-01',country:'DE'}]) {
    reset();assert.equal((await send('POST',body)).statusCode,400);assert.equal(calls.some(x=>x.name),false);
  }
});
test('same-origin POST enforced; failed persistence cannot grant eligibility or disclose errors',async()=>{
  reset();assert.equal((await send('POST',{birthdate:'2000-01-01',country:'US'},{origin:'https://evil.test'})).statusCode,400);
  assert.equal(calls.some(x=>x.name),false);
  reset();writeError=true;const response=await send('POST',{birthdate:'2000-01-01',country:'US'});
  assert.equal(response.statusCode,503);assert.equal(response.body.state,undefined);
  assert.equal(JSON.stringify(response.body).includes('private database'),false);
});
test('unknown/missing status is not treated as eligible',()=>{
  const policies={US:{minimumAge:13,version:'us-independent-13-v1'}};
  assert.equal(describeEligibility({...ELIGIBLE,status:undefined},policies).state,'review_required');
  assert.equal(describeEligibility({...ELIGIBLE,age_band:'under13'},policies).state,'review_required');
});

test('existing-owner POST uses dedicated canonical origin override too', async () => {
  reset(); process.env.SIGNUP_APP_URL = 'https://www.sineday.app';
  try {
    assert.equal((await send('POST', { birthdate: '2000-01-01', country: 'US' })).statusCode, 400);
    const response = await send('POST', { birthdate: '2000-01-01', country: 'US' }, { origin: 'https://www.sineday.app' });
    assert.equal(response.statusCode, 200); assert.equal(response.body.state, 'eligible');
  } finally { delete process.env.SIGNUP_APP_URL; }
});
