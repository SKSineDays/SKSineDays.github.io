import test from "node:test";
import assert from "node:assert/strict";
import { createAffiliateRecipientAccount } from "../api/_lib/stripe.js";

test("createAffiliateRecipientAccount sends lowercase identity.country", async () => {
  const calls = [];
  const stripe = {
    v2: {
      core: {
        accounts: {
          create: async (payload, options) => {
            calls.push({ payload, options });
            return { id: "acct_test" };
          },
        },
      },
    },
  };

  await createAffiliateRecipientAccount({
    contactEmail: "affiliate@example.com",
    displayName: "RA420 Affiliate",
    country: "US",
    userId: "user_123",
    affiliateId: "aff_ra420",
    idempotencyKey: "sineday-affiliate-account-aff_ra420",
    stripe,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.identity.country, "us");
  assert.equal(calls[0].options.idempotencyKey, "sineday-affiliate-account-aff_ra420");
});
