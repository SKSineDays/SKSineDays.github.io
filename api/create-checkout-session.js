/**
 * Create Stripe Checkout Session for subscription
 *
 * POST /api/create-checkout-session
 * Headers: Authorization: Bearer <access_token>
 *
 * Returns: { ok: true, url: 'https://checkout.stripe.com/...' }
 *
 * This endpoint:
 * 1. Authenticates the user via Supabase
 * 2. Retrieves or creates a Stripe customer
 * 3. Creates a Checkout session for subscription
 * 4. Returns the URL to redirect the user to Stripe
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
 * Get or create Stripe customer ID
 */
async function getOrCreateStripeCustomer(stripe, supabaseAdmin, user) {
  // Check if customer ID already exists in subscriptions table
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (subscription?.stripe_customer_id) {
    console.log('Reusing existing Stripe customer:', subscription.stripe_customer_id);
    return subscription.stripe_customer_id;
  }

  // Create new Stripe customer
  console.log('Creating new Stripe customer for user:', user.id);
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: {
      supabase_user_id: user.id
    }
  });

  // Save customer ID to subscriptions table
  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: user.id,
      stripe_customer_id: customer.id,
      status: 'inactive',
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });

  console.log('Created Stripe customer:', customer.id);
  return customer.id;
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
    const { user, supabase } = await authenticateUser(req);
    console.log('Authenticated user:', user.id, user.email);

    // Initialize Stripe
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const stripePriceId = process.env.STRIPE_PRICE_ID;
    const appUrl = process.env.APP_URL || 'https://sineday.app';

    if (!stripeSecretKey || !stripePriceId) {
      console.error('Missing Stripe configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia'
    });

    // Initialize Supabase admin client for writing to subscriptions
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

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(stripe, supabaseAdmin, user);

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1
        }
      ],
      success_url: `${appUrl}/dashboard.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard.html?checkout=cancel`,
      metadata: {
        supabase_user_id: user.id
      }
    });

    console.log('Created Checkout session:', session.id);

    // Return the session URL
    return res.status(200).json({
      ok: true,
      url: session.url
    });

  } catch (error) {
    console.error('Create checkout session error:', error);

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
      error: 'Failed to create checkout session'
    });
  }
}
