import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { Webhook } from "standardwebhooks";

const WEBHOOK_SECRET = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const EMAIL_ID = "ae2014de-c168-4c61-8267-70d2662a1ce1";
const SUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;

const store = {
  deliveries: new Map(),
  subscribers: new Map(),
  preferences: new Map()
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        from(tableName) {
          const state = { filters: {}, payload: null, action: "select" };
          const api = {
            select() {
              state.action = state.action === "update" ? "update" : "select";
              return api;
            },
            update(row) {
              state.action = "update";
              state.payload = row;
              return api;
            },
            eq(key, value) {
              state.filters[key] = value;
              return api;
            },
            async maybeSingle() {
              if (tableName === "delivery_log") {
                const row = [...store.deliveries.values()].find(
                  (item) => item.provider_message_id === state.filters.provider_message_id
                );
                return { data: clone(row || null), error: null };
              }
              return { data: null, error: null };
            },
            then(resolve, reject) {
              return Promise.resolve()
                .then(() => {
                  if (state.action !== "update") return { data: null, error: null };
                  if (tableName === "delivery_log") {
                    const row = store.deliveries.get(state.filters.id);
                    if (row) Object.assign(row, state.payload);
                  }
                  if (tableName === "subscribers") {
                    const row = store.subscribers.get(state.filters.id);
                    if (row && (!state.filters.status || row.status === state.filters.status)) {
                      Object.assign(row, state.payload);
                    }
                  }
                  if (tableName === "subscriber_preferences") {
                    const row = store.preferences.get(state.filters.subscriber_id);
                    if (row) Object.assign(row, state.payload);
                  }
                  return { data: null, error: null };
                })
                .then(resolve, reject);
            }
          };
          return api;
        }
      };
    }
  }
});

const { default: webhook } = await import("../api/resend/webhook.js");

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
    },
    end() {
      return this;
    }
  };
}

function signEvent(event) {
  const payload = JSON.stringify(event);
  const id = "msg_test_1";
  const timestamp = new Date();
  const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, payload);
  return {
    payload,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature
    }
  };
}

function resetStore() {
  store.deliveries.clear();
  store.subscribers.clear();
  store.preferences.clear();
  store.deliveries.set("del_1", {
    id: "del_1",
    subscriber_id: SUB_ID,
    provider_message_id: EMAIL_ID,
    provider_status: null
  });
  store.subscribers.set(SUB_ID, { id: SUB_ID, status: "active" });
  store.preferences.set(SUB_ID, {
    subscriber_id: SUB_ID,
    email_enabled: true,
    email_opt_in: true
  });
}

async function postWebhook({ payload, headers, method = "POST" }) {
  const req = {
    method,
    headers,
    async text() {
      return payload;
    }
  };
  const res = mockRes();
  await webhook(req, res);
  return res;
}

test("invalid webhook signatures cause HTTP 400", async () => {
  resetStore();
  const signed = signEvent({
    type: "email.delivered",
    created_at: "2026-01-15T12:00:00.000Z",
    data: { email_id: EMAIL_ID }
  });
  const res = await postWebhook({
    payload: signed.payload,
    headers: {
      ...signed.headers,
      "svix-signature": "v1,dGFtcGVyZWQ="
    }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(store.subscribers.get(SUB_ID).status, "active");
});

test("bounced events suppress sending but preserve email_opt_in", async () => {
  resetStore();
  const signed = signEvent({
    type: "email.bounced",
    created_at: "2026-01-15T12:00:00.000Z",
    data: { email_id: EMAIL_ID }
  });
  const res = await postWebhook(signed);
  assert.equal(res.statusCode, 200);
  assert.equal(store.deliveries.get("del_1").provider_status, "email.bounced");
  assert.equal(store.subscribers.get(SUB_ID).status, "suppressed");
  assert.equal(store.preferences.get(SUB_ID).email_enabled, false);
  assert.equal(store.preferences.get(SUB_ID).email_opt_in, true);
});

test("replayed webhook events do not produce harmful state changes", async () => {
  resetStore();
  store.subscribers.get(SUB_ID).status = "unsubscribed";
  const signed = signEvent({
    type: "email.bounced",
    created_at: "2026-01-15T12:00:00.000Z",
    data: { email_id: EMAIL_ID }
  });
  const first = await postWebhook(signed);
  const second = await postWebhook(signed);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(store.subscribers.get(SUB_ID).status, "unsubscribed");
  assert.equal(store.preferences.get(SUB_ID).email_opt_in, true);
  assert.equal(store.deliveries.get("del_1").provider_status, "email.bounced");
});

test("GET is rejected", async () => {
  const res = await postWebhook({
    method: "GET",
    payload: "{}",
    headers: {}
  });
  assert.equal(res.statusCode, 405);
});
