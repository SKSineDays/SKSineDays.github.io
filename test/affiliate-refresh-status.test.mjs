import test, { mock } from "node:test";
import assert from "node:assert/strict";

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

test("refresh endpoint rejects affiliate without Stripe account ID", async (t) => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";

  const affiliateServer = await import("../api/_lib/affiliate-server.js");
  mock.module("../api/_lib/affiliate-server.js", {
    namedExports: {
      ...affiliateServer,
      requireAffiliateContext: async () => ({
        user: { id: "user_123" },
        supabaseAdmin: {},
      }),
      getAffiliateForUser: async () => ({
        ...affiliateBase,
        stripe_connect_account_id: null,
      }),
    },
  });

  t.after(() => {
    mock.restoreAll();
    process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  });

  const { default: handler } = await import("../api/affiliate/refresh-status.js");
  const res = createMockResponse();
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "Stripe setup has not started");
});
