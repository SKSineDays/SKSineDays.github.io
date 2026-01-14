/**
 * Public configuration endpoint
 *
 * GET /api/config
 *
 * Returns safe public environment variables for client-side use.
 * NEVER expose secret keys or service role keys.
 */

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Return only PUBLIC configuration
  return res.status(200).json({
    ok: true,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    appUrl: process.env.APP_URL || 'https://sineday.app'
  });
}
