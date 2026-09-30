import { getAdminClient } from '../_lib/auth.js';
import { authenticateGlobeUser } from '../_lib/globe-auth.js';

// No shared cache: every request authenticates, then performs one bounded GROUP BY.
// The browser keeps a five-minute snapshot only while signed in.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try { await authenticateGlobeUser(req); }
  catch (error) { return res.status(error.code === 'GLOBE_AUTH_TIMEOUT' ? 503 : 401).json({ error: 'Authentication required or unavailable' }); }
  try {
    const { data, error } = await getAdminClient().rpc('globe_region_counts').abortSignal(AbortSignal.timeout(5000));
    if (error) throw error;
    const groups = (data || []).map(row => ({ regionKey: row.region_key, count: Number(row.member_count) }));
    if (groups.length > 249 || groups.some(group => !Number.isSafeInteger(group.count) || group.count < 1)) throw new Error('Invalid aggregate');
    return res.status(200).json({ groups, generatedAt: new Date().toISOString(), precision: 'region', participation: 'opt-in' });
  } catch { return res.status(503).json({ error: 'Member lights are temporarily unavailable' }); }
}
