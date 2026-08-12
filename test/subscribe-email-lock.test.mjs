import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

const store = {
  subscribers: new Map(),
  profiles: new Map(),
  preferences: new Map(),
  authEmail: "member@sineday.app"
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeTable(tableName) {
  let filters = {};
  let payload = null;
  let action = "select";
  let columns = "*";

  const api = {
    select(cols) {
      action = action === "upsert" || action === "update" ? action : "select";
      columns = cols;
      return api;
    },
    eq(key, value) {
      filters[key] = value;
      return api;
    },
    upsert(row) {
      action = "upsert";
      payload = row;
      return api;
    },
    update(row) {
      action = "update";
      payload = row;
      return api;
    },
    single: async () => api.maybeSingle(),
    async maybeSingle() {
      if (tableName === "subscribers") {
        if (action === "upsert") {
          const existing = [...store.subscribers.values()].find((row) => row.email === payload.email);
          const row = {
            id: existing?.id || `sub_${store.subscribers.size + 1}`,
            created_at: existing?.created_at || "2026-01-01T00:00:00.000Z",
            ...existing,
            ...payload
          };
          store.subscribers.set(row.id, row);
          return { data: clone(row), error: null };
        }
        const row = [...store.subscribers.values()].find((item) => item.email === filters.email) || null;
        return { data: clone(row), error: null };
      }

      if (tableName === "subscriber_preferences") {
        if (action === "upsert") {
          store.preferences.set(payload.subscriber_id, { ...payload });
          return { data: clone(payload), error: null };
        }
        return { data: null, error: null };
      }

      if (tableName === "subscriber_profile") {
        if (action === "upsert") {
          const existing = store.profiles.get(payload.subscriber_id) || {};
          const row = { ...existing, ...payload };
          store.profiles.set(payload.subscriber_id, row);
          return { data: clone(row), error: null };
        }
        const row = store.profiles.get(filters.subscriber_id) || null;
        if (!row) return { data: null, error: null };
        if (columns === "*") return { data: clone(row), error: null };
        const picked = {};
        for (const key of String(columns).split(",").map((part) => part.trim())) {
          picked[key] = row[key];
        }
        return { data: picked, error: null };
      }

      return { data: null, error: null };
    },
    then(resolve, reject) {
      return api.maybeSingle().then(resolve, reject);
    }
  };

  return api;
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient() {
      return {
        auth: {
          async getUser() {
            if (!store.authEmail) return { data: { user: null }, error: new Error("no user") };
            return { data: { user: { email: store.authEmail } }, error: null };
          }
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
      emails = { send: async () => ({ id: "email_skip" }) };
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
    },
    end() {
      return this;
    }
  };
}

async function postSubscribe(body, { bearer = "token" } = {}) {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  const req = {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body
  };
  const res = mockRes();
  await subscribe(req, res);
  return res;
}

test("authenticated Daily Duck setup stores derived values and not the raw birthdate", async () => {
  store.subscribers.clear();
  store.profiles.clear();
  store.preferences.clear();
  store.authEmail = "member@sineday.app";

  const res = await postSubscribe({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20",
    source: "dashboard-daily-duck"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.profileConfigured, true);
  assert.equal(res.body.profileLocked, true);
  assert.equal(res.body.originDay, 1);
  assert.equal("birthdate" in res.body, false);

  const subscriber = [...store.subscribers.values()][0];
  const profile = store.profiles.get(subscriber.id);
  assert.equal(profile.birth_day_of_year, 110);
  assert.equal(profile.origin_day, 1);
  assert.equal("birthdate" in profile, false);
});

test("locked Daily Duck identity is not overwritten by a later birthdate or stale client values", async () => {
  store.subscribers.clear();
  store.profiles.clear();
  store.preferences.clear();
  store.authEmail = "member@sineday.app";

  await postSubscribe({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "1985-04-20",
    source: "dashboard-daily-duck"
  });

  const res = await postSubscribe({
    consent: true,
    timezone: "America/Chicago",
    birthdate: "2000-01-01",
    birth_day_of_year: 1,
    origin_day: 18,
    source: "dashboard-owner"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profileLocked, true);
  assert.equal(res.body.originDay, 1);

  const subscriber = [...store.subscribers.values()][0];
  const profile = store.profiles.get(subscriber.id);
  assert.equal(profile.birth_day_of_year, 110);
  assert.equal(profile.origin_day, 1);
  assert.equal(subscriber.status, "active");
});

test("re-subscribe without a birthdate reuses the locked email rhythm", async () => {
  store.subscribers.clear();
  store.profiles.clear();
  store.preferences.clear();
  store.authEmail = "member@sineday.app";

  await postSubscribe({
    consent: true,
    birthdate: "1985-04-20",
    source: "dashboard-daily-duck"
  });

  const subscriber = [...store.subscribers.values()][0];
  subscriber.status = "unsubscribed";

  const res = await postSubscribe({
    consent: true,
    timezone: "America/Chicago",
    source: "dashboard-daily-duck"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.originDay, 1);
  assert.equal(store.profiles.get(subscriber.id).origin_day, 1);
  assert.equal(store.subscribers.get(subscriber.id).status, "active");
});
