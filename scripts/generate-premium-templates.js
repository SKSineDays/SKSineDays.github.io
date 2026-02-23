/**
 * Batch-generate 18 premium template PDFs (monthly + weekly) using the existing
 * calendar-pdf render functions. Uploads to Supabase premium_templates bucket.
 *
 * Regenerate after footer or layout changes to clear any baked-in content.
 *
 * Run from repo root:
 *   export SUPABASE_URL="..."
 *   export SUPABASE_SERVICE_ROLE_KEY="..."
 *   export TEMPLATE_ASSET_ORIGIN="https://YOUR_DEPLOYED_DOMAIN"
 *   npm run gen:templates -- --year 2026 --weekStart 0 --locale en-US --version v1
 */
import { PDFDocument } from "pdf-lib";
import { getAdminClient } from "../api/_lib/auth.js";
import { renderMonthPdf, renderWeekPdf } from "../api/_lib/calendar-pdf.js";
import { ORIGIN_ANCHOR_DATE } from "../shared/origin-wave.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function ymdUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    year: new Date().getUTCFullYear(),
    weekStart: 0,
    locale: "en-US",
    version: "v1"
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--year") out.year = Number(args[++i]);
    else if (a === "--weekStart") out.weekStart = Number(args[++i]);
    else if (a === "--locale") out.locale = String(args[++i]);
    else if (a === "--version") out.version = String(args[++i]);
  }
  return out;
}

async function uploadPdf(admin, bucket, path, bytes) {
  const { error } = await admin.storage.from(bucket).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true
  });
  if (error) throw error;
}

async function mergeSinglePageInto(masterPdf, singlePagePdfBytes) {
  const doc = await PDFDocument.load(singlePagePdfBytes);
  const [p0] = await masterPdf.copyPages(doc, [0]);
  masterPdf.addPage(p0);
}

async function mergeAllPagesInto(masterPdf, pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const idxs = Array.from({ length: doc.getPageCount() }, (_, i) => i);
  const pages = await masterPdf.copyPages(doc, idxs);
  for (const p of pages) masterPdf.addPage(p);
}

async function main() {
  const { year, weekStart, locale, version } = parseArgs();
  // Footer comes from shared footer-text.js (used by calendar-pdf.js)

  const origin = process.env.TEMPLATE_ASSET_ORIGIN;
  if (!origin) {
    throw new Error("Missing TEMPLATE_ASSET_ORIGIN (ex: https://sineday.app)");
  }

  const bucket = "premium_templates";
  const admin = getAdminClient();

  // Anchor for canonical DOBs: ORIGIN_ANCHOR_DATE + (originDay-1) days
  const [ay, am, ad] = ORIGIN_ANCHOR_DATE.split("-").map(Number);
  const anchor = new Date(Date.UTC(ay, am - 1, ad, 12));

  // Build list of week starts for the year (based on weekStart)
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  const jan1Next = new Date(Date.UTC(year + 1, 0, 1, 12));

  let wk = startOfWeekUTC(jan1, weekStart);
  const weekStarts = [];
  while (wk < jan1Next) {
    weekStarts.push(ymdUTC(wk));
    wk = addDaysUTC(wk, 7);
  }

  console.log(
    `Generating templates for year=${year}, locale=${locale}, weekStart=${weekStart}`
  );
  console.log(
    `Weeks: ${weekStarts.length} (weekly PDF will be ${weekStarts.length * 2} pages)`
  );

  for (let originDay = 1; originDay <= 18; originDay++) {
    const canonicalDob = ymdUTC(addDaysUTC(anchor, originDay - 1));
    const profiles = [{ birthdate: canonicalDob, display_name: "" }];

    // ===== Monthly (12 pages merged) =====
    const monthlyMaster = await PDFDocument.create();
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const one = await renderMonthPdf({
        year,
        monthIndex,
        locale,
        weekStart,
        profiles,
        titleSuffix: "",
        origin
      });
      await mergeSinglePageInto(monthlyMaster, one);
    }
    const monthlyBytes = await monthlyMaster.save();
    const monthlyPath = `${version}/${year}/monthly/origin-${pad2(originDay)}.pdf`;
    await uploadPdf(admin, bucket, monthlyPath, monthlyBytes);
    console.log(`✅ Uploaded ${monthlyPath}`);

    // ===== Weekly (all weeks merged; each renderWeekPdf returns 2 pages) =====
    const weeklyMaster = await PDFDocument.create();
    for (const startYmd of weekStarts) {
      const twoPages = await renderWeekPdf({
        startYmd,
        locale,
        profiles,
        titleSuffix: "",
        origin
      });
      await mergeAllPagesInto(weeklyMaster, twoPages);
    }
    const weeklyBytes = await weeklyMaster.save();
    const weeklyPath = `${version}/${year}/weekly/origin-${pad2(originDay)}.pdf`;
    await uploadPdf(admin, bucket, weeklyPath, weeklyBytes);
    console.log(`✅ Uploaded ${weeklyPath}`);
  }

  console.log("Done. 18 monthly + 18 weekly templates generated and uploaded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
