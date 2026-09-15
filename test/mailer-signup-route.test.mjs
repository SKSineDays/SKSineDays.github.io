import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_FROM = "Daily <daily@daily.sineday.app>";
process.env.PUBLIC_SITE_URL = "https://sineday.app";
process.env.MAILER_SIGNUP_SECRET = "mailer-signup-secret-at-least-32-bytes";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const store = {
  createState: "created",
  rpcCalls: [],
  sends: [],
  sendError: null,
  rpcError: null
};

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        async rpc(name, args) {
          store.rpcCalls.push({ name, args });
          if (store.rpcError && name === "create_mailer_signup_request") {
            return { data: null, error: store.rpcError };
          }
          if (name === "create_mailer_signup_request") {
            return {
              data: [{
                result_state: store.createState,
                request_id: store.createState === "created" ? REQUEST_ID : null,
                retry_after_seconds: store.createState === "rate_limited" ? 3600 : 0
              }],
              error: null
            };
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
          store.sends.push({ payload, options });
          if (store.sendError) return { data: null, error: store.sendError };
          return { data: { id: "email_confirmation" }, error: null };
        }
      };
    }
  }
});

const { default: signup } = await import("../api/mailer-signup.js");

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
  store.createState = "created";
  store.rpcCalls.length = 0;
  store.sends.length = 0;
  store.sendError = null;
  store.rpcError = null;
}

function validBody() {
  return {
    email: "Person@Example.com ",
    birthdate: "1985-04-20",
    timezone: "America/Chicago",
    consent: true,
    company: "",
    source: "homepage-banner"
  };
}

async function post(body = validBody()) {
  const req = {
    method: "POST",
    headers: {
      "content-length": String(Buffer.byteLength(JSON.stringify(body))),
      "x-forwarded-for": "203.0.113.7"
    },
    body
  };
  const res = mockRes();
  await signup(req, res);
  return res;
}

test("public signup stores only derived rhythm and sends a fragment confirmation link", async () => {
  reset();
  const body = validBody();
  const res = await post(body);
  const create = store.rpcCalls.find((call) => call.name === "create_mailer_signup_request");
  const mark = store.rpcCalls.find((call) => call.name === "mark_mailer_confirmation_sent");

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(create.args.p_email, "person@example.com");
  assert.equal(create.args.p_birth_day_of_year, 110);
  assert.equal(create.args.p_origin_day, 1);
  assert.match(create.args.p_token_hash, /^[0-9a-f]{64}$/);
  assert.match(create.args.p_recipient_key_hash, /^[0-9a-f]{64}$/);
  assert.match(create.args.p_ip_key_hash, /^[0-9a-f]{64}$/);
  assert.equal("birthdate" in create.args, false);
  assert.equal(body.birthdate, "");

  assert.equal(store.sends.length, 1);
  assert.equal(store.sends[0].payload.template.id, "dailyemailconfirmation");
  assert.match(
    store.sends[0].payload.template.variables.CONFIRM_URL,
    /^https:\/\/sineday\.app\/daily\/confirm#token=/
  );
  assert.equal(JSON.stringify(store.sends[0]).includes("1985-04-20"), false);
  assert.equal(
    store.sends[0].options.idempotencyKey,
    `sineday-confirm/${REQUEST_ID}`
  );
  assert.equal(mark.args.p_provider_message_id, "email_confirmation");
  assert.equal(res.headers["Cache-Control"], "no-store, max-age=0");
});

test("cooldown responses stay neutral and preserve the previously sent request", async () => {
  reset();
  store.createState = "cooldown";
  const res = await post();
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.match(res.body.message, /Check your inbox/);
  assert.equal(store.sends.length, 0);
  assert.equal(
    store.rpcCalls.some((call) => call.name === "mark_mailer_confirmation_failed"),
    false
  );
});

test("durable rate limits return a bounded neutral error without sending", async () => {
  reset();
  store.createState = "rate_limited";
  const res = await post();
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Retry-After"], "3600");
  assert.equal(store.sends.length, 0);
  assert.equal(JSON.stringify(res.body).includes("recipient"), false);
});

test("confirmation provider failures do not claim an email was sent", async () => {
  reset();
  store.sendError = { message: "template unavailable" };
  const res = await post();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /could not send/i);
  assert.ok(
    store.rpcCalls.some((call) => call.name === "mark_mailer_confirmation_failed")
  );
});

test("honeypot submissions create no durable request and receive a neutral response", async () => {
  reset();
  const body = validBody();
  body.company = "Robots Incorporated";
  const res = await post(body);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(store.rpcCalls.length, 0);
  assert.equal(store.sends.length, 0);
});

test("invalid consent, dates, timezones, and sources fail before writes", async () => {
  for (const patch of [
    { consent: false },
    { birthdate: "2026-02-31" },
    { birthdate: "2999-01-01" },
    { timezone: "Not/AZone" },
    { source: "affiliate" }
  ]) {
    reset();
    const res = await post({ ...validBody(), ...patch });
    assert.equal(res.statusCode, 400);
    assert.equal(store.rpcCalls.length, 0);
    assert.equal(store.sends.length, 0);
  }
});
