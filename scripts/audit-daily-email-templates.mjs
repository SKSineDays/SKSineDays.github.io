import { pathToFileURL } from "node:url";
import { Resend } from "resend";
import {
  DAILY_SINEDAY_TITLES,
  DAILY_TEMPLATE_ALIASES,
  WELCOME_TEMPLATE_ALIAS
} from "../api/_lib/daily-email.js";
import { MAILER_CONFIRMATION_TEMPLATE_ALIAS } from "../api/_lib/mailer-signup.js";

const SURFACES = Object.freeze({
  outer: "#05060A",
  card: "#0D111B",
  header: "#0A0D14",
  notice: "#121826",
  reflection: "#101725",
  footer: "#080A10"
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDay(value, day) {
  return new RegExp(`\\bDay\\s+${day}\\b`, "i").test(String(value || ""));
}

function getMarkedTag(html, surface) {
  const marker = escapeRegex(surface);
  return String(html || "").match(
    new RegExp(`<(?:body|table|td)\\b[^>]*data-sineday-surface=["']${marker}["'][^>]*>`, "i")
  )?.[0] || "";
}

function validateSurface(html, surface, color) {
  const tag = getMarkedTag(html, surface);
  if (!tag) return false;
  const escapedColor = escapeRegex(color);
  return (
    new RegExp(`\\bbgcolor=["']${escapedColor}["']`, "i").test(tag) &&
    new RegExp(`background-color\\s*:\\s*${escapedColor}\\b`, "i").test(tag)
  );
}

function hasMeta(html, name, content) {
  const escapedName = escapeRegex(name);
  const escapedContent = escapeRegex(content);
  return new RegExp(
    `<meta\\b[^>]*name=["']${escapedName}["'][^>]*content=["']${escapedContent}["'][^>]*>`,
    "i"
  ).test(html) || new RegExp(
    `<meta\\b[^>]*content=["']${escapedContent}["'][^>]*name=["']${escapedName}["'][^>]*>`,
    "i"
  ).test(html);
}

function validateDarkCanvasLock(html) {
  const failures = [];
  if (
    hasMeta(html, "color-scheme", "dark") ||
    hasMeta(html, "supported-color-schemes", "dark")
  ) {
    failures.push("dark-scheme-invite");
  }
  if (
    !hasMeta(html, "color-scheme", "light only") ||
    !hasMeta(html, "supported-color-schemes", "light only")
  ) {
    failures.push("canvas-lock");
  }
  return failures;
}

function validateVisualShell(html) {
  const failures = [];
  if (!/data-sineday-email-wrapper=["']true["']/i.test(html)) {
    failures.push("visual-wrapper");
  }
  if (!/<table\b[^>]*role=["']presentation["']/i.test(html)) {
    failures.push("presentation-table");
  }
  for (const [surface, color] of Object.entries(SURFACES)) {
    if (!validateSurface(html, surface, color)) {
      failures.push(`surface-${surface}`);
    }
  }
  if (!validateSurface(html, "accent", "#7AA7FF")) {
    failures.push("brand-accent");
  }
  failures.push(...validateDarkCanvasLock(html));
  return failures;
}

function getDuckImageTags(html) {
  return String(html || "").match(/<img\b[^>]*SineDuck\d{1,2}@3x\.png[^>]*>/gi) || [];
}

export function validateDailyTemplate(template, day, expectedAlias) {
  const failures = [];
  const html = String(template?.html || "");
  const subject = String(template?.subject || "");
  const expectedDuck = new RegExp(`SineDuck${day}@3x\\.png`, "i");
  const duckNumbers = [
    ...html.matchAll(/SineDuck(\d{1,2})@3x\.png/gi)
  ].map((match) => Number(match[1]));

  if (template?.alias !== expectedAlias) failures.push("alias");
  if (template?.status !== "published") failures.push("published");
  if (!hasDay(subject, day)) failures.push("subject-day");
  if (!hasDay(html, day)) failures.push("html-day");
  if (!expectedDuck.test(html)) failures.push("expected-duck");
  if (duckNumbers.some((number) => number !== day)) failures.push("wrong-duck");
  if (!html.includes("{{{OPT_OUT_URL}}}")) failures.push("opt-out");
  if (!DAILY_SINEDAY_TITLES[day]) failures.push("title");

  const duckTags = getDuckImageTags(html);
  const expectedTag = duckTags.find((tag) => expectedDuck.test(tag));
  if (
    !expectedTag ||
    !/\bsrc=["']https:\/\//i.test(expectedTag) ||
    !/\bwidth=["']\d+["']/i.test(expectedTag) ||
    !/\bborder=["']0["']/i.test(expectedTag) ||
    !/\balt=["'][^"']+["']/i.test(expectedTag) ||
    !/display\s*:\s*block/i.test(expectedTag)
  ) {
    failures.push("duck-image");
  }
  if (!validateSurface(html, "duck-plate", "#FFFFFF")) {
    failures.push("duck-plate");
  }

  failures.push(...validateVisualShell(html));
  return [...new Set(failures)];
}

export function validateWelcomeTemplate(template) {
  const failures = [];
  const html = String(template?.html || "");
  if (template?.alias !== WELCOME_TEMPLATE_ALIAS) failures.push("alias");
  if (template?.status !== "published") failures.push("published");
  if (!html.includes("{{{OPT_OUT_URL}}}")) failures.push("opt-out");
  if (!html.includes("https://sineday.app/assets/email/sineday-daily.vcf")) {
    failures.push("contact-card");
  }
  if (!/Add SineDay to Contacts/i.test(html)) failures.push("contact-action");
  failures.push(...validateVisualShell(html));
  return [...new Set(failures)];
}

export function validateConfirmationTemplate(template) {
  const failures = [];
  const html = String(template?.html || "");
  if (template?.alias !== MAILER_CONFIRMATION_TEMPLATE_ALIAS) failures.push("alias");
  if (template?.status !== "published") failures.push("published");
  if (!html.includes("{{{CONFIRM_URL}}}")) failures.push("confirm-url");
  if (!/Review and confirm my daily emails/i.test(html)) failures.push("confirm-action");
  if (!/expires in 24 hours/i.test(html)) failures.push("expiry-copy");
  if (!/Opening this email alone will not subscribe you/i.test(html)) {
    failures.push("explicit-confirmation");
  }
  failures.push(...validateVisualShell(html));
  return [...new Set(failures)];
}

function printResult({ alias, day, failures, status }) {
  const resolvedStatus =
    status || (failures.length === 0 ? "ok" : `fail(${failures.join("|")})`);
  console.log(`alias=${alias} day=${day} status=${resolvedStatus}`);
}

async function getTemplate(resend, alias) {
  try {
    const result = await resend.templates.get(alias);
    if (result?.error || !result?.data) return null;
    return result.data;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function auditDailyEmailTemplates({
  apiKey = process.env.RESEND_API_KEY,
  resend = apiKey ? new Resend(apiKey) : null
} = {}) {
  if (!apiKey || !resend) {
    console.error("alias=all day=all status=missing-resend-api-key");
    return false;
  }

  let passed = true;
  const entries = Object.entries(DAILY_TEMPLATE_ALIASES);

  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) await sleep(600);
    const [rawDay, alias] = entries[index];
    const day = Number(rawDay);
    const template = await getTemplate(resend, alias);
    if (!template) {
      passed = false;
      printResult({ alias, day, failures: [], status: "missing-or-unavailable" });
      continue;
    }
    const failures = validateDailyTemplate(template, day, alias);
    if (failures.length > 0) passed = false;
    printResult({ alias, day, failures });
  }

  await sleep(600);
  const welcome = await getTemplate(resend, WELCOME_TEMPLATE_ALIAS);
  if (!welcome) {
    passed = false;
    printResult({
      alias: WELCOME_TEMPLATE_ALIAS,
      day: "welcome",
      failures: [],
      status: "missing-or-unavailable"
    });
  } else {
    const failures = validateWelcomeTemplate(welcome);
    if (failures.length > 0) passed = false;
    printResult({
      alias: WELCOME_TEMPLATE_ALIAS,
      day: "welcome",
      failures
    });
  }

  await sleep(600);
  const confirmation = await getTemplate(resend, MAILER_CONFIRMATION_TEMPLATE_ALIAS);
  if (!confirmation) {
    passed = false;
    printResult({
      alias: MAILER_CONFIRMATION_TEMPLATE_ALIAS,
      day: "confirmation",
      failures: [],
      status: "missing-or-unavailable"
    });
  } else {
    const failures = validateConfirmationTemplate(confirmation);
    if (failures.length > 0) passed = false;
    printResult({
      alias: MAILER_CONFIRMATION_TEMPLATE_ALIAS,
      day: "confirmation",
      failures
    });
  }

  return passed;
}

async function main() {
  try {
    const passed = await auditDailyEmailTemplates();
    if (!passed) process.exitCode = 1;
  } catch {
    console.error("alias=all day=all status=audit-failed");
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await main();
}
