/**
 * Stripe Webhook Handler
 *
 * POST /api/stripe/webhook
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

export const runtime = "nodejs";

import { getAdminClient } from "../_lib/auth.js";
import {
  getStripeObjectId,
  isAffiliateProgramEnabled,
  isEligiblePremiumInvoice,
  unixSecondsToIso,
} from "../_lib/affiliate.js";
import {
  recordAffiliateAttributionFromPromotion,
  recoverAffiliateAttributionFromInvoice,
  retrieveCheckoutPromotionCodeIds,
} from "../_lib/affiliate-server.js";
import { getStripeClient } from "../_lib/stripe.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../_lib/webhook.js";

/**
 * Read raw body as text from request stream
 * Provides req.text() compatibility for Vercel serverless functions
 */
async function readRequestBodyAsText(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.toString('utf8'));
    });
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
async function handleCheckoutCompleted(supabase, stripe, event) {
  const session = event.data.object;
  const userId = getUserIdFromEvent(event);

  if (!userId) {
    console.error('No user ID found in checkout session:', session.id);
    return;
  }

  console.log('Checkout completed for user:', userId);

  // Update subscriptions table
  const { error } = await supabase
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
  if (error) throw new Error('Failed to synchronize checkout subscription');

  if (!isAffiliateProgramEnabled()) return;

  const promotionCodeIds = await retrieveCheckoutPromotionCodeIds(stripe, session);
  await recordAffiliateAttributionFromPromotion({
    supabaseAdmin: supabase,
    subscriberUserId: userId,
    promotionCodeIds,
    source: "checkout",
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

  const { error } = await supabase
    .from('subscriptions')
    .upsert(updateData, {
      onConflict: 'user_id'
    });
  if (error) throw new Error('Failed to synchronize subscription');
}

async function findUserForInvoice(supabase, invoice) {
  const customerId = getStripeObjectId(invoice.customer);
  const subscriptionId = getStripeObjectId(invoice.subscription);

  let query = supabase
    .from("subscriptions")
    .select("user_id");
  if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Failed to resolve invoice owner");
  return data?.user_id || null;
}

async function handleInvoicePaid(supabase, stripe, event) {
  const invoice = event.data.object;
  const premiumPriceId = process.env.STRIPE_PRICE_ID;
  if (!premiumPriceId) throw new Error("Missing Premium price configuration");
  if (!isEligiblePremiumInvoice(invoice, premiumPriceId)) return;

  const userId = await findUserForInvoice(supabase, invoice);
  const subscriptionId = getStripeObjectId(invoice.subscription);
  if (!userId || !subscriptionId) return;

  if (isAffiliateProgramEnabled()) {
    await recoverAffiliateAttributionFromInvoice({
      stripe,
      supabaseAdmin: supabase,
      invoice,
      userId,
    });
  }

  const paidAt = invoice.status_transitions?.paid_at || event.created;
  const { error } = await supabase.rpc("record_affiliate_commission", {
    p_subscriber_user_id: userId,
    p_stripe_invoice_id: invoice.id,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_event_id: event.id,
    p_paid_at: unixSecondsToIso(paidAt),
    p_billing_period_start: unixSecondsToIso(invoice.period_start),
    p_billing_period_end: unixSecondsToIso(invoice.period_end),
  });
  if (error) throw new Error("Failed to record affiliate commission");
}

async function resolveInvoiceIdFromCharge(stripe, charge) {
  const directInvoiceId = getStripeObjectId(charge.invoice);
  if (directInvoiceId) return directInvoiceId;

  const paymentIntentId = getStripeObjectId(charge.payment_intent);
  if (!paymentIntentId) return null;
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return getStripeObjectId(paymentIntent.invoice);
}

async function handleChargeRefunded(supabase, stripe, event) {
  const charge = event.data.object;
  if (Number(charge.amount_refunded) <= 0) return;
  const invoiceId = await resolveInvoiceIdFromCharge(stripe, charge);
  if (!invoiceId) return;

  const refunds = charge.refunds?.data || [];
  const refund = refunds[refunds.length - 1] || null;
  const { error } = await supabase.rpc("record_affiliate_invoice_event", {
    p_stripe_invoice_id: invoiceId,
    p_event_kind: "refund",
    p_stripe_object_id: refund?.id || event.id,
    p_dispute_status: null,
  });
  if (error) throw new Error("Failed to reverse refunded affiliate commission");
}

async function handleCreditNoteCreated(supabase, event) {
  const creditNote = event.data.object;
  const invoiceId = getStripeObjectId(creditNote.invoice);
  if (!invoiceId || Number(creditNote.amount) <= 0) return;

  const { error } = await supabase.rpc("record_affiliate_invoice_event", {
    p_stripe_invoice_id: invoiceId,
    p_event_kind: "credit_note",
    p_stripe_object_id: creditNote.id,
    p_dispute_status: null,
  });
  if (error) throw new Error("Failed to reverse credited affiliate commission");
}

async function handleDisputeCreated(supabase, stripe, event) {
  const dispute = event.data.object;
  const charge =
    typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(dispute.charge)
      : dispute.charge;
  const invoiceId = charge
    ? await resolveInvoiceIdFromCharge(stripe, charge)
    : null;
  if (!invoiceId) return;

  const { error } = await supabase.rpc("record_affiliate_invoice_event", {
    p_stripe_invoice_id: invoiceId,
    p_event_kind: "dispute",
    p_stripe_object_id: dispute.id,
    p_dispute_status: "open",
  });
  if (error) throw new Error("Failed to hold disputed affiliate commission");
}

async function handleDisputeClosed(supabase, stripe, event) {
  const dispute = event.data.object;
  const charge =
    typeof dispute.charge === "string"
      ? await stripe.charges.retrieve(dispute.charge)
      : dispute.charge;
  const invoiceId = charge
    ? await resolveInvoiceIdFromCharge(stripe, charge)
    : null;
  if (!invoiceId) return;

  const restored = ["won", "warning_closed"].includes(dispute.status);
  const { error } = await supabase.rpc("record_affiliate_invoice_event", {
    p_stripe_invoice_id: invoiceId,
    p_event_kind: "dispute",
    p_stripe_object_id: dispute.id,
    p_dispute_status: restored ? "won" : "lost",
  });
  if (error) throw new Error("Failed to resolve affiliate commission dispute");
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  let event = null;
  let supabase = null;
  let eventClaimed = false;
  let eventClaimToken = null;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('Missing Stripe configuration');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error'
      });
    }

    const stripe = getStripeClient();

    // Get raw body as text for signature verification
    // Stripe requires the raw body string for signature verification
    const rawBody = await readRequestBodyAsText(req);
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      console.error('Missing Stripe signature');
      return res.status(400).json({
        ok: false,
        error: 'Missing signature'
      });
    }

    // Verify webhook signature
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({
        ok: false,
        error: 'Invalid signature'
      });
    }

    console.log('Received billing webhook:', event.type, 'id:', event.id);
    supabase = getAdminClient();

    let claim;
    try {
      const claimResult = await claimWebhookEvent(supabase, {
        eventId: event.id,
        eventType: event.type,
        source: "billing",
      });
      claim = claimResult?.action;
      eventClaimToken = claimResult?.claim_token || null;
      eventClaimed = claim === "process";
    } catch (claimError) {
      if (isAffiliateProgramEnabled()) throw claimError;
      console.warn(
        "[Stripe Webhook] Idempotency table unavailable while Affiliate is disabled",
      );
      claim = "process";
    }

    if (claim === "duplicate") {
      return res.status(200).json({ ok: true, received: true, duplicate: true });
    }
    if (claim === "busy") {
      return res.status(503).json({ ok: false, error: "Event is processing" });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(supabase, stripe, event);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(supabase, event);
        break;

      case "invoice.paid":
        await handleInvoicePaid(supabase, stripe, event);
        break;

      case "charge.refunded":
        await handleChargeRefunded(supabase, stripe, event);
        break;

      case "credit_note.created":
        await handleCreditNoteCreated(supabase, event);
        break;

      case "charge.dispute.created":
        await handleDisputeCreated(supabase, stripe, event);
        break;

      case "charge.dispute.closed":
        await handleDisputeClosed(supabase, stripe, event);
        break;

      default:
        console.log('Unhandled event type:', event.type);
    }

    if (eventClaimed) {
      await completeWebhookEvent(supabase, event.id, eventClaimToken);
    }

    return res.status(200).json({
      ok: true,
      received: true
    });

  } catch (error) {
    if (eventClaimed && supabase && event?.id) {
      await failWebhookEvent(supabase, event.id, eventClaimToken, error);
    }
    console.error('Webhook handler error:', {
      eventId: event?.id || null,
      eventType: event?.type || null,
      message: error?.message || "Unknown error",
    });
    return res.status(500).json({
      ok: false,
      error: 'Webhook handler failed'
    });
  }
}
