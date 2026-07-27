import {
  affiliateApiError,
  ensureAffiliateRecipientAccount,
  getAffiliateForUser,
  getAffiliateReturnUrls,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";
import { createAffiliateAccountLink } from "../_lib/stripe.js";

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "POST, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);
    const affiliate = await getAffiliateForUser(supabaseAdmin, user.id);
    if (!affiliate || affiliate.status === "closed") {
      return res.status(409).json({
        ok: false,
        error: "Affiliate payout setup is not available.",
      });
    }

    const accountId = await ensureAffiliateRecipientAccount({
      affiliate,
      user,
      supabaseAdmin,
    });

    const { refreshUrl, returnUrl } = getAffiliateReturnUrls();
    const accountLink = await createAffiliateAccountLink(accountId, {
      refreshUrl,
      returnUrl,
    });
    return res.status(200).json({ ok: true, url: accountLink.url });
  } catch (error) {
    return affiliateApiError(res, error, "onboarding link failed");
  }
}
