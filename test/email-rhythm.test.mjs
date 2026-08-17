import test from "node:test";
import assert from "node:assert/strict";
import {
  parseStrictYmd,
  getBirthDayOfYear,
  isEmailRhythmLocked,
  deriveEmailRhythmFromBirthdate,
  resolveEmailRhythmWrite,
  buildEmailStatusPayload,
  todayYmdInTimeZone
} from "../api/_lib/email-rhythm.js";
import { getOriginTypeForDob } from "../shared/origin-wave.js";

test("parseStrictYmd accepts real calendar dates only", () => {
  assert.deepEqual(parseStrictYmd("1990-05-15"), {
    year: 1990,
    month: 5,
    day: 15,
    ymd: "1990-05-15"
  });
  assert.equal(parseStrictYmd("2024-02-30"), null);
  assert.equal(parseStrictYmd("2024-13-01"), null);
  assert.equal(parseStrictYmd("15-05-1990"), null);
  assert.equal(parseStrictYmd(""), null);
  assert.equal(parseStrictYmd(null), null);
});

test("getBirthDayOfYear uses UTC calendar math", () => {
  assert.equal(getBirthDayOfYear("2024-01-01"), 1);
  assert.equal(getBirthDayOfYear("2024-12-31"), 366);
  assert.equal(getBirthDayOfYear("2023-12-31"), 365);
  assert.equal(getBirthDayOfYear("2024-02-30"), null);
});

test("deriveEmailRhythmFromBirthdate uses shared Origin math and rejects future dates", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  const derived = deriveEmailRhythmFromBirthdate("1985-04-20", {
    now,
    timezone: "UTC"
  });
  assert.equal(derived.ok, true);
  assert.equal(derived.originDay, getOriginTypeForDob("1985-04-20"));
  assert.equal(derived.originDay, 1);
  assert.equal(derived.birthDayOfYear, 110);
  assert.equal("sinedayIndex" in derived, false);

  const future = deriveEmailRhythmFromBirthdate("2026-08-13", {
    now,
    timezone: "UTC"
  });
  assert.equal(future.ok, false);
  assert.equal(future.error, "Birthdate cannot be in the future.");
  assert.equal("birthdate" in future, false);

  const invalid = deriveEmailRhythmFromBirthdate("2024-02-30", { now, timezone: "UTC" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "Enter a valid birthdate.");
});

test("todayYmdInTimeZone does not reject a still-valid local today", () => {
  const now = new Date("2026-08-12T18:00:00Z");
  assert.equal(todayYmdInTimeZone("UTC", now), "2026-08-12");
  assert.equal(todayYmdInTimeZone("Pacific/Kiritimati", now), "2026-08-13");
});

test("email rhythm is locked only when both derived values exist", () => {
  assert.equal(isEmailRhythmLocked(null), false);
  assert.equal(isEmailRhythmLocked({ birth_day_of_year: 12 }), false);
  assert.equal(isEmailRhythmLocked({ origin_day: 7 }), false);
  assert.equal(
    isEmailRhythmLocked({ birth_day_of_year: 12, origin_day: 7 }),
    true
  );
});

test("locked email rhythm ignores later derived or client-provided values", () => {
  const existing = {
    birth_day_of_year: 100,
    origin_day: 7
  };
  const decision = resolveEmailRhythmWrite({
    existingProfile: existing,
    derived: {
      birthDayOfYear: 200,
      originDay: 3
    },
    clientProvided: {
      birth_day_of_year: 1,
      origin_day: 18
    }
  });

  assert.equal(decision.write, null);
  assert.equal(decision.locked, true);
  assert.equal(decision.configured, true);
  assert.equal(decision.originDay, 7);
  assert.equal(decision.birthDayOfYear, 100);
});

test("incomplete email rhythm can be completed once from Daily Duck birthdate", () => {
  const decision = resolveEmailRhythmWrite({
    existingProfile: { birth_day_of_year: 40, origin_day: null },
    derived: {
      birthDayOfYear: 110,
      originDay: 1
    }
  });

  assert.equal(decision.locked, false);
  assert.equal(decision.configured, true);
  assert.deepEqual(decision.write, {
    birth_day_of_year: 110,
    origin_day: 1
  });
  assert.equal("sineday_index" in decision.write, false);
});

test("stale client derived values can complete an incomplete profile but never overwrite a lock", () => {
  const incomplete = resolveEmailRhythmWrite({
    existingProfile: { birth_day_of_year: null, origin_day: null },
    clientProvided: {
      birth_day_of_year: 12,
      origin_day: 4
    }
  });
  assert.equal(incomplete.configured, true);
  assert.equal(incomplete.write.origin_day, 4);

  const locked = resolveEmailRhythmWrite({
    existingProfile: { birth_day_of_year: 12, origin_day: 4 },
    clientProvided: {
      birth_day_of_year: 99,
      origin_day: 18
    }
  });
  assert.equal(locked.write, null);
  assert.equal(locked.originDay, 4);
});

test("email-status payload never includes raw birthdate or subscriber id", () => {
  const empty = buildEmailStatusPayload(null, null);
  assert.deepEqual(empty, {
    ok: true,
    subscribed: false,
    profileConfigured: false,
    originDay: null
  });

  const activeIncomplete = buildEmailStatusPayload(
    { id: "sub_secret", status: "active" },
    { birth_day_of_year: 12 }
  );
  assert.deepEqual(activeIncomplete, {
    ok: true,
    subscribed: true,
    profileConfigured: false,
    originDay: null
  });
  assert.equal("id" in activeIncomplete, false);
  assert.equal("birthdate" in activeIncomplete, false);

  const unsubscribedConfigured = buildEmailStatusPayload(
    { id: "sub_secret", status: "unsubscribed" },
    { birth_day_of_year: 12, origin_day: 7 }
  );
  assert.deepEqual(unsubscribedConfigured, {
    ok: true,
    subscribed: false,
    profileConfigured: true,
    originDay: 7
  });
});
