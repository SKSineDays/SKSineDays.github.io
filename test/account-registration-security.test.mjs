import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createFlow, flowCookie, FLOW_COOKIE, hash, parseRegistrationBody, providerSettings,
  readFlow, registrationConfig, requireSameOrigin, signFlow, verifyProviderProof } from '../api/_lib/account-registration.js';
const now = Date.parse('2026-11-18T12:00:00Z');
const secret = 'test-secret-at-least-32-characters-long';
const config = { googleClientId: 'google-test-client', appleClientId: 'apple-test-client' };
const eligibility = { eligible: true, country: 'US', minimumAge: 13, policyVersion: 'us-independent-13-v1', ageBand: '13-15' };
const flow = createFlow('google', eligibility, now);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function token(changes = {}, headerChanges = {}, key = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...headerChanges })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: config.googleClientId,
    sub: 'provider-subject', iat: now / 1000, exp: now / 1000 + 3600, nonce: hash(flow.nonce), ...changes })).toString('base64url');
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key).toString('base64url')}`;
}
test('signed short-lived host cookie contains eligibility only, never full birthdate', () => {
  const value = signFlow(flow, secret);
  assert.deepEqual(readFlow(`${FLOW_COOKIE}=${value}`, secret, now), flow);
  assert.equal('birthdate' in flow.eligibility, false);
  assert.match(flowCookie(value), /Secure; HttpOnly; SameSite=Strict/);
  assert.throws(() => readFlow(`${FLOW_COOKIE}=${value}x`, secret, now));
  assert.throws(() => readFlow(`${FLOW_COOKIE}=${value}`, secret, now + 300000));
  assert.throws(() => readFlow(`${FLOW_COOKIE}=${value}; ${FLOW_COOKIE}=${value}`, secret, now));
  assert.throws(() => readFlow(`${FLOW_COOKIE}=${value}`, 'wrong-secret', now));
});
test('registration fails closed when hook activation or secret absent', () => {
  assert.throws(() => registrationConfig({ APP_URL: 'https://sineday.app' }));
  assert.throws(() => registrationConfig({ AGE_AUTH_HOOK_READY: 'true', SIGNUP_ADMISSION_SECRET: secret, APP_URL: 'http://sineday.app' }));
  assert.equal(registrationConfig({ AGE_AUTH_HOOK_READY: 'true', SIGNUP_ADMISSION_SECRET: secret }).origin, 'https://sineday.app');
});
test('state-changing registration rejects cross-origin, missing Origin, non-JSON and huge bodies', () => {
  const headers = { origin: 'https://sineday.app', 'content-type': 'application/json' };
  assert.doesNotThrow(() => requireSameOrigin({ headers }, headers.origin));
  for (const extra of [{ origin: 'https://evil.test' }, { origin: undefined }, { 'content-type': 'text/plain' }]) {
    assert.throws(() => requireSameOrigin({ headers: { ...headers, ...extra } }, headers.origin));
  }
  assert.throws(() => parseRegistrationBody('x'.repeat(30000)));
  assert.throws(() => parseRegistrationBody([]));
  assert.deepEqual(parseRegistrationBody('{"action":"cancel"}'), { action: 'cancel' });
});
test('provider admission requires valid signature, issuer, audience, subject, fresh dates and nonce', async () => {
  assert.deepEqual(await verifyProviderProof(token(), flow, config, { now, keys: [jwk] }), { subject: 'provider-subject' });
  for (const changes of [{ iss: 'https://evil.test' }, { aud: 'another-client' }, { sub: '' },
    { exp: now / 1000 }, { iat: now / 1000 - 1000 }, { iat: now / 1000 + 1000 },
    { nonce: 'wrong-nonce' }, { nbf: now / 1000 + 1000 }, { azp: 'wrong-client' },
    { aud: [config.googleClientId, 'other'] }]) {
    await assert.rejects(verifyProviderProof(token(changes), flow, config, { now, keys: [jwk] }));
  }
  await assert.rejects(verifyProviderProof(token({}, { alg: 'none' }), flow, config, { now, keys: [jwk] }));
  await assert.rejects(verifyProviderProof(token({}, { kid: 'unknown' }), flow, config, { now, keys: [jwk] }));
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(verifyProviderProof(token({}, {}, wrong.privateKey), flow, config, { now, keys: [jwk] }));
  assert.throws(() => providerSettings('apple', { googleClientId: 'only-google' }));
});
test('Apple token uses Apple audience/issuer and same nonce binding', async () => {
  const appleFlow = { ...flow, provider: 'apple' };
  const value = token({ iss: 'https://appleid.apple.com', aud: config.appleClientId });
  assert.deepEqual(await verifyProviderProof(value, appleFlow, config, { now, keys: [jwk] }), { subject: 'provider-subject' });
  await assert.rejects(verifyProviderProof(value, flow, config, { now, keys: [jwk] }));
});
