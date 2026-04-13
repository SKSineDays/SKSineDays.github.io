import { authenticateUser, getAdminClient } from "../_lib/auth.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

async function loadPlannerForOwner(admin, plannerId, ownerUserId) {
  const { data, error } = await admin
    .from("social_planners")
    .select("id, title, owner_user_id")
    .eq("id", plannerId)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) throw new Error(`Failed to load planner: ${error.message}`);
  if (!data || data.owner_user_id !== ownerUserId) return null;
  return data;
}

async function assertActiveMembership(admin, plannerId, userId) {
  const { data, error } = await admin
    .from("social_planner_members")
    .select("planner_id, role, status")
    .eq("planner_id", plannerId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`Failed to verify membership: ${error.message}`);
  return data;
}

async function emailsForUserIds(admin, userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map();
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        if (!error && data?.user?.email) {
          map.set(uid, String(data.user.email).toLowerCase());
        }
      } catch {
        /* ignore */
      }
    })
  );
  return map;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { user } = await authenticateUser(req);
    const admin = getAdminClient();

    if (req.method === "GET") {
      const plannerId = String(req.query?.planner_id || "").trim();
      if (!plannerId) {
        return res.status(400).json({ ok: false, error: "planner_id is required" });
      }

      const membership = await assertActiveMembership(admin, plannerId, user.id);
      if (!membership) {
        return res.status(404).json({ ok: false, error: "Planner not found" });
      }

      const { data: planner, error: pErr } = await admin
        .from("social_planners")
        .select("id, title, owner_user_id")
        .eq("id", plannerId)
        .eq("is_archived", false)
        .maybeSingle();

      if (pErr) throw new Error(`Failed to load planner: ${pErr.message}`);
      if (!planner) return res.status(404).json({ ok: false, error: "Planner not found" });

      const isOwner = planner.owner_user_id === user.id;

      const { data: memberRows, error: mErr } = await admin
        .from("social_planner_members")
        .select(
          `
          user_id,
          role,
          owner_profile_id,
          profiles:owner_profile_id (
            display_name
          )
        `
        )
        .eq("planner_id", plannerId)
        .eq("status", "active")
        .order("created_at", { ascending: true });

      if (mErr) throw new Error(`Failed to load members: ${mErr.message}`);

      const memberUserIds = (memberRows || []).map((r) => r.user_id);
      const emailMap = await emailsForUserIds(admin, memberUserIds);

      const members = (memberRows || [])
        .map((row) => ({
          userId: row.user_id,
          displayName: row.profiles?.display_name || emailMap.get(row.user_id) || "Member",
          email: emailMap.get(row.user_id) || "",
          role: row.role
        }))
        .sort((a, b) => {
          if (a.role === "owner" && b.role !== "owner") return -1;
          if (a.role !== "owner" && b.role === "owner") return 1;
          return a.displayName.localeCompare(b.displayName);
        });

      let addableFriends = [];
      if (isOwner) {
        const memberSet = new Set(memberUserIds);
        const { data: friends, error: fErr } = await admin
          .from("social_connections")
          .select("friend_user_id, friend_email, friend_display_name")
          .eq("user_id", user.id)
          .order("friend_display_name", { ascending: true });

        if (fErr) throw new Error(`Failed to load friends: ${fErr.message}`);

        const friendIds = (friends || []).map((f) => f.friend_user_id).filter(Boolean);
        const friendEmailMap = await emailsForUserIds(admin, friendIds);

        addableFriends = (friends || [])
          .filter((f) => f.friend_user_id && !memberSet.has(f.friend_user_id))
          .map((f) => ({
            userId: f.friend_user_id,
            displayName: f.friend_display_name || friendEmailMap.get(f.friend_user_id) || "Friend",
            email: friendEmailMap.get(f.friend_user_id) || f.friend_email || ""
          }));
      }

      return res.status(200).json({
        ok: true,
        planner: { id: planner.id, title: planner.title || "Social Planner" },
        members,
        addableFriends
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = parseJsonBody(req);
    const action = String(body.action || "").trim();
    const plannerId = String(body.plannerId || "").trim();

    if (!plannerId) {
      return res.status(400).json({ ok: false, error: "plannerId is required" });
    }

    const planner = await loadPlannerForOwner(admin, plannerId, user.id);
    if (!planner) {
      return res.status(403).json({ ok: false, error: "Only the calendar owner can manage members" });
    }

    if (action === "add_members") {
      const raw = Array.isArray(body.memberUserIds) ? body.memberUserIds : [];
      const memberUserIds = [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))].filter(
        (id) => id !== user.id
      );

      if (!memberUserIds.length) {
        return res.status(400).json({ ok: false, error: "memberUserIds is required" });
      }

      const { data: requesterProfile, error: rpErr } = await admin
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .eq("is_owner", true)
        .maybeSingle();

      if (rpErr) throw new Error(`Failed to load owner profile: ${rpErr.message}`);

      const notifications = [];

      for (const friendId of memberUserIds) {
        const { data: conn, error: connErr } = await admin
          .from("social_connections")
          .select("id")
          .eq("user_id", user.id)
          .eq("friend_user_id", friendId)
          .maybeSingle();

        if (connErr) throw new Error(`Failed to verify friendship: ${connErr.message}`);
        if (!conn?.id) {
          return res.status(400).json({ ok: false, error: "All members must be active friends" });
        }

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

        const { error: upsertErr } = await admin.from("social_planner_members").upsert(
          {
            planner_id: plannerId,
            user_id: friendId,
            owner_profile_id: friendOwner.id,
            role: "member",
            status: "active",
            invited_by_user_id: user.id
          },
          { onConflict: "planner_id,user_id" }
        );

        if (upsertErr) throw new Error(`Failed to add member: ${upsertErr.message}`);

        notifications.push({
          user_id: friendId,
          actor_user_id: user.id,
          type: "planner_update",
          title: `${requesterProfile?.display_name || "Someone"} added you to "${planner.title}"`,
          body: "Open Social Planner to view this shared calendar.",
          payload: { planner_id: plannerId }
        });
      }

      if (notifications.length) {
        const { error: nErr } = await admin.from("social_notifications").insert(notifications);
        if (nErr) throw new Error(`Failed to notify members: ${nErr.message}`);
      }

      return res.status(200).json({ ok: true });
    }

    if (action === "remove_member") {
      const memberUserId = String(body.memberUserId || "").trim();
      if (!memberUserId) {
        return res.status(400).json({ ok: false, error: "memberUserId is required" });
      }
      if (memberUserId === user.id) {
        return res.status(400).json({ ok: false, error: "Owner cannot remove themselves here" });
      }
      if (memberUserId === planner.owner_user_id) {
        return res.status(400).json({ ok: false, error: "Cannot remove the owner" });
      }

      const { data: targetRow, error: tErr } = await admin
        .from("social_planner_members")
        .select("user_id, role, status")
        .eq("planner_id", plannerId)
        .eq("user_id", memberUserId)
        .maybeSingle();

      if (tErr) throw new Error(`Failed to load membership: ${tErr.message}`);
      if (!targetRow || targetRow.status !== "active") {
        return res.status(404).json({ ok: false, error: "Member not found" });
      }
      if (targetRow.role === "owner") {
        return res.status(400).json({ ok: false, error: "Cannot remove the owner" });
      }

      const { error: updErr } = await admin
        .from("social_planner_members")
        .update({ status: "removed", updated_at: new Date().toISOString() })
        .eq("planner_id", plannerId)
        .eq("user_id", memberUserId)
        .eq("status", "active");

      if (updErr) throw new Error(`Failed to update membership: ${updErr.message}`);

      const { error: delEntries } = await admin
        .from("social_day_entries")
        .delete()
        .eq("planner_id", plannerId)
        .eq("author_user_id", memberUserId);

      if (delEntries) throw new Error(`Failed to clear member notes: ${delEntries.message}`);

      const { error: delCompletions } = await admin
        .from("social_day_task_completions")
        .delete()
        .eq("planner_id", plannerId)
        .eq("author_user_id", memberUserId);

      if (delCompletions) throw new Error(`Failed to clear member completions: ${delCompletions.message}`);

      const { error: delTasks } = await admin
        .from("social_day_tasks")
        .delete()
        .eq("planner_id", plannerId)
        .eq("author_user_id", memberUserId);

      if (delTasks) throw new Error(`Failed to clear member tasks: ${delTasks.message}`);

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/planner-members] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
