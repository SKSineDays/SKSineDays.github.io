export async function readRequestBodyAsText(req) {
  if (typeof req.text === "function") {
    return req.text();
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function claimWebhookEvent(
  supabaseAdmin,
  { eventId, eventType, source },
) {
  const { data, error } = await supabaseAdmin.rpc("claim_stripe_webhook_event", {
    p_stripe_event_id: eventId,
    p_event_type: eventType,
    p_source: source,
    p_recovery_timeout_seconds: 300,
  });
  if (error) throw new Error("Failed to claim webhook event");
  return data;
}

export async function completeWebhookEvent(supabaseAdmin, eventId, claimToken) {
  const { data, error } = await supabaseAdmin.rpc("complete_stripe_webhook_event", {
    p_stripe_event_id: eventId,
    p_claim_token: claimToken,
  });
  if (error || data !== true) throw new Error("Failed to complete webhook event");
}

export async function failWebhookEvent(supabaseAdmin, eventId, claimToken, error) {
  const message =
    typeof error?.message === "string" ? error.message : "Processing failed";
  const { error: updateError } = await supabaseAdmin.rpc(
    "fail_stripe_webhook_event",
    {
      p_stripe_event_id: eventId,
      p_claim_token: claimToken,
      p_last_error: message,
    },
  );
  if (updateError) {
    console.error("[Stripe Webhook] Failed to record processing failure");
  }
}
