import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const DIAGNOSTIC_COOKIE = '__Host-sineday-provider-diagnostic';
export const DIAGNOSTIC_SECONDS = 180;
export function diagnosticConfig(env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || env.PROVIDER_DIAGNOSTIC_ENABLED !== 'true') throw new Error('Disabled');
  const url = new URL(env.PROVIDER_DIAGNOSTIC_APP_URL);
  if (!url.hostname.endsWith('.vercel.app')) throw new Error('Preview hostname required');
  if (['sineday.app', 'www.sineday.app', 'sineday.vercel.app'].includes(url.hostname)) throw new Error('Production origin forbidden');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin');
  const secret = env.PROVIDER_DIAGNOSTIC_SECRET;
  if (!secret || secret.length < 32 || secret === env.SIGNUP_ADMISSION_SECRET) throw new Error('Dedicated secret required');
  return { origin: url.origin, secret, googleClientId: env.PROVIDER_DIAGNOSTIC_GOOGLE_CLIENT_ID || '',
    appleClientId: env.PROVIDER_DIAGNOSTIC_APPLE_CLIENT_ID || '', redirectUri: new URL('/provider-diagnostic.html', url.origin).href };
}
export function createDiagnosticFlow(provider, now = Date.now()) {
  return { purpose: 'provider-diagnostic-v1', provider, nonce: randomBytes(32).toString('hex'),
    state: randomBytes(32).toString('hex'), expires: now + DIAGNOSTIC_SECONDS * 1000 };
}
export function encodeDiagnosticFlow(flow, secret) {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function diagnosticCookie(value = '', seconds = DIAGNOSTIC_SECONDS) {
  return `${DIAGNOSTIC_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
}
export function readDiagnosticFlow(cookie, secret, now = Date.now()) {
  const matches = String(cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${DIAGNOSTIC_COOKIE}=`));
  if (matches.length !== 1 || matches[0].length > 2048) throw new Error('Invalid cookie');
  const [payload, signature, extra] = matches[0].slice(DIAGNOSTIC_COOKIE.length + 1).split('.');
  if (!payload || !signature || extra) throw new Error('Invalid cookie');
  const actual = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
  const flow = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (flow.purpose !== 'provider-diagnostic-v1' || !['google','apple'].includes(flow.provider) ||
      !/^[a-f0-9]{64}$/.test(flow.nonce || '') || !/^[a-f0-9]{64}$/.test(flow.state || '') ||
      !Number.isInteger(flow.expires) || flow.expires <= now || flow.expires > now + DIAGNOSTIC_SECONDS * 1000) throw new Error('Invalid flow');
  return flow;
}
