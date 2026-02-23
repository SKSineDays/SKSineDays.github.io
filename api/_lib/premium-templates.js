/**
 * Premium template manifest — single source for template paths and mapping.
 * Templates are pre-generated PDFs in premium_templates bucket (18 per view).
 */
export const TEMPLATE_BUCKET = "premium_templates";
export const PRINT_BUCKET = "prints";
export const TEMPLATE_VERSION = "v1";

// Years we have pre-generated templates for (prefer these)
export const TEMPLATE_YEARS = [2025, 2026, 2027];

export function hasTemplatesForYear(year) {
  return TEMPLATE_YEARS.includes(Number(year));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Path to monthly template PDF (12 pages, Jan=0..Dec=11).
 * @param {number} year
 * @param {number} originDay 1..18
 * @param {number} [weekStart] 0 or 1 (for future multi-layout support)
 * @param {string} [locale]
 */
export function monthlyTemplatePath(year, originDay, weekStart = 0, locale = "en-US") {
  // v1 templates use canonical ws0, en-US; path doesn't vary for now
  return `${TEMPLATE_VERSION}/${year}/monthly/origin-${pad2(originDay)}.pdf`;
}

/**
 * Path to weekly template PDF (2 pages per week, chronological).
 * @param {number} year
 * @param {number} originDay 1..18
 */
export function weeklyTemplatePath(year, originDay) {
  return `${TEMPLATE_VERSION}/${year}/weekly/origin-${pad2(originDay)}.pdf`;
}

/** month 1..12 => page index 0..11 */
export function monthToPageIndex(month) {
  return month - 1;
}
