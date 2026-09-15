/**
 * Public Daily SineDay double-opt-in request.
 *
 * Birthdate is validated and reduced to rhythm values in request memory only.
 * No subscriber is created and no welcome/daily email is sent until the
 * recipient confirms ownership from the dedicated confirmation page.
 */
import { Resend } from "resend";
import { getAdminClient } from "./_lib/auth.js";
import {
  deriveEmailRhythmFromBirthdate
} from "./_lib/email-rhythm.js";
import { unwrapResendSend } from "./_lib/daily-email.js";
import {
  MAILER_CONFIRMATION_TEMPLATE_ALIAS,
  MAILER_CONSENT_VERSION,
  buildMailerConfirmationUrl,
  createMailerToken,
  getRequestIp,
  hashMailerToken,
  hashRateLimitKey,
  isAllowedMailerSource,
  isHoneypotFilled,
  normalizeMailerEmail,
  parseBoundedJsonBody,
  publicSignupAcceptedPayload,
  setPrivateJsonHeaders,
  validateMailerTimeZone
} from "./_lib/mailer-signup.js";

function json(res, status, body) {
  setPrivateJsonHeaders(res);
  return res.status(status).json(body);
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function markFailed(supabase, requestId) {
  if (!requestId) return;
  const { error } = await supabase.rpc("mark_mailer_confirmation_failed", {
    p_request_id: requestId
  });
  if (error) {
    console.error("[mailer-signup] failed to close unsuccessful request", { requestId });
  }
}

export default async function handler(req, res) {
  setPrivateJsonHeaders(res);

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const parsed = parseBoundedJsonBody(req);
  if (!parsed.ok) {
    return json(res, 400, { ok: false, error: parsed.error });
  }
  const body = parsed.body;

  // Bots receive the same neutral response but do not create durable records.
  if (isHoneypotFilled(body)) {
    return json(res, 202, publicSignupAcceptedPayload());
  }

  const email = normalizeMailerEmail(body.email);
  if (!email) {
    return json(res, 400, { ok: false, error: "Enter a valid email address." });
  }
  if (body.consent !== true) {
    return json(res, 400, { ok: false, error: "Consent is required." });
  }
  if (!validateMailerTimeZone(body.timezone)) {
    return json(res, 400, { ok: false, error: "Choose a valid time zone." });
  }
  if (!isAllowedMailerSource(body.source)) {
    return json(res, 400, { ok: false, error: "Invalid signup source." });
  }

  const birthdate = body.birthdate;
  body.birthdate = "";
  const rhythm = deriveEmailRhythmFromBirthdate(birthdate, {
    timezone: body.timezone
  });
  if (!rhythm.ok) {
    return json(res, 400, { ok: false, error: rhythm.error });
  }

  const requiredEnv = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "PUBLIC_SITE_URL",
    "MAILER_SIGNUP_SECRET"
  ];
  if (
    requiredEnv.some((key) => !process.env[key]) ||
    process.env.MAILER_SIGNUP_SECRET.length < 32
  ) {
    console.error("[mailer-signup] missing configuration");
    return json(res, 500, { ok: false, error: "Server configuration error." });
  }

  const token = createMailerToken();
  const tokenHash = hashMailerToken(token);
  const recipientKeyHash = hashRateLimitKey("recipient", email);
  const ipKeyHash = hashRateLimitKey("ip", getRequestIp(req));
  const confirmationUrl = buildMailerConfirmationUrl(token);
  if (!tokenHash || !recipientKeyHash || !ipKeyHash || !confirmationUrl) {
    console.error("[mailer-signup] could not prepare request");
    return json(res, 500, { ok: false, error: "Server configuration error." });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.rpc("create_mailer_signup_request", {
    p_token_hash: tokenHash,
    p_email: email,
    p_timezone: body.timezone,
    p_birth_day_of_year: rhythm.birthDayOfYear,
    p_origin_day: rhythm.originDay,
    p_consent_version: MAILER_CONSENT_VERSION,
    p_source: body.source,
    p_recipient_key_hash: recipientKeyHash,
    p_ip_key_hash: ipKeyHash
  });

  if (error) {
    console.error("[mailer-signup] request creation failed");
    return json(res, 500, { ok: false, error: "Unable to start signup. Please try again." });
  }

  const created = firstRow(data);
  if (created?.result_state === "rate_limited") {
    const retryAfter = Math.max(60, Number(created.retry_after_seconds) || 600);
    res.setHeader("Retry-After", String(retryAfter));
    return json(res, 429, {
      ok: false,
      error: "Too many signup attempts. Please wait before trying again."
    });
  }

  if (created?.result_state !== "created" || !created?.request_id) {
    return json(res, 202, publicSignupAcceptedPayload());
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data: sendData, error: sendError } = await resend.emails.send(
      {
        from: process.env.RESEND_FROM,
        to: [email],
        subject: "Confirm your Daily SineDay emails",
        template: {
          id: MAILER_CONFIRMATION_TEMPLATE_ALIAS,
          variables: {
            CONFIRM_URL: confirmationUrl
          }
        },
        tags: [
          { name: "category", value: "sineday_confirmation" },
          {
            name: "signup_request_id",
            value: String(created.request_id).replace(/[^a-zA-Z0-9_-]/g, "")
          }
        ]
      },
      {
        idempotencyKey: `sineday-confirm/${created.request_id}`
      }
    );
    const providerMessageId = unwrapResendSend({ data: sendData, error: sendError });
    const { error: markError } = await supabase.rpc("mark_mailer_confirmation_sent", {
      p_request_id: created.request_id,
      p_provider_message_id: providerMessageId
    });
    if (markError) throw markError;
  } catch {
    await markFailed(supabase, created.request_id);
    console.error("[mailer-signup] confirmation send failed", {
      requestId: created.request_id
    });
    return json(res, 503, {
      ok: false,
      error: "We could not send the confirmation email. Please try again."
    });
  }

  return json(res, 202, publicSignupAcceptedPayload());
}
