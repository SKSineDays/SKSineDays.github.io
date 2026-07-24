import {
  getAffiliateTermsVersion,
  validateAffiliateCode,
  validateAffiliateDisplayName,
} from "../_lib/affiliate.js";
import {
  affiliateApiError,
  getAffiliateForUser,
  getAffiliateReturnUrls,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";
import {
  createAffiliateAccountLink,
  createAffiliateRecipientAccount,
} from "../_lib/stripe.js";

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

    let affiliate = await getAffiliateForUser(supabaseAdmin, user.id);
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
    }

    let accountId = affiliate.stripe_connect_account_id;
    if (!accountId) {
      const account = await createAffiliateRecipientAccount({
        contactEmail: user.email,
        displayName: affiliate.display_name,
        userId: user.id,
        affiliateId: affiliate.id,
        idempotencyKey: `sineday-affiliate-account-${affiliate.id}`,
      });
      accountId = account.id;

      const { error } = await supabaseAdmin
        .from("affiliates")
        .update({
          stripe_connect_account_id: accountId,
          stripe_status_updated_at: new Date().toISOString(),
        })
        .eq("id", affiliate.id)
        .is("stripe_connect_account_id", null);
      if (error) throw new Error("Failed to save affiliate account");
    }

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
