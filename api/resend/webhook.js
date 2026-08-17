/**
 * POST /api/resend/webhook
 *
 * Verifies Resend/Svix signatures against the raw body, then records
 * provider status on delivery_log. Bounce/complaint/suppression events
 * locally suppress sending without clearing email_opt_in.
 */

import { Resend } from "resend";
import { getAdminClient } from "../_lib/auth.js";
import { readRequestBodyAsText } from "../_lib/webhook.js";

const PROVIDER_STATUS_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed"
]);

const SUPPRESS_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.suppressed"
]);

function headerValue(headers, name) {
  if (!headers) return "";
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0] || "";
  return typeof direct === "string" ? direct : "";
}

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!webhookSecret || !resendApiKey) {
    console.error("[resend-webhook] missing configuration");
    return json(res, 500, { ok: false, error: "Server configuration error" });
  }

  let event;
  try {
    const rawBody = await readRequestBodyAsText(req);
    const resend = new Resend(resendApiKey);
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: headerValue(req.headers, "svix-id"),
        timestamp: headerValue(req.headers, "svix-timestamp"),
        signature: headerValue(req.headers, "svix-signature")
      },
      webhookSecret
    });
  } catch {
    return json(res, 400, { ok: false, error: "Invalid signature" });
  }

  const type = event?.type;
  if (!PROVIDER_STATUS_EVENTS.has(type)) {
    return json(res, 200, { ok: true });
  }

  const emailId = event?.data?.email_id;
  if (typeof emailId !== "string" || emailId.length === 0) {
    return json(res, 200, { ok: true });
  }

  const providerEventAt =
    typeof event.created_at === "string"
      ? event.created_at
      : new Date().toISOString();

  try {
    const supabase = getAdminClient();
    const { data: delivery, error: lookupError } = await supabase
      .from("delivery_log")
      .select("id, subscriber_id, provider_status")
      .eq("provider_message_id", emailId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!delivery) {
      return json(res, 200, { ok: true });
    }

    const { error: updateError } = await supabase
      .from("delivery_log")
      .update({
        provider_status: type,
        provider_event_at: providerEventAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", delivery.id);
    if (updateError) throw updateError;

    if (SUPPRESS_EVENTS.has(type) && delivery.subscriber_id) {
      const now = new Date().toISOString();
      const { error: suppressError } = await supabase
        .from("subscribers")
        .update({ status: "suppressed", updated_at: now })
        .eq("id", delivery.subscriber_id)
        .eq("status", "active");
      if (suppressError) throw suppressError;

      const { error: prefError } = await supabase
        .from("subscriber_preferences")
        .update({ email_enabled: false, updated_at: now })
        .eq("subscriber_id", delivery.subscriber_id);
      if (prefError) throw prefError;
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("[resend-webhook] processing failed");
    return json(res, 500, { ok: false, error: "Webhook handler failed" });
  }
}
