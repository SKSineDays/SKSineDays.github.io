/**
 * Debug endpoint to verify user authentication
 *
 * GET /api/whoami
 * Headers: Authorization: Bearer <access_token>
 *
 * Returns: { user_id, email }
 */

import { createClient } from '@supabase/supabase-js';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'Missing or invalid Authorization header'
      });
    }

    const accessToken = authHeader.substring(7);

    // Initialize Supabase client with anon key
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase environment variables');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    });

    // Get the user
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired token'
      });
    }

    // Return user info
    return res.status(200).json({
      ok: true,
      user_id: user.id,
      email: user.email
    });

  } catch (error) {
    console.error('Whoami error:', error);
    return res.status(500).json({
      ok: false,
      error: 'An unexpected error occurred'
    });
  }
}
