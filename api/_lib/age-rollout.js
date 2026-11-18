/** Database and application must agree. Missing/unreadable state never selects legacy. */
export async function mailerAgeEnabled(admin, env = process.env) {
  const expected = env.AGE_MAILER_ENFORCEMENT_READY === 'true';
  const { data, error } = await admin.rpc('mailer_age_enforcement_is_enabled');
  if (error || typeof data !== 'boolean' || data !== expected) {
    const failure = new Error('Email signup is temporarily unavailable. Please try again later.');
    failure.code = 'AGE_ROLLOUT_UNAVAILABLE';
    throw failure;
  }
  return expected;
}
