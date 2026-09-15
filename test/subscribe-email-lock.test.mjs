import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_FROM = "Daily <daily@daily.sineday.app>";
process.env.UNSUBSCRIBE_SECRET = "unsubscribe-secret-test-key";
process.env.PUBLIC_SITE_URL = "https://sineday.app";
process.env.MAILER_SIGNUP_SECRET = "mailer-signup-secret-at-least-32-bytes";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WELCOME_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const store = {
  authEmail: "member@sineday.app",
  rpcCalls: [],
  resendSends: [],
  activationError: null,
  activation: {
    result_state: "active",
    subscriber_id: SUBSCRIBER_ID,
    profile_configured: true,
    origin_day: 1
  },
  welcomeClaimed: false
};

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        auth: {
          async getUser() {
            if (!store.authEmail) {
              return { data: { user: null }, error: new Error("invalid token") };
            }
            return { data: { user: { email: store.authEmail } }, error: null };
          }
        },
        async rpc(name, args) {
          store.rpcCalls.push({ name, args });
          if (name === "activate_authenticated_email_subscriber") {
            return { data: store.activation ? [store.activation] : null, error: store.activationError };
          }
          if (name === "claim_due_mailer_welcomes") {
            if (store.welcomeClaimed) return { data: [], error: null };
            store.welcomeClaimed = true;
            return {
              data: [{
                delivery_id: WELCOME_ID,
                subscriber_id: SUBSCRIBER_ID,
                email: store.authEmail
              }],
              error: null
            };
          }
          if (name === "is_mailer_welcome_sendable") {
            return { data: true, error: null };
          }
          return { data: null, error: null };
        }
      };
    }
  }
});

mock.module("resend", {
  namedExports: {
    Resend: class Resend {
      emails = {
        send: async (payload, options) => {
          store.resendSends.push({ payload, options });
          return { data: { id: "email_welcome" }, error: null };
        }
      };
    }
  }
});

const { default: subscribe } = await import("../api/subscribe.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function reset() {
  store.authEmail = "member@sineday.app";
  store.rpcCalls.length = 0;
  store.resendSends.length = 0;
  store.activationError = null;
  store.activation = {
    result_state: "active",
    subscriber_id: SUBSCRIBER_ID,
    profile_configured: true,
    origin_day: 1
  };
  store.welcomeClaimed = false;
}

async function post(body, bearer = "valid-token") {
  const req = {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body
  };
  const res = mockRes();
  await subscribe(req, res);
  return res;
}

test("subscribe rejects missing authentication instead of falling back to a body email", async () => {
  reset();
  const res = await post({
    email: "attacker@example.com",
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20"
  }, "");
  assert.equal(res.statusCode, 401);
  assert.equal(store.rpcCalls.length, 0);
});

test("subscribe rejects invalid authentication instead of falling back to a body email", async () => {
  reset();
  store.authEmail = null;
  const res = await post({
    email: "attacker@example.com",
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20"
  });
  assert.equal(res.statusCode, 401);
  assert.equal(store.rpcCalls.length, 0);
});

test("authenticated setup derives rhythm server-side and ignores client rhythm values", async () => {
  reset();
  const body = {
    email: "MEMBER@sineday.app",
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20",
    birth_day_of_year: 1,
    origin_day: 18,
    source: "affiliate"
  };
  const res = await post(body);
  const activation = store.rpcCalls.find(
    (call) => call.name === "activate_authenticated_email_subscriber"
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    message: "Successfully subscribed",
    profileConfigured: true,
    profileLocked: true,
    originDay: 1
  });
  assert.equal(activation.args.p_email, "member@sineday.app");
  assert.match(activation.args.p_recipient_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(activation.args.p_birth_day_of_year, 110);
  assert.equal(activation.args.p_origin_day, 1);
  assert.equal(activation.args.p_source, "dashboard-daily-duck");
  assert.equal("birthdate" in activation.args, false);
  assert.equal(body.birthdate, "");
});

test("authenticated setup preserves the welcome template and idempotency convention", async () => {
  reset();
  const res = await post({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(store.resendSends.length, 1);
  assert.equal(store.resendSends[0].payload.template.id, "welcomeemail");
  assert.equal(
    store.resendSends[0].options.idempotencyKey,
    `sineday-welcome/${SUBSCRIBER_ID}`
  );
  assert.match(
    store.resendSends[0].payload.template.variables.OPT_OUT_URL,
    /^https:\/\/sineday\.app\/unsubscribe\.html\?token=/
  );
});

test("required atomic activation failures fail the request", async () => {
  reset();
  store.activationError = new Error("transaction rolled back");
  const res = await post({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20"
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(store.resendSends.length, 0);
});

test("suppressed recipients are never automatically reactivated", async () => {
  reset();
  store.activation = {
    result_state: "suppressed",
    subscriber_id: null,
    profile_configured: false,
    origin_day: null
  };
  const res = await post({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20"
  });
  assert.equal(res.statusCode, 409);
  assert.equal(store.resendSends.length, 0);
});
