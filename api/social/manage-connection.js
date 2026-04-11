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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadConnection(admin, userId, friendUserId) {
  const { data, error } = await admin
    .from("social_connections")
    .select("id, friend_user_id, friend_email, friend_display_name")
    .eq("user_id", userId)
    .eq("friend_user_id", friendUserId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load connection: ${error.message}`);
  return data;
}

async function cancelPendingRequests(admin, userId, friendUserId, userEmail, friendEmail) {
  const now = new Date().toISOString();

  const { error: err1 } = await admin
    .from("social_friend_requests")
    .update({
      status: "cancelled",
      responded_by_user_id: userId,
      responded_at: now
    })
    .eq("status", "pending")
    .eq("requester_user_id", userId)
    .eq("recipient_email", friendEmail);

  if (err1) throw new Error(`Failed to cancel outbound requests: ${err1.message}`);

  const { error: err2 } = await admin
    .from("social_friend_requests")
    .update({
      status: "cancelled",
      responded_by_user_id: userId,
      responded_at: now
    })
    .eq("status", "pending")
    .eq("requester_user_id", friendUserId)
    .eq("recipient_email", userEmail);

  if (err2) throw new Error(`Failed to cancel inbound requests: ${err2.message}`);
}

async function removeMemberships(admin, userId, friendUserId) {
  const { data: planners, error: plannerError } = await admin
    .from("social_planners")
    .select("id")
    .in("owner_user_id", [userId, friendUserId])
    .eq("is_archived", false);

  if (plannerError) throw new Error(`Failed to load planners: ${plannerError.message}`);

  const plannerIds = (planners || []).map((row) => row.id);
  if (!plannerIds.length) return;

  const { error } = await admin
    .from("social_planner_members")
    .update({ status: "removed" })
    .in("planner_id", plannerIds)
    .in("user_id", [userId, friendUserId])
    .neq("role", "owner")
    .eq("status", "active");

  if (error) throw new Error(`Failed to remove memberships: ${error.message}`);
}

async function removeConnections(admin, userId, friendUserId) {
  const { error } = await admin
    .from("social_connections")
    .delete()
    .or(
      `and(user_id.eq.${userId},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${userId})`
    );

  if (error) throw new Error(`Failed to remove connections: ${error.message}`);
}

async function clearRelationshipNotifications(admin, userId, friendUserId) {
  const { error } = await admin
    .from("social_notifications")
    .delete()
    .or(
      `and(user_id.eq.${userId},actor_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},actor_user_id.eq.${userId})`
    );

  if (error) throw new Error(`Failed to clear relationship notifications: ${error.message}`);
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

    const action = String(body.action || "").trim();
    const friendUserId = String(body.friendUserId || "").trim();

    if (action !== "remove" && action !== "block") {
      return res.status(400).json({ ok: false, error: "action must be remove or block" });
    }

    if (!friendUserId) {
      return res.status(400).json({ ok: false, error: "friendUserId is required" });
    }

    const connection = await loadConnection(admin, user.id, friendUserId);
    if (!connection) {
      return res.status(404).json({ ok: false, error: "Friend connection not found" });
    }

    const userEmail = normalizeEmail(user.email);
    const friendEmail = normalizeEmail(connection.friend_email);

    if (action === "block") {
      const { error: blockError } = await admin
        .from("social_blocks")
        .upsert(
          {
            user_id: user.id,
            blocked_user_id: friendUserId,
            blocked_email: friendEmail
          },
          { onConflict: "user_id,blocked_user_id" }
        );

      if (blockError) throw new Error(`Failed to block user: ${blockError.message}`);
    }

    await cancelPendingRequests(admin, user.id, friendUserId, userEmail, friendEmail);
    await removeMemberships(admin, user.id, friendUserId);
    await removeConnections(admin, user.id, friendUserId);
    await clearRelationshipNotifications(admin, user.id, friendUserId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/manage-connection] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
