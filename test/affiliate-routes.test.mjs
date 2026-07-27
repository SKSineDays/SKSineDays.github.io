import test from "node:test";
import assert from "node:assert/strict";
import { validateAffiliateCountry } from "../api/_lib/affiliate.js";
import { ensureAffiliateRecipientAccount } from "../api/_lib/affiliate-server.js";

const affiliateWithoutAccount = {
  id: "aff_ra420",
  display_name: "RA420 Affiliate",
  stripe_connect_account_id: null,
};

const affiliateWithAccount = {
  ...affiliateWithoutAccount,
  stripe_connect_account_id: "acct_existing",
};

const user = {
  id: "user_123",
  email: "affiliate@example.com",
};

function resolveCountryValidation(affiliate, country) {
  const needsCountry = !affiliate?.stripe_connect_account_id;
  return needsCountry
    ? validateAffiliateCountry(country)
    : { ok: true, country: null, error: null };
}

test("apply and onboarding-link reject missing payout country", () => {
  const result = resolveCountryValidation(affiliateWithoutAccount, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Payout country is required.");
});

test("apply and onboarding-link reject unsupported payout country", () => {
  const result = resolveCountryValidation(affiliateWithoutAccount, "CA");
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "Affiliate payouts are currently available in the United States only.",
  );
});

test("existing Stripe account ID bypasses country validation", () => {
  const result = resolveCountryValidation(affiliateWithAccount, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.country, null);
});

test("RA420-style null-account recovery succeeds with US country", async () => {
  const countryResult = resolveCountryValidation(affiliateWithoutAccount, "US");
  assert.equal(countryResult.ok, true);
  assert.equal(countryResult.country, "US");

  let createArgs = null;
  const accountId = await ensureAffiliateRecipientAccount({
    affiliate: affiliateWithoutAccount,
    user,
    country: countryResult.country,
    supabaseAdmin: {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      select() {
                        return {
                          async maybeSingle() {
                            return {
                              data: { stripe_connect_account_id: "acct_new" },
                              error: null,
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
        };
      },
    },
    createAccount: async (args) => {
      createArgs = args;
      return { id: "acct_new" };
    },
  });

  assert.equal(accountId, "acct_new");
  assert.equal(createArgs.country, "US");
  assert.equal(createArgs.affiliateId, "aff_ra420");
});
