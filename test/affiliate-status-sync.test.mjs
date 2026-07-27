import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRefreshAffiliateFromStripe,
  syncAffiliateAccountState,
} from "../api/_lib/affiliate-server.js";

const completedStripeAccount = {
  closed: false,
  configuration: {
    recipient: {
      applied: true,
      capabilities: {
        stripe_balance: {
          stripe_transfers: { status: "active" },
          payouts: { status: "active" },
        },
      },
    },
  },
  requirements: {
    entries: [],
    summary: {},
  },
};

const incompleteStripeAccount = {
  closed: false,
  configuration: {
    recipient: {
      applied: false,
      capabilities: {
        stripe_balance: {
          stripe_transfers: { status: "pending" },
          payouts: { status: "pending" },
        },
      },
    },
  },
  requirements: {
    entries: [],
    summary: {},
  },
};

const affiliateBase = {
  id: "aff_ra420",
  user_id: "user_123",
  code: "RA420",
  display_name: "RA420 Affiliate",
  status: "onboarding",
  stripe_connect_account_id: "acct_1TxfN53dC581FLwu",
  details_submitted: false,
  payouts_enabled: false,
  tax_setup_status: "not_started",
  stripe_transfers_status: "pending",
  recipient_payouts_status: "pending",
  requirements_status: "currently_due",
  activated_at: null,
  updated_at: "2026-07-27T00:00:00.000Z",
};

function createSyncSupabaseMock({
  affiliate,
  updateResult = "success",
} = {}) {
  let updatePayload = null;
  let retrieveCalled = false;

  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "affiliates");
      return {
        update(payload) {
          updatePayload = payload;
          return {
            eq(field, value) {
              assert.equal(field, "id");
              assert.equal(value, affiliate.id);
              return {
                select() {
                  return {
                    async single() {
                      if (updateResult === "success") {
                        return {
                          data: {
                            ...affiliate,
                            ...payload,
                          },
                          error: null,
                        };
                      }
                      return {
                        data: null,
                        error: { message: "update failed" },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    get updatePayload() {
      return updatePayload;
    },
    wasRetrieveNeeded() {
      return retrieveCalled;
    },
    markRetrieve() {
      retrieveCalled = true;
    },
  };

  return supabaseAdmin;
}

test("completed Stripe account activates affiliate", async () => {
  const supabaseAdmin = createSyncSupabaseMock({ affiliate: affiliateBase });
  const synced = await syncAffiliateAccountState({
    affiliate: affiliateBase,
    supabaseAdmin,
    retrieveAccount: async () => completedStripeAccount,
    now: () => "2026-07-27T12:00:00.000Z",
  });

  assert.equal(synced.status, "active");
  assert.equal(synced.details_submitted, true);
  assert.equal(synced.payouts_enabled, true);
  assert.equal(synced.tax_setup_status, "complete");
  assert.equal(synced.stripe_transfers_status, "active");
  assert.equal(synced.recipient_payouts_status, "active");
  assert.equal(synced.requirements_status, "complete");
  assert.equal(synced.activated_at, "2026-07-27T12:00:00.000Z");
});

test("incomplete Stripe account stays onboarding", async () => {
  const supabaseAdmin = createSyncSupabaseMock({ affiliate: affiliateBase });
  const synced = await syncAffiliateAccountState({
    affiliate: affiliateBase,
    supabaseAdmin,
    retrieveAccount: async () => incompleteStripeAccount,
    now: () => "2026-07-27T12:00:00.000Z",
  });

  assert.equal(synced.status, "onboarding");
  assert.equal(synced.payouts_enabled, false);
});

test("paused affiliate remains paused when Stripe is ready", async () => {
  const pausedAffiliate = { ...affiliateBase, status: "paused" };
  const supabaseAdmin = createSyncSupabaseMock({ affiliate: pausedAffiliate });
  const synced = await syncAffiliateAccountState({
    affiliate: pausedAffiliate,
    supabaseAdmin,
    retrieveAccount: async () => completedStripeAccount,
    now: () => "2026-07-27T12:00:00.000Z",
  });

  assert.equal(synced.status, "paused");
});

test("missing Stripe account ID performs no retrieval", async () => {
  let retrieveCalled = false;
  const affiliate = { ...affiliateBase, stripe_connect_account_id: null };
  const result = await syncAffiliateAccountState({
    affiliate,
    supabaseAdmin: createSyncSupabaseMock({ affiliate }),
    retrieveAccount: async () => {
      retrieveCalled = true;
      return completedStripeAccount;
    },
  });

  assert.equal(retrieveCalled, false);
  assert.equal(result, affiliate);
});

test("Stripe retrieval failure does not overwrite Supabase", async () => {
  let updateCalled = false;
  const supabaseAdmin = {
    from() {
      return {
        update() {
          updateCalled = true;
          return {
            eq() {
              return {
                select() {
                  return { single: async () => ({ data: null, error: null }) };
                },
              };
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () =>
      syncAffiliateAccountState({
        affiliate: affiliateBase,
        supabaseAdmin,
        retrieveAccount: async () => {
          throw new Error("Stripe unavailable");
        },
      }),
    /Stripe unavailable/,
  );
  assert.equal(updateCalled, false);
});

test("database update failure surfaces an error", async () => {
  const supabaseAdmin = createSyncSupabaseMock({
    affiliate: affiliateBase,
    updateResult: "failure",
  });

  await assert.rejects(
    () =>
      syncAffiliateAccountState({
        affiliate: affiliateBase,
        supabaseAdmin,
        retrieveAccount: async () => completedStripeAccount,
      }),
    /Failed to synchronize affiliate Stripe status/,
  );
});

test("shouldRefreshAffiliateFromStripe always refreshes onboarding affiliates", () => {
  assert.equal(
    shouldRefreshAffiliateFromStripe({
      ...affiliateBase,
      status: "onboarding",
      updated_at: new Date().toISOString(),
    }),
    true,
  );
});

test("shouldRefreshAffiliateFromStripe refreshes action_required tax setup", () => {
  assert.equal(
    shouldRefreshAffiliateFromStripe({
      ...affiliateBase,
      status: "active",
      tax_setup_status: "action_required",
      updated_at: new Date().toISOString(),
    }),
    true,
  );
});

test("shouldRefreshAffiliateFromStripe skips fresh active accounts", () => {
  assert.equal(
    shouldRefreshAffiliateFromStripe({
      ...affiliateBase,
      status: "active",
      tax_setup_status: "complete",
      updated_at: new Date().toISOString(),
    }),
    false,
  );
});

test("shouldRefreshAffiliateFromStripe refreshes stale active accounts", () => {
  assert.equal(
    shouldRefreshAffiliateFromStripe({
      ...affiliateBase,
      status: "active",
      tax_setup_status: "complete",
      updated_at: "2026-07-27T00:00:00.000Z",
    }),
    true,
  );
});

test("refresh endpoint requires authentication", async () => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";
  try {
    const { default: handler } = await import("../api/affiliate/refresh-status.js");
    const res = createMockResponse();
    await handler({ method: "POST", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
  } finally {
    process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  }
});

function createMockResponse() {
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      response.headers[name] = value;
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(payload) {
      response.body = payload;
      return response;
    },
    end() {
      return response;
    },
  };
  return response;
}
