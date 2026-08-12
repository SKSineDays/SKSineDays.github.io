import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  getAffiliateApplicationForUser,
  hasAffiliateApplicationHoneypot,
  toPlainAffiliateApplicationText,
  toPublicAffiliateApplication,
  validateAffiliateApplicationInput,
} from "../api/_lib/affiliate-server.js";

const validApplication = {
  displayName: "Wave Writer",
  email: "  Writer@Example.COM ",
  instagram: "@sineday",
  tiktok: "",
  youtube: "",
  website: "",
  otherSocial: "",
  introduction: "I share quiet journaling notes with people who want a calmer daily rhythm.",
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

function createApplicationsClient(rows) {
  const store = rows.map((row) => ({ ...row }));

  function find(field, value) {
    return store.find((row) => row[field] === value) || null;
  }

  return {
    store,
    from(table) {
      assert.equal(table, "affiliate_applications");
      return {
        select() {
          return {
            eq(field, value) {
              return {
                async maybeSingle() {
                  return { data: find(field, value), error: null };
                },
              };
            },
          };
        },
        update(payload) {
          return {
            eq(field, value) {
              return {
                is(field2, value2) {
                  return {
                    select() {
                      return {
                        async maybeSingle() {
                          const row = store.find(
                            (item) => item[field] === value && item[field2] === value2,
                          );
                          if (!row) return { data: null, error: null };
                          Object.assign(row, payload);
                          return { data: { ...row }, error: null };
                        },
                      };
                    },
                  };
                },
                eq(field2, value2) {
                  return {
                    select() {
                      return {
                        async maybeSingle() {
                          const row = store.find(
                            (item) => item[field] === value && item[field2] === value2,
                          );
                          if (!row) return { data: null, error: null };
                          Object.assign(row, payload);
                          return { data: { ...row }, error: null };
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
  };
}

test("application validation normalizes email and requires a social profile", () => {
  const result = validateAffiliateApplicationInput(validApplication);
  assert.equal(result.ok, true);
  assert.equal(result.fields.email, "writer@example.com");
  assert.equal(result.fields.instagram, "@sineday");
  assert.equal(result.fields.tiktok, null);
});

test("application validation rejects missing social profiles", () => {
  const result = validateAffiliateApplicationInput({
    ...validApplication,
    instagram: "   ",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /at least one social/i);
});

test("application validation stores plain text only", () => {
  const result = validateAffiliateApplicationInput({
    ...validApplication,
    displayName: "<b>Wave Writer</b>",
    introduction:
      "<p>I share quiet journaling notes with people who want a calmer daily rhythm.</p>",
  });
  assert.equal(result.ok, true);
  assert.equal(result.fields.displayName, "Wave Writer");
  assert.equal(
    result.fields.introduction,
    "I share quiet journaling notes with people who want a calmer daily rhythm.",
  );
  assert.equal(toPlainAffiliateApplicationText("<script>alert(1)</script>hello").includes("<"), false);
});

test("public application helper never exposes review notes or ids", () => {
  const publicApplication = toPublicAffiliateApplication({
    id: "secret-id",
    user_id: "user_123",
    display_name: "Wave Writer",
    email: "writer@example.com",
    instagram: "@sineday",
    tiktok: null,
    youtube: null,
    website: null,
    other_social: null,
    introduction: "I share quiet journaling notes with people who want a calmer daily rhythm.",
    review_status: "pending",
    review_notes: "internal decline reason",
    created_at: "2026-08-12T00:00:00.000Z",
    reviewed_at: null,
    approved_at: null,
  });

  assert.equal(publicApplication.displayName, "Wave Writer");
  assert.equal(publicApplication.reviewStatus, "pending");
  assert.equal("id" in publicApplication, false);
  assert.equal("review_notes" in publicApplication, false);
  assert.equal("reviewNotes" in publicApplication, false);
});

test("honeypot treats any company value as spam", () => {
  assert.equal(hasAffiliateApplicationHoneypot({ company: "" }), false);
  assert.equal(hasAffiliateApplicationHoneypot({ company: "   " }), false);
  assert.equal(hasAffiliateApplicationHoneypot({ company: "Acme" }), true);
});

test("public application honeypot returns generic success without writing", async () => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";
  const { default: handler } = await import("../api/affiliate/application.js");
  const { AFFILIATE_APPLICATION_RECEIVED_MESSAGE } = await import(
    "../api/_lib/affiliate-server.js"
  );
  const res = createMockResponse();
  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        company: "spam-bot",
        displayName: "Wave Writer",
        email: "writer@example.com",
      },
    },
    res,
  );
  process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    message: AFFILIATE_APPLICATION_RECEIVED_MESSAGE,
  });
});

test("public application validation fails closed before a database write", async () => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";
  const { default: handler } = await import("../api/affiliate/application.js");
  const res = createMockResponse();
  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        displayName: "A",
        email: "not-an-email",
        introduction: "too short",
      },
    },
    res,
  );
  process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test("getAffiliateApplicationForUser binds a public email match to the authenticated user", async () => {
  const client = createApplicationsClient([
    {
      id: "app_public",
      user_id: null,
      email: "writer@example.com",
      display_name: "Wave Writer",
      review_status: "approved",
    },
  ]);

  const application = await getAffiliateApplicationForUser({
    supabaseAdmin: client,
    user: { id: "user_123", email: "Writer@example.com" },
  });

  assert.equal(application.id, "app_public");
  assert.equal(application.user_id, "user_123");
  assert.equal(client.store[0].user_id, "user_123");
});

test("getAffiliateApplicationForUser does not return another account's application", async () => {
  const client = createApplicationsClient([
    {
      id: "app_other",
      user_id: "user_other",
      email: "writer@example.com",
      display_name: "Wave Writer",
      review_status: "approved",
    },
  ]);

  const application = await getAffiliateApplicationForUser({
    supabaseAdmin: client,
    user: { id: "user_123", email: "writer@example.com" },
  });

  assert.equal(application, null);
  assert.equal(client.store[0].user_id, "user_other");
});

test.describe("apply approval gate", { concurrency: 1 }, () => {
  test("apply rejects unapproved applicants before Stripe setup", async (t) => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";

  const affiliateServer = await import("../api/_lib/affiliate-server.js");
  const stripe = await import("../api/_lib/stripe.js");
  let stripeCalled = false;

  mock.module("../api/_lib/affiliate-server.js", {
    namedExports: {
      ...affiliateServer,
      requireAffiliateContext: async () => ({
        user: { id: "user_123", email: "writer@example.com" },
        supabaseAdmin: {
          from() {
            throw new Error("affiliates table should not be written");
          },
        },
      }),
      getAffiliateForUser: async () => null,
      getAffiliateApplicationForUser: async () => ({
        id: "app_1",
        review_status: "pending",
      }),
      ensureAffiliateRecipientAccount: async () => {
        stripeCalled = true;
        throw new Error("Stripe account should not be created");
      },
    },
  });
  mock.module("../api/_lib/stripe.js", {
    namedExports: {
      ...stripe,
      createAffiliateAccountLink: async () => {
        stripeCalled = true;
        throw new Error("Stripe link should not be created");
      },
    },
  });

  t.after(() => {
    mock.restoreAll();
    process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  });

  const { default: handler } = await import("../api/affiliate/apply.js?test=unapproved");
  const res = createMockResponse();
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: {
        displayName: "Wave Writer",
        requestedCode: "WAVE24",
        country: "US",
        acceptedTermsVersion: "2026-07-24",
      },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(
    res.body.error,
    "Your Affiliate application must be approved before setup can continue.",
  );
  assert.equal(stripeCalled, false);
});

test("apply preserves existing affiliate Stripe onboarding without an application row", async (t) => {
  const originalEnv = process.env.AFFILIATE_PROGRAM_ENABLED;
  process.env.AFFILIATE_PROGRAM_ENABLED = "true";

  const affiliateServer = await import("../api/_lib/affiliate-server.js");
  const stripe = await import("../api/_lib/stripe.js");
  let applicationLookupCalled = false;
  let stripeAccountCalled = false;

  mock.module("../api/_lib/affiliate-server.js", {
    namedExports: {
      ...affiliateServer,
      requireAffiliateContext: async () => ({
        user: { id: "user_123", email: "writer@example.com" },
        supabaseAdmin: {},
      }),
      getAffiliateForUser: async () => ({
        id: "aff_existing",
        status: "onboarding",
        code: "WAVE24",
        display_name: "Wave Writer",
        accepted_terms_version: "2026-07-24",
        stripe_connect_account_id: "acct_existing",
      }),
      getAffiliateApplicationForUser: async () => {
        applicationLookupCalled = true;
        return null;
      },
      ensureAffiliateRecipientAccount: async () => {
        stripeAccountCalled = true;
        return "acct_existing";
      },
    },
  });
  mock.module("../api/_lib/stripe.js", {
    namedExports: {
      ...stripe,
      createAffiliateAccountLink: async () => ({ url: "https://connect.stripe.com/setup" }),
    },
  });

  t.after(() => {
    mock.restoreAll();
    process.env.AFFILIATE_PROGRAM_ENABLED = originalEnv;
  });

  const { default: handler } = await import("../api/affiliate/apply.js?grandfathered=1");
  const res = createMockResponse();
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: {
        displayName: "Wave Writer",
        requestedCode: "WAVE24",
        country: "US",
        acceptedTermsVersion: "2026-07-24",
      },
    },
    res,
  );

  assert.equal(applicationLookupCalled, false);
  assert.equal(stripeAccountCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.url, "https://connect.stripe.com/setup");
});
});
