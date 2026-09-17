/**
 * GET /api/export-journal-data
 * Headers: Authorization: Bearer <access_token>
 *
 * Returns a focused personal journal export (JSON).
 * Free and Premium users may export; journal RLS applies via the authed client.
 */

import { authenticateUser } from "./_lib/auth.js";

const PAGE_SIZE = 500;
const EXPORT_FORMAT = "sineday-journal-export";
const EXPORT_VERSION = 1;

function isMeaningfulRow(row) {
  const hasContent = String(row.content ?? "").trim().length > 0;
  const hasFelt = row.felt_sineday != null;
  return hasContent || hasFelt;
}

function mapRowToExport(row) {
  const hasContent = String(row.content ?? "").trim().length > 0;
  return {
    date: row.entry_date,
    actual_sineday: row.actual_sineday,
    felt_sineday: row.felt_sineday ?? null,
    journal_entry: hasContent ? row.content : null,
  };
}

async function fetchAllJournalEntries(supabase, userId) {
  const allRows = [];
  let offset = 0;

  while (true) {
    const from = offset;
    const to = offset + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("journal_entries")
      .select("entry_date, actual_sineday, felt_sineday, content")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const page = data || [];
    allRows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "https://sineday.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user, supabase } = await authenticateUser(req);
    const rows = await fetchAllJournalEntries(supabase, user.id);
    const entries = rows.filter(isMeaningfulRow).map(mapRowToExport);

    return res.status(200).json({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      record_count: entries.length,
      entries,
    });
  } catch (error) {
    const unauthorized =
      error?.message?.includes("Authorization") ||
      error?.message?.includes("token") ||
      error?.message?.includes("Invalid or expired");
    if (!unauthorized) {
      console.error("[Journal Export] Failed:", error?.message || error);
    }
    return res.status(unauthorized ? 401 : 500).json({
      ok: false,
      error: unauthorized ? "Authentication required" : "Unable to export journal data",
    });
  }
}
