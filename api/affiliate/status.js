import {
  affiliateApiError,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
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
    const [affiliateResult, attributionResult] = await Promise.all([
      supabaseAdmin
        .from("affiliates")
        .select(
          "status, code, display_name, payouts_enabled, details_submitted, tax_setup_status, stripe_transfers_status, recipient_payouts_status, requirements_status",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("affiliate_attributions")
        .select("affiliate_id, source_code, attributed_at, status")
        .eq("subscriber_user_id", user.id)
        .maybeSingle(),
    ]);

    if (affiliateResult.error || attributionResult.error) {
      throw new Error("Failed to load affiliate status");
    }

    let support = null;
    const attribution = attributionResult.data;
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

    return res.status(200).json({
      ok: true,
      affiliate: toSafeAffiliate(affiliateResult.data),
      support,
    });
  } catch (error) {
    return affiliateApiError(res, error, "status failed");
  }
}
