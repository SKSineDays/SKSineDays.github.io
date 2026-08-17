import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("affiliate support remains GET-only and still returns existing attribution", async (t) => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";
  const affiliateServer = await import("../api/_lib/affiliate-server.js");
  mock.module("../api/_lib/affiliate-server.js", {
    namedExports: {
      ...affiliateServer,
      requireAffiliateContext: async () => ({
        user: { id: "customer_1" },
        supabaseAdmin: {
          from(table) {
            if (table === "affiliate_attributions") {
              return {
                select() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return {
                            data: {
                              affiliate_id: "aff_ra420",
                              source_code: "RA420",
                              attributed_at: "2026-08-17T00:00:00.000Z",
                              status: "active",
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            }
            return {
              select() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return {
                          data: { display_name: "RA420 Affiliate", code: "RA420" },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        },
      }),
    },
  });
  t.after(() => {
    mock.restoreAll();
    process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  });

  const { default: handler } = await import("../api/affiliate/support.js");

  const postRes = createMockResponse();
  await handler({ method: "POST", body: { code: "RA420", confirmed: true } }, postRes);
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.body.ok, false);
  assert.match(postRes.body.error, /Stripe Checkout/);

  const getRes = createMockResponse();
  await handler({ method: "GET", headers: { authorization: "Bearer test" } }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.support.affiliateCode, "RA420");
});

test("retired seven-day backfill helpers are gone from the support route", () => {
  const source = readFileSync(join(root, "api/affiliate/support.js"), "utf8");
  assert.doesNotMatch(source, /utcCalendarDaysSince|loadPaidPremiumInvoices|backfillFirstInvoice|create_affiliate_attribution/);
});

test("dashboard checkout carries a pending affiliate code and no longer posts support", () => {
  const dashboard = readFileSync(join(root, "js/dashboard.js"), "utf8");
  const ui = readFileSync(join(root, "js/affiliate-ui.js"), "utf8");
  assert.match(dashboard, /affiliateCode: pendingAffiliateCode/);
  assert.match(dashboard, /clearPendingAffiliateCode\(\)/);
  assert.doesNotMatch(ui, /Confirm Support|Connect your Premium membership|data-affiliate-form="support"/);
  assert.match(
    ui,
    /Enter it securely in Stripe Checkout when you upgrade to Premium/,
  );
  assert.match(
    ui,
    /Use my SineDay Affiliate Code \$\{affiliate\.code\} at checkout to save \$1 each month on Premium\./,
  );
});

test("public config and service worker keep affiliate secrets and APIs off the client cache", () => {
  const config = readFileSync(join(root, "api/config.js"), "utf8");
  const worker = readFileSync(join(root, "service-worker.js"), "utf8");
  assert.doesNotMatch(config, /STRIPE_AFFILIATE_COUPON_ID|STRIPE_SECRET_KEY/);
  assert.match(worker, /sineday-v19/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
});
