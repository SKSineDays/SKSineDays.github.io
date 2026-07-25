import { authenticateUser, getAdminClient } from "./auth.js";
import { isAffiliateProgramEnabled } from "./affiliate.js";

export function setPrivateApiHeaders(res, methods = "GET, POST, OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "https://sineday.app");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "private, no-store");
}

export function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}

export async function requireAffiliateContext(req) {
  if (!isAffiliateProgramEnabled()) {
    const error = new Error("Affiliate program unavailable");
    error.code = "AFFILIATE_DISABLED";
    throw error;
  }

  const { user } = await authenticateUser(req);
  return { user, supabaseAdmin: getAdminClient() };
}

export function affiliateApiError(res, error, context) {
  const code = error?.code;
  if (code === "AFFILIATE_DISABLED") {
    return res.status(404).json({ ok: false, error: "Affiliate program unavailable" });
  }

  if (
    error?.message?.includes("Authorization") ||
    error?.message?.includes("token")
  ) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  console.error(`[Affiliate] ${context}:`, {
    code: code || null,
    message: error?.message || "Unknown error",
  });
  return res.status(500).json({ ok: false, error: "Unable to complete this request" });
}

export async function getAffiliateForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to load affiliate account");
  return data;
}

export function getAffiliateReturnUrls() {
  const appUrl = (process.env.APP_URL || "https://sineday.app").replace(/\/+$/, "");
  return {
    refreshUrl: `${appUrl}/dashboard.html?affiliate=refresh`,
    returnUrl: `${appUrl}/dashboard.html?affiliate=return`,
  };
}
