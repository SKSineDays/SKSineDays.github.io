import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-test-key";
process.env.APP_URL = "https://sineday.app";

const USER_ID = "user-1111-1111-1111-111111111111";
const PAGE_SIZE = 500;

const store = {
  authValid: true,
  journalRows: [],
  pageSize: PAGE_SIZE,
  requirePremiumCalled: false,
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeJournalQuery() {
  let filters = {};
  let rangeFrom = 0;
  let rangeTo = PAGE_SIZE - 1;

  const api = {
    select() {
      return api;
    },
    eq(key, value) {
      filters[key] = value;
      return api;
    },
    order() {
      return api;
    },
    range(from, to) {
      rangeFrom = from;
      rangeTo = to;
      return api;
    },
    then(resolve, reject) {
      return api.execute().then(resolve, reject);
    },
    async execute() {
      const filtered = store.journalRows
        .filter((row) => row.user_id === filters.user_id)
        .sort((a, b) => {
          const dateCmp = String(a.entry_date).localeCompare(String(b.entry_date));
          if (dateCmp !== 0) return dateCmp;
          return String(a.id).localeCompare(String(b.id));
        });

      const page = filtered.slice(rangeFrom, rangeTo + 1).map((row) => ({
        entry_date: row.entry_date,
        actual_sineday: row.actual_sineday,
        felt_sineday: row.felt_sineday,
        content: row.content,
      }));

      return { data: clone(page), error: null };
    },
  };

  return api;
}

mock.module("../api/_lib/auth.js", {
  namedExports: {
    authenticateUser: async (req) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader?.startsWith("Bearer ") || !store.authValid) {
        throw new Error("Invalid or expired token");
      }
      return {
        user: { id: USER_ID, email: "member@sineday.app" },
        supabase: {
          from(table) {
            if (table !== "journal_entries") {
              throw new Error(`Unexpected table: ${table}`);
            }
            return makeJournalQuery();
          },
        },
        accessToken: "test-token",
      };
    },
    getAdminClient: () => {
      throw new Error("getAdminClient should not be used");
    },
    requirePremium: async () => {
      store.requirePremiumCalled = true;
      throw new Error("Premium required");
    },
    getPremiumEntitlement: async () => ({ premium: false }),
  },
});

const { default: exportJournalData } = await import("../api/export-journal-data.js");

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
    },
  };
}

async function getExport(headers = { authorization: "Bearer test-token" }) {
  const req = { method: "GET", headers };
  const res = mockRes();
  await exportJournalData(req, res);
  return res;
}

function resetStore(rows = []) {
  store.authValid = true;
  store.journalRows = rows;
  store.pageSize = PAGE_SIZE;
  store.requirePremiumCalled = false;
}

test("unauthenticated request returns 401", async () => {
  resetStore();
  store.authValid = false;
  const res = await getExport();
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Authentication required");
});

test("authenticated export works without Premium entitlement", async () => {
  resetStore([
    {
      id: "row-1",
      user_id: USER_ID,
      entry_date: "2026-09-15",
      actual_sineday: 16,
      felt_sineday: 14,
      content: "A reflective day.",
    },
  ]);

  const res = await getExport();
  assert.equal(res.statusCode, 200);
  assert.equal(store.requirePremiumCalled, false);
  assert.equal(res.body.format, "sineday-journal-export");
  assert.equal(res.body.version, 1);
  assert.equal(res.body.record_count, 1);
  assert.deepEqual(res.body.entries[0], {
    date: "2026-09-15",
    actual_sineday: 16,
    felt_sineday: 14,
    journal_entry: "A reflective day.",
  });
});

test("felt-only row is exported with null journal_entry", async () => {
  resetStore([
    {
      id: "row-felt",
      user_id: USER_ID,
      entry_date: "2026-09-16",
      actual_sineday: 17,
      felt_sineday: 11,
      content: "",
    },
  ]);

  const res = await getExport();
  assert.equal(res.body.record_count, 1);
  assert.deepEqual(res.body.entries[0], {
    date: "2026-09-16",
    actual_sineday: 17,
    felt_sineday: 11,
    journal_entry: null,
  });
});

test("blank and image-only-equivalent rows are excluded", async () => {
  resetStore([
    {
      id: "row-blank",
      user_id: USER_ID,
      entry_date: "2026-09-10",
      actual_sineday: 12,
      felt_sineday: null,
      content: "   ",
    },
    {
      id: "row-image-only",
      user_id: USER_ID,
      entry_date: "2026-09-11",
      actual_sineday: 13,
      felt_sineday: null,
      content: "",
    },
    {
      id: "row-real",
      user_id: USER_ID,
      entry_date: "2026-09-12",
      actual_sineday: 14,
      felt_sineday: null,
      content: "Saved text",
    },
  ]);

  const res = await getExport();
  assert.equal(res.body.record_count, 1);
  assert.equal(res.body.entries[0].date, "2026-09-12");
});

test("internal columns are not present in export entries", async () => {
  resetStore([
    {
      id: "internal-row",
      user_id: USER_ID,
      profile_id: "profile-uuid",
      entry_date: "2026-09-15",
      actual_sineday: 16,
      felt_sineday: 14,
      content: "Keep me",
      image_path: "private/path.jpg",
      created_at: "2026-09-15T12:00:00.000Z",
      updated_at: "2026-09-15T12:05:00.000Z",
    },
  ]);

  const res = await getExport();
  const entry = res.body.entries[0];
  assert.deepEqual(Object.keys(entry).sort(), [
    "actual_sineday",
    "date",
    "felt_sineday",
    "journal_entry",
  ]);
});

test("empty account returns valid zero-record export", async () => {
  resetStore([]);
  const res = await getExport();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.record_count, 0);
  assert.deepEqual(res.body.entries, []);
});

test("pagination does not truncate datasets larger than one page", async () => {
  resetStore([]);
  for (let i = 0; i < PAGE_SIZE + 3; i += 1) {
    const day = String((i % 28) + 1).padStart(2, "0");
    store.journalRows.push({
      id: `row-${i}`,
      user_id: USER_ID,
      entry_date: `2026-01-${day}`,
      actual_sineday: (i % 18) + 1,
      felt_sineday: i % 5 === 0 ? 3 : null,
      content: i % 5 === 0 ? "" : `Entry ${i}`,
    });
  }

  const res = await getExport();
  const expectedCount = PAGE_SIZE + 3;
  assert.equal(res.body.record_count, expectedCount);
  assert.equal(res.body.entries.length, expectedCount);
  assert.equal(res.body.entries[0].date, "2026-01-01");
  assert.ok(res.body.entries.some((entry) => entry.journal_entry === `Entry ${expectedCount - 1}`));
});

test("multiline journal text is preserved without trimming export body", async () => {
  resetStore([
    {
      id: "row-multiline",
      user_id: USER_ID,
      entry_date: "2026-09-17",
      actual_sineday: 18,
      felt_sineday: null,
      content: "  Line one\n\nLine two  ",
    },
  ]);

  const res = await getExport();
  assert.equal(res.body.entries[0].journal_entry, "  Line one\n\nLine two  ");
});

test("unsupported method returns 405", async () => {
  const req = { method: "POST", headers: { authorization: "Bearer test-token" } };
  const res = mockRes();
  await exportJournalData(req, res);
  assert.equal(res.statusCode, 405);
});

test("route source does not depend on requirePremium or subscriptions", () => {
  const source = readFileSync(join(root, "api/export-journal-data.js"), "utf8");
  assert.doesNotMatch(source, /requirePremium/);
  assert.doesNotMatch(source, /subscriptions/);
  assert.doesNotMatch(source, /getAdminClient/);
  assert.doesNotMatch(source, /SERVICE_ROLE/);
});
