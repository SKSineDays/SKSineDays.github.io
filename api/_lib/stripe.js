import Stripe from "stripe";

export const BILLING_API_VERSION = "2024-12-18.acacia";
export const CONNECT_API_VERSION = "2026-06-24.dahlia";

let billingClient = null;
let connectClient = null;

function getSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing Stripe configuration");
  }
  return key;
}

export function getStripeClient({ connect = false } = {}) {
  if (connect) {
    if (!connectClient) {
      connectClient = new Stripe(getSecretKey(), {
        apiVersion: CONNECT_API_VERSION,
      });
    }
    return connectClient;
  }

  if (!billingClient) {
    billingClient = new Stripe(getSecretKey(), {
      apiVersion: BILLING_API_VERSION,
    });
  }
  return billingClient;
}

export async function createAffiliateRecipientAccount({
  contactEmail,
  displayName,
  userId,
  affiliateId,
  idempotencyKey,
}) {
  const stripe = getStripeClient({ connect: true });
  return stripe.v2.core.accounts.create(
    {
      contact_email: contactEmail,
      display_name: displayName,
      dashboard: "express",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {
                requested: true,
              },
            },
          },
        },
      },
      metadata: {
        sineday_user_id: userId,
        sineday_affiliate_id: affiliateId,
        integration: "sineday_affiliate",
      },
      include: [
        "configuration.recipient",
        "defaults",
        "requirements",
        "future_requirements",
      ],
    },
    { idempotencyKey },
  );
}

export async function createAffiliateAccountLink(
  accountId,
  { refreshUrl, returnUrl, idempotencyKey } = {},
) {
  const stripe = getStripeClient({ connect: true });
  return stripe.v2.core.accountLinks.create(
    {
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          collection_options: {
            fields: "eventually_due",
            future_requirements: "include",
          },
          refresh_url: refreshUrl,
          return_url: returnUrl,
        },
      },
    },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
}

export async function createAffiliateDashboardLoginLink(accountId) {
  const stripe = getStripeClient({ connect: true });
  return stripe.accounts.createLoginLink(accountId);
}

export async function retrieveAffiliateAccount(accountId) {
  const stripe = getStripeClient({ connect: true });
  return stripe.v2.core.accounts.retrieve(accountId, {
    include: [
      "configuration.recipient",
      "defaults",
      "requirements",
      "future_requirements",
    ],
  });
}

export async function createAffiliateTransfer({
  amount,
  destination,
  metadata,
  idempotencyKey,
}) {
  const stripe = getStripeClient({ connect: true });
  return stripe.transfers.create(
    {
      amount,
      currency: "usd",
      destination,
      transfer_group: `sineday-affiliate-payout-${metadata.sineday_payout_id}`,
      metadata,
    },
    { idempotencyKey },
  );
}

export async function findAffiliateTransfers(payoutId) {
  const stripe = getStripeClient({ connect: true });
  const transferGroup = `sineday-affiliate-payout-${payoutId}`;
  const matches = [];
  let startingAfter;

  for (let page = 0; page < 10; page += 1) {
    const transfers = await stripe.transfers.list({
      transfer_group: transferGroup,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    matches.push(...transfers.data);
    if (!transfers.has_more) return matches;
    startingAfter = transfers.data.at(-1)?.id;
    if (!startingAfter) break;
  }

  throw new Error("Affiliate transfer reconciliation exceeded the safe page limit");
}
