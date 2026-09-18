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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function eventTagUuid(event, name) {
  const value = event?.data?.tags?.[name];
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
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
      const { error: mailerEventError } = await supabase.rpc(
        "record_mailer_provider_event",
        {
          p_provider_message_id: emailId,
          p_event_type: type,
          p_event_at: providerEventAt,
          p_signup_request_id: eventTagUuid(event, "signup_request_id"),
          p_welcome_delivery_id: eventTagUuid(event, "welcome_delivery_id")
        }
      );
      if (mailerEventError) throw mailerEventError;
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
      const { error: suppressError } = await supabase.rpc(
        "suppress_mailer_recipient",
        {
          p_email: null,
          p_subscriber_id: delivery.subscriber_id,
          p_recipient_key_hash: null,
          p_reason: type,
          p_provider_message_id: emailId,
          p_event_at: providerEventAt
        }
      );
      if (suppressError) throw suppressError;
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("[resend-webhook] processing failed");
    return json(res, 500, { ok: false, error: "Webhook handler failed" });
  }
}
