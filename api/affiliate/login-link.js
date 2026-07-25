import {
  affiliateApiError,
  getAffiliateForUser,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";
import { createAffiliateDashboardLoginLink } from "../_lib/stripe.js";

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "POST, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);
    const affiliate = await getAffiliateForUser(supabaseAdmin, user.id);
    if (
      !affiliate?.stripe_connect_account_id ||
      !["active", "onboarding", "paused"].includes(affiliate.status)
    ) {
      return res.status(409).json({
        ok: false,
        error: "Affiliate payout details are not available.",
      });
    }

    const loginLink = await createAffiliateDashboardLoginLink(
      affiliate.stripe_connect_account_id,
    );
    return res.status(200).json({ ok: true, url: loginLink.url });
  } catch (error) {
    return affiliateApiError(res, error, "dashboard link failed");
  }
}
