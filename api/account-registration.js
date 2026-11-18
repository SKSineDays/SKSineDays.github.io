import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from './_lib/auth.js';
import { evaluateEligibility, getConfiguredPolicies } from './_lib/age-eligibility.js';
import { createFlow, flowCookie, hash, parseRegistrationBody, providerSettings, readFlow,
  registrationConfig, requireSameOrigin, signFlow, verifyProviderProof } from './_lib/account-registration.js';

/** No live activation until the admission hook + insert trigger are installed and verified. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let config;
  try { config = registrationConfig(); } catch {
    return res.status(503).json({ ok: false, error: 'New account registration is temporarily unavailable. Existing members can still sign in.' });
  }
  let body;
  try { requireSameOrigin(req, config.origin); body = parseRegistrationBody(req.body); } catch {
    return res.status(400).json({ ok: false, error: 'Unable to process registration.' });
  }
  if (body.action === 'cancel') {
    res.setHeader('Set-Cookie', flowCookie('', 0));
    return res.status(200).json({ ok: true });
  }
  // Environment readiness alone is not activation. The database admission switch
  // must also be on before starting or completing this new flow. Staged migration
  // installs leave old signup paths untouched and this endpoint unavailable.
  let admin;
  try {
    admin = getAdminClient();
    const { data: enabled, error } = await admin.rpc('account_signup_enforcement_is_enabled');
    if (error || enabled !== true) throw new Error('Admission not activated');
  } catch {
    res.setHeader('Set-Cookie', flowCookie('', 0));
    return res.status(503).json({ ok: false, error: 'New account registration is temporarily unavailable. Existing members can still sign in.' });
  }
  if (body.action === 'begin') {
    // Clear stale admission even when the new screening fails.
    res.setHeader('Set-Cookie', flowCookie('', 0));
    if (!['google', 'apple', 'email'].includes(body.provider)) return res.status(400).json({ ok: false, error: 'Choose a sign-up method.' });
    let result;
    try { result = evaluateEligibility({ birthdate: body.birthdate, country: body.country, policies: getConfiguredPolicies() }); }
    catch { return res.status(503).json({ ok: false, error: 'Registration is temporarily unavailable.' }); }
    body.birthdate = '';
    if (!result.ok || !result.eligible) return res.status(403).json({ ok: false, code: result.code || 'not_eligible',
      error: result.ok ? 'An independent account is not available for the information provided. Please ask a parent or guardian to contact support.' : result.error });
    let settings;
    if (body.provider !== 'email') {
      try { settings = providerSettings(body.provider, config); } catch {
        return res.status(503).json({ ok: false, error: 'This sign-up method is temporarily unavailable.' });
      }
    }
    const flow = createFlow(body.provider, result);
    res.setHeader('Set-Cookie', flowCookie(signFlow(flow, config.secret)));
    return res.status(200).json({ ok: true, provider: flow.provider, nonce: hash(flow.nonce),
      clientId: settings?.clientId, redirectUri: flow.provider === 'apple' ? config.appleRedirectUri : undefined });
  }
  if (body.action !== 'complete') return res.status(400).json({ ok: false, error: 'Invalid action.' });
  let flow;
  try { flow = readFlow(req.headers.cookie, config.secret); } catch {
    return res.status(403).json({ ok: false, error: 'Please start account registration again.' });
  }
  // End the browser transaction on any completion attempt. DB uniqueness additionally
  // prevents replay of a captured signed cookie. Existing accounts are never modified.
  res.setHeader('Set-Cookie', flowCookie('', 0));
  try {
    // An operator may withdraw a regional policy while a signup is in flight.
    const currentPolicy = getConfiguredPolicies()[flow.eligibility.country];
    if (!currentPolicy || currentPolicy.version !== flow.eligibility.policyVersion || currentPolicy.minimumAge !== flow.eligibility.minimumAge) throw new Error('Policy changed');
    let subject;
    if (flow.provider === 'email') {
      subject = String(body.email || '').trim().toLowerCase();
      if (subject.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) throw new Error('Invalid email');
    } else {
      ({ subject } = await verifyProviderProof(body.token, flow, config));
    }
    const { error: grantError } = await admin.rpc('issue_account_admission', {
      p_provider: flow.provider, p_subject: subject, p_flow_hash: hash(flow.id),
      p_country: flow.eligibility.country, p_policy_version: flow.eligibility.policyVersion,
      p_minimum_age: flow.eligibility.minimumAge, p_age_band: flow.eligibility.ageBand
    });
    if (grantError?.message === 'signup_rate_limited') {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ ok: false, error: 'Too many registration attempts. Please try again later.' });
    }
    if (grantError) throw new Error('Admission unavailable');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error('Auth unavailable');
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    if (flow.provider === 'email') {
      const { error } = await client.auth.signInWithOtp({ email: subject, options: {
        shouldCreateUser: true, emailRedirectTo: new URL('/auth/callback.html', config.origin).href,
        data: { signup_admission_token: flow.id }
      } });
      if (error) throw new Error('Auth unavailable');
      return res.status(200).json({ ok: true, emailSent: true });
    }
    const { data, error } = await client.auth.signInWithIdToken({ provider: flow.provider, token: body.token, nonce: flow.nonce });
    if (error || !data?.session?.access_token || !data?.session?.refresh_token) throw new Error('Auth unavailable');
    return res.status(200).json({ ok: true, session: {
      access_token: data.session.access_token, refresh_token: data.session.refresh_token
    } });
  } catch {
    // Never log DOB, provider proofs, cookies, emails, admission secrets or sessions.
    return res.status(400).json({ ok: false, error: 'Registration could not be completed. Please start again, or use Sign in if you already have an account.' });
  }
}
