import { evaluateEligibility } from './age-eligibility.js';
/** Independent email-consent age policy, separate from account product minimum.
 * No parental-consent pathway is implemented. Existing subscriptions are untouched.
 * EU thresholds are recorded in docs/eu-mailer-consent-policy-sources.md.
 */
const groups = {
  13: ['BE','EE','FI','LV','MT','PT','SE'],
  14: ['AT','BG','CY','ES','IT','LT'],
  15: ['CZ','DK','FR','GR','SI'],
  16: ['DE','HR','HU','IE','LU','NL','PL','RO','SK']
};
export const DEFAULT_MAILER_POLICIES = Object.freeze(Object.fromEntries([
  ['US',Object.freeze({minimumAge:13,version:'us-independent-13-v1'})],
  ...Object.entries(groups).flatMap(([age,countries]) => countries.map(country => [country,
    Object.freeze({minimumAge:Number(age),version:`eu-mailer-consent-${age}-v1`})]))
]));
export function getConfiguredMailerPolicies() {
  const raw = process.env.AGE_MAILER_POLICIES_JSON;
  if (!raw) return DEFAULT_MAILER_POLICIES;
  let overrides;
  try { overrides=JSON.parse(raw); } catch { throw new Error('Invalid mailer policy'); }
  if(!overrides||Array.isArray(overrides)||typeof overrides!=='object')throw new Error('Invalid mailer policy');
  for(const [country,policy] of Object.entries(overrides)) {
    const baseline=DEFAULT_MAILER_POLICIES[country];
    if(!baseline||!policy||policy.minimumAge!==baseline.minimumAge||typeof policy.version!=='string'||!/^[a-zA-Z0-9._-]{1,80}$/.test(policy.version))throw new Error('Invalid mailer policy');
  }
  return {...DEFAULT_MAILER_POLICIES,...overrides};
}
export function evaluateMailerEligibility(input) {
  const decision=evaluateEligibility({...input,policies:input?.policies||getConfiguredMailerPolicies()});
  if(decision.code==='policy_unavailable')return {...decision,error:'Independent daily email signup is not available for your country yet. Your SineDay account is separate.'};
  return decision;
}
