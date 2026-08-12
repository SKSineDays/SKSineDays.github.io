/**
 * GET  /api/email-status  — returns subscriber active status for the authed user
 * PATCH /api/email-status  — sets status to 'unsubscribed' for the authed user
 * Headers: Authorization: Bearer <access_token>
 *
 * GET never returns raw birthdate, auth metadata, or subscriber UUIDs.
 * Unsubscribing does not delete subscriber_profile or the locked email rhythm.
 */

import { createClient } from '@supabase/supabase-js';
import { buildEmailStatusPayload } from './_lib/email-rhythm.js';

async function getAuthedEmail(req, serviceClient) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const { data: { user }, error } = await serviceClient.auth.getUser(token);
  if (error || !user) return null;
  return user.email?.toLowerCase().trim() ?? null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const email = await getAuthedEmail(req, serviceClient);
  if (!email) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { data: subscriber, error } = await serviceClient
        .from('subscribers')
        .select('id, status')
        .eq('email', email)
        .maybeSingle();

      if (error) throw error;

      if (!subscriber) {
        return res.status(200).json(buildEmailStatusPayload(null, null));
      }

      const { data: profile, error: profileError } = await serviceClient
        .from('subscriber_profile')
        .select('birth_day_of_year, origin_day')
        .eq('subscriber_id', subscriber.id)
        .maybeSingle();

      if (profileError) throw profileError;

      return res.status(200).json(buildEmailStatusPayload(subscriber, profile));
    }

    if (req.method === 'PATCH') {
      const { error } = await serviceClient
        .from('subscribers')
        .update({ status: 'unsubscribed' })
        .eq('email', email);

      if (error) throw error;

      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error('[email-status] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
