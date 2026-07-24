import {
  affiliateApiError,
  getAffiliateForUser,
  handleOptions,
  requireAffiliateContext,
  setPrivateApiHeaders,
} from "../_lib/affiliate-server.js";

function monthKey(value) {
  return new Date(value).toISOString().slice(0, 7);
}

function lastTwelveMonths() {
  const now = new Date();
  const months = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    months.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
        .toISOString()
        .slice(0, 7),
    );
  }
  return months;
}

export default async function handler(req, res) {
  setPrivateApiHeaders(res, "GET, OPTIONS");
  if (handleOptions(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabaseAdmin } = await requireAffiliateContext(req);
    const affiliate = await getAffiliateForUser(supabaseAdmin, user.id);
    if (!affiliate || affiliate.status !== "active") {
      return res.status(403).json({
        ok: false,
        error: "An active Affiliate account is required.",
      });
    }

    const [supporterResult, commissionResult, adjustmentResult, payoutResult] =
      await Promise.all([
        supabaseAdmin.rpc("get_affiliate_active_supporter_count", {
          p_affiliate_id: affiliate.id,
        }),
        supabaseAdmin
          .from("affiliate_commissions")
          .select(
            "subscriber_user_id, amount_cents, status, created_at, available_at",
          )
          .eq("affiliate_id", affiliate.id),
        supabaseAdmin
          .from("affiliate_adjustments")
          .select("amount_cents, status")
          .eq("affiliate_id", affiliate.id),
        supabaseAdmin
          .from("affiliate_payouts")
          .select(
            "payout_month, net_amount_cents, commission_count, status, paid_at",
          )
          .eq("affiliate_id", affiliate.id)
          .order("payout_month", { ascending: false })
          .limit(24),
      ]);

    if (
      supporterResult.error ||
      commissionResult.error ||
      adjustmentResult.error ||
      payoutResult.error
    ) {
      throw new Error("Failed to load affiliate summary");
    }

    const commissions = commissionResult.data || [];
    const adjustments = adjustmentResult.data || [];
    const payouts = payoutResult.data || [];
    const currentMonth = new Date().toISOString().slice(0, 7);
    const earnedStatuses = new Set(["pending", "available", "paid"]);

    const estimatedThisMonthCents = commissions
      .filter(
        (row) =>
          monthKey(row.created_at) === currentMonth &&
          earnedStatuses.has(row.status),
      )
      .reduce((sum, row) => sum + row.amount_cents, 0);

    const pendingBalanceCents = commissions
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + row.amount_cents, 0);

    const availableCommissionCents = commissions
      .filter((row) => row.status === "available")
      .reduce((sum, row) => sum + row.amount_cents, 0);
    const pendingAdjustmentCents = adjustments
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + row.amount_cents, 0);

    const lifetimePaidCents = payouts
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + row.net_amount_cents, 0);

    const monthlyMap = new Map(
      lastTwelveMonths().map((month) => [
        month,
        { month, earnedCents: 0, paidCents: 0, supporterIds: new Set() },
      ]),
    );

    commissions.forEach((row) => {
      const month = monthKey(row.created_at);
      const target = monthlyMap.get(month);
      if (!target || !earnedStatuses.has(row.status)) return;
      target.earnedCents += row.amount_cents;
      target.supporterIds.add(row.subscriber_user_id);
    });
    payouts.forEach((row) => {
      const month = String(row.payout_month).slice(0, 7);
      const target = monthlyMap.get(month);
      if (target && row.status === "paid") {
        target.paidCents += row.net_amount_cents;
      }
    });

    return res.status(200).json({
      ok: true,
      summary: {
        activeSupporters: Number(supporterResult.data || 0),
        estimatedThisMonthCents,
        pendingBalanceCents,
        availableBalanceCents: availableCommissionCents + pendingAdjustmentCents,
        lifetimePaidCents,
      },
      monthly: [...monthlyMap.values()].map((row) => ({
        month: row.month,
        earnedCents: row.earnedCents,
        paidCents: row.paidCents,
        supporterCount: row.supporterIds.size,
      })),
      payouts: payouts.map((row) => ({
        month: String(row.payout_month).slice(0, 7),
        amountCents: row.net_amount_cents,
        commissionCount: row.commission_count,
        status: row.status,
        paidAt: row.paid_at,
      })),
    });
  } catch (error) {
    return affiliateApiError(res, error, "summary failed");
  }
}
