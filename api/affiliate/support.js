import {
  affiliateApiError,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";

async function loadSupport(supabaseAdmin, userId) {
  const { data: attribution, error } = await supabaseAdmin
    .from("affiliate_attributions")
    .select("affiliate_id, source_code, attributed_at, status")
    .eq("subscriber_user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load support attribution");
  if (!attribution || attribution.status !== "active") return null;

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from("affiliates")
    .select("display_name, code")
    .eq("id", attribution.affiliate_id)
    .maybeSingle();
  if (affiliateError) throw new Error("Failed to load supported affiliate");
  return affiliate
    ? {
        affiliateDisplayName: affiliate.display_name,
        affiliateCode: affiliate.code,
        attributedAt: attribution.attributed_at,
      }
    : null;
}

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "GET, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Affiliate Codes are applied in Stripe Checkout.",
    });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);
    const support = await loadSupport(supabaseAdmin, user.id);
    return res.status(200).json({ ok: true, support });
  } catch (error) {
    return affiliateApiError(res, error, "support request failed");
  }
}
