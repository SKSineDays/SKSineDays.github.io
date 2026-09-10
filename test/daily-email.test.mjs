import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { ORIGIN_ANCHOR_DATE } from "../shared/origin-wave.js";
import {
  DAILY_TEMPLATE_ALIASES,
  calculateDailySineDay,
  getDailyTemplateAlias,
  getLocalCivilDateTime,
  isValidIanaTimeZone,
  isWithinLocalSendWindow,
  sanitizeDeliveryError,
  unwrapResendSend
} from "../api/_lib/daily-email.js";
import {
  claimDueDailyEmails,
  createDailyEmailStore,
  getDelivery,
  seedEligibleSubscriber
} from "./helpers/daily-email-claim-sim.mjs";

const SUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("anchor 1985-04-20 Origin Day 1 is SineDay 1 on the anchor date", () => {
  assert.equal(ORIGIN_ANCHOR_DATE, "1985-04-20");
  assert.equal(calculateDailySineDay(1, "1985-04-20"), 1);
});

test("same origin advances one SineDay on the next local date", () => {
  assert.equal(calculateDailySineDay(1, "1985-04-21"), 2);
});

test("Origin Day 2 on 1985-04-21 is SineDay 1", () => {
  assert.equal(calculateDailySineDay(2, "1985-04-21"), 1);
});

test("Day 18 wraps to Day 1", () => {
  assert.equal(calculateDailySineDay(1, "1985-05-07"), 18);
  assert.equal(calculateDailySineDay(1, "1985-05-08"), 1);
});

test("dates before the anchor use positive modulo", () => {
  assert.equal(calculateDailySineDay(1, "1985-04-19"), 18);
  assert.equal(calculateDailySineDay(1, "1985-04-02"), 1);
});

test("every civil date stays within 1-18", () => {
  for (let origin = 1; origin <= 18; origin += 1) {
    for (let offset = -40; offset <= 40; offset += 1) {
      const ms = Date.UTC(1985, 3, 20 + offset, 12);
      const ymd = new Date(ms).toISOString().slice(0, 10);
      const day = calculateDailySineDay(origin, ymd);
      assert.ok(day >= 1 && day <= 18, `origin ${origin} ${ymd}`);
    }
  }
});

test("template mapping contains all integers 1-18", () => {
  for (let day = 1; day <= 18; day += 1) {
    const alias = getDailyTemplateAlias(day);
    assert.equal(typeof alias, "string");
    assert.equal(DAILY_TEMPLATE_ALIASES[day], alias);
    assert.match(alias, /^day\d{2}/);
  }
  assert.equal(Object.keys(DAILY_TEMPLATE_ALIASES).length, 18);
});

test("invalid origin days and invalid civil dates fail closed", () => {
  assert.equal(calculateDailySineDay(0, "1985-04-20"), null);
  assert.equal(calculateDailySineDay(19, "1985-04-20"), null);
  assert.equal(calculateDailySineDay(1.5, "1985-04-20"), null);
  assert.equal(calculateDailySineDay("1", "1985-04-20"), 1);
  assert.equal(calculateDailySineDay(1, "1985-04-31"), null);
  assert.equal(calculateDailySineDay(1, "04/20/1985"), null);
  assert.equal(calculateDailySineDay(1, ""), null);
  assert.equal(getDailyTemplateAlias(0), null);
  assert.equal(getDailyTemplateAlias(19), null);
});

test("America/Chicago standard time is due at 6:00 AM local", () => {
  const now = "2026-01-15T12:00:00.000Z";
  assert.equal(getLocalCivilDateTime(now, "America/Chicago").ymd, "2026-01-15");
  assert.equal(isWithinLocalSendWindow(now, "America/Chicago", 6, 0), true);
  assert.equal(isWithinLocalSendWindow("2026-01-15T11:59:59.000Z", "America/Chicago", 6, 0), false);
});

test("America/Chicago daylight time is due at 6:00 AM local", () => {
  const now = "2026-07-15T11:00:00.000Z";
  assert.equal(getLocalCivilDateTime(now, "America/Chicago").hour, 6);
  assert.equal(isWithinLocalSendWindow(now, "America/Chicago", 6, 0), true);
  assert.equal(isWithinLocalSendWindow("2026-07-15T16:59:59.000Z", "America/Chicago", 6, 0), true);
  assert.equal(isWithinLocalSendWindow("2026-07-15T17:00:00.000Z", "America/Chicago", 6, 0), false);
});

test("Pacific/Kiritimati, Pacific/Honolulu, and Asia/Kathmandu windows", () => {
  assert.equal(isWithinLocalSendWindow("2026-01-14T16:00:00.000Z", "Pacific/Kiritimati", 6, 0), true);
  assert.equal(getLocalCivilDateTime("2026-01-14T16:00:00.000Z", "Pacific/Kiritimati").ymd, "2026-01-15");
  assert.equal(isWithinLocalSendWindow("2026-01-15T16:00:00.000Z", "Pacific/Honolulu", 6, 0), true);
  assert.equal(isWithinLocalSendWindow("2026-01-15T00:15:00.000Z", "Asia/Kathmandu", 6, 0), true);
  assert.equal(isWithinLocalSendWindow("2026-01-15T00:14:59.000Z", "Asia/Kathmandu", 6, 0), false);
});

test("2026 US DST transition dates still have a 6:00 AM send window", () => {
  assert.equal(isWithinLocalSendWindow("2026-03-08T11:00:00.000Z", "America/Chicago", 6, 0), true);
  assert.equal(getLocalCivilDateTime("2026-03-08T11:00:00.000Z", "America/Chicago").hour, 6);
  assert.equal(isWithinLocalSendWindow("2026-11-01T12:00:00.000Z", "America/Chicago", 6, 0), true);
  assert.equal(getLocalCivilDateTime("2026-11-01T12:00:00.000Z", "America/Chicago").hour, 6);
});

test("invalid timezones fail closed", () => {
  assert.equal(isValidIanaTimeZone("Not/AZone"), false);
  assert.equal(isValidIanaTimeZone(""), false);
  assert.equal(isWithinLocalSendWindow("2026-01-15T12:00:00.000Z", "Not/AZone", 6, 0), false);
  assert.equal(isWithinLocalSendWindow("2026-01-15T12:00:00.000Z", "", 6, 0), false);
  assert.equal(getLocalCivilDateTime("2026-01-15T12:00:00.000Z", "Not/AZone"), null);
  assert.equal(isValidIanaTimeZone("America/Chicago"), true);
});

test("duplicate claims produce one send slot", () => {
  const store = createDailyEmailStore();
  seedEligibleSubscriber(store, { id: SUB_A });
  const first = claimDueDailyEmails(store, "2026-01-15T12:00:00.000Z");
  const second = claimDueDailyEmails(store, "2026-01-15T12:01:00.000Z");
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(store.deliveries.size, 1);
});

test("a stale processing claim can be reclaimed", () => {
  const store = createDailyEmailStore();
  seedEligibleSubscriber(store, { id: SUB_A });
  const first = claimDueDailyEmails(store, "2026-01-15T12:00:00.000Z");
  assert.equal(first.length, 1);
  const delivery = getDelivery(store, SUB_A, "2026-01-15");
  delivery.last_attempt_at = "2026-01-15T11:49:00.000Z";
  const second = claimDueDailyEmails(store, "2026-01-15T12:00:00.000Z");
  assert.equal(second.length, 1);
  assert.equal(second[0].delivery_id, first[0].delivery_id);
  assert.equal(getDelivery(store, SUB_A, "2026-01-15").attempt_count, 2);
});

test("a sent claim cannot be reclaimed", () => {
  const store = createDailyEmailStore();
  seedEligibleSubscriber(store, { id: SUB_A });
  claimDueDailyEmails(store, "2026-01-15T12:00:00.000Z");
  getDelivery(store, SUB_A, "2026-01-15").status = "sent";
  const second = claimDueDailyEmails(store, "2026-01-15T12:10:00.000Z");
  assert.equal(second.length, 0);
});

test("unsubscribed, disabled, non-opted-in, invalid-timezone, and incomplete-profile rows are skipped", () => {
  const store = createDailyEmailStore();
  seedEligibleSubscriber(store, { id: SUB_A, status: "unsubscribed" });
  seedEligibleSubscriber(store, { id: SUB_B, emailEnabled: false });
  seedEligibleSubscriber(store, {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    emailOptIn: false
  });
  seedEligibleSubscriber(store, {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    timezone: "Not/AZone"
  });
  seedEligibleSubscriber(store, {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    originDay: null
  });
  const claimed = claimDueDailyEmails(store, "2026-01-15T12:00:00.000Z");
  assert.equal(claimed.length, 0);
});

test("Resend { data, error } objects are treated as failures", () => {
  assert.throws(
    () => unwrapResendSend({ data: null, error: { message: "template is a draft" } }),
    /template is a draft/
  );
  assert.equal(unwrapResendSend({ data: { id: "email_123" }, error: null }), "email_123");
});

test("delivery errors are sanitized and truncated", () => {
  const sanitized = sanitizeDeliveryError("failed for user@example.com see https://secret.example/token");
  assert.equal(sanitized.includes("@"), false);
  assert.equal(sanitized.includes("http"), false);
  assert.equal(sanitizeDeliveryError("x".repeat(1500)).length, 1000);
});

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const APPLIED_SCHEDULER_MIGRATION = "20260817071320_daily_email_scheduler.sql";
const FUNCTION_START = /create or replace function public\.claim_due_daily_emails\s*\(/i;

function readMigration(fileName) {
  return readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
}

function extractClaimDueDailyEmailsDefinition(sql) {
  const start = sql.search(FUNCTION_START);
  if (start < 0) return null;
  const end = sql.indexOf("$$;", start);
  if (end < 0) return null;
  return sql.slice(start, end + 3);
}

function latestClaimDueDailyEmailsSql() {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  let latest = null;
  for (const fileName of files) {
    const definition = extractClaimDueDailyEmailsDefinition(readMigration(fileName));
    if (definition) {
      latest = { fileName, sql: definition };
    }
  }
  return latest;
}

test("applied daily-email scheduler migration stays unchanged", () => {
  const applied = readMigration(APPLIED_SCHEDULER_MIGRATION);
  assert.equal([...applied.matchAll(/pg_catalog\.coalesce\s*\(/g)].length, 4);
  assert.match(applied, /pg_catalog\.greatest\s*\(/);
  assert.match(applied, /pg_catalog\.least\s*\(/);
});

test("later migration recreates claim_due_daily_emails without qualified special SQL", () => {
  const latest = latestClaimDueDailyEmailsSql();
  assert.ok(latest, "claim_due_daily_emails must still be defined");
  assert.notEqual(latest.fileName, APPLIED_SCHEDULER_MIGRATION);
  assert.doesNotMatch(latest.sql, /pg_catalog\.coalesce\s*\(/);
  assert.doesNotMatch(latest.sql, /pg_catalog\.greatest\s*\(/);
  assert.doesNotMatch(latest.sql, /pg_catalog\.least\s*\(/);
  assert.match(latest.sql, /#variable_conflict use_column/);
  assert.match(latest.sql, /v_now := coalesce\(p_now, pg_catalog\.clock_timestamp\(\)\);/);
  assert.match(latest.sql, /v_limit := greatest\(1, least\(coalesce\(p_limit, 50\), 200\)\);/);
  assert.match(latest.sql, /and coalesce\(d\.last_attempt_at, d\.created_at\)/);
  assert.match(latest.sql, /and coalesce\(\s*public\.delivery_log\.last_attempt_at,/);
});
