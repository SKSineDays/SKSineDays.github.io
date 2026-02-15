import { getSupabaseClient } from "./supabase-client.js";

const LS_PREFIX = "sd:user_settings:";

export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" }
];

export const SUPPORTED_REGIONS = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "IE", label: "Ireland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
  { value: "MX", label: "Mexico" },
  { value: "BR", label: "Brazil" },
  { value: "JP", label: "Japan" }
];

function inferBrowserLanguageRegion() {
  const raw = (navigator.languages && navigator.languages[0]) || navigator.language || "en-US";
  const m = raw.match(/^([a-zA-Z]{2,3})(?:[-_]?([a-zA-Z]{2}|\d{3}))?/);
  const language = (m?.[1] || "en").toLowerCase();
  const region = (m?.[2] || "US").toUpperCase();
  return { language, region };
}

export function getDefaultUserSettings() {
  const { language, region } = inferBrowserLanguageRegion();
  return {
    language,
    region,
    week_start: -1 // auto
  };
}

/**
 * Resolves week start into 0 (Sun) or 1 (Mon).
 * week_start: -1(auto) | 0 | 1
 */
export function resolveWeekStart(settings) {
  const ws = settings?.week_start;
  if (ws === 0 || ws === 1) return ws;

  // Auto: US defaults to Sunday; most of the world defaults to Monday
  const region = (settings?.region || "US").toUpperCase();
  return region === "US" ? 0 : 1;
}

export async function loadUserSettings(userId) {
  const defaults = getDefaultUserSettings();
  const lsKey = `${LS_PREFIX}${userId}`;

  // Local cache first
  try {
    const cached = JSON.parse(localStorage.getItem(lsKey) || "null");
    if (cached && typeof cached === "object") {
      return { ...defaults, ...cached };
    }
  } catch {}

  // Supabase (fallback-safe if table not created yet)
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from("user_settings")
      .select("language, region, week_start")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[user_settings] load error:", error.message);
      return defaults;
    }

    const merged = { ...defaults, ...(data || {}) };
    localStorage.setItem(lsKey, JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.warn("[user_settings] load failed:", e);
    return defaults;
  }
}

export async function saveUserSettings(userId, patch) {
  const lsKey = `${LS_PREFIX}${userId}`;
  const next = { ...(getDefaultUserSettings()), ...(patch || {}) };

  // optimistic local cache
  localStorage.setItem(lsKey, JSON.stringify(next));

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from("user_settings")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" })
      .select("language, region, week_start")
      .single();

    if (error) {
      console.warn("[user_settings] save error:", error.message);
      return next;
    }

    localStorage.setItem(lsKey, JSON.stringify(data));
    return data;
  } catch (e) {
    console.warn("[user_settings] save failed:", e);
    return next;
  }
}
