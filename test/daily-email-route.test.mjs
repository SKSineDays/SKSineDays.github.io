import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  claimDueDailyEmails,
  createDailyEmailStore,
  seedEligibleSubscriber
} from "./helpers/daily-email-claim-sim.mjs";

const SUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CRON_SECRET = "cron-secret-test-key";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.RESEND_API_KEY = "re_test_key";
process.env.RESEND_FROM = "Daily <daily@daily.sineday.app>";
process.env.UNSUBSCRIBE_SECRET = "unsubscribe-secret-test-key";
process.env.PUBLIC_SITE_URL = "https://sineday.app";
process.env.CRON_SECRET = CRON_SECRET;
process.env.DAILY_EMAIL_CRON_ENABLED = "true";
process.env.DAILY_EMAIL_ALLOW_NOW_OVERRIDE = "true";
process.env.DAILY_EMAIL_NOW = "1985-04-20T12:00:00.000Z";

const store = createDailyEmailStore();
const sent = [];
let resendError = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeTable(tableName) {
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
      if (tableName === "subscribers") {
        return { data: clone(store.subscribers.get(state.filters.id) || null), error: null };
      }
      if (tableName === "subscriber_preferences") {
        return {
          data: clone(store.preferences.get(state.filters.subscriber_id) || null),
          error: null
        };
      }
      return { data: null, error: null };
    },
    then(resolve, reject) {
      return Promise.resolve()
        .then(async () => {
          if (tableName === "delivery_log" && state.action === "update") {
            for (const delivery of store.deliveries.values()) {
              if (delivery.id === state.filters.id) Object.assign(delivery, state.payload);
            }
            return { data: null, error: null };
          }
          return api.maybeSingle();
        })
        .then(resolve, reject);
    }
  };
  return api;
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        rpc: async (name, args) => {
          if (name !== "claim_due_daily_emails") {
            return { data: null, error: new Error("unknown rpc") };
          }
          return {
            data: claimDueDailyEmails(store, args.p_now, args.p_limit),
            error: null
          };
        },
        from(tableName) {
          return makeTable(tableName);
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
          sent.push({ payload, options });
          if (resendError) return { data: null, error: resendError };
          return { data: { id: `re_${sent.length}` }, error: null };
        }
      };
    }
  }
});

const { default: dailyEmailCron } = await import("../api/cron/daily-email.js");
const { dispatchClaimedDailyEmails } = await import("../api/_lib/daily-email-dispatch.js");

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
  store.profiles.clear();
  store.deliveries.clear();
  sent.length = 0;
  resendError = null;
  process.env.DAILY_EMAIL_CRON_ENABLED = "true";
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.DAILY_EMAIL_ALLOW_NOW_OVERRIDE = "true";
  process.env.DAILY_EMAIL_NOW = "1985-04-20T12:00:00.000Z";
}

async function runCron({
  method = "GET",
  authorization = `Bearer ${CRON_SECRET}`
} = {}) {
  const req = {
    method,
    headers: authorization ? { authorization } : {},
    url: "/api/cron/daily-email"
  };
  const res = mockRes();
  await dailyEmailCron(req, res);
  return res;
}

test("cron rejects non-GET methods", async () => {
  resetStore();
  const res = await runCron({ method: "POST" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("cron requires the bearer secret", async () => {
  resetStore();
  const res = await runCron({ authorization: "Bearer wrong-secret-value" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("disabled cron does not claim or send", async () => {
  resetStore();
  seedEligibleSubscriber(store, { id: SUB_ID });
  process.env.DAILY_EMAIL_CRON_ENABLED = "false";
  const res = await runCron();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, claimed: 0, sent: 0, failed: 0, skipped: 0 });
  assert.equal(sent.length, 0);
  assert.equal(store.deliveries.size, 0);
});

test("duplicate cron claims produce one send", async () => {
  resetStore();
  seedEligibleSubscriber(store, { id: SUB_ID });
  const first = await runCron();
  process.env.DAILY_EMAIL_NOW = "1985-04-20T12:01:00.000Z";
  const second = await runCron();
  const delivery = [...store.deliveries.values()][0];

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.claimed, 1);
  assert.equal(first.body.sent, 1);
  assert.equal(second.body.claimed, 0);
  assert.equal(second.body.sent, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.idempotencyKey, `sineday-daily/${delivery.id}`);
  assert.equal(sent[0].payload.template.id, "day01risinginitiation-1");
  assert.equal(sent[0].payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal("email" in first.body, false);
  assert.equal(JSON.stringify(first.body).includes("@"), false);
});

test("opt-out after claim but before send is rechecked and skipped", async () => {
  resetStore();
  seedEligibleSubscriber(store, { id: SUB_ID });
  store.subscribers.get(SUB_ID).status = "unsubscribed";
  store.preferences.get(SUB_ID).email_enabled = false;
  store.preferences.get(SUB_ID).email_opt_in = false;

  const claims = [{
    delivery_id: "11111111-1111-4111-8111-000000000099",
    subscriber_id: SUB_ID,
    email: "delivered+daily-sineday@resend.dev",
    timezone: "America/Chicago",
    local_date: "2026-01-15",
    origin_day: 1
  }];
  store.deliveries.set(`${SUB_ID}|email|2026-01-15`, {
    id: claims[0].delivery_id,
    subscriber_id: SUB_ID,
    status: "processing",
    attempt_count: 1,
    send_date: "2026-01-15"
  });

  const counts = await dispatchClaimedDailyEmails({
    claims,
    supabase: { from: makeTable },
    resend: {
      emails: {
        send: async () => {
          throw new Error("should not send after opt-out");
        }
      }
    },
    now: new Date("2026-01-15T12:00:00.000Z"),
    sleep: async () => {}
  });

  assert.equal(counts.skipped, 1);
  assert.equal(counts.sent, 0);
  assert.equal(store.deliveries.get(`${SUB_ID}|email|2026-01-15`).status, "skipped");
});

test("Resend error objects mark the delivery failed without leaking addresses", async () => {
  resetStore();
  seedEligibleSubscriber(store, { id: SUB_ID });
  resendError = { message: "template unpublished for delivered+daily-sineday@resend.dev" };
  const res = await runCron();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.failed, 1);
  assert.equal(res.body.sent, 0);
  const delivery = [...store.deliveries.values()][0];
  assert.equal(delivery.status, "failed");
  assert.equal(delivery.error.includes("@"), false);
  assert.equal(JSON.stringify(res.body).includes("@"), false);
});
