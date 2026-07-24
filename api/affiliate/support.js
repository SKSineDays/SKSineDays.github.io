import {
  getStripeObjectId,
  isEligiblePremiumInvoice,
  normalizeAffiliateCode,
  unixSecondsToIso,
  validateAffiliateCode,
} from "../_lib/affiliate.js";
import {
  affiliateApiError,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";
import { getStripeClient } from "../_lib/stripe.js";

function utcCalendarDaysSince(unixSeconds) {
  const paidDate = new Date(Number(unixSeconds) * 1000);
  const now = new Date();
  const paidUtc = Date.UTC(
    paidDate.getUTCFullYear(),
    paidDate.getUTCMonth(),
    paidDate.getUTCDate(),
  );
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowUtc - paidUtc) / 86_400_000);
}

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

async function loadPaidPremiumInvoices(supabaseAdmin, userId) {
  const { data: subscription, error } = await supabaseAdmin
    .from("subscriptions")
    .select("status, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to verify Premium membership");
  if (
    subscription?.status !== "active" ||
    !subscription.stripe_subscription_id
  ) {
    return { subscription, invoices: [] };
  }

  const stripe = getStripeClient();
  const invoiceList = await stripe.invoices.list({
    subscription: subscription.stripe_subscription_id,
    status: "paid",
    limit: 100,
  });
  const premiumPriceId = process.env.STRIPE_PRICE_ID;
  if (!premiumPriceId) throw new Error("Missing Premium price configuration");

  const invoices = invoiceList.data.filter((invoice) =>
    isEligiblePremiumInvoice(invoice, premiumPriceId),
  );
  return { subscription, invoices };
}

async function backfillFirstInvoice(supabaseAdmin, userId, invoices) {
  if (!invoices.length) return;

  const sorted = [...invoices].sort((a, b) => {
    const aPaid = a.status_transitions?.paid_at || a.created;
    const bPaid = b.status_transitions?.paid_at || b.created;
    return aPaid - bPaid;
  });
  const invoice = sorted[0];
  const paidAt = invoice.status_transitions?.paid_at || invoice.created;
  if (utcCalendarDaysSince(paidAt) < 0 || utcCalendarDaysSince(paidAt) > 7) return;

  const { error } = await supabaseAdmin.rpc("record_affiliate_commission", {
    p_subscriber_user_id: userId,
    p_stripe_invoice_id: invoice.id,
    p_stripe_subscription_id: getStripeObjectId(invoice.subscription),
    p_stripe_event_id: null,
    p_paid_at: unixSecondsToIso(paidAt),
    p_billing_period_start: unixSecondsToIso(invoice.period_start),
    p_billing_period_end: unixSecondsToIso(invoice.period_end),
  });
  if (error) throw new Error("Failed to record initial affiliate commission");
}

function mapSupportError(error) {
  const message = error?.message || "";
  if (message.includes("AFFILIATE_SELF_REFERRAL")) {
    return [
      400,
      "You cannot connect your own Affiliate Code to your Premium membership.",
    ];
  }
  if (message.includes("AFFILIATE_ATTRIBUTION_ALREADY_EXISTS")) {
    return [409, "Your Premium membership already supports an affiliate."];
  }
  if (message.includes("AFFILIATE_CODE_NOT_ACTIVE")) {
    return [404, "That Affiliate Code is not available."];
  }
  if (message.includes("AFFILIATE_STRIPE_PREMIUM_REQUIRED")) {
    return [402, "A paid SineDay Premium membership is required."];
  }
  return null;
}

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "GET, POST, OPTIONS");
  if (handleOptions(req, res)) return;
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);

    if (req.method === "GET") {
      const support = await loadSupport(supabaseAdmin, user.id);
      return res.status(200).json({ ok: true, support });
    }

    const validation = validateAffiliateCode(req.body?.code);
    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid Affiliate Code.",
      });
    }

    const { invoices } = await loadPaidPremiumInvoices(supabaseAdmin, user.id);
    if (!invoices.length) {
      return res.status(402).json({
        ok: false,
        error: "A successful paid SineDay Premium invoice is required.",
      });
    }

    if (req.body?.confirmed !== true) {
      const existingSupport = await loadSupport(supabaseAdmin, user.id);
      if (existingSupport) {
        return res.status(409).json({
          ok: false,
          error: "Your Premium membership already supports an affiliate.",
        });
      }

      const { data: candidate, error: candidateError } = await supabaseAdmin
        .from("affiliates")
        .select("user_id, display_name, code, status")
        .eq("code", validation.code)
        .maybeSingle();
      if (candidateError) throw new Error("Failed to validate Affiliate Code");
      if (!candidate || candidate.status !== "active") {
        return res.status(404).json({
          ok: false,
          error: "That Affiliate Code is not available.",
        });
      }
      if (candidate.user_id === user.id) {
        return res.status(400).json({
          ok: false,
          error:
            "You cannot connect your own Affiliate Code to your Premium membership.",
        });
      }

      return res.status(200).json({
        ok: true,
        requiresConfirmation: true,
        affiliateDisplayName: candidate.display_name,
        affiliateCode: candidate.code,
      });
    }

    const { data: attribution, error } = await supabaseAdmin.rpc(
      "create_affiliate_attribution",
      {
        p_subscriber_user_id: user.id,
        p_code: normalizeAffiliateCode(validation.code),
      },
    );
    if (error) {
      const mapped = mapSupportError(error);
      if (mapped) {
        return res.status(mapped[0]).json({ ok: false, error: mapped[1] });
      }
      throw error;
    }

    await backfillFirstInvoice(supabaseAdmin, user.id, invoices);

    return res.status(200).json({
      ok: true,
      support: {
        affiliateDisplayName: attribution.affiliate_display_name,
        affiliateCode: attribution.affiliate_code,
        attributedAt: attribution.attributed_at,
      },
      message: `You’re now supporting ${attribution.affiliate_display_name} with your SineDay Premium membership.`,
    });
  } catch (error) {
    return affiliateApiError(res, error, "support request failed");
  }
}
