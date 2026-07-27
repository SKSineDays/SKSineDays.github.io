import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAffiliateAccountState,
  isEligiblePremiumInvoice,
  normalizeAffiliateCode,
  normalizeAffiliateCountry,
  sanitizeStripeFailure,
  validateAffiliateCode,
  validateAffiliateCountry,
} from "../api/_lib/affiliate.js";

function readyAccount(overrides = {}) {
  return {
    closed: false,
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "active", status_details: [] },
          },
        },
      },
    },
    requirements: { entries: [] },
    ...overrides,
  };
}

test("affiliate codes normalize and enforce reserved values", () => {
  assert.equal(normalizeAffiliateCode("  wave-24 "), "WAVE-24");
  assert.deepEqual(validateAffiliateCode("wave-24"), {
    ok: true,
    code: "WAVE-24",
    error: null,
  });
  assert.equal(validateAffiliateCode("admin").ok, false);
  assert.equal(validateAffiliateCode("x").ok, false);
});

test("affiliate payout country accepts US only", () => {
  assert.equal(normalizeAffiliateCountry(" us "), "US");
  assert.deepEqual(validateAffiliateCountry("US"), {
    ok: true,
    country: "US",
    error: null,
  });
  assert.deepEqual(validateAffiliateCountry(""), {
    ok: false,
    country: "",
    error: "Payout country is required.",
  });
  assert.deepEqual(validateAffiliateCountry("CA"), {
    ok: false,
    country: "CA",
    error: "Affiliate payouts are currently available in the United States only.",
  });
});

test("Accounts v2 readiness activates an onboarding affiliate", () => {
  const state = deriveAffiliateAccountState(readyAccount(), "onboarding");
  assert.equal(state.programStatus, "active");
  assert.equal(state.stripeReady, true);
  assert.equal(state.payoutsEnabled, true);
  assert.equal(state.requirementsStatus, "complete");
  assert.equal(state.taxSetupStatus, "complete");
});

test("manual paused state is never undone by Stripe readiness", () => {
  const state = deriveAffiliateAccountState(readyAccount(), "paused");
  assert.equal(state.programStatus, "paused");
  assert.equal(state.stripeReady, true);
});

test("closed Stripe accounts are never payout-ready", () => {
  const state = deriveAffiliateAccountState(
    readyAccount({ closed: true }),
    "active",
  );
  assert.equal(state.programStatus, "closed");
  assert.equal(state.stripeReady, false);
});

test("past-due recipient payout requirements block activation", () => {
  const account = readyAccount({
    requirements: {
      entries: [
        {
          minimum_deadline: { status: "past_due" },
          impact: {
            restricts_capabilities: [
              {
                configuration: "recipient",
                capability: "stripe_balance.payouts",
                deadline: { status: "past_due" },
              },
            ],
          },
        },
      ],
    },
  });
  const state = deriveAffiliateAccountState(account, "onboarding");
  assert.equal(state.programStatus, "onboarding");
  assert.equal(state.stripeReady, false);
  assert.equal(state.requirementsStatus, "past_due");
  assert.equal(state.taxSetupStatus, "action_required");
});

test("only positive paid Premium subscription invoices are eligible", () => {
  const invoice = {
    status: "paid",
    amount_paid: 500,
    subscription: "sub_123",
    billing_reason: "subscription_cycle",
    lines: {
      data: [{ amount: 500, price: { id: "price_premium" } }],
    },
  };
  assert.equal(isEligiblePremiumInvoice(invoice, "price_premium"), true);
  assert.equal(
    isEligiblePremiumInvoice({ ...invoice, amount_paid: 0 }, "price_premium"),
    false,
  );
  assert.equal(
    isEligiblePremiumInvoice(
      { ...invoice, billing_reason: "manual" },
      "price_premium",
    ),
    false,
  );
  assert.equal(isEligiblePremiumInvoice(invoice, "price_other"), false);
  assert.equal(
    isEligiblePremiumInvoice({ ...invoice, billing_reason: null }, "price_premium"),
    false,
  );
});

test("Stripe failures are sanitized for payout records", () => {
  assert.equal(
    sanitizeStripeFailure({ code: "balance_insufficient", message: "secret" }),
    "Stripe transfer failed (balance_insufficient).",
  );
  assert.equal(
    sanitizeStripeFailure({ code: "unsafe code!" }),
    "Stripe transfer failed (stripe_request_failed).",
  );
});
