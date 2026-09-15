import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_FROM = "Daily <daily@daily.sineday.app>";
process.env.UNSUBSCRIBE_SECRET = "unsubscribe-secret-test-key";
process.env.PUBLIC_SITE_URL = "https://sineday.app";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WELCOME_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "a".repeat(43);
const store = {
  confirmationState: "active",
  rpcCalls: [],
  sends: [],
  confirmError: null,
  welcomeClaimed: false
};

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        async rpc(name, args) {
          store.rpcCalls.push({ name, args });
          if (name === "confirm_mailer_signup") {
            if (store.confirmError) return { data: null, error: store.confirmError };
            return {
              data: [{
                result_state: store.confirmationState,
                subscriber_id: store.confirmationState === "active" ? SUBSCRIBER_ID : null,
                timezone: store.confirmationState === "active" ? "America/Chicago" : null,
                send_hour_local: store.confirmationState === "active" ? 6 : null,
                send_minute_local: store.confirmationState === "active" ? 0 : null
              }],
              error: null
            };
          }
          if (name === "claim_due_mailer_welcomes") {
            if (store.welcomeClaimed) return { data: [], error: null };
            store.welcomeClaimed = true;
            return {
              data: [{
                delivery_id: WELCOME_ID,
                subscriber_id: SUBSCRIBER_ID,
                email: "member@example.com"
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
          return { data: { id: "welcome_provider_id" }, error: null };
        }
      };
    }
  }
});

const { default: confirm } = await import("../api/mailer-confirm.js");

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

function reset(state = "active") {
  store.confirmationState = state;
  store.rpcCalls.length = 0;
  store.sends.length = 0;
  store.confirmError = null;
  store.welcomeClaimed = false;
}

async function request({ method = "POST", token = TOKEN } = {}) {
  const req = {
    method,
    headers: {},
    body: { token }
  };
  const res = mockRes();
  await confirm(req, res);
  return res;
}

test("confirmed activation returns only the actual schedule and sends welcome once", async () => {
  reset();
  const res = await request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    state: "active",
    timezone: "America/Chicago",
    sendHourLocal: 6,
    sendMinuteLocal: 0
  });
  assert.equal("subscriberId" in res.body, false);
  assert.equal("originDay" in res.body, false);
  assert.equal(store.sends.length, 1);
  assert.equal(store.sends[0].payload.template.id, "welcomeemail");
  assert.equal(
    store.sends[0].options.idempotencyKey,
    `sineday-welcome/${SUBSCRIBER_ID}`
  );
});

test("GET never consumes a confirmation token", async () => {
  reset();
  const res = await request({ method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(store.rpcCalls.length, 0);
  assert.equal(store.sends.length, 0);
});

test("replayed, expired, invalid, and suppressed states are explicit but disclose no identity", async () => {
  const cases = [
    ["already_used", 409, "already-used"],
    ["expired", 410, "expired"],
    ["invalid", 400, "invalid"],
    ["suppressed", 409, "unavailable"]
  ];
  for (const [databaseState, statusCode, publicState] of cases) {
    reset(databaseState);
    const res = await request();
    assert.equal(res.statusCode, statusCode);
    assert.equal(res.body.state, publicState);
    assert.equal(JSON.stringify(res.body).includes(SUBSCRIBER_ID), false);
    assert.equal(store.sends.length, 0);
  }
});

test("required activation failures roll back to a retry response", async () => {
  reset();
  store.confirmError = new Error("transaction failed");
  const res = await request();
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.state, "retry");
  assert.equal(store.sends.length, 0);
});

test("malformed tokens fail before database access", async () => {
  reset();
  const res = await request({ token: "short" });
  assert.equal(res.statusCode, 400);
  assert.equal(store.rpcCalls.length, 0);
});
