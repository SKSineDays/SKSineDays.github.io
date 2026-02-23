/**
 * Shared footer text for calendars (UI + PDF).
 * Production: no timestamps, no template identifiers.
 */
export function getSineDayCopyrightText(year = new Date().getFullYear()) {
  return `© SineDay™ ${year}`;
}
