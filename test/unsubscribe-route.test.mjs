import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { createUnsubscribeToken } from "../api/_lib/unsubscribe-token.js";

const SECRET = "unsubscribe-secret-test-key";
const SUB_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_EMAIL = "member@sineday.app";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.UNSUBSCRIBE_SECRET = SECRET;
process.env.PUBLIC_SITE_URL = "https://sineday.app";

const store = {
  subscribers: new Map(),
  preferences: new Map(),
  deliveries: new Map(),
  rpcCalls: []
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { email: AUTH_EMAIL } }, error: null };
          }
        },
        async rpc(name, args) {
          store.rpcCalls.push({ name, args });
          if (name === "unsubscribe_email_subscriber") {
            const id = args.p_subscriber_id;
            const subscriber = store.subscribers.get(id);
            if (subscriber) subscriber.status = "unsubscribed";
            const prefs = store.preferences.get(id);
            if (prefs) {
              prefs.email_enabled = false;
              prefs.email_opt_in = false;
            }
            for (const delivery of store.deliveries.values()) {
              if (delivery.subscriber_id === id && ["queued", "processing"].includes(delivery.status)) {
                delivery.status = "skipped";
                delivery.error = "Subscriber opted out before delivery";
              }
            }
            return { data: null, error: null };
          }
          return { data: null, error: new Error("unknown rpc") };
        },
        from(tableName) {
          const state = { filters: {}, action: "select" };
          const api = {
            select() {
              return api;
            },
            eq(key, value) {
              state.filters[key] = value;
              return api;
            },
            async maybeSingle() {
              if (tableName === "subscribers") {
                if (state.filters.email) {
                  const row = [...store.subscribers.values()].find((item) => item.email === state.filters.email);
                  return { data: clone(row || null), error: null };
                }
                return { data: clone(store.subscribers.get(state.filters.id) || null), error: null };
              }
              return { data: null, error: null };
            }
          };
          return api;
        }
      };
    }
  }
});

const { default: unsubscribe } = await import("../api/unsubscribe.js");
const { default: emailStatus } = await import("../api/email-status.js");

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

function resetStore() {
  store.subscribers.clear();
  store.preferences.clear();
  store.deliveries.clear();
  store.rpcCalls.length = 0;
  store.subscribers.set(SUB_ID, {
    id: SUB_ID,
    email: AUTH_EMAIL,
    status: "active"
  });
  store.preferences.set(SUB_ID, {
    subscriber_id: SUB_ID,
    email_enabled: true,
    email_opt_in: true
  });
  store.deliveries.set("d1", {
    id: "d1",
    subscriber_id: SUB_ID,
    channel: "email",
    status: "processing"
  });
}

async function postUnsubscribe({ token, url, method = "POST" }) {
  const req = {
    method,
    headers: {},
    url: url || "/api/unsubscribe",
    body: token ? { token } : {}
  };
  const res = mockRes();
  await unsubscribe(req, res);
  return res;
}

test("unsubscribe page never unsubscribes on GET and requires a button POST", () => {
  const html = readFileSync(new URL("../unsubscribe.html", import.meta.url), "utf8");
  assert.match(html, /Unsubscribe from daily emails/);
  assert.match(html, /method:\s*["']POST["']/);
  assert.match(html, /addEventListener\(\s*["']click["']/);
  assert.equal(html.includes("DOMContentLoaded"), false);
  assert.doesNotMatch(html, /fetch\([^)]*unsubscribe[^)]*\)[\s\S]*addEventListener/);
});

test("altered unsubscribe tokens are rejected by the route", async () => {
  resetStore();
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const res = await postUnsubscribe({ token: `${token}tampered` });
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(store.rpcCalls.length, 0);
  assert.equal(store.subscribers.get(SUB_ID).status, "active");
});

test("repeated unsubscribe calls are idempotent", async () => {
  resetStore();
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const first = await postUnsubscribe({ token });
  const second = await postUnsubscribe({ token });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.ok, true);
  assert.equal(second.body.ok, true);
  assert.equal(store.rpcCalls.length, 2);
  assert.equal(store.subscribers.get(SUB_ID).status, "unsubscribed");
  assert.equal(store.preferences.get(SUB_ID).email_enabled, false);
  assert.equal(store.preferences.get(SUB_ID).email_opt_in, false);
  assert.equal(store.deliveries.get("d1").status, "skipped");
});

test("one-click POST accepts a token in the query string", async () => {
  resetStore();
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const res = await postUnsubscribe({
    url: `/api/unsubscribe?token=${encodeURIComponent(token)}`
  });
  assert.equal(res.statusCode, 200);
  assert.equal(store.subscribers.get(SUB_ID).status, "unsubscribed");
});

test("GET unsubscribe is rejected", async () => {
  resetStore();
  const token = createUnsubscribeToken(SUB_ID, SECRET);
  const res = await postUnsubscribe({ token, method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(store.rpcCalls.length, 0);
});

test("authenticated email-status PATCH uses the atomic unsubscribe RPC", async () => {
  resetStore();
  const req = {
    method: "PATCH",
    headers: { authorization: "Bearer access-token" }
  };
  const res = mockRes();
  await emailStatus(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.rpcCalls[0].name, "unsubscribe_email_subscriber");
  assert.equal(store.rpcCalls[0].args.p_subscriber_id, SUB_ID);
  assert.equal(store.subscribers.get(SUB_ID).status, "unsubscribed");
});
