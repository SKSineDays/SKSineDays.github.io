import {
  authenticateUser,
  getAdminClient,
  getPremiumEntitlement,
} from "./_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "https://sineday.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateUser(req);
    const entitlement = await getPremiumEntitlement(getAdminClient(), user.id);
    return res.status(200).json({ ok: true, ...entitlement });
  } catch (error) {
    const unauthorized =
      error?.message?.includes("Authorization") ||
      error?.message?.includes("token");
    if (!unauthorized) {
      console.error("[Entitlements] Load failed:", error?.message || error);
    }
    return res.status(unauthorized ? 401 : 500).json({
      ok: false,
      error: unauthorized ? "Authentication required" : "Unable to load entitlements",
    });
  }
}
