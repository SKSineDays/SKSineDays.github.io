import { authenticateUser, getAdminClient, requirePremium } from "../_lib/auth.js";

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

async function getOwnerProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name, timezone")
    .eq("user_id", userId)
    .eq("is_owner", true)
    .maybeSingle();

  if (error) throw new Error(`Failed to load owner profile: ${error.message}`);
  if (!data) throw new Error("Owner profile required");

  return data;
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
    await requirePremium(admin, user.id);

    const ownerProfile = await getOwnerProfile(admin, user.id);
    const body = parseJsonBody(req);

    const title = String(body.title || "").trim();
    if (!title) {
      return res.status(400).json({ ok: false, error: "title is required" });
    }
    if (title.length > 200) {
      return res.status(400).json({ ok: false, error: "title is too long" });
    }

    const rawIds = Array.isArray(body.memberUserIds) ? body.memberUserIds : [];
    const memberUserIds = [...new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean))].filter(
      (id) => id !== user.id
    );

    const { count: ownedCount, error: countError } = await admin
      .from("social_planners")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id)
      .eq("is_archived", false);

    if (countError) throw new Error(`Failed to count planners: ${countError.message}`);
    if ((ownedCount ?? 0) >= 100) {
      return res.status(400).json({
        ok: false,
        error: "You can have at most 100 active social calendars"
      });
    }

    for (const friendId of memberUserIds) {
      const { data: conn, error: connErr } = await admin
        .from("social_connections")
        .select("id")
        .eq("user_id", user.id)
        .eq("friend_user_id", friendId)
        .maybeSingle();

      if (connErr) throw new Error(`Failed to verify friendship: ${connErr.message}`);
      if (!conn?.id) {
        return res.status(400).json({ ok: false, error: "All invited members must be active friends" });
      }
    }

    const { data: planner, error: createError } = await admin
      .from("social_planners")
      .insert({
        owner_user_id: user.id,
        owner_profile_id: ownerProfile.id,
        title,
        timezone: ownerProfile.timezone || "America/Chicago"
      })
      .select("id, title, owner_user_id, created_at, updated_at")
      .single();

    if (createError) throw new Error(`Failed to create planner: ${createError.message}`);

    const { error: ownerMemError } = await admin.from("social_planner_members").upsert(
      {
        planner_id: planner.id,
        user_id: user.id,
        owner_profile_id: ownerProfile.id,
        role: "owner",
        status: "active",
        invited_by_user_id: user.id
      },
      { onConflict: "planner_id,user_id" }
    );

    if (ownerMemError) throw new Error(`Failed to add owner membership: ${ownerMemError.message}`);

    const memberRows = [];
    const notifications = [];
    const requesterDisplayName = ownerProfile.display_name || user.email || "Someone";

    for (const friendId of memberUserIds) {
      const { data: friendOwner, error: fpErr } = await admin
        .from("profiles")
        .select("id")
        .eq("user_id", friendId)
        .eq("is_owner", true)
        .maybeSingle();

      if (fpErr) throw new Error(`Failed to load friend profile: ${fpErr.message}`);
      if (!friendOwner?.id) {
        return res.status(400).json({ ok: false, error: "Friend must have an owner profile" });
      }

      memberRows.push({
        planner_id: planner.id,
        user_id: friendId,
        owner_profile_id: friendOwner.id,
        role: "member",
        status: "active",
        invited_by_user_id: user.id
      });

      notifications.push({
        user_id: friendId,
        actor_user_id: user.id,
        type: "planner_update",
        title: `${requesterDisplayName} added you to "${title}"`,
        body: "Open Social Planner to view this shared calendar.",
        payload: { planner_id: planner.id }
      });
    }

    if (memberRows.length) {
      const { error: memInsErr } = await admin.from("social_planner_members").upsert(memberRows, {
        onConflict: "planner_id,user_id"
      });
      if (memInsErr) throw new Error(`Failed to add members: ${memInsErr.message}`);
    }

    if (notifications.length) {
      const { error: notifErr } = await admin.from("social_notifications").insert(notifications);
      if (notifErr) throw new Error(`Failed to notify members: ${notifErr.message}`);
    }

    const { count: memberCount, error: mcErr } = await admin
      .from("social_planner_members")
      .select("*", { count: "exact", head: true })
      .eq("planner_id", planner.id)
      .eq("status", "active");

    if (mcErr) throw new Error(`Failed to count members: ${mcErr.message}`);

    return res.status(200).json({
      ok: true,
      planner: {
        id: planner.id,
        title: planner.title || title,
        owner_user_id: planner.owner_user_id,
        isOwner: true,
        memberCount: memberCount ?? 1,
        created_at: planner.created_at,
        updated_at: planner.updated_at
      }
    });
  } catch (err) {
    if (err?.code === "PREMIUM_REQUIRED") {
      return res.status(402).json({ ok: false, error: "Premium required" });
    }

    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/create-planner] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
