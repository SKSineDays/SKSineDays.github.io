/**
 * GET /api/cron/daily-email
 *
 * Minute cron (UTC). Claims subscribers whose local time is in the 6:00 AM
 * send window and dispatches published Resend day templates.
 *
 * Requires Vercel Pro/Enterprise for reliable minutely cron across timezones.
 * Sending is fail-closed until DAILY_EMAIL_CRON_ENABLED=true.
 */

import { Resend } from "resend";
import { getAdminClient } from "../_lib/auth.js";
import {
  DAILY_EMAIL_CLAIM_LIMIT,
  getCronNow,
  getMissingDailyEmailEnv,
  isDailyEmailCronEnabled
} from "../_lib/daily-email.js";
import { dispatchClaimedDailyEmails } from "../_lib/daily-email-dispatch.js";
import { secureEqual } from "../_lib/unsubscribe-token.js";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function isAuthorizedCron(req) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const provided = req.headers?.authorization;
  return secureEqual(typeof provided === "string" ? provided : "", expected);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const missing = getMissingDailyEmailEnv();
  if (missing.length > 0) {
    console.error("[daily-email] missing configuration");
    return json(res, 500, { ok: false, error: "Server configuration error" });
  }

  if (!isAuthorizedCron(req)) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  if (!isDailyEmailCronEnabled()) {
    console.warn("[daily-email] sending disabled");
    return json(res, 200, {
      ok: true,
      claimed: 0,
      sent: 0,
      failed: 0,
      skipped: 0
    });
  }

  try {
    const now = getCronNow();
    const supabase = getAdminClient();
    const { data: claims, error: claimError } = await supabase.rpc(
      "claim_due_daily_emails",
      {
        p_now: now.toISOString(),
        p_limit: DAILY_EMAIL_CLAIM_LIMIT
      }
    );

    if (claimError) {
      console.error("[daily-email] claim failed");
      return json(res, 500, { ok: false, error: "Claim failed" });
    }

    const claimed = Array.isArray(claims) ? claims : [];
    const resend = new Resend(process.env.RESEND_API_KEY);
    const counts = await dispatchClaimedDailyEmails({
      claims: claimed,
      supabase,
      resend,
      now
    });

    return json(res, 200, {
      ok: true,
      claimed: claimed.length,
      sent: counts.sent,
      failed: counts.failed,
      skipped: counts.skipped
    });
  } catch (error) {
    console.error("[daily-email] unexpected error");
    return json(res, 500, { ok: false, error: "Daily email run failed" });
  }
}
