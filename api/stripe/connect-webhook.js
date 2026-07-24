export const runtime = "nodejs";

import { getAdminClient } from "../_lib/auth.js";
import { deriveAffiliateAccountState } from "../_lib/affiliate.js";
import {
  getStripeClient,
  retrieveAffiliateAccount,
} from "../_lib/stripe.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  readRequestBodyAsText,
} from "../_lib/webhook.js";

const ACCOUNT_EVENT_TYPES = new Set([
  "v2.core.account.updated",
  "v2.core.account.closed",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[requirements].updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account[identity].updated",
  "v2.core.account_link.returned",
]);

async function getAccountId(notification) {
  if (notification.type === "v2.core.account_link.returned") {
    const event = await notification.fetchEvent();
    return event?.data?.account_id || null;
  }
  if (notification.related_object?.id) {
    return notification.related_object?.id || null;
  }
  const event = await notification.fetchEvent();
  return event?.related_object?.id || null;
}

async function synchronizeAffiliateAccount(supabaseAdmin, notification) {
  if (!ACCOUNT_EVENT_TYPES.has(notification.type)) return;
  const accountId = await getAccountId(notification);
  if (!accountId) return;

  const { data: affiliate, error } = await supabaseAdmin
    .from("affiliates")
    .select("id, status, activated_at")
    .eq("stripe_connect_account_id", accountId)
    .maybeSingle();
  if (error) throw new Error("Failed to resolve affiliate account");
  if (!affiliate) return;

  if (notification.type === "v2.core.account.closed") {
    const { error: closeError } = await supabaseAdmin
      .from("affiliates")
      .update({
        status: "closed",
        stripe_transfers_status: "restricted",
        recipient_payouts_status: "restricted",
        requirements_status: "past_due",
        details_submitted: false,
        payouts_enabled: false,
        tax_setup_status: "action_required",
        stripe_status_updated_at: new Date().toISOString(),
      })
      .eq("id", affiliate.id);
    if (closeError) throw new Error("Failed to close affiliate account state");
    return;
  }

  const account = await retrieveAffiliateAccount(accountId);
  const state = deriveAffiliateAccountState(account, affiliate.status);
  const now = new Date().toISOString();
  const update = {
    status: state.programStatus,
    stripe_transfers_status: state.stripeTransfersStatus,
    recipient_payouts_status: state.recipientPayoutsStatus,
    requirements_status: state.requirementsStatus,
    details_submitted: state.detailsSubmitted,
    payouts_enabled: state.payoutsEnabled,
    tax_setup_status: state.taxSetupStatus,
    stripe_status_updated_at: now,
  };
  if (state.programStatus === "active" && !affiliate.activated_at) {
    update.activated_at = now;
  }

  const { error: updateError } = await supabaseAdmin
    .from("affiliates")
    .update(update)
    .eq("id", affiliate.id);
  if (updateError) throw new Error("Failed to synchronize affiliate account");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let notification = null;
  let supabaseAdmin = null;
  let eventClaimed = false;
  let eventClaimToken = null;

  try {
    const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ ok: false, error: "Server configuration error" });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ ok: false, error: "Missing signature" });
    }

    const rawBody = await readRequestBodyAsText(req);
    const stripe = getStripeClient({ connect: true });
    try {
      notification = stripe.parseEventNotification(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      console.error("[Connect Webhook] Signature verification failed");
      return res.status(400).json({ ok: false, error: "Invalid signature" });
    }

    supabaseAdmin = getAdminClient();
    const claimResult = await claimWebhookEvent(supabaseAdmin, {
      eventId: notification.id,
      eventType: notification.type,
      source: "connect",
    });
    const claim = claimResult?.action;
    eventClaimToken = claimResult?.claim_token || null;
    eventClaimed = claim === "process";
    if (claim === "duplicate") {
      return res.status(200).json({ ok: true, received: true, duplicate: true });
    }
    if (claim === "busy") {
      return res.status(503).json({ ok: false, error: "Event is processing" });
    }

    await synchronizeAffiliateAccount(supabaseAdmin, notification);
    await completeWebhookEvent(
      supabaseAdmin,
      notification.id,
      eventClaimToken,
    );
    return res.status(200).json({ ok: true, received: true });
  } catch (error) {
    if (eventClaimed && supabaseAdmin && notification?.id) {
      await failWebhookEvent(
        supabaseAdmin,
        notification.id,
        eventClaimToken,
        error,
      );
    }
    console.error("[Connect Webhook] Processing failed:", {
      eventId: notification?.id || null,
      eventType: notification?.type || null,
      message: error?.message || "Unknown error",
    });
    return res.status(500).json({ ok: false, error: "Webhook handler failed" });
  }
}
