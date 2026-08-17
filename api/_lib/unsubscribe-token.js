/**
 * Signed Daily Duck unsubscribe tokens.
 *
 * Payload contains only a versioned subscriber UUID — never an email address.
 * Tokens are HMAC-SHA256 with UNSUBSCRIBE_SECRET and encoded as base64url.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const UNSUBSCRIBE_TOKEN_VERSION = 1;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getUnsubscribeSecret(secret = process.env.UNSUBSCRIBE_SECRET) {
  if (typeof secret !== "string" || secret.length < 16) return null;
  return secret;
}

export function isSubscriberUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function encodePayload(subscriberId) {
  return Buffer.from(`${UNSUBSCRIBE_TOKEN_VERSION}.${subscriberId}`, "utf8").toString(
    "base64url"
  );
}

function signPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createUnsubscribeToken(
  subscriberId,
  secret = process.env.UNSUBSCRIBE_SECRET
) {
  const resolvedSecret = getUnsubscribeSecret(secret);
  if (!resolvedSecret || !isSubscriberUuid(subscriberId)) return null;
  const payload = encodePayload(subscriberId);
  return `${payload}.${signPayload(payload, resolvedSecret)}`;
}

export function verifyUnsubscribeToken(
  token,
  secret = process.env.UNSUBSCRIBE_SECRET
) {
  const resolvedSecret = getUnsubscribeSecret(secret);
  if (!resolvedSecret || typeof token !== "string") {
    return { ok: false, reason: "invalid" };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, resolvedSecret);
  if (!secureEqual(providedSignature, expectedSignature)) {
    return { ok: false, reason: "altered" };
  }

  let decoded;
  try {
    decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const match = /^(\d+)\.([0-9a-f-]{36})$/i.exec(decoded);
  if (!match) return { ok: false, reason: "malformed" };

  const version = Number(match[1]);
  if (version !== UNSUBSCRIBE_TOKEN_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  const subscriberId = match[2].toLowerCase();
  if (!isSubscriberUuid(subscriberId)) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, subscriberId, version };
}

export function getPublicSiteUrl(env = process.env) {
  const raw = typeof env.PUBLIC_SITE_URL === "string" ? env.PUBLIC_SITE_URL.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function buildUnsubscribePageUrl(subscriberId, env = process.env) {
  const site = getPublicSiteUrl(env);
  const token = createUnsubscribeToken(subscriberId, env.UNSUBSCRIBE_SECRET);
  if (!site || !token) return null;
  return `${site}/unsubscribe.html?token=${encodeURIComponent(token)}`;
}

export function buildUnsubscribeApiUrl(subscriberId, env = process.env) {
  const site = getPublicSiteUrl(env);
  const token = createUnsubscribeToken(subscriberId, env.UNSUBSCRIBE_SECRET);
  if (!site || !token) return null;
  return `${site}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function buildListUnsubscribeHeaders(apiUnsubscribeUrl) {
  if (typeof apiUnsubscribeUrl !== "string" || apiUnsubscribeUrl.length === 0) {
    return null;
  }
  return {
    "List-Unsubscribe": `<${apiUnsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}
