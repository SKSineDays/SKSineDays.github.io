import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createPrivacyController, PRIVACY_KEY, PRIVACY_TTL, validChoice } from '../js/privacy-consent.js';

const REF = 'sineday_pending_affiliate_code';
const REF_TIME = 'sineday_pending_affiliate_code_saved_at';
const HISTORY = 'sineday:photo-history:v1';
const VISIT = 'sineday:photo-visit:v1';
const TIME = 1800000000000;
const all = { analytics: true, referrals: true, photos: true };
const none = { analytics: false, referrals: false, photos: false };
const record = (values = all, savedAt = TIME) => ({ version: 1, savedAt, ...values });
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return { data, writes, getItem: key => data.get(key) ?? null,
    setItem(key, value) { writes.push([key, String(value)]); data.set(key, String(value)); },
    removeItem(key) { data.delete(key); } };
}
function controller(options = {}) {
  const local = options.local ?? store(); const session = options.session ?? store();
  const api = createPrivacyController({ local, session, now: () => TIME, ...options });
  return { api, local, session };
}

test('first visit makes no optional writes and keeps a URL referral only in memory until consent', () => {
  const { api, local, session } = controller({ search: '?ref=hello-123' });
  assert.equal(api.get(), null);
  for (const purpose of Object.keys(all)) assert.equal(api.allowed(purpose), false);
  assert.equal(api.pendingReferral(), '');
  assert.deepEqual(local.writes, []); assert.deepEqual(session.writes, []);
  api.save({ referrals: true });
  assert.equal(api.pendingReferral(), 'HELLO-123');
  assert.equal(local.getItem(REF), 'HELLO-123');
  assert.equal(local.getItem(REF_TIME), String(TIME));
  assert.equal(api.allowed('analytics'), false);
  assert.equal(api.allowed('photos'), false);
});

test('returning affirmative consent captures valid referral and rejects malformed codes', () => {
  const local = store({ [PRIVACY_KEY]: JSON.stringify(record()) });
  const { api } = controller({ local, search: '?ref=code-42' });
  assert.equal(api.pendingReferral(), 'CODE-42');
  for (const search of ['?ref=abc', '?ref=a%20b%20c', '?ref=' + 'a'.repeat(21), '?ref=%3Cscript%3E']) {
    const h = controller({ local: store({ [PRIVACY_KEY]: JSON.stringify(record()) }), search });
    assert.equal(h.api.pendingReferral(), ''); assert.equal(h.local.getItem(REF), null);
  }
});

test('unknown consent clears legacy optional state without touching auth or functional settings', () => {
  const local = store({ [REF]: 'OLD-CODE', [REF_TIME]: String(TIME), [HISTORY]: '{}', 'sb-app-auth-token': 'token', 'sd:user_settings:user-1': '{"language":"en"}' });
  const session = store({ [VISIT]: '{}', sineday_auth_error: 'functional' });
  controller({ local, session });
  for (const key of [REF, REF_TIME, HISTORY]) assert.equal(local.getItem(key), null);
  assert.equal(session.getItem(VISIT), null);
  assert.equal(local.getItem('sb-app-auth-token'), 'token');
  assert.equal(local.getItem('sd:user_settings:user-1'), '{"language":"en"}');
  assert.equal(session.getItem('sineday_auth_error'), 'functional');
});

test('reject and withdraw clear only optional state while retaining necessary login', () => {
  for (const initialConsent of [null, record()]) {
    const local = store({ ...(initialConsent ? { [PRIVACY_KEY]: JSON.stringify(initialConsent) } : {}), 'sb-auth-token': 'session' });
    const session = store({ sineday_identity_link_success: 'yes' });
    const { api } = controller({ local, session, search: '?ref=TEST-CODE' });
    api.save(all); local.setItem(HISTORY, '{}'); session.setItem(VISIT, '{}'); api.save(none);
    for (const key of [REF, REF_TIME, HISTORY]) assert.equal(local.getItem(key), null);
    assert.equal(session.getItem(VISIT), null); assert.equal(api.pendingReferral(), '');
    assert.equal(local.getItem('sb-auth-token'), 'session');
    assert.equal(session.getItem('sineday_identity_link_success'), 'yes');
    assert.deepEqual(api.get(), record(none));
  }
});

test('TTL boundary, invalid/future/corrupt choices all fail closed', () => {
  assert.equal(validChoice(record(all, TIME - PRIVACY_TTL + 1), TIME), true);
  for (const value of [null, {}, record(all, TIME + 1), record(all, TIME - PRIVACY_TTL), { ...record(), version: 2 }, { ...record(), savedAt: Infinity }, { ...record(), analytics: 'true' }, { ...record(), photos: undefined }]) {
    assert.equal(validChoice(value, TIME), false);
    const { api } = controller({ local: store({ [PRIVACY_KEY]: JSON.stringify(value) }) });
    assert.equal(api.get(), null); assert.equal(api.allowed('analytics'), false);
  }
  const { api } = controller({ local: store({ [PRIVACY_KEY]: '{corrupt' }) });
  assert.equal(api.get(), null);
});

test('expiry while a page is open revokes permission, removes optional data and notifies once', () => {
  let now = TIME; const changes = [];
  const local = store({ [PRIVACY_KEY]: JSON.stringify(record()), [REF]: 'CODE-123', [REF_TIME]: String(TIME), [HISTORY]: '{}' });
  const session = store({ [VISIT]: '{}' });
  const { api } = controller({ local, session, now: () => now, onChange: (...args) => changes.push(args) });
  now += PRIVACY_TTL;
  assert.equal(api.allowed('analytics'), false); assert.equal(api.get(), null);
  assert.equal(local.getItem(PRIVACY_KEY), null); assert.equal(local.getItem(REF), null);
  assert.equal(local.getItem(HISTORY), null); assert.equal(session.getItem(VISIT), null);
  assert.equal(changes.length, 1); assert.equal(changes[0][0], null);
});

test('referral TTL rejects expired/future codes and explicit clear removes attribution', () => {
  for (const timestamp of [TIME + 1, TIME - 30 * 86400000, 0, NaN]) {
    const h = controller({ local: store({ [PRIVACY_KEY]: JSON.stringify(record()), [REF]: 'CODE-123', [REF_TIME]: String(timestamp) }) });
    assert.equal(h.api.pendingReferral(), ''); assert.equal(h.local.getItem(REF), null);
  }
  const h = controller({ search: '?ref=CODE-123' }); h.api.save(all); h.api.clearReferral();
  assert.equal(h.api.pendingReferral(), ''); assert.equal(h.local.getItem(REF_TIME), null);
});

test('storage exceptions fail closed initially and explicit choices work only in memory', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const { api } = controller({ local: blocked, session: blocked, search: '?ref=CODE-123' });
  assert.equal(api.get(), null); api.save(all); assert.equal(api.allowed('analytics'), true);
  assert.equal(api.pendingReferral(), ''); api.save(none); assert.equal(api.allowed('analytics'), false);
  api.refresh(); assert.equal(api.get(), null);
});

test('cross-tab refresh updates permission and cleans withdrawn optional state without auth loss', () => {
  const changes = []; const h = controller({ search: '?ref=CODE-123', onChange: (...args) => changes.push(args) });
  h.api.save(all); h.local.setItem('sb-auth-token', 'token'); h.local.setItem(HISTORY, '{}'); h.session.setItem(VISIT, '{}');
  h.local.setItem(PRIVACY_KEY, JSON.stringify(record(none))); h.api.refresh();
  assert.equal(h.api.allowed('analytics'), false); assert.equal(h.api.pendingReferral(), '');
  assert.equal(h.local.getItem(HISTORY), null); assert.equal(h.session.getItem(VISIT), null);
  assert.equal(h.local.getItem('sb-auth-token'), 'token'); assert.equal(changes.length, 2);
  h.api.refresh(); assert.equal(changes.length, 2);
});

function analyticsHarness(initial = false) {
  let permitted = initial; let reloads = 0; const scripts = []; const events = {};
  const window = { location: { origin: 'https://sineday.app', reload() { reloads++; } }, addEventListener: (name, callback) => { events[name] = callback; } };
  const document = { head: { appendChild: node => scripts.push(node) }, createElement: type => ({ type }) };
  const source = readFileSync(new URL('../js/vercel-analytics.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const context = { window, document, URL, privacyAllowed: purpose => purpose === 'analytics' && permitted };
  runInNewContext(source, context);
  return { window, scripts, filter: context.filterAnalyticsEvent, get reloads() { return reloads; }, change(value) { permitted = value; events['sineday:privacy-change'](); } };
}

test('analytics loader makes no script/queue until opt-in and injects just once', () => {
  const h = analyticsHarness(); assert.equal(h.scripts.length, 0); assert.equal(h.window.vaq, undefined);
  assert.equal(h.filter({ type: 'pageview', url: 'https://sineday.app/' }), null);
  h.change(true); assert.equal(h.scripts.length, 1); assert.equal(h.scripts[0].src, '/_vercel/insights/script.js');
  assert.equal(h.window.vaq[0][0], 'beforeSend'); assert.equal(h.window.vaq[0][1], h.filter);
  h.change(true); assert.equal(h.scripts.length, 1);
  h.change(false); assert.equal(h.reloads, 1); assert.equal(h.filter({ type: 'pageview', url: 'https://sineday.app/' }), null);
});

test('analytics beforeSend strips query/hash and refuses custom events and malformed URLs', () => {
  const h = analyticsHarness(true); assert.equal(h.scripts.length, 1);
  const clean = h.filter({ type: 'pageview', url: 'https://sineday.app/?ref=PRIVATE#secret' });
  assert.equal(clean.url, 'https://sineday.app/');
  assert.equal(h.filter({ type: 'event', url: 'https://sineday.app/' }), null);
  assert.equal(h.filter({ type: 'pageview', url: 'http://[' }), null);
});
