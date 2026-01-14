/**
 * Create Stripe Billing Portal Session
 *
 * POST /api/create-portal-session
 * Headers: Authorization: Bearer <access_token>
 *
 * Returns: { ok: true, url: 'https://billing.stripe.com/...' }
 *
 * This endpoint allows paid users to manage their subscription:
 * - Update payment method
 * - Cancel subscription
 * - View invoices
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * Authenticate user from Authorization header
 */
async function authenticateUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const accessToken = authHeader.substring(7);

  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration');
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

  // Verify the token and get user
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return { user, supabase };
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Authenticate user
    const { user } = await authenticateUser(req);
    console.log('Authenticated user:', user.id, user.email);

    // Initialize Supabase admin client to read subscriptions
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase service configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get Stripe customer ID from subscriptions table
    const { data: subscription, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (subError || !subscription?.stripe_customer_id) {
      console.error('No Stripe customer found for user:', user.id);
      return res.status(400).json({
        ok: false,
        error: 'No subscription found. Please upgrade to Premium first.'
      });
    }

    // Initialize Stripe
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.APP_URL || 'https://sineday.app';

    if (!stripeSecretKey) {
      console.error('Missing Stripe configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia'
    });

    // Create Billing Portal Session
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${appUrl}/dashboard.html`
    });

    console.log('Created Billing Portal session for customer:', subscription.stripe_customer_id);

    // Return the session URL
    return res.status(200).json({
      ok: true,
      url: session.url
    });

  } catch (error) {
    console.error('Create portal session error:', error);

    // Return appropriate error status
    if (error.message === 'Missing or invalid Authorization header' ||
        error.message === 'Invalid or expired token') {
      return res.status(401).json({
        ok: false,
        error: error.message
      });
    }

    return res.status(500).json({
      ok: false,
      error: 'Failed to create portal session'
    });
  }
}
