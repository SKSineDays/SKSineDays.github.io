import { authenticateUser, getAdminClient } from "../_lib/auth.js";
import { calculateSineDayForYmd } from "../../js/sineday-engine.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function loadPlannerMembership(admin, plannerId, userId) {
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

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { user } = await authenticateUser(req);
    const admin = getAdminClient();

    const plannerId = String(req.query?.planner_id || "").trim();
    const date = String(req.query?.date || "").trim();

    if (!plannerId) {
      return res.status(400).json({ ok: false, error: "planner_id is required" });
    }
    if (!isValidYmd(date)) {
      return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
    }

    const membership = await loadPlannerMembership(admin, plannerId, user.id);

    const { data: planner, error: plannerError } = await admin
      .from("social_planners")
      .select("id, title")
      .eq("id", plannerId)
      .eq("is_archived", false)
      .maybeSingle();

    if (plannerError) throw new Error(`Failed to load planner: ${plannerError.message}`);
    if (!planner || !membership) {
      return res.status(404).json({ ok: false, error: "Planner not found" });
    }

    const [{ data: members, error: membersError }, { data: notes, error: notesError }, { data: tasks, error: tasksError }] = await Promise.all([
      admin
        .from("social_planner_members")
        .select(`
          user_id,
          role,
          owner_profile_id,
          profiles:owner_profile_id (
            id,
            display_name,
            birthdate
          )
        `)
        .eq("planner_id", plannerId)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
      admin
        .from("social_day_entries")
        .select("id, entry_date, author_user_id, content, updated_at")
        .eq("planner_id", plannerId)
        .eq("entry_date", date),
      admin
        .from("social_day_tasks")
        .select("id, task_date, author_user_id, title, is_completed, completed_at, is_archived, sort_order, created_at")
        .eq("planner_id", plannerId)
        .eq("task_date", date)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    ]);

    if (membersError) throw new Error(`Failed to load members: ${membersError.message}`);
    if (notesError) throw new Error(`Failed to load notes: ${notesError.message}`);
    if (tasksError) throw new Error(`Failed to load tasks: ${tasksError.message}`);

    const notesByUser = new Map((notes || []).map((row) => [row.author_user_id, row]));
    const tasksByUser = new Map();

    for (const task of tasks || []) {
      const list = tasksByUser.get(task.author_user_id) || [];
      list.push(task);
      tasksByUser.set(task.author_user_id, list);
    }

    const memberCards = (members || []).map((member) => {
      const profile = member.profiles;
      const dayResult = profile?.birthdate
        ? calculateSineDayForYmd(profile.birthdate, date)
        : null;

      return {
        userId: member.user_id,
        displayName: profile?.display_name || "Member",
        dayNumber: dayResult?.day || 1,
        isCurrentUser: member.user_id === user.id,
        role: member.role,
        note: notesByUser.get(member.user_id)
          ? {
              content: notesByUser.get(member.user_id).content || "",
              updated_at: notesByUser.get(member.user_id).updated_at || null
            }
          : { content: "", updated_at: null },
        tasks: tasksByUser.get(member.user_id) || []
      };
    });

    memberCards.sort((a, b) => {
      if (a.isCurrentUser && !b.isCurrentUser) return -1;
      if (!a.isCurrentUser && b.isCurrentUser) return 1;
      if (a.role === "owner" && b.role !== "owner") return -1;
      if (a.role !== "owner" && b.role === "owner") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    const label = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(`${date}T12:00:00Z`));

    return res.status(200).json({
      ok: true,
      planner: {
        id: planner.id,
        title: planner.title || "Social Planner"
      },
      label,
      members: memberCards
    });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/day-summary] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
