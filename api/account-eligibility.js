import { getAdminClient } from './_lib/auth.js';
import { evaluateEligibility, getConfiguredPolicies, eligibilityFailure } from './_lib/age-eligibility.js';
import { parseRegistrationBody, requireSameOrigin, registrationOrigin } from './_lib/account-registration.js';

const FIELDS = 'country,policy_version,minimum_age,age_band,status';
const REVIEW_MESSAGE = 'This account needs an eligibility review. Please ask a parent or guardian to contact support if needed. Your existing account and saved information have not been deleted.';

/** Only server-owned decisions count. Missing/stale/unknown evidence never grants access. */
export function describeEligibility(row, policies) {
  if (!row) return { ok: true, state: 'required' };
  const policy = policies[row.country];
  if (row.status !== 'eligible' || !policy || row.policy_version !== policy.version || row.minimum_age !== policy.minimumAge ||
      !['13-15', '16-17', 'adult'].includes(row.age_band)) {
    return { ok: true, state: 'review_required', message: REVIEW_MESSAGE };
  }
  return { ok: true, state: 'eligible' };
}

/**
 * Staged owner migration endpoint. Does not sign out, suspend, delete or stop email.
 * Requires immutable record_account_eligibility_decision RPC before deployment.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Authorization');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length <= 7 || authorization.length > 16384) {
    return res.status(401).json({ ok: false, error: 'Please sign in again.' });
  }
  let admin, user, policies;
  try { admin = getAdminClient(); policies = getConfiguredPolicies(); } catch {
    return res.status(503).json({ ok: false, error: 'Eligibility checks are temporarily unavailable.' });
  }
  try {
    const { data, error } = await admin.auth.getUser(authorization.slice(7));
    if (error || !data?.user?.id) return res.status(401).json({ ok: false, error: 'Please sign in again.' });
    user = data.user;
  } catch {
    return res.status(401).json({ ok: false, error: 'Please sign in again.' });
  }
  try {
    // Account ID comes exclusively from verified Auth, never the submitted body.
    const { data: saved, error } = await admin.from('account_eligibility').select(FIELDS).eq('user_id', user.id).maybeSingle();
    if (error) throw new Error('Eligibility unavailable');
    const state = describeEligibility(saved, policies);
    if (req.method === 'GET') return res.status(200).json(state);
    try {
      requireSameOrigin(req, registrationOrigin());
    } catch {
      return res.status(400).json({ ok: false, error: 'Unable to process this request.' });
    }
    // A recheck/correction must not silently replace a recorded result. In particular,
    // an underage result remains review_required across retries, devices and sessions.
    if (saved) return res.status(409).json({ ...state, ok: false, code: 'eligibility_already_recorded',
      error: state.state === 'eligible' ? 'Eligibility was already recorded. Contact support to correct it.' : REVIEW_MESSAGE });
    let body;
    try { body = parseRegistrationBody(req.body); } catch {
      return res.status(400).json({ ok: false, error: 'Unable to process this request.' });
    }
    const decision = evaluateEligibility({ birthdate: body.birthdate, country: body.country, policies });
    body.birthdate = '';
    if (!decision.ok) return res.status(400).json(eligibilityFailure(decision));
    // Both eligible and ineligible valid declarations are recorded atomically. A
    // simple read/insert or upsert cannot protect against racing opposite answers.
    const { data: recorded, error: writeError } = await admin.rpc('record_account_eligibility_decision', {
      p_user_id: user.id, p_country: decision.country, p_policy_version: decision.policyVersion,
      p_minimum_age: decision.minimumAge, p_age_band: decision.ageBand, p_eligible: decision.eligible
    });
    if (writeError) throw new Error('Eligibility unavailable');
    const row = Array.isArray(recorded) ? recorded[0] : recorded;
    if (!row) throw new Error('Eligibility unavailable');
    const finalState = describeEligibility(row, policies);
    return res.status(finalState.state === 'eligible' ? 200 : 403).json(finalState);
  } catch {
    // No DOB, token, profile content, email or raw provider/database errors in logs.
    return res.status(503).json({ ok: false, error: 'Eligibility could not be confirmed. Please try again later.' });
  }
}
