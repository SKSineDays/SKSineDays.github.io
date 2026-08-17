/**
 * Timezone-safe daily email helpers.
 *
 * Daily SineDay is calculated from the permanent origin_day and the
 * subscriber's local civil date returned by claim_due_daily_emails.
 * Never derive the send day from birth_day_of_year or the Vercel runtime TZ.
 */

import { ORIGIN_ANCHOR_DATE } from "../../shared/origin-wave.js";
import { parseStrictYmd } from "./email-rhythm.js";

export const WELCOME_TEMPLATE_ALIAS = "welcomeemail";

export const DAILY_TEMPLATE_ALIASES = Object.freeze({
  1: "day01risinginitiation-1",
  2: "day02ascendingmomentum-1",
  3: "day03ascendingcreativity",
  4: "day04ascendingconnection-1",
  5: "day05ascendingproductivity-1",
  6: "day06peakbalance",
  7: "day07peakinsight-1",
  8: "day08peakchallenge-1",
  9: "day09cresttransition",
  10: "day10descendingreflection",
  11: "day11descendingintegration-1",
  12: "day12descendingrecalibration-1",
  13: "day13descendingrelease",
  14: "day14troughinnerwork",
  15: "day15troughhealing-1",
  16: "day16troughpreparation-1",
  17: "day17emergingfoundation",
  18: "day18emergingculmination"
});

export const DAILY_SINEDAY_TITLES = Object.freeze({
  1: "Initiation",
  2: "Momentum",
  3: "Creativity",
  4: "Connection",
  5: "Productivity",
  6: "Balance",
  7: "Insight",
  8: "Challenge",
  9: "Transition",
  10: "Reflection",
  11: "Integration",
  12: "Recalibration",
  13: "Release",
  14: "Inner Work",
  15: "Healing",
  16: "Preparation",
  17: "Foundation",
  18: "Culmination"
});

export const DAILY_EMAIL_SEND_INTERVAL_MS = 250;
export const DAILY_EMAIL_CLAIM_LIMIT = 50;
export const DAILY_EMAIL_RECOVERY_HOURS = 6;

const MS_PER_DAY = 86_400_000;
const REQUIRED_DAILY_EMAIL_ENV = Object.freeze([
  "CRON_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "UNSUBSCRIBE_SECRET",
  "PUBLIC_SITE_URL"
]);

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function asOriginDay(value) {
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    value = Number(value);
  }
  if (!Number.isInteger(value) || value < 1 || value > 18) return null;
  return value;
}

export function toCivilDateString(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0")
    ].join("-");
  }
  if (typeof value !== "string") return null;
  const ymd = value.trim().slice(0, 10);
  return parseStrictYmd(ymd) ? ymd : null;
}

function utcNoonMs(parsed) {
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0);
}

/**
 * Daily SineDay (1–18) from origin_day and a local YYYY-MM-DD civil date.
 * Algebraically equivalent to (days alive % 18) + 1 because
 * today - DOB = (today - anchor) - (DOB - anchor).
 */
export function calculateDailySineDay(originDay, localDateYmd) {
  const origin = asOriginDay(originDay);
  const local = parseStrictYmd(toCivilDateString(localDateYmd));
  const anchor = parseStrictYmd(ORIGIN_ANCHOR_DATE);
  if (origin == null || !local || !anchor) return null;

  const anchorToLocalDate = Math.floor((utcNoonMs(local) - utcNoonMs(anchor)) / MS_PER_DAY);
  const originOffset = origin - 1;
  return mod(anchorToLocalDate - originOffset, 18) + 1;
}

export function getDailyTemplateAlias(day) {
  const alias = DAILY_TEMPLATE_ALIASES[day];
  if (typeof alias !== "string" || alias.length === 0) return null;
  return alias;
}

export function getDailyEmailSubject(day) {
  const title = DAILY_SINEDAY_TITLES[day];
  if (!title) return null;
  return `Your SineDay — Day ${day}: ${title}`;
}

export function isValidIanaTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) return false;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
    return typeof resolved === "string" && resolved.length > 0;
  } catch {
    return false;
  }
}

export function getLocalCivilDateTime(now, timeZone) {
  if (!isValidIanaTimeZone(timeZone)) return null;
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) return null;

  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(instant);
  } catch {
    return null;
  }

  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour");
  const minute = pick("minute");
  const second = pick("second");
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  if (!parseStrictYmd(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  )) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    ymd: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

/**
 * Mirrors claim_due_daily_emails local-window math:
 * due when local time is at/after send time and less than six hours after it.
 * Invalid timezones fail closed.
 */
export function isWithinLocalSendWindow(
  now,
  timeZone,
  sendHour = 6,
  sendMinute = 0,
  windowHours = DAILY_EMAIL_RECOVERY_HOURS
) {
  if (
    !Number.isInteger(sendHour) ||
    sendHour < 0 ||
    sendHour > 23 ||
    !Number.isInteger(sendMinute) ||
    sendMinute < 0 ||
    sendMinute > 59 ||
    !Number.isFinite(windowHours) ||
    windowHours <= 0
  ) {
    return false;
  }

  const local = getLocalCivilDateTime(now, timeZone);
  if (!local) return false;

  const localSeconds = local.hour * 3600 + local.minute * 60 + local.second;
  const sendSeconds = sendHour * 3600 + sendMinute * 60;
  return localSeconds >= sendSeconds && localSeconds < sendSeconds + windowHours * 3600;
}

export function unwrapResendSend(result) {
  if (result?.error) {
    throw new Error(result.error.message || "Email send failed");
  }
  const id = result?.data?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Email send failed");
  }
  return id;
}

export function sanitizeDeliveryError(error, maxLength = 1000) {
  const raw =
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : "Delivery failed";
  const redacted = raw.replace(/\S+@\S+/g, "[redacted]").replace(/https?:\/\/\S+/gi, "[redacted]");
  return redacted.slice(0, maxLength);
}

export function getMissingDailyEmailEnv(env = process.env) {
  const missing = [];
  for (const key of REQUIRED_DAILY_EMAIL_ENV) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (!value) missing.push(key);
  }
  if (typeof env.CRON_SECRET === "string" && env.CRON_SECRET.length > 0 && env.CRON_SECRET.length < 16) {
    if (!missing.includes("CRON_SECRET")) missing.push("CRON_SECRET");
  }
  if (
    typeof env.UNSUBSCRIBE_SECRET === "string" &&
    env.UNSUBSCRIBE_SECRET.length > 0 &&
    env.UNSUBSCRIBE_SECRET.length < 16
  ) {
    if (!missing.includes("UNSUBSCRIBE_SECRET")) missing.push("UNSUBSCRIBE_SECRET");
  }
  return missing;
}

export function isDailyEmailCronEnabled(env = process.env) {
  return env.DAILY_EMAIL_CRON_ENABLED === "true";
}

export function getCronNow(env = process.env) {
  if (env.DAILY_EMAIL_ALLOW_NOW_OVERRIDE === "true" && typeof env.DAILY_EMAIL_NOW === "string") {
    const parsed = new Date(env.DAILY_EMAIL_NOW);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
