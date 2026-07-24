export const AFFILIATE_CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
export const RESERVED_AFFILIATE_CODES = new Set([
  "SINEDAY",
  "ADMIN",
  "SUPPORT",
  "PREMIUM",
  "STRIPE",
  "RALUX",
]);

export function isAffiliateProgramEnabled() {
  return process.env.AFFILIATE_PROGRAM_ENABLED === "true";
}

export function getAffiliateTermsVersion() {
  return process.env.AFFILIATE_TERMS_VERSION || "2026-07-24";
}

export function normalizeAffiliateCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function validateAffiliateCode(value) {
  const code = normalizeAffiliateCode(value);
  if (!AFFILIATE_CODE_PATTERN.test(code)) {
    return { ok: false, code, error: "Use 4–20 letters, numbers, or hyphens." };
  }
  if (RESERVED_AFFILIATE_CODES.has(code)) {
    return { ok: false, code, error: "That Affiliate Code is reserved." };
  }
  return { ok: true, code, error: null };
}

export function validateAffiliateDisplayName(value) {
  const displayName = typeof value === "string" ? value.trim() : "";
  if (displayName.length < 2 || displayName.length > 80) {
    return {
      ok: false,
      displayName,
      error: "Display name must be between 2 and 80 characters.",
    };
  }
  return { ok: true, displayName, error: null };
}

function requirementRestrictsRecipientPayouts(entry) {
  const restricted = entry?.impact?.restricts_capabilities || [];
  return restricted.some(
    (item) =>
      item?.configuration === "recipient" &&
      (item?.capability === "stripe_balance.payouts" ||
        item?.capability === "stripe_balance.stripe_transfers"),
  );
}

function getRequirementSeverity(account) {
  const entries = account?.requirements?.entries || [];
  const relevantEntries = entries.filter(requirementRestrictsRecipientPayouts);
  const statuses = relevantEntries.flatMap((entry) => {
    const capabilityStatuses =
      entry?.impact?.restricts_capabilities
        ?.filter(
          (item) =>
            item?.configuration === "recipient" &&
            (item?.capability === "stripe_balance.payouts" ||
              item?.capability === "stripe_balance.stripe_transfers"),
        )
        .map((item) => item?.deadline?.status)
        .filter(Boolean) || [];

    return [
      entry?.minimum_deadline?.status,
      ...capabilityStatuses,
    ].filter(Boolean);
  });

  const summaryStatus = account?.requirements?.summary?.minimum_deadline?.status;
  if (summaryStatus) statuses.push(summaryStatus);

  if (statuses.includes("past_due")) return "past_due";
  if (statuses.includes("currently_due")) return "currently_due";
  if (statuses.includes("eventually_due")) return "eventually_due";
  return relevantEntries.length ? "currently_due" : "complete";
}

export function deriveAffiliateAccountState(account, currentProgramStatus = "onboarding") {
  const recipient = account?.configuration?.recipient;
  const stripeBalance = recipient?.capabilities?.stripe_balance;
  const transfersStatus = stripeBalance?.stripe_transfers?.status || "pending";
  const payoutsStatus = stripeBalance?.payouts?.status || "pending";
  const requirementsStatus = getRequirementSeverity(account);
  const closed = account?.closed === true;
  const recipientApplied = recipient?.applied === true;
  const payoutBlocked = requirementsStatus === "past_due";

  const stripeReady =
    !closed &&
    recipientApplied &&
    transfersStatus === "active" &&
    payoutsStatus === "active" &&
    !payoutBlocked;

  const detailsSubmitted =
    recipientApplied &&
    requirementsStatus !== "currently_due" &&
    requirementsStatus !== "past_due";

  let taxSetupStatus = "pending";
  if (!recipientApplied) taxSetupStatus = "not_started";
  else if (requirementsStatus === "past_due" || requirementsStatus === "currently_due") {
    taxSetupStatus = "action_required";
  } else if (stripeReady) {
    taxSetupStatus = "complete";
  }

  let programStatus = currentProgramStatus;
  if (!["paused", "closed"].includes(currentProgramStatus)) {
    programStatus = stripeReady ? "active" : "onboarding";
  }

  return {
    programStatus,
    stripeReady,
    recipientApplied,
    stripeTransfersStatus: transfersStatus,
    recipientPayoutsStatus: payoutsStatus,
    requirementsStatus,
    detailsSubmitted,
    payoutsEnabled: stripeReady,
    taxSetupStatus,
  };
}

export function isEligiblePremiumInvoice(invoice, premiumPriceId) {
  if (!invoice || invoice.status !== "paid" || Number(invoice.amount_paid) <= 0) {
    return false;
  }

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (!subscriptionId) return false;

  const billingReason = invoice.billing_reason;
  if (
    billingReason &&
    !["subscription_create", "subscription_cycle"].includes(
      billingReason,
    )
  ) {
    return false;
  }

  const lines = invoice.lines?.data || [];
  return lines.some((line) => {
    const priceId =
      typeof line.price === "string"
        ? line.price
        : line.price?.id || line.pricing?.price_details?.price;
    return priceId === premiumPriceId && Number(line.amount) > 0;
  });
}

export function getStripeObjectId(value) {
  return typeof value === "string" ? value : value?.id || null;
}

export function unixSecondsToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

export function sanitizeStripeFailure(error) {
  const safeCode =
    typeof error?.code === "string" && /^[a-z0-9_]{1,80}$/i.test(error.code)
      ? error.code
      : "stripe_request_failed";
  return `Stripe transfer failed (${safeCode}).`;
}
