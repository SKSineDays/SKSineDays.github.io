import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
const state = { authorized: true, rows: new Map(), fail: false, supplied: null };
const authId = 'verified-account';
function chain() {
  let op = 'get', filter, record;
  const query = {
    select() { return query; },
    eq(key, value) { assert.equal(key, 'user_id'); filter = value; return query; },
    abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query; },
    upsert(value) { op = 'put'; record = value; state.supplied = value; return query; },
    delete() { op = 'delete'; return query; },
    single() { return query; }, maybeSingle() { return query; },
    then(resolve, reject) {
      if (state.fail) return Promise.resolve({ error: { code: '57014' } }).then(resolve, reject);
      if (op === 'put') state.rows.set(record.user_id, record);
      if (op === 'delete') state.rows.delete(filter);
      return Promise.resolve({ data: state.rows.get(record?.user_id || filter) || null, error: null }).then(resolve, reject);
    }
  };
  return query;
}
mock.module('../api/_lib/auth.js', { namedExports: {
  async authenticateUser() {
    if (!state.authorized) throw new Error('invalid');
    return { user: { id: authId }, supabase: { from(name) { assert.equal(name, 'globe_memberships'); return chain(); } } };
  },
  getAdminClient() { return { rpc(name) { assert.equal(name, 'globe_region_counts'); return {
    async abortSignal() { return state.fail ? { error: new Error('timeout') } : { data: [{ region_key: 'US', member_count: 2, unapproved: 'never serialize' }] }; }
  }; } }; }
} });
const { default: me } = await import('../api/globe/me.js');
const { default: groups } = await import('../api/globe/groups.js');
const call = async (handler, method, body) => {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body, headers: {} }, response); return response;
};
test('routes reject unauthorized access, derive ownership and serialize only approved fields', async () => {
  state.authorized = false;
  for (const [handler, method] of [[groups,'GET'],[me,'GET'],[me,'PUT'],[me,'DELETE']]) assert.equal((await call(handler,method)).code,401);
  state.authorized = true;
  assert.equal((await call(me,'GET')).body.membership.enabled,false);
  for (const body of [{enabled:true,regionKey:'ZZ',consentVersion:'2026-09-30'}, {enabled:false,regionKey:'US',consentVersion:'2026-09-30'}, {enabled:true,regionKey:'US'}, {enabled:true,regionKey:'US',consentVersion:'2026-09-30',user_id:'someone-else'}]) {
    assert.equal((await call(me,'PUT',body)).code,400);
  }
  const consent = {enabled:true,regionKey:'US',consentVersion:'2026-09-30'};
  const saved = await call(me,'PUT',consent);
  assert.equal(saved.code,200); assert.equal(state.supplied.user_id,authId);
  assert.deepEqual(Object.keys(saved.body.membership).sort(),['consentVersion','enabled','regionKey']);
  assert.match(saved.headers['Cache-Control'],/no-store/);
  await call(me,'PUT',consent); assert.equal(state.rows.size,1);
  const feed = await call(groups,'GET');
  assert.deepEqual(Object.keys(feed.body).sort(),['generatedAt','groups','participation','precision']);
  assert.deepEqual(feed.body.groups,[{regionKey:'US',count:2}]);
  assert.match(feed.headers['Cache-Control'],/no-store/);
  await call(me,'DELETE'); assert.equal(state.rows.size,0);
  state.fail = true;
  assert.equal((await call(groups,'GET')).code,503);
  assert.equal((await call(me,'PUT',consent)).code,503);
  assert.equal((await call(me,'DELETE')).code,503);
});
