import { validateAffiliateCountry } from "../_lib/affiliate.js";
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

function validationError(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

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

    const needsCountry = !affiliate.stripe_connect_account_id;
    const countryResult = needsCountry
      ? validateAffiliateCountry(req.body?.country)
      : { ok: true, country: null, error: null };

    if (!countryResult.ok) {
      return validationError(res, countryResult.error);
    }

    const accountId = await ensureAffiliateRecipientAccount({
      affiliate,
      user,
      country: countryResult.country,
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
