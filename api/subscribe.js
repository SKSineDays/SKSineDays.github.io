/**
 * Authenticated Daily Duck setup.
 *
 * POST /api/subscribe
 * Body: { email, consent, timezone, birthdate?, source }
 *
 * Client-provided rhythm values are ignored. A supplied birthdate is reduced
 * to email-safe values in request memory and is never stored or logged.
 */
import { Resend } from "resend";
import { getAdminClient } from "./_lib/auth.js";
import { deriveEmailRhythmFromBirthdate } from "./_lib/email-rhythm.js";
import {
  MAILER_CONSENT_VERSION,
  hashRateLimitKey,
  normalizeMailerEmail,
  parseBoundedJsonBody,
  setPrivateJsonHeaders,
  validateMailerTimeZone
} from "./_lib/mailer-signup.js";
import { claimAndDispatchWelcomeEmails } from "./_lib/welcome-email.js";

async function getAuthedEmail(req, serviceClient) {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!token) return null;
  const { data: { user } = {}, error } = await serviceClient.auth.getUser(token);
  if (error || !user) return null;
  return normalizeMailerEmail(user.email);
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

export default async function handler(req, res) {
  setPrivateJsonHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const parsed = parseBoundedJsonBody(req);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    const body = parsed.body;

    if (
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      typeof process.env.MAILER_SIGNUP_SECRET !== "string" ||
      process.env.MAILER_SIGNUP_SECRET.length < 32
    ) {
      console.error("[subscribe] missing Supabase configuration");
      return res.status(500).json({ ok: false, error: "Server configuration error" });
    }

    const supabase = getAdminClient();
    const authEmail = await getAuthedEmail(req, supabase);
    if (!authEmail) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (typeof body.email === "string") {
      const requestedEmail = normalizeMailerEmail(body.email);
      if (!requestedEmail) {
        return res.status(400).json({ ok: false, error: "Invalid email format" });
      }
      if (requestedEmail !== authEmail) {
        return res.status(403).json({
          ok: false,
          error: "Email must match the signed-in account"
        });
      }
    }

    if (body.consent !== true) {
      return res.status(400).json({
        ok: false,
        error: "Consent is required to subscribe"
      });
    }

    const timezone =
      typeof body.timezone === "string" && body.timezone.length > 0
        ? body.timezone
        : "America/Chicago";
    if (!validateMailerTimeZone(timezone)) {
      return res.status(400).json({ ok: false, error: "Invalid timezone" });
    }

    let derived = null;
    if (typeof body.birthdate === "string" && body.birthdate.length > 0) {
      derived = deriveEmailRhythmFromBirthdate(body.birthdate, { timezone });
      body.birthdate = "";
      if (!derived.ok) {
        return res.status(400).json({ ok: false, error: derived.error });
      }
    }

    const { data, error } = await supabase.rpc(
      "activate_authenticated_email_subscriber",
      {
        p_email: authEmail,
        p_recipient_key_hash: hashRateLimitKey("recipient", authEmail),
        p_timezone: timezone,
        p_birth_day_of_year: derived?.birthDayOfYear ?? null,
        p_origin_day: derived?.originDay ?? null,
        p_consent_version: MAILER_CONSENT_VERSION,
        p_source: "dashboard-daily-duck"
      }
    );

    if (error) {
      if (String(error.message || "").includes("birthdate_required")) {
        return res.status(400).json({ ok: false, error: "Enter a valid birthdate." });
      }
      console.error("[subscribe] atomic activation failed");
      return res.status(500).json({ ok: false, error: "Failed to create subscriber" });
    }

    const activation = firstRow(data);
    if (activation?.result_state === "suppressed") {
      return res.status(409).json({
        ok: false,
        error: "Email delivery is suppressed. Contact support to restore delivery."
      });
    }
    if (activation?.result_state !== "active" || !activation?.subscriber_id) {
      return res.status(500).json({ ok: false, error: "Failed to create subscriber" });
    }

    if (
      process.env.RESEND_API_KEY &&
      process.env.RESEND_FROM &&
      process.env.UNSUBSCRIBE_SECRET &&
      process.env.PUBLIC_SITE_URL
    ) {
      try {
        await claimAndDispatchWelcomeEmails({
          supabase,
          resend: new Resend(process.env.RESEND_API_KEY),
          subscriberId: activation.subscriber_id,
          limit: 1
        });
      } catch {
        // The persisted welcome row is retried by the existing minute cron.
        console.error("[subscribe] welcome dispatch deferred");
      }
    }

    const configured = activation.profile_configured === true;
    return res.status(200).json({
      ok: true,
      message: "Successfully subscribed",
      profileConfigured: configured,
      profileLocked: configured,
      originDay:
        configured && Number.isInteger(activation.origin_day)
          ? activation.origin_day
          : null
    });
  } catch {
    console.error("[subscribe] unexpected error");
    return res.status(500).json({
      ok: false,
      error: "An unexpected error occurred"
    });
  }
}
