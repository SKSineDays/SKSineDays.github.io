// shared/i18n.js
export const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "dv", "ku"]);

export function langFromLocale(locale = "") {
  return String(locale).split("-")[0].toLowerCase();
}

export function isRtlLocale(locale = "") {
  return RTL_LANGS.has(langFromLocale(locale));
}

export function dirFromLocale(locale = "") {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}
