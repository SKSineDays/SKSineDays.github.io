// js/origin-wave.js
export const ORIGIN_ANCHOR_DATE = "1985-04-20"; // Wave 1 Day 1 (Stephen)

/** Parse YYYY-MM-DD as a UTC timestamp (midnight UTC) */
function ymdToUtcMs(ymd) {
  if (!ymd || typeof ymd !== "string") return NaN;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}

/** Integer day diff: (b - a) in days using UTC-safe math */
function daysBetweenUtc(aYmd, bYmd) {
  const a = ymdToUtcMs(aYmd);
  const b = ymdToUtcMs(bYmd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.floor((b - a) / 86400000);
}

/** Positive modulo */
function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Origin Type Wave (1..18) derived only from DOB relative to anchor.
 * Anchor date itself => 1
 */
export function getOriginTypeForDob(dobYmd, anchorYmd = ORIGIN_ANCHOR_DATE) {
  const diff = daysBetweenUtc(anchorYmd, dobYmd);
  if (!Number.isFinite(diff)) return null;
  return mod(diff, 18) + 1;
}
