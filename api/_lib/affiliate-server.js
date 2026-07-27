import { authenticateUser, getAdminClient } from "./auth.js";
import { deriveAffiliateAccountState, isAffiliateProgramEnabled } from "./affiliate.js";
import { createAffiliateRecipientAccount, retrieveAffiliateAccount } from "./stripe.js";

const AFFILIATE_SYNC_SELECT = [
  "id",
  "user_id",
  "code",
  "display_name",
  "status",
  "stripe_connect_account_id",
  "details_submitted",
  "payouts_enabled",
  "tax_setup_status",
  "stripe_transfers_status",
  "recipient_payouts_status",
  "requirements_status",
  "activated_at",
  "updated_at",
].join(", ");

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

  const diagnostic = {
    code: code || null,
    message: error?.message || "Unknown error",
  };

  if (
    code === "invalid_fields" &&
    error?.message?.includes("You must have Connect enabled")
  ) {
    console.error(`[Affiliate] ${context}:`, diagnostic);
    return res.status(503).json({
      ok: false,
      error: "Stripe payout onboarding is not available yet. Please try again shortly.",
    });
  }

  console.error(`[Affiliate] ${context}:`, diagnostic);
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

export function shouldRefreshAffiliateFromStripe(affiliate) {
  if (!affiliate?.stripe_connect_account_id) return false;
  if (affiliate.status === "onboarding") return true;
  if (affiliate.tax_setup_status === "action_required") return true;
  const updatedAt = Date.parse(affiliate.updated_at || "");
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > 5 * 60 * 1000;
}

export async function syncAffiliateAccountState({
  affiliate,
  supabaseAdmin,
  retrieveAccount = retrieveAffiliateAccount,
  now = () => new Date().toISOString(),
}) {
  if (!affiliate?.id || !affiliate?.stripe_connect_account_id) {
    return affiliate;
  }

  const stripeAccount = await retrieveAccount(affiliate.stripe_connect_account_id);
  const state = deriveAffiliateAccountState(stripeAccount, affiliate.status);
  const update = {
    status: state.programStatus,
    details_submitted: state.detailsSubmitted,
    payouts_enabled: state.payoutsEnabled,
    tax_setup_status: state.taxSetupStatus,
    stripe_transfers_status: state.stripeTransfersStatus,
    recipient_payouts_status: state.recipientPayoutsStatus,
    requirements_status: state.requirementsStatus,
    updated_at: now(),
  };

  if (state.programStatus === "active" && !affiliate.activated_at) {
    update.activated_at = now();
  }

  const { data, error } = await supabaseAdmin
    .from("affiliates")
    .update(update)
    .eq("id", affiliate.id)
    .select(AFFILIATE_SYNC_SELECT)
    .single();

  if (error) {
    throw new Error("Failed to synchronize affiliate Stripe status");
  }

  return data;
}

export function getAffiliateReturnUrls() {
  const appUrl = (process.env.APP_URL || "https://sineday.app").replace(/\/+$/, "");
  return {
    refreshUrl: `${appUrl}/dashboard.html?affiliate=refresh`,
    returnUrl: `${appUrl}/dashboard.html?affiliate=return`,
  };
}

export async function ensureAffiliateRecipientAccount({
  affiliate,
  user,
  country,
  supabaseAdmin,
  createAccount = createAffiliateRecipientAccount,
  now = () => new Date().toISOString(),
}) {
  if (affiliate.stripe_connect_account_id) {
    return affiliate.stripe_connect_account_id;
  }

  const account = await createAccount({
    contactEmail: user.email,
    displayName: affiliate.display_name,
    country,
    userId: user.id,
    affiliateId: affiliate.id,
    idempotencyKey: `sineday-affiliate-account-${affiliate.id}`,
  });

  const accountId = account?.id;
  if (!accountId) {
    throw new Error("Stripe did not return a connected account ID");
  }

  const { data: updated, error } = await supabaseAdmin
    .from("affiliates")
    .update({
      stripe_connect_account_id: accountId,
      stripe_status_updated_at: now(),
    })
    .eq("id", affiliate.id)
    .is("stripe_connect_account_id", null)
    .select("stripe_connect_account_id")
    .maybeSingle();

  if (error) {
    throw new Error("Failed to save affiliate account");
  }

  if (updated?.stripe_connect_account_id) {
    return updated.stripe_connect_account_id;
  }

  const { data: reloaded, error: reloadError } = await supabaseAdmin
    .from("affiliates")
    .select("stripe_connect_account_id")
    .eq("id", affiliate.id)
    .maybeSingle();

  if (reloadError) {
    throw new Error("Failed to load affiliate account");
  }

  const persistedId = reloaded?.stripe_connect_account_id;
  if (!persistedId) {
    throw new Error("Failed to persist affiliate connected account");
  }

  return persistedId;
}
