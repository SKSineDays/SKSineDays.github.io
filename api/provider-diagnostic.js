// No database/Auth SDK, mailer, payments, analytics or identity persistence.
import { hash, parseRegistrationBody, providerSettings, requireSameOrigin, verifyProviderProof } from './_lib/account-registration.js';
import { createDiagnosticFlow, diagnosticConfig, diagnosticCookie, encodeDiagnosticFlow, readDiagnosticFlow } from './_lib/provider-diagnostic.js';

// Bounded instance-local abuse/replay guard only. It stores no IP, identity or token.
// A protected preview and platform rate limiting remain deployment requirements.
let windowStart = 0, requests = 0;
const usedNonces = new Map();
function withinBudget(now) {
  if (now - windowStart >= 60000) { windowStart = now; requests = 0; }
  return ++requests <= 60;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  let config;
  const fail = (status, provider = null) => res.status(status).json({ ok: false, passed: false, provider });
  try { config = diagnosticConfig(); } catch { return fail(404); }
  if (req.method !== 'POST') return fail(405);
  let body;
  try { requireSameOrigin(req, config.origin); body = parseRegistrationBody(req.body); } catch { return fail(400); }
  let token = body.action === 'complete' ? body.token : undefined;
  body.token = '';
  if (body.action === 'cancel') {
    res.setHeader('Set-Cookie', diagnosticCookie('', 0));
    return res.status(200).json({ ok: true, passed: false, provider: null });
  }
  const now = Date.now();
  if (!withinBudget(now)) {
    token = '';
    res.setHeader('Set-Cookie', diagnosticCookie('', 0));
    res.setHeader('Retry-After', '60');
    return fail(429);
  }
  if (body.action === 'begin') {
    res.setHeader('Set-Cookie', diagnosticCookie('', 0));
    if (!['google','apple'].includes(body.provider)) return fail(400);
    try {
      const settings = providerSettings(body.provider, config);
      const flow = createDiagnosticFlow(body.provider, now);
      res.setHeader('Set-Cookie', diagnosticCookie(encodeDiagnosticFlow(flow, config.secret)));
      return res.status(200).json({ ok: true, provider: flow.provider, clientId: settings.clientId,
        nonce: hash(flow.nonce), state: flow.state, redirectUri: config.redirectUri });
    } catch { return fail(400, body.provider); }
  }
  // Every attempt consumes the browser cookie. No token/subject/claims in output.
  res.setHeader('Set-Cookie', diagnosticCookie('', 0));
  if (body.action !== 'complete') return fail(400);
  let flow;
  try {
    flow = readDiagnosticFlow(req.headers.cookie, config.secret, now);
    if (body.provider !== flow.provider || body.state !== flow.state) throw new Error('Invalid state');
    for (const [key, expires] of usedNonces) if (expires <= now) usedNonces.delete(key);
    const nonceKey = hash(flow.nonce);
    if (usedNonces.has(nonceKey) || usedNonces.size >= 500) throw new Error('Replay');
    usedNonces.set(nonceKey, flow.expires);
    await verifyProviderProof(token, flow, config, { now });
    return res.status(200).json({ ok: true, passed: true, provider: flow.provider });
  } catch { return fail(400, flow?.provider || null); }
  finally { token = ''; }
}
