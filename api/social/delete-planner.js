import { authenticateUser, getAdminClient } from "../_lib/auth.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseJsonBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return typeof req.body === "object" ? req.body : {};
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateUser(req);
    const admin = getAdminClient();
    const body = parseJsonBody(req);

    const plannerId = String(body.plannerId || "").trim();
    if (!plannerId) {
      return res.status(400).json({ ok: false, error: "plannerId is required" });
    }

    const { data: planner, error: plannerErr } = await admin
      .from("social_planners")
      .select("id, title, owner_user_id")
      .eq("id", plannerId)
      .eq("is_archived", false)
      .maybeSingle();

    if (plannerErr) throw new Error(`Failed to load planner: ${plannerErr.message}`);
    if (!planner) {
      return res.status(404).json({ ok: false, error: "Calendar not found" });
    }
    if (planner.owner_user_id !== user.id) {
      return res.status(403).json({ ok: false, error: "Only the calendar owner can delete this calendar" });
    }

    const { error: deleteErr } = await admin
      .from("social_planners")
      .delete()
      .eq("id", plannerId)
      .eq("owner_user_id", user.id);

    if (deleteErr) throw new Error(`Failed to delete calendar: ${deleteErr.message}`);

    return res.status(200).json({ ok: true, plannerId });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/delete-planner] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
