/**
 * Claimed daily-email dispatch: eligibility recheck, SineDay math, Resend send.
 * Never logs email addresses or unsubscribe URLs.
 */

import {
  DAILY_EMAIL_SEND_INTERVAL_MS,
  calculateDailySineDay,
  getDailyEmailSubject,
  getDailyTemplateAlias,
  sanitizeDeliveryError,
  sleep as defaultSleep,
  unwrapResendSend
} from "./daily-email.js";
import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeApiUrl,
  buildUnsubscribePageUrl
} from "./unsubscribe-token.js";

function nowIso(now) {
  if (now instanceof Date && Number.isFinite(now.getTime())) return now.toISOString();
  if (typeof now === "string" && now.length > 0) return now;
  return new Date().toISOString();
}

async function loadEligibility(supabase, subscriberId) {
  const { data: subscriber, error: subscriberError } = await supabase
    .from("subscribers")
    .select("id, status, email, timezone")
    .eq("id", subscriberId)
    .maybeSingle();
  if (subscriberError) throw subscriberError;

  const { data: preferences, error: preferencesError } = await supabase
    .from("subscriber_preferences")
    .select("email_enabled, email_opt_in, email_opt_in_at")
    .eq("subscriber_id", subscriberId)
    .maybeSingle();
  if (preferencesError) throw preferencesError;

  const eligible =
    subscriber?.status === "active" &&
    typeof subscriber.email === "string" &&
    subscriber.email.length > 0 &&
    preferences?.email_enabled === true &&
    preferences?.email_opt_in === true &&
    preferences?.email_opt_in_at != null;

  return { eligible };
}

async function updateDelivery(supabase, deliveryId, patch) {
  const { error } = await supabase
    .from("delivery_log")
    .update(patch)
    .eq("id", deliveryId);
  if (error) throw error;
}

export async function dispatchClaimedDailyEmails({
  claims,
  supabase,
  resend,
  now = new Date(),
  sleep = defaultSleep,
  env = process.env
}) {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  const rows = Array.isArray(claims) ? claims : [];
  const attemptedAt = nowIso(now);

  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) await sleep(DAILY_EMAIL_SEND_INTERVAL_MS);

    const claim = rows[index];
    const deliveryId = claim?.delivery_id;
    const subscriberId = claim?.subscriber_id;
    if (!deliveryId || !subscriberId) {
      counts.failed += 1;
      continue;
    }

    try {
      const { eligible } = await loadEligibility(supabase, subscriberId);
      if (!eligible) {
        await updateDelivery(supabase, deliveryId, {
          status: "skipped",
          error: "Subscriber opted out before delivery",
          updated_at: attemptedAt
        });
        counts.skipped += 1;
        continue;
      }

      const day = calculateDailySineDay(claim.origin_day, claim.local_date);
      const templateAlias = getDailyTemplateAlias(day);
      const subject = getDailyEmailSubject(day);
      const optOutUrl = buildUnsubscribePageUrl(subscriberId, env);
      const apiUnsubscribeUrl = buildUnsubscribeApiUrl(subscriberId, env);
      const listHeaders = buildListUnsubscribeHeaders(apiUnsubscribeUrl);

      if (day == null || !templateAlias || !subject || !optOutUrl || !listHeaders) {
        await updateDelivery(supabase, deliveryId, {
          status: "failed",
          error: "Delivery could not be prepared",
          sineday_day: day,
          template_alias: templateAlias,
          updated_at: attemptedAt
        });
        counts.failed += 1;
        continue;
      }

      const { data, error } = await resend.emails.send(
        {
          from: env.RESEND_FROM,
          to: [claim.email],
          subject,
          template: {
            id: templateAlias,
            variables: {
              OPT_OUT_URL: optOutUrl
            }
          },
          headers: listHeaders,
          tags: [
            { name: "category", value: "daily_sineday" },
            { name: "sineday_day", value: String(day) },
            { name: "delivery_id", value: String(deliveryId).replace(/[^a-zA-Z0-9_-]/g, "") }
          ]
        },
        {
          idempotencyKey: `sineday-daily/${deliveryId}`
        }
      );

      const providerMessageId = unwrapResendSend({ data, error });
      await updateDelivery(supabase, deliveryId, {
        status: "sent",
        provider: "resend",
        provider_message_id: providerMessageId,
        sineday_day: day,
        template_alias: templateAlias,
        local_timezone: claim.timezone || null,
        error: null,
        updated_at: attemptedAt
      });
      counts.sent += 1;
    } catch (error) {
      console.error("[daily-email] delivery failed", {
        deliveryId,
        message: sanitizeDeliveryError(error)
      });
      try {
        await updateDelivery(supabase, deliveryId, {
          status: "failed",
          error: sanitizeDeliveryError(error),
          updated_at: attemptedAt
        });
      } catch (updateError) {
        console.error("[daily-email] failed to record delivery failure");
      }
      counts.failed += 1;
    }
  }

  return counts;
}
