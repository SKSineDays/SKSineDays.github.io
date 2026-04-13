import { authenticateUser, getAdminClient } from "../_lib/auth.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateUser(req);
    const admin = getAdminClient();

    const { data: memberships, error: memErr } = await admin
      .from("social_planner_members")
      .select("planner_id, role")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (memErr) throw new Error(`Failed to load memberships: ${memErr.message}`);

    const plannerIds = [...new Set((memberships || []).map((m) => m.planner_id).filter(Boolean))];
    if (!plannerIds.length) {
      return res.status(200).json({ ok: true, planners: [] });
    }

    const { data: planners, error: planErr } = await admin
      .from("social_planners")
      .select("id, title, owner_user_id, created_at, updated_at")
      .in("id", plannerIds)
      .eq("is_archived", false);

    if (planErr) throw new Error(`Failed to load planners: ${planErr.message}`);

    const activePlannerIds = (planners || []).map((p) => p.id);
    if (!activePlannerIds.length) {
      return res.status(200).json({ ok: true, planners: [] });
    }

    const { data: countRows, error: countErr } = await admin
      .from("social_planner_members")
      .select("planner_id")
      .in("planner_id", activePlannerIds)
      .eq("status", "active");

    if (countErr) throw new Error(`Failed to load member counts: ${countErr.message}`);

    const countByPlanner = new Map();
    for (const row of countRows || []) {
      const id = row.planner_id;
      countByPlanner.set(id, (countByPlanner.get(id) || 0) + 1);
    }

    const out = (planners || []).map((p) => ({
      id: p.id,
      title: p.title || "Social Planner",
      owner_user_id: p.owner_user_id,
      isOwner: p.owner_user_id === user.id,
      memberCount: countByPlanner.get(p.id) || 0,
      created_at: p.created_at,
      updated_at: p.updated_at
    }));

    out.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });

    return res.status(200).json({ ok: true, planners: out });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/planners] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
