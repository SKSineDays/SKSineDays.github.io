import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const quiet = { log() {}, error() {} };

function helperHarness(path = '/login.html') {
  const calls = [];
  let options;
  const client = { auth: {
    signInWithOtp: async args => { calls.push(args); return { data: { ok: true }, error: null }; },
    signInWithOAuth: async args => { calls.push(args); return { data: {}, error: null }; },
    linkIdentity: async args => { calls.push(args); return { data: {}, error: null }; }
  }};
  const context = vm.createContext({ URL, console: quiet, fetch: async () => ({ ok: true, json: async () => ({ ok: true, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-test', appUrl: 'https://sineday.app' }) }), window: { location: { origin: 'https://preview.example', pathname: path }, supabase: { createClient: (_url, _key, opts) => { options = opts; return client; } } } });
  vm.runInContext(source('js/supabase-client.js').replace(/export /g, ''), context);
  return { context, calls, client, get options() { return options; } };
}

test('email helper normalizes and uses shared configured callback with new-user support', async () => {
  const h = helperHarness();
  await h.context.signInWithEmail('  Member@Example.com  ');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { email: 'member@example.com', options: { emailRedirectTo: 'https://sineday.app/auth/callback.html', shouldCreateUser: true } });
});
test('email helper rejects malformed input before calling provider', async () => {
  const h = helperHarness();
  for (const email of ['', 'bad', 'a@', 'a b@example.com']) await assert.rejects(h.context.signInWithEmail(email));
  assert.equal(h.calls.length, 0);
});
test('callback disables automatic consumption; normal pages retain session detection', async () => {
  for (const [path, expected] of [['/auth/callback.html', false], ['/login.html', true], ['/dashboard.html', true]]) {
    const h = helperHarness(path); await h.context.getSupabaseClient();
    assert.equal(h.options.auth.detectSessionInUrl, expected);
    assert.equal(h.options.auth.persistSession, true);
  }
});
test('Google, Apple and explicit Apple linking keep their providers and redirects', async () => {
  const h = helperHarness();
  await h.context.signInWithGoogle(); await h.context.signInWithApple(); await h.context.linkAppleIdentity();
  assert.deepEqual(h.calls.map(c => c.provider), ['google', 'apple', 'apple']);
  assert.equal(h.calls[0].options.redirectTo, 'https://sineday.app/auth/callback.html');
  assert.equal(h.calls[2].options.redirectTo, 'https://sineday.app/auth/callback.html?identity_link=apple');
});

async function callbackHarness(suffix, result = { data: { session: { user: { id: 'existing-user-id' } } }, error: null }) {
  const calls = [], stored = {}, destinations = [], logs = [], history = [];
  const auth = Object.fromEntries(['setSession','exchangeCodeForSession','getSession'].map(name => [name, async args => { calls.push({ name, args }); if (result instanceof Error) throw result; return result; }]));
  const context = { URL, URLSearchParams, console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) }, document: { title: 'Signing in' }, sessionStorage: { setItem: (k,v) => stored[k] = v }, window: { location: { href: `https://sineday.app/auth/callback.html${suffix}`, origin: 'https://sineday.app', replace: u => destinations.push(u) }, history: { replaceState: (...args) => history.push(args) } }, getSupabaseClient: async () => ({ auth }) };
  await vm.runInNewContext(source('js/auth-callback.js').replace(/^import .*;\n/, ''), context);
  return { calls, stored, destinations, logs, history };
}
test('magic-link token callback establishes mocked session exactly once without app-side user mutation', async () => {
  const h = await callbackHarness('#access_token=token-fixture&refresh_token=refresh-fixture&type=magiclink');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'setSession');
  assert.equal(h.destinations[0], 'https://sineday.app/dashboard.html');
  assert.equal(h.history[0][2], '/auth/callback.html');
  assert.deepEqual(h.stored, {}); assert.deepEqual(h.logs, []);
});
test('PKCE exchange receives only code and happens once', async () => {
  const h = await callbackHarness('?code=one-time-code');
  assert.deepEqual(h.calls, [{ name: 'exchangeCodeForSession', args: 'one-time-code' }]);
  assert.equal(h.destinations[0], 'https://sineday.app/dashboard.html');
});
test('Apple identity-link success marker and dashboard query are preserved', async () => {
  const h = await callbackHarness('?identity_link=apple&code=apple-code');
  assert.equal(h.stored.sineday_identity_link_success, 'apple');
  assert.equal(h.destinations[0], 'https://sineday.app/dashboard.html?linked=apple');
});
for (const suffix of ['?error=access_denied&error_description=secret-token', '#error_code=otp_expired&error_description=secret-token', '#access_token=secret-token', '?code=one#access_token=two&refresh_token=three']) {
  test(`invalid callback fails safely: ${suffix.split('=')[0]}`, async () => {
    const h = await callbackHarness(suffix);
    assert.equal(h.calls.length, 0); assert.equal(h.destinations[0], '/login.html?auth_error=sign_in_failed');
    assert.ok(!JSON.stringify(h.stored).includes('secret-token')); assert.deepEqual(h.logs, []);
  });
}
test('expired/reused exchanges, empty sessions and thrown errors return friendly login', async () => {
  for (const result of [{ error: { message: 'secret-token' } }, { data: { session: null }, error: null }, new Error('secret-token')]) {
    const h = await callbackHarness('?code=used-code', result);
    assert.equal(h.calls.length, 1); assert.equal(h.destinations[0], '/login.html?auth_error=sign_in_failed');
    assert.ok(!JSON.stringify(h.stored).includes('secret-token')); assert.deepEqual(h.logs, []);
  }
});
test('clean callback revisit accepts existing session but not an anonymous visit', async () => {
  assert.equal((await callbackHarness('')).destinations[0], 'https://sineday.app/dashboard.html');
  assert.equal((await callbackHarness('', { data: { session: null } })).destinations[0], '/login.html?auth_error=sign_in_failed');
});

function loginHarness(send = async () => {}, session = null, authError = false) {
  const elements = Object.fromEntries(['email-signin-form','signin-email','email-signin-btn','login-status','google-signin-btn','apple-signin-btn'].map(id => [id, { dataset: {}, style: {}, value: 'member@example.com', attributes: {}, setAttribute(k,v) { this.attributes[k] = v; }, checkValidity() { return this.value.includes('@'); }, focus() { this.focused = true; }, addEventListener() {}, querySelector() { return { textContent: '' }; } }]));
  const context = vm.createContext({ URLSearchParams, console: quiet, getCurrentSession: async () => session, signInWithEmail: send, signInWithGoogle: async () => {}, signInWithApple: async () => {}, sessionStorage: { getItem: () => null, removeItem() {} }, document: { getElementById: id => elements[id], readyState: 'loading', addEventListener() {} }, window: { location: { search: authError ? '?auth_error=sign_in_failed' : '', pathname: '/login.html', hash: '' }, history: { replaceState() {} } } });
  vm.runInContext(source('js/login.js').replace(/^import .*;$/m, ''), context);
  return { context, elements, submit: () => context.handleEmailSignIn({ preventDefault() {} }) };
}
test('valid form shows success and prevents concurrent submissions', async () => {
  let resolve, count = 0;
  const h = loginHarness(() => { count++; return new Promise(r => resolve = r); });
  const first = h.submit(); await h.submit();
  assert.equal(count, 1); assert.equal(h.elements['email-signin-btn'].disabled, true);
  resolve(); await first;
  assert.match(h.elements['login-status'].textContent, /^Check your inbox\./);
  assert.equal(h.elements['email-signin-btn'].disabled, false);
});
test('invalid email never calls provider and receives accessible feedback', async () => {
  let called = false; const h = loginHarness(async () => called = true);
  h.elements['signin-email'].value = 'bad'; await h.submit();
  assert.equal(called, false); assert.equal(h.elements['signin-email'].attributes['aria-invalid'], 'true');
  assert.equal(h.elements['signin-email'].focused, true);
});
test('rate limit and provider failures are neutral and restore controls', async () => {
  for (const error of [{ status: 429 }, { message: 'account exists secret' }]) {
    const h = loginHarness(async () => { throw error; }); await h.submit();
    assert.equal(h.elements['email-signin-btn'].disabled, false);
    assert.ok(!h.elements['login-status'].textContent.includes('account exists'));
    assert.match(h.elements['login-status'].textContent, error.status ? /wait a minute/ : /try again shortly/);
  }
});
test('returning session redirects normally, but failed callback remains on login', async () => {
  for (const error of [false, true]) {
    const h = loginHarness(undefined, { user: { id: 'existing' } }, error); await h.context.init();
    assert.equal(h.context.window.location.href, error ? undefined : '/dashboard.html');
  }
});
test('callback HTML excludes analytics and suppresses referrer', () => {
  const html = source('auth/callback.html'); assert.match(html, /name="referrer" content="no-referrer"/); assert.doesNotMatch(html, /vercel-analytics/);
});
test('login has native email semantics and minimum touch/focus styles', () => {
  const html = source('login.html');
  for (const pattern of [/type="email"/, /autocomplete="email"/, /inputmode="email"/, /for="signin-email"/, /min-height: 48px/, /\.btn:focus-visible/, /or continue with email/]) assert.match(html, pattern);
});
test('callback and API requests never access service worker caches, including offline', async () => {
  let fetchHandler;
  const context = { URL, Response, location: { origin: 'https://sineday.app' }, console: quiet, self: { addEventListener: (name, fn) => { if (name === 'fetch') fetchHandler = fn; } }, caches: { open: () => { throw new Error('cache must not be accessed'); } } };
  vm.runInNewContext(source('service-worker.js'), context);
  for (const path of ['/auth/callback.html?code=secret', '/auth/callback.html', '/api/config']) {
    for (const offline of [false,true]) {
      context.fetch = async (_request, options) => { assert.equal(options.cache, 'no-store'); if (offline) throw new Error('offline'); return new Response('ok'); };
      let promise;
      fetchHandler({ request: { url: 'https://sineday.app' + path, method: 'GET' }, respondWith: value => promise = value });
      assert.equal((await promise).status, offline ? 503 : 200);
    }
  }
});

test('email listener binds before delayed session check and survives session-check failure', async () => {
  for (const reject of [false, true]) {
    const h = loginHarness(); let finish; let bound = false;
    h.elements['email-signin-form'].addEventListener = (event, handler) => { bound = event === 'submit' && typeof handler === 'function'; };
    h.context.getCurrentSession = () => new Promise((resolve, fail) => { finish = () => reject ? fail(new Error('offline')) : resolve(null); });
    const pending = h.context.init();
    assert.equal(bound, true);
    assert.equal(h.elements['email-signin-btn'].disabled, false);
    finish(); await pending;
  }
});
test('email controls start disabled until JavaScript binds, without an email GET field', () => {
  const html = source('login.html');
  assert.match(html, /id="signin-email"[^>]*disabled/);
  assert.match(html, /id="email-signin-btn"[^>]*disabled/);
  assert.doesNotMatch(html, /name="email"/);
});
