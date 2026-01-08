/**
 * Vercel serverless function for health check and environment verification
 *
 * GET /api/health
 *
 * Returns:
 * - Environment variable status (without exposing secrets)
 * - Supabase connection status
 * - Resend configuration status
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Main handler
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

  try {
    // Check environment variables (without exposing values)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM;

    const envStatus = {
      SUPABASE_URL: !!supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!supabaseServiceKey,
      RESEND_API_KEY: !!resendApiKey,
      RESEND_FROM: !!resendFrom
    };

    // Test Supabase connection
    let supabaseOk = false;
    let supabaseError = null;

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });

        // Simple query to test connection
        const { data, error } = await supabase
          .from('subscribers')
          .select('id')
          .limit(1);

        if (error) {
          supabaseError = error.message;
          supabaseOk = false;
        } else {
          supabaseOk = true;
        }
      } catch (err) {
        supabaseError = err.message;
        supabaseOk = false;
      }
    }

    // Check Resend configuration (don't test sending, just check env vars)
    const resendOk = !!(resendApiKey && resendFrom);

    // Overall health status
    const allOk = supabaseOk && envStatus.SUPABASE_URL && envStatus.SUPABASE_SERVICE_ROLE_KEY;

    return res.status(200).json({
      ok: allOk,
      timestamp: new Date().toISOString(),
      env: envStatus,
      supabase: supabaseOk,
      supabaseError: supabaseError,
      resend: resendOk
    });

  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Health check failed',
      message: error.message
    });
  }
}
