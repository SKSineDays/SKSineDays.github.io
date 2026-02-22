/**
 * Template-based PDF: extract page(s) from pre-generated template, stamp header, return bytes.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  TEMPLATE_BUCKET,
  monthlyTemplatePath,
  weeklyTemplatePath,
  monthToPageIndex,
  pad2
} from "./premium-templates.js";

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function ymdUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Build week start dates for a year (matches generator logic). */
function buildWeekStarts(year, weekStart) {
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  const jan1Next = new Date(Date.UTC(year + 1, 0, 1, 12));
  let wk = startOfWeekUTC(jan1, weekStart);
  const out = [];
  while (wk < jan1Next) {
    out.push(ymdUTC(wk));
    wk = addDaysUTC(wk, 7);
  }
  return out;
}

/** Find week index for startYmd; returns { year, weekIndex } or null. */
function getWeekIndexForStartYmd(startYmd, weekStart) {
  const [y] = startYmd.split("-").map(Number);
  for (const tryYear of [y, y + 1, y - 1]) {
    const weekStarts = buildWeekStarts(tryYear, weekStart);
    const idx = weekStarts.indexOf(startYmd);
    if (idx >= 0) return { year: tryYear, weekIndex: idx };
  }
  return null;
}

function watermarkText(userEmailOrId) {
  const ts = new Date().toISOString();
  return `Generated for ${userEmailOrId} • ${ts}`;
}

/**
 * Download template from Supabase Storage.
 * @returns {Promise<Uint8Array|null>} template bytes or null if not found
 */
async function downloadTemplate(admin, bucket, path) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Extract one monthly page, stamp header, return PDF bytes.
 */
export async function extractMonthlyFromTemplate({
  admin,
  year,
  month,
  originDay,
  profileDisplayName = "",
  userMark = "",
  locale = "en-US"
}) {
  const path = monthlyTemplatePath(year, originDay);
  const templateBytes = await downloadTemplate(admin, TEMPLATE_BUCKET, path);
  if (!templateBytes) return null;

  const templateDoc = await PDFDocument.load(templateBytes);
  const pageIndex = monthToPageIndex(month);
  const pageCount = templateDoc.getPageCount();
  if (pageIndex < 0 || pageIndex >= pageCount) return null;

  const newDoc = await PDFDocument.create();
  const [copiedPage] = await newDoc.copyPages(templateDoc, [pageIndex]);
  newDoc.addPage(copiedPage);

  const page = newDoc.getPage(0);
  const { height } = page.getSize();
  const font = await newDoc.embedFont(StandardFonts.Helvetica);
  const bold = await newDoc.embedFont(StandardFonts.HelveticaBold);

  const dtfTitle = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  const title =
    dtfTitle.format(new Date(Date.UTC(year, month - 1, 1, 12))) +
    (profileDisplayName ? `  ·  ${profileDisplayName}` : "");

  page.drawText(title, { x: 48, y: height - 40, size: 18, font: bold });
  page.drawText(watermarkText(userMark), { x: 48, y: 36, size: 8, font });

  return await newDoc.save();
}

/**
 * Extract two weekly pages, stamp header, return PDF bytes.
 */
export async function extractWeeklyFromTemplate({
  admin,
  startYmd,
  weekStart,
  originDay,
  profileDisplayName = "",
  userMark = "",
  locale = "en-US"
}) {
  const info = getWeekIndexForStartYmd(startYmd, weekStart);
  if (!info) return null;

  const { year, weekIndex } = info;
  const path = weeklyTemplatePath(year, originDay);
  const templateBytes = await downloadTemplate(admin, TEMPLATE_BUCKET, path);
  if (!templateBytes) return null;

  const templateDoc = await PDFDocument.load(templateBytes);
  const pageA = weekIndex * 2;
  const pageB = weekIndex * 2 + 1;
  const pageCount = templateDoc.getPageCount();
  if (pageB >= pageCount) return null;

  const newDoc = await PDFDocument.create();
  const [p0, p1] = await newDoc.copyPages(templateDoc, [pageA, pageB]);
  newDoc.addPage(p0);
  newDoc.addPage(p1);

  const [yy, mm, dd] = startYmd.split("-").map(Number);
  const start = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 12));
  const end = addDaysUTC(start, 6);
  const dtfRange = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  const title =
    `${dtfRange.format(start)} – ${dtfRange.format(end)}` +
    (profileDisplayName ? `  ·  ${profileDisplayName}` : "");

  const font = await newDoc.embedFont(StandardFonts.Helvetica);
  const bold = await newDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < 2; i++) {
    const page = newDoc.getPage(i);
    const { height } = page.getSize();
    page.drawText(title, { x: 48, y: height - 40, size: 16, font: bold });
    page.drawText(watermarkText(userMark), { x: 48, y: 36, size: 8, font });
  }

  return await newDoc.save();
}
