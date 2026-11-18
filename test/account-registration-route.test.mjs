import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { FLOW_COOKIE, hash, readFlow } from '../api/_lib/account-registration.js';
process.env.APP_URL = 'https://sineday.app';
process.env.SIGNUP_ADMISSION_SECRET = 'test-secret-at-least-32-characters-long';
process.env.AGE_AUTH_HOOK_READY = 'true';
process.env.GOOGLE_SIGNUP_CLIENT_ID = 'test-google-client';
process.env.APPLE_SIGNUP_CLIENT_ID = 'test-apple-client';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
const calls = [];
let denied = false;
let signupEnabled = true;
mock.module('@supabase/supabase-js', { namedExports: { createClient(url, key) {
  return { async rpc(name, args) { if (name === 'account_signup_enforcement_is_enabled') return { data: signupEnabled, error: null }; calls.push({ name, args, key }); return { error: denied ? new Error('denied') : null }; },
    auth: { async signInWithOtp(args) { calls.push({ type: 'otp', args, key }); return { data: {}, error: null }; },
      async signInWithIdToken(args) { calls.push({ type: 'id-token', args, key });
        return { data: { session: { access_token: 'test-access', refresh_token: 'test-refresh' } }, error: null }; } } };
} } });
const { default: handler } = await import('../api/account-registration.js');
function response() { return { headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } }; }
async function send(body, cookie, headers = {}) {
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://sineday.app', 'content-type': 'application/json', cookie, ...headers }, body }, res);
  return res;
}
async function begin(provider = 'email') {
  return send({ action: 'begin', birthdate: '2000-01-01', country: 'US', provider });
}
test('underage or unconfigured country cannot produce admission, persist DOB or send auth messages', async () => {
  calls.length = 0;
  for (const payload of [{ birthdate: '2020-01-01', country: 'US' }, { birthdate: '2000-01-01', country: 'ZZ' }]) {
    const res = await send({ action: 'begin', provider: 'email', ...payload });
    assert.equal(res.statusCode, 403);
    assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
    assert.equal(JSON.stringify(res.body).includes(payload.birthdate), false);
  }
  assert.equal(calls.length, 0);
});
test('email signup binds admission to random proof and normalised email before sending OTP', async () => {
  calls.length = 0;
  const start = await begin();
  assert.equal(start.statusCode, 200);
  const cookie = start.headers['Set-Cookie'].split(';')[0];
  const flow = readFlow(cookie, process.env.SIGNUP_ADMISSION_SECRET);
  const done = await send({ action: 'complete', email: ' MEMBER@example.com ' }, cookie);
  assert.equal(done.statusCode, 200);
  assert.equal(done.body.emailSent, true);
  assert.equal(calls[0].name, 'issue_account_admission');
  assert.equal(calls[0].key, 'test-service');
  assert.equal(calls[0].args.p_subject, 'member@example.com');
  assert.equal(calls[0].args.p_flow_hash, hash(flow.id));
  assert.equal(calls[1].key, 'test-anon');
  assert.equal(calls[1].args.options.data.signup_admission_token, flow.id);
  assert.equal(calls[1].args.options.shouldCreateUser, true);
  assert.match(done.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal(JSON.stringify(calls).includes('2000-01-01'), false);
});
test('missing cookie, cross-site completion and DB admission failure never call Auth', async () => {
  calls.length = 0;
  assert.equal((await send({ action: 'complete', email: 'test@example.com' })).statusCode, 403);
  const start = await begin();
  const cookie = start.headers['Set-Cookie'].split(';')[0];
  assert.equal((await send({ action: 'complete' }, cookie, { origin: 'https://evil.test' })).statusCode, 400);
  denied = true;
  const done = await send({ action: 'complete', email: 'test@example.com' }, cookie);
  denied = false;
  assert.equal(done.statusCode, 400);
  assert.equal(calls.some(c => c.type), false);
});
test('Google proof is checked before DB admission and raw nonce only reaches Supabase server SDK', async () => {
  calls.length = 0;
  const start = await begin('google');
  const cookie = start.headers['Set-Cookie'].split(';')[0];
  const flow = readFlow(cookie, process.env.SIGNUP_ADMISSION_SECRET);
  assert.equal(start.body.nonce, hash(flow.nonce));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'route-key', alg: 'RS256' };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs'); return { ok: true, json: async () => ({ keys: [key] }) }; };
  try {
    const seconds = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'route-key' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_SIGNUP_CLIENT_ID,
      sub: 'stable-provider-id', exp: seconds + 300, iat: seconds, nonce: start.body.nonce })).toString('base64url');
    const token = `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
    const done = await send({ action: 'complete', token }, cookie);
    assert.equal(done.statusCode, 200);
    assert.equal(calls[0].args.p_subject, 'stable-provider-id');
    assert.equal(calls[1].args.nonce, flow.nonce);
    assert.deepEqual(done.body.session, { access_token: 'test-access', refresh_token: 'test-refresh' });
  } finally { globalThis.fetch = oldFetch; }
});

test('database switch disabled rejects new flow even when environment readiness is true', async () => {
  calls.length = 0;
  signupEnabled = false;
  try {
    const response = await begin();
    assert.equal(response.statusCode, 503);
    assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
    assert.equal(calls.length, 0);
  } finally { signupEnabled = true; }
});
test('disabling admission between begin and complete prevents auth or grants', async () => {
  calls.length = 0;
  const start = await begin();
  const cookie = start.headers['Set-Cookie'].split(';')[0];
  signupEnabled = false;
  try {
    const response = await send({ action: 'complete', email: 'test@example.com' }, cookie);
    assert.equal(response.statusCode, 503);
    assert.equal(calls.length, 0);
  } finally { signupEnabled = true; }
});

test('canonical signup override accepts www and sets email callback without changing legacy APP_URL', async () => {
  calls.length = 0;
  process.env.SIGNUP_APP_URL = 'https://www.sineday.app';
  try {
    const payload = { action: 'begin', birthdate: '2000-01-01', country: 'US', provider: 'email' };
    assert.equal((await send({ ...payload }, undefined, { origin: 'https://sineday.app' })).statusCode, 400);
    assert.equal((await send({ ...payload }, undefined, { origin: 'https://evil.test' })).statusCode, 400);
    const start = await send({ ...payload }, undefined, { origin: 'https://www.sineday.app' });
    assert.equal(start.statusCode, 200);
    const cookie = start.headers['Set-Cookie'].split(';')[0];
    const done = await send({ action: 'complete', email: 'canonical@example.com' }, cookie, { origin: 'https://www.sineday.app' });
    assert.equal(done.statusCode, 200);
    assert.equal(calls.find(x => x.type === 'otp').args.options.emailRedirectTo, 'https://www.sineday.app/auth/callback.html');
    assert.equal(process.env.APP_URL, 'https://sineday.app');
    const apple = await send({ ...payload, provider: 'apple' }, undefined, { origin: 'https://www.sineday.app' });
    assert.equal(apple.body.redirectUri, 'https://www.sineday.app/login.html');
  } finally { delete process.env.SIGNUP_APP_URL; }
});
test('policy version change while registration is in flight denies old signed eligibility before admission',async()=>{
 calls.length=0;signupEnabled=true;denied=false;const original=process.env.AGE_ELIGIBILITY_POLICIES_JSON;
 try{
   delete process.env.AGE_ELIGIBILITY_POLICIES_JSON;const started=await begin('email');
   process.env.AGE_ELIGIBILITY_POLICIES_JSON=JSON.stringify({US:{minimumAge:13,version:'withdrawn-test-version'}});
   const res=await send({action:'complete',email:'test@example.invalid'},started.headers['Set-Cookie']);
   assert.equal(res.statusCode,400);assert.equal(calls.length,0);
 }finally{if(original===undefined)delete process.env.AGE_ELIGIBILITY_POLICIES_JSON;else process.env.AGE_ELIGIBILITY_POLICIES_JSON=original;}
});
