import {
  affiliateApiError,
  getAffiliateForUser,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
  syncAffiliateAccountState,
  syncAffiliatePromotionCodeState,
} from "../_lib/affiliate-server.js";
import { getStripeClient } from "../_lib/stripe.js";

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "POST, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);
    const affiliate = await getAffiliateForUser(supabaseAdmin, user.id);

    if (!affiliate) {
      return res.status(404).json({
        ok: false,
        error: "Affiliate account not found",
      });
    }

    if (!affiliate.stripe_connect_account_id) {
      return res.status(409).json({
        ok: false,
        error: "Stripe setup has not started",
      });
    }

    const synced = await syncAffiliateAccountState({
      affiliate,
      supabaseAdmin,
    });

    try {
      await syncAffiliatePromotionCodeState({
        stripe: getStripeClient(),
        supabaseAdmin,
        affiliate: synced,
        previousStatus: affiliate.status,
      });
    } catch (error) {
      console.error("[Affiliate] promotion sync failed:", {
        affiliateId: synced.id,
        message: error?.message || "Unknown error",
      });
    }

    return res.status(200).json({
      ok: true,
      status: synced.status,
      detailsSubmitted: synced.details_submitted,
      payoutsEnabled: synced.payouts_enabled,
      taxSetupStatus: synced.tax_setup_status,
      stripeTransfersStatus: synced.stripe_transfers_status,
      recipientPayoutsStatus: synced.recipient_payouts_status,
      requirementsStatus: synced.requirements_status,
    });
  } catch (error) {
    return affiliateApiError(res, error, "refresh status failed");
  }
}
