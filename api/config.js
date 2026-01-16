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

  // Prevent caching to ensure fresh config is always fetched
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Runtime guards: ensure required environment variables are present
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    console.error('CRITICAL: SUPABASE_URL environment variable is missing');
    return res.status(500).json({
      ok: false,
      error: 'Server configuration error: SUPABASE_URL is not set'
    });
  }

  if (!supabaseAnonKey) {
    console.error('CRITICAL: SUPABASE_ANON_KEY environment variable is missing');
    return res.status(500).json({
      ok: false,
      error: 'Server configuration error: SUPABASE_ANON_KEY is not set'
    });
  }

  // Return only PUBLIC configuration
  return res.status(200).json({
    ok: true,
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    appUrl: process.env.APP_URL || 'https://sineday.app'
  });
}
