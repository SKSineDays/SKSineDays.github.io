import { authenticateUser, getAdminClient } from "./auth.js";
import {
  collectPromotionCodeIds,
  deriveAffiliateAccountState,
  getAffiliateCouponId,
  getPromotionCouponId,
  getStripeObjectId,
  isAffiliateProgramEnabled,
  validateAffiliateCode,
} from "./affiliate.js";
import {
  createAffiliateRecipientAccount,
  getStripeClient,
  retrieveAffiliateAccount,
} from "./stripe.js";

const AFFILIATE_SYNC_SELECT = [
  "id",
  "user_id",
  "code",
  "display_name",
  "status",
  "stripe_connect_account_id",
  "stripe_promotion_code_id",
  "stripe_promotion_code_created_at",
  "details_submitted",
  "payouts_enabled",
  "tax_setup_status",
  "stripe_transfers_status",
  "recipient_payouts_status",
  "requirements_status",
  "activated_at",
  "updated_at",
].join(", ");

const AFFILIATE_PROMOTION_SELECT = [
  "id",
  "user_id",
  "code",
  "status",
  "stripe_promotion_code_id",
  "stripe_promotion_code_created_at",
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

function promotionMatchesAffiliateCoupon(promotion, couponId) {
  return getPromotionCouponId(promotion) === couponId;
}

async function listPromotionCodesByAffiliateCode(stripe, code) {
  const listed = await stripe.promotionCodes.list({
    code,
    limit: 20,
  });
  return (listed?.data || []).filter(
    (promotion) => String(promotion?.code || "").toUpperCase() === code,
  );
}

async function persistAffiliatePromotionCode({
  supabaseAdmin,
  affiliate,
  promotionCodeId,
  now,
}) {
  const { data: updated, error } = await supabaseAdmin
    .from("affiliates")
    .update({
      stripe_promotion_code_id: promotionCodeId,
      stripe_promotion_code_created_at: now(),
    })
    .eq("id", affiliate.id)
    .is("stripe_promotion_code_id", null)
    .select(AFFILIATE_PROMOTION_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to save affiliate promotion code");
  }

  if (updated?.stripe_promotion_code_id) {
    return updated;
  }

  const { data: reloaded, error: reloadError } = await supabaseAdmin
    .from("affiliates")
    .select(AFFILIATE_PROMOTION_SELECT)
    .eq("id", affiliate.id)
    .maybeSingle();

  if (reloadError) {
    throw new Error("Failed to load affiliate promotion code");
  }

  if (!reloaded?.stripe_promotion_code_id) {
    throw new Error("Failed to persist affiliate promotion code");
  }

  return reloaded;
}

export async function ensureAffiliatePromotionCode({
  stripe,
  supabaseAdmin,
  affiliate,
  couponId = getAffiliateCouponId(),
  now = () => new Date().toISOString(),
}) {
  if (affiliate?.stripe_promotion_code_id) {
    return {
      promotionCodeId: affiliate.stripe_promotion_code_id,
      affiliate,
      created: false,
    };
  }

  if (affiliate?.status !== "active") {
    const error = new Error("Affiliate is not eligible for a promotion code");
    error.code = "AFFILIATE_PROMOTION_NOT_ELIGIBLE";
    throw error;
  }

  if (!couponId) {
    throw new Error("Missing affiliate coupon configuration");
  }

  if (!affiliate?.id || !affiliate?.code) {
    throw new Error("Affiliate promotion code is missing required identity");
  }

  let matches = await listPromotionCodesByAffiliateCode(stripe, affiliate.code);
  let promotion = matches.find((item) =>
    promotionMatchesAffiliateCoupon(item, couponId),
  );

  if (!promotion && matches.length) {
    const error = new Error(
      "Affiliate promotion code is not tied to the SineDay Affiliate coupon",
    );
    error.code = "AFFILIATE_PROMOTION_COUPON_MISMATCH";
    throw error;
  }

  if (!promotion) {
    try {
      promotion = await stripe.promotionCodes.create(
        {
          coupon: couponId,
          code: affiliate.code,
          metadata: {
            sineday_affiliate_id: affiliate.id,
            sineday_affiliate_code: affiliate.code,
          },
        },
        { idempotencyKey: `sineday-affiliate-promo-${affiliate.id}` },
      );
    } catch (error) {
      matches = await listPromotionCodesByAffiliateCode(stripe, affiliate.code);
      promotion = matches.find((item) =>
        promotionMatchesAffiliateCoupon(item, couponId),
      );
      if (!promotion) {
        throw error;
      }
    }
  }

  if (promotion?.active === false) {
    promotion = await stripe.promotionCodes.update(promotion.id, {
      active: true,
    });
  }

  const promotionCodeId = promotion?.id;
  if (!promotionCodeId) {
    throw new Error("Stripe did not return a promotion code ID");
  }

  const persisted = await persistAffiliatePromotionCode({
    supabaseAdmin,
    affiliate,
    promotionCodeId,
    now,
  });

  console.log("affiliate promotion ensured", {
    affiliateId: affiliate.id,
    promotionCodeId: persisted.stripe_promotion_code_id,
  });

  return {
    promotionCodeId: persisted.stripe_promotion_code_id,
    affiliate: { ...affiliate, ...persisted },
    created: persisted.stripe_promotion_code_id === promotionCodeId,
  };
}

async function setAffiliatePromotionCodeActive(stripe, promotionCodeId, active) {
  if (!promotionCodeId) return;
  await stripe.promotionCodes.update(promotionCodeId, { active });
}

export async function syncAffiliatePromotionCodeState({
  stripe,
  supabaseAdmin,
  affiliate,
  previousStatus = null,
  now = () => new Date().toISOString(),
}) {
  if (!affiliate?.id) return affiliate;

  if (affiliate.status === "active") {
    const ensured = await ensureAffiliatePromotionCode({
      stripe,
      supabaseAdmin,
      affiliate,
      now,
    });
    if (
      affiliate.stripe_promotion_code_id &&
      previousStatus &&
      previousStatus !== "active"
    ) {
      try {
        await setAffiliatePromotionCodeActive(
          stripe,
          affiliate.stripe_promotion_code_id,
          true,
        );
      } catch (error) {
        console.error("[Affiliate] Failed to reactivate promotion code:", {
          affiliateId: affiliate.id,
          message: error?.message || "Unknown error",
        });
      }
    }
    return ensured.affiliate || affiliate;
  }

  if (
    ["paused", "closed"].includes(affiliate.status) &&
    affiliate.stripe_promotion_code_id
  ) {
    try {
      await setAffiliatePromotionCodeActive(
        stripe,
        affiliate.stripe_promotion_code_id,
        false,
      );
    } catch (error) {
      console.error("[Affiliate] Failed to deactivate promotion code:", {
        affiliateId: affiliate.id,
        message: error?.message || "Unknown error",
      });
    }
  }

  return affiliate;
}

export async function recoverAffiliatePromotionCodeIfNeeded({
  stripe,
  supabaseAdmin,
  affiliate,
  now = () => new Date().toISOString(),
}) {
  if (affiliate?.status !== "active" || affiliate?.stripe_promotion_code_id) {
    return affiliate;
  }

  try {
    const ensured = await ensureAffiliatePromotionCode({
      stripe: stripe || getStripeClient(),
      supabaseAdmin,
      affiliate,
      now,
    });
    return ensured.affiliate || affiliate;
  } catch (error) {
    console.error("[Affiliate] promotion recovery failed:", {
      affiliateId: affiliate?.id || null,
      message: error?.message || "Unknown error",
    });
    return affiliate;
  }
}

export async function resolveCheckoutAffiliateReferral({
  stripe,
  supabaseAdmin,
  user,
  affiliateCode,
  now = () => new Date().toISOString(),
}) {
  if (!affiliateCode) return null;

  const validation = validateAffiliateCode(affiliateCode);
  if (!validation.ok) return null;

  const { data: affiliate, error } = await supabaseAdmin
    .from("affiliates")
    .select(AFFILIATE_PROMOTION_SELECT)
    .eq("code", validation.code)
    .maybeSingle();

  if (error) throw new Error("Failed to load affiliate referral");
  if (!affiliate || affiliate.status !== "active") return null;
  if (affiliate.user_id === user.id) {
    console.log("self-referral checkout promotion skipped", {
      affiliateId: affiliate.id,
    });
    return null;
  }

  const ensured = await ensureAffiliatePromotionCode({
    stripe,
    supabaseAdmin,
    affiliate,
    now,
  });

  return {
    affiliateId: affiliate.id,
    code: affiliate.code,
    promotionCodeId: ensured.promotionCodeId,
  };
}

export function applyAffiliateCheckoutMode(sessionParams, referral) {
  const next = {
    ...sessionParams,
    metadata: { ...(sessionParams.metadata || {}) },
  };

  if (referral?.promotionCodeId) {
    next.discounts = [{ promotion_code: referral.promotionCodeId }];
    next.metadata.affiliate_ref_code = referral.code;
    next.metadata.affiliate_id = referral.affiliateId;
    next.metadata.affiliate_promotion_code_id = referral.promotionCodeId;
    delete next.allow_promotion_codes;
    return next;
  }

  next.allow_promotion_codes = true;
  delete next.discounts;
  return next;
}

function hasUnexpandedDiscountRefs(value) {
  if (!value) return false;
  const items = Array.isArray(value.discounts)
    ? value.discounts
    : value.discounts?.data;
  if (Array.isArray(items) && items.some((item) => typeof item === "string")) {
    return true;
  }
  return Boolean(value.discount && typeof value.discount === "string");
}

export async function retrieveCheckoutPromotionCodeIds(stripe, session) {
  const immediate = collectPromotionCodeIds({ session });
  if (immediate.length) return immediate;

  const sessionId = getStripeObjectId(session);
  let expandedSession = session;
  if (sessionId && stripe?.checkout?.sessions?.retrieve) {
    try {
      expandedSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["discounts.promotion_code", "subscription"],
      });
    } catch (error) {
      console.error("[Affiliate] Failed to expand checkout discounts:", {
        message: error?.message || "Unknown error",
      });
    }
  }

  const fromSession = collectPromotionCodeIds({ session: expandedSession });
  if (fromSession.length) return fromSession;

  const subscriptionId = getStripeObjectId(
    expandedSession?.subscription || session?.subscription,
  );
  if (!subscriptionId || !stripe?.subscriptions?.retrieve) return fromSession;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["discounts", "discount.promotion_code"],
    });
    return collectPromotionCodeIds({
      session: expandedSession,
      subscription,
    });
  } catch (error) {
    console.error("[Affiliate] Failed to expand checkout subscription discounts:", {
      message: error?.message || "Unknown error",
    });
    return fromSession;
  }
}

export async function retrieveInvoicePromotionCodeIds(stripe, invoice) {
  const immediate = collectPromotionCodeIds({ invoice });
  if (immediate.length) return immediate;

  let expandedInvoice = invoice;
  const invoiceId = getStripeObjectId(invoice);
  if (
    invoiceId &&
    hasUnexpandedDiscountRefs(invoice) &&
    stripe?.invoices?.retrieve
  ) {
    try {
      expandedInvoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ["discounts", "discount.promotion_code"],
      });
    } catch (error) {
      console.error("[Affiliate] Failed to expand invoice discounts:", {
        message: error?.message || "Unknown error",
      });
    }
  }

  const fromInvoice = collectPromotionCodeIds({ invoice: expandedInvoice });
  if (fromInvoice.length) return fromInvoice;

  const subscriptionId = getStripeObjectId(
    expandedInvoice?.subscription || invoice?.subscription,
  );
  if (!subscriptionId || !stripe?.subscriptions?.retrieve) return fromInvoice;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["discounts", "discount.promotion_code"],
    });
    return collectPromotionCodeIds({
      invoice: expandedInvoice,
      subscription,
    });
  } catch (error) {
    console.error("[Affiliate] Failed to expand invoice subscription discounts:", {
      message: error?.message || "Unknown error",
    });
    return fromInvoice;
  }
}

function isAttributionConflict(error, code) {
  const message = error?.message || "";
  return message.includes(code);
}

export async function recordAffiliateAttributionFromPromotion({
  supabaseAdmin,
  subscriberUserId,
  promotionCodeIds,
  source = "checkout",
}) {
  if (!subscriberUserId || !promotionCodeIds?.length) {
    return { recorded: false, reason: "no_promotion" };
  }

  let sawMappedAffiliate = false;

  for (const promotionCodeId of promotionCodeIds) {
    const { data: affiliate, error } = await supabaseAdmin
      .from("affiliates")
      .select(AFFILIATE_PROMOTION_SELECT)
      .eq("stripe_promotion_code_id", promotionCodeId)
      .maybeSingle();

    if (error) throw new Error("Failed to resolve affiliate promotion");
    if (!affiliate) {
      console.log("non-affiliate promotion ignored for attribution", {
        promotionCodeId,
      });
      continue;
    }

    sawMappedAffiliate = true;

    if (affiliate.status !== "active") {
      console.log("inactive affiliate promotion ignored for attribution", {
        affiliateId: affiliate.id,
      });
      continue;
    }

    if (affiliate.user_id === subscriberUserId) {
      console.log("self-referral commission rejected", {
        affiliateId: affiliate.id,
      });
      return { recorded: false, reason: "self_referral", affiliate };
    }

    const { data: attribution, error: attributionError } = await supabaseAdmin.rpc(
      "create_affiliate_attribution",
      {
        p_subscriber_user_id: subscriberUserId,
        p_code: affiliate.code,
      },
    );

    if (attributionError) {
      if (isAttributionConflict(attributionError, "AFFILIATE_ATTRIBUTION_ALREADY_EXISTS")) {
        return { recorded: false, reason: "already_exists", affiliate };
      }
      if (isAttributionConflict(attributionError, "AFFILIATE_SELF_REFERRAL")) {
        console.log("self-referral commission rejected", {
          affiliateId: affiliate.id,
        });
        return { recorded: false, reason: "self_referral", affiliate };
      }
      throw new Error("Failed to record affiliate attribution");
    }

    console.log(
      source === "invoice"
        ? "affiliate attribution recovered from invoice"
        : "affiliate attribution recorded from checkout",
      {
        affiliateId: affiliate.id,
        existing: attribution?.existing === true,
      },
    );

    return {
      recorded: attribution?.existing !== true,
      reason: attribution?.existing === true ? "already_exists" : "created",
      affiliate,
      attribution,
    };
  }

  return {
    recorded: false,
    reason: sawMappedAffiliate ? "affiliate_not_eligible" : "no_mapped_affiliate",
  };
}

export async function recoverAffiliateAttributionFromInvoice({
  stripe,
  supabaseAdmin,
  invoice,
  userId,
}) {
  const { data: attribution, error } = await supabaseAdmin
    .from("affiliate_attributions")
    .select("id")
    .eq("subscriber_user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error("Failed to load affiliate attribution");
  if (attribution) {
    return { recorded: false, reason: "already_exists" };
  }

  const promotionCodeIds = await retrieveInvoicePromotionCodeIds(stripe, invoice);
  return recordAffiliateAttributionFromPromotion({
    supabaseAdmin,
    subscriberUserId: userId,
    promotionCodeIds,
    source: "invoice",
  });
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
