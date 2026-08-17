import {
  affiliateApiError,
  getAffiliateApplicationForUser,
  handleOptions,
  recoverAffiliatePromotionCodeIfNeeded,
  requireAffiliateContext,
  setPrivateApiHeaders,
  shouldRefreshAffiliateFromStripe,
  syncAffiliateAccountState,
  toPublicAffiliateApplication,
} from "../_lib/affiliate-server.js";

function toSafeAffiliate(affiliate) {
  if (!affiliate) return null;
  const appUrl = (process.env.APP_URL || "https://sineday.app").replace(/\/+$/, "");
  return {
    status: affiliate.status,
    code: affiliate.code,
    displayName: affiliate.display_name,
    payoutsEnabled: affiliate.payouts_enabled,
    detailsSubmitted: affiliate.details_submitted,
    taxSetupStatus: affiliate.tax_setup_status,
    stripeTransfersStatus: affiliate.stripe_transfers_status,
    recipientPayoutsStatus: affiliate.recipient_payouts_status,
    requirementsStatus: affiliate.requirements_status,
    affiliateUrl: `${appUrl}/?ref=${encodeURIComponent(affiliate.code)}`,
  };
}

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "GET, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);

    const { data: storedAffiliate, error: affiliateError } = await supabaseAdmin
      .from("affiliates")
      .select(
        [
          "id",
          "user_id",
          "status",
          "code",
          "display_name",
          "stripe_connect_account_id",
          "details_submitted",
          "payouts_enabled",
          "tax_setup_status",
          "stripe_transfers_status",
          "recipient_payouts_status",
          "requirements_status",
          "activated_at",
          "updated_at",
          "stripe_promotion_code_id",
          "stripe_promotion_code_created_at",
        ].join(", "),
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (affiliateError) {
      throw new Error("Failed to load affiliate status");
    }

    let affiliate = storedAffiliate;
    if (affiliate && shouldRefreshAffiliateFromStripe(affiliate)) {
      affiliate = await syncAffiliateAccountState({
        affiliate,
        supabaseAdmin,
      });
    }

    if (affiliate?.status === "active" && !affiliate.stripe_promotion_code_id) {
      affiliate = await recoverAffiliatePromotionCodeIfNeeded({
        supabaseAdmin,
        affiliate,
      });
    }

    const { data: attribution, error: attributionError } = await supabaseAdmin
      .from("affiliate_attributions")
      .select("affiliate_id, source_code, attributed_at, status")
      .eq("subscriber_user_id", user.id)
      .maybeSingle();

    if (attributionError) {
      throw new Error("Failed to load affiliate status");
    }

    let support = null;
    if (attribution?.status === "active") {
      const { data: supportedAffiliate, error } = await supabaseAdmin
        .from("affiliates")
        .select("display_name, code")
        .eq("id", attribution.affiliate_id)
        .maybeSingle();
      if (error) throw new Error("Failed to load support attribution");
      if (supportedAffiliate) {
        support = {
          affiliateDisplayName: supportedAffiliate.display_name,
          affiliateCode: supportedAffiliate.code,
          attributedAt: attribution.attributed_at,
        };
      }
    }

    const application = await getAffiliateApplicationForUser({
      supabaseAdmin,
      user,
    });

    return res.status(200).json({
      ok: true,
      affiliate: toSafeAffiliate(affiliate),
      application: toPublicAffiliateApplication(application),
      viewerEmail: user.email || null,
      support,
    });
  } catch (error) {
    return affiliateApiError(res, error, "status failed");
  }
}
