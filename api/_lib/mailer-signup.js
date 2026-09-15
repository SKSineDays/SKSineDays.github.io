import {
  createHash,
  createHmac,
  randomBytes
} from "node:crypto";
import { isIP } from "node:net";
import { getPublicSiteUrl } from "./unsubscribe-token.js";
import { isValidIanaTimeZone } from "./daily-email.js";

export const MAILER_CONSENT_VERSION = "daily-email-consent-2026-09-15";
export const MAILER_CONFIRMATION_TEMPLATE_ALIAS = "dailyemailconfirmation";
export const MAILER_REQUEST_TTL_HOURS = 24;
export const MAILER_MAX_BODY_BYTES = 8 * 1024;
export const MAILER_MAX_EMAIL_LENGTH = 320;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ALLOWED_SOURCES = new Set([
  "public-daily-page",
  "homepage-banner"
]);

export function parseBoundedJsonBody(req, maxBytes = MAILER_MAX_BODY_BYTES) {
  const declaredLength = Number(req?.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, error: "Request is too large." };
  }

  const raw = req?.body;
  if (raw == null) return { ok: true, body: {} };
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      return { ok: false, error: "Request is too large." };
    }
    try {
      const parsed = JSON.parse(raw || "{}");
      return {
        ok: true,
        body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
      };
    } catch {
      return { ok: false, error: "Invalid request." };
    }
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request." };
  }

  try {
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > maxBytes) {
      return { ok: false, error: "Request is too large." };
    }
  } catch {
    return { ok: false, error: "Invalid request." };
  }

  return { ok: true, body: raw };
}

export function normalizeMailerEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > MAILER_MAX_EMAIL_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(email) ||
    !EMAIL_RE.test(email)
  ) {
    return null;
  }

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length < 1 ||
    local.length > 64 ||
    domain.length < 3 ||
    domain.length > 255 ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return null;
  }

  return email;
}

export function normalizeMailerSource(value) {
  return ALLOWED_SOURCES.has(value) ? value : "public-daily-page";
}

export function isAllowedMailerSource(value) {
  return ALLOWED_SOURCES.has(value);
}

export function validateMailerTimeZone(value) {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    value === value.trim() &&
    isValidIanaTimeZone(value)
  );
}

export function isHoneypotFilled(body) {
  return typeof body?.company === "string" && body.company.trim().length > 0;
}

export function createMailerToken() {
  return randomBytes(32).toString("base64url");
}

export function hashMailerToken(token) {
  if (
    typeof token !== "string" ||
    token.length < 43 ||
    token.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    return null;
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function getRequestIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]
      : "";
  const candidate =
    String(firstForwarded || req?.headers?.["x-real-ip"] || req?.socket?.remoteAddress || "")
      .trim()
      .replace(/^\[|\]$/g, "");
  return isIP(candidate) ? candidate : "unknown";
}

export function hashRateLimitKey(scope, value, secret = process.env.MAILER_SIGNUP_SECRET) {
  if (
    typeof scope !== "string" ||
    typeof value !== "string" ||
    typeof secret !== "string" ||
    secret.length < 32
  ) {
    return null;
  }
  return createHmac("sha256", secret)
    .update(`${scope}\0${value}`, "utf8")
    .digest("hex");
}

export function buildMailerConfirmationUrl(token, env = process.env) {
  const site = getPublicSiteUrl(env);
  if (!site || !hashMailerToken(token)) return null;
  return `${site}/daily/confirm#token=${encodeURIComponent(token)}`;
}

export function setPrivateJsonHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export function publicSignupAcceptedPayload() {
  return {
    ok: true,
    message:
      "Check your inbox for the confirmation step. If it does not arrive, wait a few minutes before trying again."
  };
}
