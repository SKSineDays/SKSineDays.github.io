import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from './_lib/auth.js';
import { evaluateEligibility, getConfiguredPolicies } from './_lib/age-eligibility.js';
import { createFlow, flowCookie, hash, parseRegistrationBody, readFlow, registrationOrigin,
  requireSameOrigin, signFlow } from './_lib/account-registration.js';

const COOKIE = '__Host-sineday-signup-canary';
const first = data => Array.isArray(data) ? data[0] : data;
const cookie = (value = '', age = 0) => flowCookie(value, age, COOKIE);
/** Explicitly scoped EMAIL-only operator canary. Never switches global enforcement. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  if (process.env.SIGNUP_CANARY_ENABLED !== 'true') return res.status(404).json({ok:false,error:'Not found'});
  let origin, body;
  const secret = process.env.SIGNUP_CANARY_SECRET;
  try {
    origin = registrationOrigin();
    if (!secret || secret.length < 32 || secret === process.env.SIGNUP_ADMISSION_SECRET) throw new Error();
  } catch { return res.status(503).json({ok:false,error:'The signup test is not configured.'}); }
  try { requireSameOrigin(req, origin); body = parseRegistrationBody(req.body); }
  catch { return res.status(400).json({ok:false,error:'Invalid test request.'}); }
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 16384) {
    return res.status(401).json({ok:false,error:'Sign in to the authorized operator account first.'});
  }
  let admin, operator, scope;
  try {
    admin = getAdminClient();
    const {data, error} = await admin.auth.getUser(authorization.slice(7));
    if (error || !data?.user?.id) return res.status(401).json({ok:false,error:'Please sign in again.'});
    operator = data.user.id;
    const result = await admin.rpc('get_signup_canary', {p_operator_id:operator});
    scope = first(result.data);
    if (result.error || !scope?.canary_id || !scope.target_email || Date.parse(scope.expires_at) <= Date.now() || !Number.isFinite(Date.parse(scope.expires_at))) throw new Error();
  } catch { return res.status(403).json({ok:false,error:'No active signup test is available for this account.'}); }
  if (body.action === 'cancel') {
    res.setHeader('Set-Cookie',cookie());
    return res.status(200).json({ok:true});
  }
  if (body.action === 'status') return res.status(200).json({ok:true,targetEmail:scope.target_email});
  if (body.action === 'begin') {
    res.setHeader('Set-Cookie',cookie());
    if (body.provider && body.provider !== 'email') return res.status(400).json({ok:false,error:'This test supports email only.'});
    let decision;
    try { decision = evaluateEligibility({birthdate:body.birthdate,country:body.country,policies:{US:getConfiguredPolicies().US}}); }
    catch { return res.status(503).json({ok:false,error:'Eligibility is unavailable.'}); }
    finally { body.birthdate = ''; }
    if (!decision.ok || !decision.eligible) return res.status(403).json({ok:false,error:'An independent account is not available for the information provided.'});
    const flow = {...createFlow('email',decision),purpose:'email-signup-canary',operator,canaryId:scope.canary_id,targetHash:hash(scope.target_email)};
    flow.expires = Math.min(flow.expires, Date.parse(scope.expires_at));
    res.setHeader('Set-Cookie',cookie(signFlow(flow,secret),Math.max(1,Math.floor((flow.expires-Date.now())/1000))));
    return res.status(200).json({ok:true,targetEmail:scope.target_email});
  }
  if (body.action !== 'complete') return res.status(400).json({ok:false,error:'Invalid action.'});
  res.setHeader('Set-Cookie',cookie());
  try {
    const flow = readFlow(req.headers.cookie,secret,Date.now(),COOKIE);
    if (flow.purpose !== 'email-signup-canary' || flow.provider !== 'email' || flow.operator !== operator ||
      flow.canaryId !== scope.canary_id || flow.targetHash !== hash(scope.target_email)) throw new Error();
    const policy = getConfiguredPolicies()[flow.eligibility.country];
    if (!policy || policy.version !== flow.eligibility.policyVersion || policy.minimumAge !== flow.eligibility.minimumAge) throw new Error();
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error();
    const {data: admittedEmail, error} = await admin.rpc('issue_signup_canary_admission',{
      p_operator_id:operator,p_canary_id:scope.canary_id,p_flow_hash:hash(flow.id),
      p_country:flow.eligibility.country,p_policy_version:flow.eligibility.policyVersion,
      p_minimum_age:flow.eligibility.minimumAge,p_age_band:flow.eligibility.ageBand
    });
    if (error || typeof admittedEmail !== 'string' || hash(admittedEmail) !== flow.targetHash) throw new Error();
    const client = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const sent = await client.auth.signInWithOtp({email:admittedEmail,options:{shouldCreateUser:true,
      emailRedirectTo:new URL('/auth/callback.html',origin).href,data:{signup_admission_token:flow.id}}});
    if (sent.error) throw new Error();
    return res.status(200).json({ok:true,emailSent:true});
  } catch {
    // A grant/account/send may already exist. Never silently retry or delete it.
    return res.status(409).json({ok:false,error:'The test could not be confirmed. Do not retry automatically. Check the test state with support; an account or email may already exist.'});
  }
}
