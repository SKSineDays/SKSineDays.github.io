/**
 * Stripe Webhook Handler
 *
 * POST /api/stripe-webhook
 *
 * This endpoint handles Stripe webhook events and updates the Supabase subscriptions table.
 *
 * CRITICAL: This endpoint requires raw body access for signature verification.
 * Vercel config in vercel.json should disable body parsing for this endpoint.
 *
 * Handled events:
 * - checkout.session.completed
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * Read raw body as buffer from request stream
 */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Get user ID from event metadata with fallbacks
 */
function getUserIdFromEvent(event) {
  const obj = event.data.object;

  // Priority 1: metadata.supabase_user_id
  if (obj.metadata?.supabase_user_id) {
    return obj.metadata.supabase_user_id;
  }

  // Priority 2: client_reference_id (for checkout sessions)
  if (obj.client_reference_id) {
    return obj.client_reference_id;
  }

  // Priority 3: customer metadata (requires separate lookup)
  // This will be handled in the main handler if needed
  return null;
}

/**
 * Find user by customer ID (fallback)
 */
async function findUserByCustomerId(supabase, customerId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.user_id;
}

/**
 * Handle checkout.session.completed
 */
async function handleCheckoutCompleted(supabase, event) {
  const session = event.data.object;
  const userId = getUserIdFromEvent(event);

  if (!userId) {
    console.error('No user ID found in checkout session:', session.id);
    return;
  }

  console.log('Checkout completed for user:', userId);

  // Update subscriptions table
  await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      status: 'active', // Will be updated by subscription events
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });
}

/**
 * Handle subscription events (created, updated, deleted)
 */
async function handleSubscriptionEvent(supabase, event) {
  const subscription = event.data.object;
  let userId = getUserIdFromEvent(event);

  // Fallback: find user by customer ID
  if (!userId && subscription.customer) {
    userId = await findUserByCustomerId(supabase, subscription.customer);
  }

  if (!userId) {
    console.error('No user ID found for subscription:', subscription.id);
    return;
  }

  console.log('Subscription event for user:', userId, 'status:', subscription.status);

  // Map Stripe status to our status
  // Stripe statuses: active, past_due, unpaid, canceled, incomplete, incomplete_expired, trialing
  let status = subscription.status;

  // Convert past_due to active (they're still subscribed, just payment failed)
  if (status === 'past_due') {
    status = 'active';
  }

  // Convert canceled to inactive
  if (status === 'canceled') {
    status = 'inactive';
  }

  // Update subscriptions table
  const updateData = {
    user_id: userId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    status: status,
    updated_at: new Date().toISOString()
  };

  // Add current_period_end if available
  if (subscription.current_period_end) {
    updateData.current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
  }

  await supabase
    .from('subscriptions')
    .upsert(updateData, {
      onConflict: 'user_id'
    });
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

  try {
    // Initialize Stripe
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecretKey || !webhookSecret) {
      console.error('Missing Stripe configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia'
    });

    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      console.error('Missing Stripe signature');
      return res.status(400).json({
        ok: false,
        error: 'Missing signature'
      });
    }

    // Verify webhook signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({
        ok: false,
        error: 'Invalid signature'
      });
    }

    console.log('Received webhook event:', event.type, 'id:', event.id);

    // Initialize Supabase admin client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(supabase, event);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(supabase, event);
        break;

      default:
        console.log('Unhandled event type:', event.type);
    }

    // Return 200 to acknowledge receipt
    return res.status(200).json({
      ok: true,
      received: true
    });

  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Webhook handler failed'
    });
  }
}
