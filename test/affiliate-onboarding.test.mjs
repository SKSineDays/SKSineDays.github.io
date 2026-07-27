import test from "node:test";
import assert from "node:assert/strict";
import {
  affiliateApiError,
  ensureAffiliateRecipientAccount,
} from "../api/_lib/affiliate-server.js";

const affiliateBase = {
  id: "aff_ra420",
  display_name: "RA420 Affiliate",
  stripe_connect_account_id: null,
};

const userBase = {
  id: "user_123",
  email: "affiliate@example.com",
};

function createSupabaseMock({ row, updateResult = "persist" } = {}) {
  let currentRow = { ...row };
  let updateCalled = false;
  let reloadCalled = false;

  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "affiliates");
      return {
        update(payload) {
          updateCalled = true;
          return {
            eq(field, value) {
              assert.equal(field, "id");
              assert.equal(value, currentRow.id);
              return {
                is(fieldName, fieldValue) {
                  assert.equal(fieldName, "stripe_connect_account_id");
                  assert.equal(fieldValue, null);
                  return {
                    select() {
                      return {
                        async maybeSingle() {
                          if (updateResult === "persist") {
                            currentRow = {
                              ...currentRow,
                              stripe_connect_account_id: payload.stripe_connect_account_id,
                              stripe_status_updated_at: payload.stripe_status_updated_at,
                            };
                            return {
                              data: {
                                stripe_connect_account_id: currentRow.stripe_connect_account_id,
                              },
                              error: null,
                            };
                          }
                          return { data: null, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        select() {
          reloadCalled = true;
          return {
            eq(field, value) {
              assert.equal(field, "id");
              assert.equal(value, currentRow.id);
              return {
                async maybeSingle() {
                  return {
                    data: {
                      stripe_connect_account_id: currentRow.stripe_connect_account_id,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    get row() {
      return currentRow;
    },
    wasUpdateCalled() {
      return updateCalled;
    },
    wasReloadCalled() {
      return reloadCalled;
    },
  };

  return supabaseAdmin;
}

function createMockResponse() {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(payload) {
      response.body = payload;
      return response;
    },
  };
  return response;
}

test("ensureAffiliateRecipientAccount returns an existing account ID without side effects", async () => {
  let stripeCalled = false;
  const supabaseAdmin = createSupabaseMock({
    row: { ...affiliateBase, stripe_connect_account_id: "acct_existing" },
  });

  const accountId = await ensureAffiliateRecipientAccount({
    affiliate: { ...affiliateBase, stripe_connect_account_id: "acct_existing" },
    user: userBase,
    supabaseAdmin,
    createAccount: async () => {
      stripeCalled = true;
      return { id: "acct_should_not_be_used" };
    },
  });

  assert.equal(accountId, "acct_existing");
  assert.equal(stripeCalled, false);
  assert.equal(supabaseAdmin.wasUpdateCalled(), false);
});

test("ensureAffiliateRecipientAccount creates, persists, and returns a connected account", async () => {
  let createArgs = null;
  const supabaseAdmin = createSupabaseMock({ row: affiliateBase });

  const accountId = await ensureAffiliateRecipientAccount({
    affiliate: affiliateBase,
    user: userBase,
    country: "US",
    supabaseAdmin,
    createAccount: async (args) => {
      createArgs = args;
      return { id: "acct_new" };
    },
    now: () => "2026-07-27T00:00:00.000Z",
  });

  assert.equal(accountId, "acct_new");
  assert.deepEqual(createArgs, {
    contactEmail: userBase.email,
    displayName: affiliateBase.display_name,
    country: "US",
    userId: userBase.id,
    affiliateId: affiliateBase.id,
    idempotencyKey: "sineday-affiliate-account-aff_ra420",
  });
  assert.equal(supabaseAdmin.row.stripe_connect_account_id, "acct_new");
  assert.equal(supabaseAdmin.row.stripe_status_updated_at, "2026-07-27T00:00:00.000Z");
  assert.equal(supabaseAdmin.wasReloadCalled(), false);
});

test("ensureAffiliateRecipientAccount reloads after a concurrent database write wins the race", async () => {
  const supabaseAdmin = createSupabaseMock({
    row: { ...affiliateBase, stripe_connect_account_id: "acct_winner" },
    updateResult: "lost",
  });

  const accountId = await ensureAffiliateRecipientAccount({
    affiliate: affiliateBase,
    user: userBase,
    country: "US",
    supabaseAdmin,
    createAccount: async () => ({ id: "acct_new" }),
  });

  assert.equal(accountId, "acct_winner");
  assert.equal(supabaseAdmin.wasUpdateCalled(), true);
  assert.equal(supabaseAdmin.wasReloadCalled(), true);
});

test("ensureAffiliateRecipientAccount propagates Stripe failures without mutating the affiliate row", async () => {
  const supabaseAdmin = createSupabaseMock({ row: affiliateBase });
  const stripeError = Object.assign(new Error("Stripe request failed"), {
    code: "api_error",
  });

  await assert.rejects(
    () =>
      ensureAffiliateRecipientAccount({
        affiliate: affiliateBase,
        user: userBase,
        country: "US",
        supabaseAdmin,
        createAccount: async () => {
          throw stripeError;
        },
      }),
    stripeError,
  );

  assert.equal(supabaseAdmin.row.stripe_connect_account_id, null);
  assert.equal(supabaseAdmin.wasUpdateCalled(), false);
});

test("affiliateApiError maps Connect-not-enabled Stripe failures to a retryable 503 response", () => {
  const res = createMockResponse();
  const error = Object.assign(
    new Error(
      "You must have Connect enabled to use this field.",
    ),
    { code: "invalid_fields" },
  );

  affiliateApiError(res, error, "onboarding link failed");

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: "Stripe payout onboarding is not available yet. Please try again shortly.",
  });
  assert.equal(
    res.body.error.includes("Connect enabled"),
    false,
  );
});
