/** Server-owned independent-account policy. A declaration is not verified age.
 * No country inference, full DOB persistence, or worldwide US-policy fallback.
 */
export const DEFAULT_POLICIES = Object.freeze({
  US: Object.freeze({ minimumAge: 13, version: 'us-independent-13-v1' })
});

export function getConfiguredPolicies() {
  const raw = process.env.AGE_ELIGIBILITY_POLICIES_JSON;
  if (!raw) return DEFAULT_POLICIES;
  let policies;
  try { policies = JSON.parse(raw); } catch { throw new Error('Invalid age policy configuration'); }
  if (!policies || Array.isArray(policies) || typeof policies !== 'object') throw new Error('Invalid age policy configuration');
  for (const [country, policy] of Object.entries(policies)) {
    if (!/^[A-Z]{2}$/.test(country) || !policy || !Number.isInteger(policy.minimumAge) || policy.minimumAge < 13 || policy.minimumAge > 18 || typeof policy.version !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(policy.version)) throw new Error('Invalid age policy configuration');
  }
  // Stephen has approved US 13+; env configuration may not weaken or silently raise it.
  if (policies.US?.minimumAge !== 13) throw new Error('US independent signup policy must be 13');
  return policies;
}

export function evaluateEligibility({ birthdate, country, now = new Date(), policies = DEFAULT_POLICIES } = {}) {
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return { ok: false, code: 'country_required', error: 'Choose your country of residence.' };
  const policy = policies[country];
  if (!policy) return { ok: false, code: 'policy_unavailable', error: 'Independent signup is not configured for your country yet. Please contact support.' };
  const match = typeof birthdate === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  if (!match || !Number.isFinite(now.getTime())) return { ok: false, code: 'invalid_birthdate', error: 'Enter a valid birthdate.' };
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > now) return { ok: false, code: 'invalid_birthdate', error: 'Enter a valid birthdate that is not in the future.' };
  // Use the latest worldwide date boundary conservatively (UTC-12). A visitor
  // cannot move their birthday earlier by supplying a timezone. This can defer
  // eligibility by hours on the birthday; it never admits before the local date.
  const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  let age = cutoff.getUTCFullYear() - year;
  if (cutoff.getUTCMonth() + 1 < month || (cutoff.getUTCMonth() + 1 === month && cutoff.getUTCDate() < day)) age--;
  return { ok: true, eligible: age >= policy.minimumAge, country, minimumAge: policy.minimumAge, policyVersion: policy.version, ageBand: age < 13 ? 'under13' : age < 16 ? '13-15' : age < 18 ? '16-17' : 'adult' };
}

export function eligibilityFailure(decision) {
  return { ok: false, code: decision.code || 'age_ineligible', error: decision.error || 'You cannot sign up independently at this age. Please ask a parent or guardian to contact support.' };
}
