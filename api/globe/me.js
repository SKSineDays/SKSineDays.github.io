import { authenticateGlobeUser } from '../_lib/globe-auth.js';
import { GLOBE_CONSENT_VERSION, GLOBE_REGION_BY_KEY } from '../../shared/globe-regions.js';

function membership(row) {
  return row ? { enabled: row.enabled, regionKey: row.region_key, consentVersion: row.consent_version }
    : { enabled: false, regionKey: null, consentVersion: null };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let auth;
  try { auth = await authenticateGlobeUser(req); }
  catch (error) { return res.status(error.code === 'GLOBE_AUTH_TIMEOUT' ? 503 : 401).json({ error: 'Authentication required or unavailable' }); }
  const { user, supabase } = auth;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('globe_memberships')
        .select('enabled,region_key,consent_version').eq('user_id', user.id)
        .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (error) throw error;
      return res.status(200).json({ membership: membership(data) });
    }
    if (req.method === 'DELETE') {
      const { error } = await supabase.from('globe_memberships').delete().eq('user_id', user.id)
        .abortSignal(AbortSignal.timeout(5000));
      if (error) throw error;
      return res.status(200).json({ membership: membership(null) });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['enabled','regionKey','consentVersion'].includes(key)) ||
        body.enabled !== true || !GLOBE_REGION_BY_KEY.has(body.regionKey) || body.consentVersion !== GLOBE_CONSENT_VERSION) {
      return res.status(400).json({ error: 'Choose a valid region and explicitly agree to show your light' });
    }
    // Request identity and database RLS both enforce ownership. Database records consent time.
    const { data, error } = await supabase.from('globe_memberships').upsert({
      user_id: user.id, enabled: true, region_key: body.regionKey, consent_version: GLOBE_CONSENT_VERSION
    }, { onConflict: 'user_id' }).select('enabled,region_key,consent_version')
      .abortSignal(AbortSignal.timeout(5000)).single();
    if (error) throw error;
    return res.status(200).json({ membership: membership(data) });
  } catch { return res.status(503).json({ error: 'Your light could not be loaded or saved' }); }
}
