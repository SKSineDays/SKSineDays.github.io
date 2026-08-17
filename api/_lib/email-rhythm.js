/**
 * Daily Duck email rhythm helpers.
 *
 * Dashboard profiles store a full birthdate.
 * Newsletter identity stores only derived values:
 *   subscriber_profile.birth_day_of_year
 *   subscriber_profile.origin_day
 *
 * Once both derived values exist, the email rhythm is locked.
 */

import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "../../shared/origin-wave.js";

const STRICT_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function formatUtcYmd(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function todayYmdInTimeZone(timeZone, now = new Date()) {
  if (timeZone && typeof timeZone === "string") {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(now);
      const year = parts.find((part) => part.type === "year")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      const day = parts.find((part) => part.type === "day")?.value;
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      // Invalid IANA timezone — fall through to a timezone-safe UTC bound.
    }
  }

  // UTC+14 is the latest calendar date that can still be "today" somewhere.
  return formatUtcYmd(new Date(now.getTime() + 14 * 60 * 60 * 1000));
}

export function parseStrictYmd(value) {
  if (typeof value !== "string") return null;
  const match = STRICT_YMD.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, ymd: value };
}

export function getBirthDayOfYear(ymd) {
  const parsed = parseStrictYmd(ymd);
  if (!parsed) return null;
  const date = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const start = Date.UTC(parsed.year, 0, 0);
  return Math.floor((date - start) / 86400000);
}

export function isEmailRhythmLocked(profile) {
  return (
    profile != null &&
    profile.birth_day_of_year != null &&
    profile.origin_day != null
  );
}

export function deriveEmailRhythmFromBirthdate(ymd, { now = new Date(), timezone } = {}) {
  const parsed = parseStrictYmd(ymd);
  if (!parsed) {
    return { ok: false, error: "Enter a valid birthdate." };
  }

  const todayYmd = todayYmdInTimeZone(timezone, now);
  if (parsed.ymd > todayYmd) {
    return { ok: false, error: "Birthdate cannot be in the future." };
  }

  const birthDayOfYear = getBirthDayOfYear(parsed.ymd);
  const originDay = getOriginTypeForDob(parsed.ymd, ORIGIN_ANCHOR_DATE);
  if (!birthDayOfYear || !originDay) {
    return { ok: false, error: "Enter a valid birthdate." };
  }

  return {
    ok: true,
    birthDayOfYear,
    originDay
  };
}

function hasOwnRhythmValue(value) {
  return value !== null && value !== undefined;
}

/**
 * Decide whether subscriber_profile rhythm fields may be written.
 * Locked profiles never change, even if a stale client submits new values.
 */
export function resolveEmailRhythmWrite({
  existingProfile = null,
  derived = null,
  clientProvided = null
} = {}) {
  if (isEmailRhythmLocked(existingProfile)) {
    return {
      write: null,
      locked: true,
      configured: true,
      originDay: existingProfile.origin_day,
      birthDayOfYear: existingProfile.birth_day_of_year
    };
  }

  const next = {
    birth_day_of_year: existingProfile?.birth_day_of_year ?? null,
    origin_day: existingProfile?.origin_day ?? null
  };

  if (derived) {
    next.birth_day_of_year = derived.birthDayOfYear;
    next.origin_day = derived.originDay;
  } else if (clientProvided) {
    if (hasOwnRhythmValue(clientProvided.birth_day_of_year)) {
      next.birth_day_of_year = clientProvided.birth_day_of_year;
    }
    if (hasOwnRhythmValue(clientProvided.origin_day)) {
      next.origin_day = clientProvided.origin_day;
    }
  }

  const configured =
    next.birth_day_of_year != null && next.origin_day != null;
  const hasWrite = Boolean(derived || clientProvided);

  return {
    write: hasWrite ? next : null,
    locked: false,
    configured,
    originDay: next.origin_day,
    birthDayOfYear: next.birth_day_of_year
  };
}

export function buildEmailStatusPayload(subscriber, profile) {
  const configured = isEmailRhythmLocked(profile);
  return {
    ok: true,
    subscribed: !!subscriber && subscriber.status === "active",
    profileConfigured: configured,
    originDay: configured ? profile.origin_day : null
  };
}
