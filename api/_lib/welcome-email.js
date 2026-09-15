import {
  DAILY_EMAIL_SEND_INTERVAL_MS,
  WELCOME_TEMPLATE_ALIAS,
  sanitizeDeliveryError,
  sleep as defaultSleep,
  unwrapResendSend
} from "./daily-email.js";
import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeApiUrl,
  buildUnsubscribePageUrl
} from "./unsubscribe-token.js";

async function finishWelcome(supabase, deliveryId, providerMessageId) {
  const { error } = await supabase.rpc("complete_mailer_welcome", {
    p_delivery_id: deliveryId,
    p_provider_message_id: providerMessageId
  });
  if (error) throw error;
}

async function failWelcome(supabase, deliveryId, error) {
  const { error: updateError } = await supabase.rpc("fail_mailer_welcome", {
    p_delivery_id: deliveryId,
    p_error: sanitizeDeliveryError(error, 500)
  });
  if (updateError) {
    console.error("[welcome-email] failed to persist send failure", { deliveryId });
  }
}

export async function dispatchClaimedWelcomeEmails({
  claims,
  supabase,
  resend,
  env = process.env,
  sleep = defaultSleep
}) {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  const rows = Array.isArray(claims) ? claims : [];

  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) await sleep(DAILY_EMAIL_SEND_INTERVAL_MS);
    const claim = rows[index];
    const deliveryId = claim?.delivery_id;
    const subscriberId = claim?.subscriber_id;
    if (!deliveryId || !subscriberId || typeof claim?.email !== "string") {
      counts.failed += 1;
      continue;
    }

    try {
      const { data: sendable, error: eligibilityError } = await supabase.rpc(
        "is_mailer_welcome_sendable",
        {
          p_delivery_id: deliveryId
        }
      );
      if (eligibilityError) throw eligibilityError;
      if (sendable !== true) {
        counts.skipped += 1;
        continue;
      }

      const optOutUrl = buildUnsubscribePageUrl(subscriberId, env);
      const apiOptOutUrl = buildUnsubscribeApiUrl(subscriberId, env);
      const listHeaders = buildListUnsubscribeHeaders(apiOptOutUrl);
      if (!optOutUrl || !listHeaders) {
        throw new Error("Welcome email could not be prepared");
      }

      const { data, error } = await resend.emails.send(
        {
          from: env.RESEND_FROM,
          to: [claim.email],
          subject: "Welcome to Your SineDay 🌊",
          template: {
            id: WELCOME_TEMPLATE_ALIAS,
            variables: {
              OPT_OUT_URL: optOutUrl
            }
          },
          headers: listHeaders,
          tags: [
            { name: "category", value: "sineday_welcome" },
            {
              name: "welcome_delivery_id",
              value: String(deliveryId).replace(/[^a-zA-Z0-9_-]/g, "")
            }
          ]
        },
        {
          idempotencyKey: `sineday-welcome/${subscriberId}`
        }
      );
      const providerMessageId = unwrapResendSend({ data, error });
      await finishWelcome(supabase, deliveryId, providerMessageId);
      console.info("[welcome-email] sent", { deliveryId, providerMessageId });
      counts.sent += 1;
    } catch (error) {
      await failWelcome(supabase, deliveryId, error);
      console.error("[welcome-email] send failed", {
        deliveryId,
        message: sanitizeDeliveryError(error)
      });
      counts.failed += 1;
    }
  }

  return counts;
}

export async function claimAndDispatchWelcomeEmails({
  supabase,
  resend,
  subscriberId = null,
  limit = 10,
  env = process.env,
  sleep = defaultSleep
}) {
  const { data, error } = await supabase.rpc("claim_due_mailer_welcomes", {
    p_subscriber_id: subscriberId,
    p_limit: limit
  });
  if (error) throw error;
  return dispatchClaimedWelcomeEmails({
    claims: data,
    supabase,
    resend,
    env,
    sleep
  });
}
