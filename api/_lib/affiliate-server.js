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

export const AFFILIATE_APPLICATION_RECEIVED_MESSAGE =
  "Thanks — your Affiliate application has been received.";

const AFFILIATE_APPLICATION_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AFFILIATE_APPLICATION_SELECT = [
  "id",
  "user_id",
  "display_name",
  "email",
  "instagram",
  "tiktok",
  "youtube",
  "website",
  "other_social",
  "introduction",
  "review_status",
  "created_at",
  "reviewed_at",
  "approved_at",
].join(", ");

export function normalizeAffiliateApplicationEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function toPlainAffiliateApplicationText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function optionalSocialField(value) {
  const text = toPlainAffiliateApplicationText(value);
  if (!text) return null;
  if (text.length > 300) {
    return { ok: false, error: "Social and profile links must be 300 characters or fewer." };
  }
  return { ok: true, value: text };
}

export function validateAffiliateApplicationInput(body = {}, { emailSource } = {}) {
  const displayName = toPlainAffiliateApplicationText(body.displayName);
  if (displayName.length < 2 || displayName.length > 80) {
    return {
      ok: false,
      error: "Name must be between 2 and 80 characters.",
    };
  }

  const email = normalizeAffiliateApplicationEmail(
    emailSource === undefined ? body.email : emailSource,
  );
  if (
    !email ||
    email.length > 254 ||
    !AFFILIATE_APPLICATION_EMAIL_PATTERN.test(email)
  ) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
    };
  }

  const instagram = optionalSocialField(body.instagram);
  if (instagram && !instagram.ok) return instagram;
  const tiktok = optionalSocialField(body.tiktok);
  if (tiktok && !tiktok.ok) return tiktok;
  const youtube = optionalSocialField(body.youtube);
  if (youtube && !youtube.ok) return youtube;
  const website = optionalSocialField(body.website);
  if (website && !website.ok) return website;
  const otherSocial = optionalSocialField(body.otherSocial);
  if (otherSocial && !otherSocial.ok) return otherSocial;

  const socialFields = [
    instagram?.value || null,
    tiktok?.value || null,
    youtube?.value || null,
    website?.value || null,
    otherSocial?.value || null,
  ];
  if (!socialFields.some(Boolean)) {
    return {
      ok: false,
      error: "Please share at least one social profile or website.",
    };
  }

  const introduction = toPlainAffiliateApplicationText(body.introduction);
  if (introduction.length < 20 || introduction.length > 1000) {
    return {
      ok: false,
      error: "Please tell us a little about yourself in 20 to 1,000 characters.",
    };
  }

  return {
    ok: true,
    error: null,
    fields: {
      displayName,
      email,
      instagram: socialFields[0],
      tiktok: socialFields[1],
      youtube: socialFields[2],
      website: socialFields[3],
      otherSocial: socialFields[4],
      introduction,
    },
  };
}

export function toPublicAffiliateApplication(application) {
  if (!application) return null;
  return {
    displayName: application.display_name,
    email: application.email,
    instagram: application.instagram,
    tiktok: application.tiktok,
    youtube: application.youtube,
    website: application.website,
    otherSocial: application.other_social,
    introduction: application.introduction,
    reviewStatus: application.review_status,
    createdAt: application.created_at,
    reviewedAt: application.reviewed_at,
    approvedAt: application.approved_at,
  };
}

export function hasAffiliateApplicationHoneypot(body = {}) {
  const company = typeof body.company === "string" ? body.company.trim() : body.company;
  return Boolean(company);
}

function applicationWritePayload(fields, { userId = null, source }) {
  return {
    user_id: userId,
    email: fields.email,
    display_name: fields.displayName,
    instagram: fields.instagram,
    tiktok: fields.tiktok,
    youtube: fields.youtube,
    website: fields.website,
    other_social: fields.otherSocial,
    introduction: fields.introduction,
    source,
  };
}

export async function getAffiliateApplicationForUser({ supabaseAdmin, user }) {
  if (!user?.id) return null;

  const { data: byUser, error: byUserError } = await supabaseAdmin
    .from("affiliate_applications")
    .select(AFFILIATE_APPLICATION_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (byUserError) throw new Error("Failed to load affiliate application");
  if (byUser) return byUser;

  const email = normalizeAffiliateApplicationEmail(user.email);
  if (!email) return null;

  const { data: byEmail, error: byEmailError } = await supabaseAdmin
    .from("affiliate_applications")
    .select(AFFILIATE_APPLICATION_SELECT)
    .eq("email", email)
    .maybeSingle();

  if (byEmailError) throw new Error("Failed to load affiliate application");
  if (!byEmail) return null;
  if (byEmail.user_id) return null;

  const { data: bound, error: bindError } = await supabaseAdmin
    .from("affiliate_applications")
    .update({ user_id: user.id })
    .eq("id", byEmail.id)
    .is("user_id", null)
    .select(AFFILIATE_APPLICATION_SELECT)
    .maybeSingle();

  if (bindError) {
    if (bindError.code === "23505") {
      const { data: existing, error } = await supabaseAdmin
        .from("affiliate_applications")
        .select(AFFILIATE_APPLICATION_SELECT)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw new Error("Failed to load affiliate application");
      return existing;
    }
    throw new Error("Failed to link affiliate application");
  }

  if (bound?.user_id === user.id) return bound;

  const { data: reloaded, error: reloadError } = await supabaseAdmin
    .from("affiliate_applications")
    .select(AFFILIATE_APPLICATION_SELECT)
    .eq("id", byEmail.id)
    .maybeSingle();

  if (reloadError) throw new Error("Failed to load affiliate application");
  if (reloaded?.user_id === user.id) return reloaded;
  return null;
}

export async function findAffiliateApplicationByEmail(supabaseAdmin, email) {
  const normalized = normalizeAffiliateApplicationEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabaseAdmin
    .from("affiliate_applications")
    .select(AFFILIATE_APPLICATION_SELECT)
    .eq("email", normalized)
    .maybeSingle();

  if (error) throw new Error("Failed to load affiliate application");
  return data;
}

export async function insertAffiliateApplication({
  supabaseAdmin,
  fields,
  source,
  userId = null,
}) {
  const { data, error } = await supabaseAdmin
    .from("affiliate_applications")
    .insert(applicationWritePayload(fields, { userId, source }))
    .select(AFFILIATE_APPLICATION_SELECT)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { duplicate: true, application: null };
    }
    throw new Error("Failed to save affiliate application");
  }

  return { duplicate: false, application: data };
}

export async function updatePendingAffiliateApplication({
  supabaseAdmin,
  applicationId,
  fields,
  userId = null,
}) {
  const updatePayload = applicationWritePayload(fields, {
    userId,
    source: "dashboard",
  });
  delete updatePayload.source;

  const { data, error } = await supabaseAdmin
    .from("affiliate_applications")
    .update(updatePayload)
    .eq("id", applicationId)
    .eq("review_status", "pending")
    .select(AFFILIATE_APPLICATION_SELECT)
    .maybeSingle();

  if (error) throw new Error("Failed to update affiliate application");
  return data;
}

export async function markAffiliateApplicationConverted({
  supabaseAdmin,
  applicationId,
  affiliateId,
  now = () => new Date().toISOString(),
}) {
  if (!applicationId || !affiliateId) return;

  const { error } = await supabaseAdmin
    .from("affiliate_applications")
    .update({
      affiliate_id: affiliateId,
      converted_at: now(),
    })
    .eq("id", applicationId)
    .is("affiliate_id", null);

  if (error) {
    console.error("[Affiliate] Failed to record application conversion:", {
      applicationId,
      affiliateId,
      message: error.message,
    });
  }
}
