import { authenticateUser, getAdminClient } from "../_lib/auth.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    const { error } = await admin
      .from("social_notifications")
      .delete()
      .eq("user_id", user.id);

    if (error) throw new Error(`Failed to clear notifications: ${error.message}`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/clear-notifications] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
