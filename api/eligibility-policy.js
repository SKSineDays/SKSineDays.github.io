import { getConfiguredPolicies } from './_lib/age-eligibility.js';

// Public policy availability only. Does not grant admission or expose private DOBs.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const countries = Object.keys(getConfiguredPolicies()).map(code => ({ code, name: names.of(code) || code }));
    return res.status(200).json({ ok: true, countries });
  } catch {
    return res.status(503).json({ ok: false, error: 'Registration policy is temporarily unavailable.' });
  }
}
