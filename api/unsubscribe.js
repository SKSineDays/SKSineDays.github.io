/**
 * POST /api/unsubscribe
 *
 * One-click and confirmation-page unsubscribe. GET never unsubscribes.
 * Tokens carry only a signed subscriber UUID — never an email address.
 */

import { getAdminClient } from "./_lib/auth.js";
import { verifyUnsubscribeToken } from "./_lib/unsubscribe-token.js";

function parseBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    const text = req.body.trim();
    if (!text) return {};
    if (text.startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    }
    try {
      return Object.fromEntries(new URLSearchParams(text).entries());
    } catch {
      return {};
    }
  }
  return typeof req.body === "object" ? req.body : {};
}

function readToken(req, body) {
  const candidates = [];
  if (typeof req.query?.token === "string") candidates.push(req.query.token);
  try {
    const url = new URL(req.url || "", "http://sineday.invalid");
    if (url.searchParams.get("token")) candidates.push(url.searchParams.get("token"));
  } catch {
    // Ignore malformed request URLs and continue with body/query candidates.
  }
  if (typeof body?.token === "string") candidates.push(body.token);
  return candidates.find((value) => value && value.trim().length > 0) || "";
}

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const token = readToken(req, parseBody(req));
  const verified = verifyUnsubscribeToken(token);
  if (!verified.ok) {
    return json(res, 400, { ok: false, error: "Invalid request" });
  }

  try {
    const supabase = getAdminClient();
    const { error } = await supabase.rpc("unsubscribe_email_subscriber", {
      p_subscriber_id: verified.subscriberId
    });
    if (error) {
      console.error("[unsubscribe] rpc failed");
      return json(res, 500, { ok: false, error: "Unable to complete request" });
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("[unsubscribe] unexpected error");
    return json(res, 500, { ok: false, error: "Unable to complete request" });
  }
}
