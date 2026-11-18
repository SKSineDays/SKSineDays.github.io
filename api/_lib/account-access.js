import { getConfiguredPolicies } from './age-eligibility.js';

/** Privileged API boundary; never authorize from user_metadata or client flags. */
export async function requireAccountEligibility(admin, userId) {
  // Coordinated rollout interlock. Draft must not be activated until RLS/RPC/storage
  // enforcement and hosted tests are complete. Not a claim of protection while off.
  if (process.env.AGE_EXISTING_ENFORCEMENT_READY !== 'true') return;
  const { data: row, error } = await admin.from('account_eligibility')
    .select('country,policy_version,minimum_age,age_band,status').eq('user_id', userId).maybeSingle();
  const policy = row && getConfiguredPolicies()[row.country];
  if (error || row?.status !== 'eligible' || !policy || policy.version !== row.policy_version ||
      policy.minimumAge !== row.minimum_age || !['13-15','16-17','adult'].includes(row.age_band)) {
    const failure = new Error('Account eligibility review required. Contact support@sineday.app.');
    failure.code = 'ACCOUNT_ELIGIBILITY_REQUIRED'; failure.status = 403;
    throw failure;
  }
}
