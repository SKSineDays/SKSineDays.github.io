import Stripe from 'stripe';
import { authenticateUser, getAdminClient } from './_lib/auth.js';

function normalizeStripeStatus(status) {
  if (status === 'past_due') return 'active';
  if (status === 'canceled') return 'inactive';
  return status;
}

function isUsableStatus(status) {
  return status === 'active' || status === 'trialing' || status === 'past_due' || status === 'unpaid' || status === 'incomplete';
}

function pickBestSubscription(subscriptions = []) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;

  const preferred = subscriptions.find((sub) =>
    sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
  );
  if (preferred) return preferred;

  return [...subscriptions].sort((a, b) => (b.created || 0) - (a.created || 0))[0];
}

async function upsertSubscriptionRow(admin, userId, stripeCustomerId, stripeSubscription) {
  const updateData = {
    user_id: userId,
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscription?.id || null,
    status: normalizeStripeStatus(stripeSubscription?.status || 'inactive'),
    updated_at: new Date().toISOString()
  };

  if (stripeSubscription?.current_period_end) {
    updateData.current_period_end = new Date(stripeSubscription.current_period_end * 1000).toISOString();
  }

  const { error } = await admin
    .from('subscriptions')
    .upsert(updateData, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`Failed to update subscription row: ${error.message}`);
  }

  return updateData;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { user } = await authenticateUser(req);

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({
        ok: false,
        error: 'Missing Stripe configuration'
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia'
    });

    const admin = getAdminClient();

    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const checkoutSessionId = body.checkout_session_id || null;

    const { data: existingRow, error: existingError } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to read current subscription state'
      });
    }

    let stripeCustomerId = existingRow?.stripe_customer_id || null;
    let stripeSubscription = null;

    // Path 1: most precise recovery via checkout session from success redirect
    if (checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ['subscription']
      });

      const sessionUserId =
        session?.metadata?.supabase_user_id ||
        session?.client_reference_id ||
        null;

      if (sessionUserId && sessionUserId !== user.id) {
        return res.status(403).json({
          ok: false,
          error: 'Checkout session does not belong to this user'
        });
      }

      stripeCustomerId = session.customer || stripeCustomerId || null;

      if (session.subscription && typeof session.subscription === 'object') {
        stripeSubscription = session.subscription;
      } else if (typeof session.subscription === 'string') {
        stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
      }
    }

    // Path 2: existing stored subscription id
    if (!stripeSubscription && existingRow?.stripe_subscription_id) {
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(existingRow.stripe_subscription_id);
      } catch (error) {
        console.warn('Failed to retrieve stored Stripe subscription ID:', error.message);
      }
    }

    // Path 3: existing stored customer id
    if (!stripeSubscription && stripeCustomerId) {
      const list = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'all',
        limit: 10
      });

      stripeSubscription = pickBestSubscription(list.data || []);
    }

    if (!stripeSubscription) {
      return res.status(404).json({
        ok: false,
        error: 'No Stripe subscription found for this account'
      });
    }

    const row = await upsertSubscriptionRow(admin, user.id, stripeCustomerId, stripeSubscription);

    return res.status(200).json({
      ok: true,
      subscription: {
        status: row.status,
        current_period_end: row.current_period_end || null,
        stripe_customer_id: row.stripe_customer_id,
        stripe_subscription_id: row.stripe_subscription_id
      },
      paid: row.status === 'active' || row.status === 'trialing'
    });

  } catch (error) {
    console.error('Sync subscription status error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Failed to sync subscription status'
    });
  }
}
