import { authenticateUser, getAdminClient } from "../_lib/auth.js";
import { calculateSineDayForYmd } from "../../js/sineday-engine.js";
import { taskOccursOnSocialDate } from "./_socialTaskRecurrence.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function startOfCalendarGrid(year, monthIndex, weekStart) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const dow = first.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(first, -delta);
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
    const year = Number(req.query?.year);
    const month = Number(req.query?.month);
    const weekStart = Number(req.query?.week_start) === 1 ? 1 : 0;

    if (!plannerId) {
      return res.status(400).json({ ok: false, error: "planner_id is required" });
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ ok: false, error: "Invalid year" });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, error: "Invalid month" });
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

    const { data: members, error: membersError } = await admin
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
      .order("created_at", { ascending: true });

    if (membersError) throw new Error(`Failed to load members: ${membersError.message}`);

    const monthIndex = month - 1;
    const gridStart = startOfCalendarGrid(year, monthIndex, weekStart);
    const gridEnd = addDaysUTC(gridStart, 41);
    const startYmd = ymdUTC(gridStart);
    const endYmd = ymdUTC(gridEnd);

    const [{ data: entries, error: entriesError }, { data: plannerTasks, error: tasksError }] = await Promise.all([
      admin
        .from("social_day_entries")
        .select("entry_date, author_user_id")
        .eq("planner_id", plannerId)
        .gte("entry_date", startYmd)
        .lte("entry_date", endYmd),
      admin
        .from("social_day_tasks")
        .select(
          "author_user_id, task_date, start_date, repeat_mode, repeat_interval, repeat_until, repeat_sinedays, is_archived"
        )
        .eq("planner_id", plannerId)
        .eq("is_archived", false)
    ]);

    if (entriesError) throw new Error(`Failed to load entries: ${entriesError.message}`);
    if (tasksError) throw new Error(`Failed to load tasks: ${tasksError.message}`);

    const dayMap = new Map();

    for (let i = 0; i < 42; i += 1) {
      const current = addDaysUTC(gridStart, i);
      const date = ymdUTC(current);
      dayMap.set(date, {
        date,
        activityCount: 0,
        members: []
      });
    }

    for (const member of members || []) {
      const profile = member.profiles;
      if (!profile?.birthdate) continue;

      for (let i = 0; i < 42; i += 1) {
        const current = addDaysUTC(gridStart, i);
        const date = ymdUTC(current);
        const result = calculateSineDayForYmd(profile.birthdate, date);
        if (!result?.day) continue;

        dayMap.get(date).members.push({
          userId: member.user_id,
          displayName: profile.display_name || "Member",
          dayNumber: result.day,
          role: member.role
        });
      }
    }

    for (const row of entries || []) {
      const bucket = dayMap.get(row.entry_date);
      if (bucket) bucket.activityCount += 1;
    }

    const birthByUserId = new Map();
    for (const member of members || []) {
      birthByUserId.set(member.user_id, member.profiles?.birthdate || null);
    }

    for (const task of plannerTasks || []) {
      const birth = birthByUserId.get(task.author_user_id);
      for (let i = 0; i < 42; i += 1) {
        const current = addDaysUTC(gridStart, i);
        const dateStr = ymdUTC(current);
        if (taskOccursOnSocialDate(task, dateStr, birth)) {
          const bucket = dayMap.get(dateStr);
          if (bucket) bucket.activityCount += 1;
        }
      }
    }

    for (const bucket of dayMap.values()) {
      bucket.members.sort((a, b) => {
        if (a.role === "owner" && b.role !== "owner") return -1;
        if (a.role !== "owner" && b.role === "owner") return 1;
        return a.displayName.localeCompare(b.displayName);
      });
    }

    return res.status(200).json({
      ok: true,
      planner: {
        id: planner.id,
        title: planner.title || "Social Planner",
        memberCount: (members || []).length
      },
      days: Array.from(dayMap.values())
    });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/month-summary] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
