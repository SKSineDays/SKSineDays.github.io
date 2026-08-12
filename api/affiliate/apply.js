import {
  getAffiliateTermsVersion,
  validateAffiliateCode,
  validateAffiliateCountry,
  validateAffiliateDisplayName,
} from "../_lib/affiliate.js";
import {
  affiliateApiError,
  ensureAffiliateRecipientAccount,
  getAffiliateApplicationForUser,
  getAffiliateForUser,
  getAffiliateReturnUrls,
  handleOptions,
  markAffiliateApplicationConverted,
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
    const body = req.body || {};
    let affiliate = await getAffiliateForUser(supabaseAdmin, user.id);
    let approvedApplication = null;

    if (!affiliate) {
      approvedApplication = await getAffiliateApplicationForUser({
        supabaseAdmin,
        user,
      });
      if (approvedApplication?.review_status !== "approved") {
        return res.status(403).json({
          ok: false,
          error: "Your Affiliate application must be approved before setup can continue.",
        });
      }
    }

    const displayNameResult = validateAffiliateDisplayName(body.displayName);
    const codeResult = validateAffiliateCode(body.requestedCode);
    const termsVersion = getAffiliateTermsVersion();

    if (!displayNameResult.ok) {
      return validationError(res, displayNameResult.error);
    }
    if (!codeResult.ok) {
      return validationError(res, codeResult.error);
    }
    if (body.acceptedTermsVersion !== termsVersion) {
      return validationError(res, "Please review and accept the current Affiliate Terms.");
    }

    const needsCountry = !affiliate?.stripe_connect_account_id;
    const countryResult = needsCountry
      ? validateAffiliateCountry(body.country)
      : { ok: true, country: null, error: null };

    if (!countryResult.ok) {
      return validationError(res, countryResult.error);
    }

    if (affiliate) {
      const matchesApplication =
        affiliate.status === "onboarding" &&
        affiliate.code === codeResult.code &&
        affiliate.display_name === displayNameResult.displayName &&
        affiliate.accepted_terms_version === termsVersion;
      if (!matchesApplication) {
        return res.status(409).json({
          ok: false,
          error: "An Affiliate application already exists for this account.",
        });
      }
    } else {
      const { data, error } = await supabaseAdmin
        .from("affiliates")
        .insert({
          user_id: user.id,
          code: codeResult.code,
          display_name: displayNameResult.displayName,
          status: "onboarding",
          accepted_terms_version: termsVersion,
          accepted_terms_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            ok: false,
            error: "That Affiliate Code is already in use.",
          });
        }
        throw new Error("Failed to create affiliate application");
      }
      affiliate = data;
      await markAffiliateApplicationConverted({
        supabaseAdmin,
        applicationId: approvedApplication?.id,
        affiliateId: affiliate.id,
      });
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
    return affiliateApiError(res, error, "application failed");
  }
}
