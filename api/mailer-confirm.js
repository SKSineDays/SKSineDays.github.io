/**
 * POST /api/mailer-confirm
 *
 * Consumes a public double-opt-in token. GET requests and page loads never
 * activate email. Subscriber identity is kept inside the server/RPC boundary.
 */
import { Resend } from "resend";
import { getAdminClient } from "./_lib/auth.js";
import {
  hashMailerToken,
  parseBoundedJsonBody,
  setPrivateJsonHeaders
} from "./_lib/mailer-signup.js";
import { claimAndDispatchWelcomeEmails } from "./_lib/welcome-email.js";

function json(res, status, body) {
  setPrivateJsonHeaders(res);
  return res.status(status).json(body);
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

function publicFailure(state) {
  switch (state) {
    case "expired":
      return {
        status: 410,
        body: {
          ok: false,
          state: "expired",
          error: "This confirmation link has expired."
        }
      };
    case "already_used":
      return {
        status: 409,
        body: {
          ok: false,
          state: "already-used",
          error: "This confirmation link has already been used."
        }
      };
    case "suppressed":
      return {
        status: 409,
        body: {
          ok: false,
          state: "unavailable",
          error: "This address cannot be activated automatically. Please contact support."
        }
      };
    default:
      return {
        status: 400,
        body: {
          ok: false,
          state: "invalid",
          error: "This confirmation link is invalid."
        }
      };
  }
}

export default async function handler(req, res) {
  setPrivateJsonHeaders(res);
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const parsed = parseBoundedJsonBody(req, 1024);
  if (!parsed.ok) {
    return json(res, 400, { ok: false, state: "invalid", error: "Invalid request." });
  }
  const tokenHash = hashMailerToken(parsed.body.token);
  parsed.body.token = "";
  if (!tokenHash) {
    return json(res, 400, {
      ok: false,
      state: "invalid",
      error: "This confirmation link is invalid."
    });
  }

  const requiredEnv = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "UNSUBSCRIBE_SECRET",
    "PUBLIC_SITE_URL"
  ];
  if (requiredEnv.some((key) => !process.env[key])) {
    console.error("[mailer-confirm] missing configuration");
    return json(res, 500, { ok: false, error: "Server configuration error." });
  }

  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase.rpc("confirm_mailer_signup", {
      p_token_hash: tokenHash
    });
    if (error) throw error;

    const result = firstRow(data);
    if (result?.result_state !== "active") {
      const failure = publicFailure(result?.result_state);
      return json(res, failure.status, failure.body);
    }

    if (result.subscriber_id) {
      try {
        await claimAndDispatchWelcomeEmails({
          supabase,
          resend: new Resend(process.env.RESEND_API_KEY),
          subscriberId: result.subscriber_id,
          limit: 1
        });
      } catch {
        // Activation is durable. The existing minute cron retries persisted welcomes.
        console.error("[mailer-confirm] welcome dispatch deferred");
      }
    }

    return json(res, 200, {
      ok: true,
      state: "active",
      timezone: result.timezone,
      sendHourLocal: result.send_hour_local,
      sendMinuteLocal: result.send_minute_local
    });
  } catch {
    console.error("[mailer-confirm] activation failed");
    return json(res, 500, {
      ok: false,
      state: "retry",
      error: "We could not confirm your signup. Please try again."
    });
  }
}
