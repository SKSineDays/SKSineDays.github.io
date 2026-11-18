import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

export const FLOW_COOKIE = '__Host-sineday-registration';
export const FLOW_SECONDS = 300;
const jwksCache = new Map();
const b64 = value => Buffer.from(value).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

export function registrationConfig(env = process.env) {
  const origin = new URL(env.APP_URL || 'https://sineday.app').origin;
  if (!origin.startsWith('https://')) throw new Error('Registration requires HTTPS');
  if (env.AGE_AUTH_HOOK_READY !== 'true' || !env.SIGNUP_ADMISSION_SECRET || env.SIGNUP_ADMISSION_SECRET.length < 32) {
    throw new Error('Registration is not configured');
  }
  return {
    origin, secret: env.SIGNUP_ADMISSION_SECRET,
    googleClientId: env.GOOGLE_SIGNUP_CLIENT_ID || '',
    appleClientId: env.APPLE_SIGNUP_CLIENT_ID || '',
    appleRedirectUri: new URL('/login.html', origin).href
  };
}

export function requireSameOrigin(req, origin) {
  // Strict Origin validation is intentional: no credential-bearing cross-site POSTs.
  if (req.headers?.origin !== origin) throw new Error('Invalid origin');
  const type = String(req.headers?.['content-type'] || '').split(';')[0];
  if (type !== 'application/json') throw new Error('JSON required');
}

export function parseRegistrationBody(body) {
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 24576) throw new Error('Request too large');
    body = JSON.parse(body);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 24576) throw new Error('Invalid request');
  return body;
}

export function signFlow(flow, secret) {
  const payload = b64(JSON.stringify(flow));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function readFlow(cookie, secret, now = Date.now()) {
  const matches = String(cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${FLOW_COOKIE}=`));
  if (matches.length !== 1) throw new Error('Start registration again');
  const raw = matches[0].slice(FLOW_COOKIE.length + 1);
  if (raw.length > 4096) throw new Error('Invalid registration');
  const [payload, signature, extra] = raw.split('.');
  if (!payload || !signature || extra) throw new Error('Invalid registration');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid registration');
  const flow = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (flow.v !== 1 || !Number.isInteger(flow.expires) || flow.expires <= now || flow.expires > now + FLOW_SECONDS * 1000 ||
      !['google', 'apple', 'email'].includes(flow.provider) || !/^[a-f0-9]{64}$/.test(flow.id || '') ||
      !/^[a-f0-9]{64}$/.test(flow.nonce || '') || !flow.eligibility?.eligible || !flow.eligibility?.policyVersion) {
    throw new Error('Registration expired');
  }
  return flow;
}

export function createFlow(provider, eligibility, now = Date.now()) {
  return { v: 1, id: randomBytes(32).toString('hex'), nonce: randomBytes(32).toString('hex'), provider,
    expires: now + FLOW_SECONDS * 1000,
    // Never persist full birthdate in a cookie, log, admission row, or response.
    eligibility: { eligible: true, country: eligibility.country, policyVersion: eligibility.policyVersion,
      minimumAge: eligibility.minimumAge, ageBand: eligibility.ageBand } };
}

export function flowCookie(value = '', maxAge = FLOW_SECONDS) {
  return `${FLOW_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function providerSettings(provider, config) {
  if (provider === 'google' && config.googleClientId) return {
    clientId: config.googleClientId, issuers: ['https://accounts.google.com', 'accounts.google.com'],
    keysUrl: 'https://www.googleapis.com/oauth2/v3/certs'
  };
  if (provider === 'apple' && config.appleClientId) return {
    clientId: config.appleClientId, issuers: ['https://appleid.apple.com'],
    keysUrl: 'https://appleid.apple.com/auth/keys'
  };
  throw new Error('Provider registration is not configured');
}

async function fetchProviderKeys(settings, fetchImpl, now) {
  const cached = jwksCache.get(settings.keysUrl);
  if (cached && cached.expires > now) return cached.keys;
  const response = await fetchImpl(settings.keysUrl, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Provider unavailable');
  const data = await response.json();
  if (!Array.isArray(data.keys) || data.keys.length > 20) throw new Error('Invalid provider keys');
  jwksCache.set(settings.keysUrl, { keys: data.keys, expires: now + 300000 });
  return data.keys;
}

/** Verify a provider proof before creating an admission. Never trust a decoded JWT alone. */
export async function verifyProviderProof(token, flow, config, { now = Date.now(), keys, fetchImpl = fetch } = {}) {
  const settings = providerSettings(flow.provider, config);
  if (typeof token !== 'string' || token.length > 16384) throw new Error('Invalid provider proof');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error('Invalid provider proof');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 || header.crit) throw new Error('Invalid provider proof');
  const providerKeys = keys || await fetchProviderKeys(settings, fetchImpl, now);
  const matching = providerKeys.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (matching.length !== 1) throw new Error('Invalid provider key');
  const key = createPublicKey({ key: matching[0], format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid provider signature');
  const seconds = Math.floor(now / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!settings.issuers.includes(claims.iss) || !audiences.includes(settings.clientId) ||
      (claims.azp && claims.azp !== settings.clientId) || (audiences.length > 1 && claims.azp !== settings.clientId) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
      !Number.isInteger(claims.exp) || claims.exp <= seconds ||
      !Number.isInteger(claims.iat) || claims.iat > seconds + 30 || claims.iat < seconds - FLOW_SECONDS - 30 ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > seconds + 30)) ||
      claims.nonce !== hash(flow.nonce)) throw new Error('Invalid provider claims');
  return { subject: claims.sub };
}
