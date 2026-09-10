import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const store = {
  subscriber: null,
  profile: null,
  authEmail: "member@sineday.app"
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeTable(tableName) {
  const filters = {};
  const api = {
    select() {
      return api;
    },
    eq(key, value) {
      filters[key] = value;
      return api;
    },
    async maybeSingle() {
      if (tableName === "subscribers") {
        const matches = store.subscriber?.email === filters.email;
        return { data: matches ? clone(store.subscriber) : null, error: null };
      }
      if (tableName === "subscriber_profile") {
        const matches = store.profile?.subscriber_id === filters.subscriber_id;
        return { data: matches ? clone(store.profile) : null, error: null };
      }
      return { data: null, error: null };
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
            if (!store.authEmail) {
              return { data: { user: null }, error: new Error("Unauthorized") };
            }
            return {
              data: { user: { email: store.authEmail } },
              error: null
            };
          }
        },
        from(tableName) {
          return makeTable(tableName);
        }
      };
    }
  }
});

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

async function withNow(iso, fn) {
  const NativeDate = globalThis.Date;
  const fixedNow = new NativeDate(iso);
  globalThis.Date = class FixedDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow.getTime());
      } else {
        super(...args);
      }
    }

    static now() {
      return fixedNow.getTime();
    }
  };

  try {
    return await fn();
  } finally {
    globalThis.Date = NativeDate;
  }
}

async function getStatus() {
  const req = {
    method: "GET",
    headers: { authorization: "Bearer test-token" }
  };
  const res = mockRes();
  await emailStatus(req, res);
  return res;
}

function seed({ status = "active", timezone = "America/Chicago", profile } = {}) {
  store.subscriber = {
    id: SUBSCRIBER_ID,
    email: store.authEmail,
    status,
    timezone
  };
  store.profile = profile
    ? { subscriber_id: SUBSCRIBER_ID, ...profile }
    : null;
}

test("configured subscriber status reports today's local Daily Duck SineDay", async () => {
  seed({
    profile: { birth_day_of_year: 110, origin_day: 1 }
  });

  const res = await withNow("2026-09-10T12:00:00.000Z", getStatus);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    subscribed: true,
    profileConfigured: true,
    originDay: 1,
    currentSineDay: 17,
    timezone: "America/Chicago"
  });
  assert.equal("id" in res.body, false);
  assert.equal("birth_day_of_year" in res.body, false);
  assert.equal("birthdate" in res.body, false);
  assert.equal("providerMessageId" in res.body, false);
});

test("incomplete profile never defaults currentSineDay to Day 1", async () => {
  seed({
    profile: { birth_day_of_year: 110, origin_day: null }
  });

  const res = await withNow("2026-09-10T12:00:00.000Z", getStatus);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profileConfigured, false);
  assert.equal(res.body.originDay, null);
  assert.equal(res.body.currentSineDay, null);
  assert.equal(res.body.timezone, "America/Chicago");
});

test("invalid subscriber timezone fails closed without guessing a SineDay", async () => {
  seed({
    timezone: "Not/AZone",
    profile: { birth_day_of_year: 110, origin_day: 1 }
  });

  const res = await withNow("2026-09-10T12:00:00.000Z", getStatus);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profileConfigured, true);
  assert.equal(res.body.currentSineDay, null);
  assert.equal(res.body.timezone, "Not/AZone");
});

test("unsubscribed subscriber keeps the locked rhythm and current SineDay", async () => {
  seed({
    status: "unsubscribed",
    profile: { birth_day_of_year: 110, origin_day: 1 }
  });

  const res = await withNow("2026-09-10T12:00:00.000Z", getStatus);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.subscribed, false);
  assert.equal(res.body.profileConfigured, true);
  assert.equal(res.body.originDay, 1);
  assert.equal(res.body.currentSineDay, 17);
  assert.equal(res.body.timezone, "America/Chicago");
});
