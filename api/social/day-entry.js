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

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

const REPEAT_MODES = new Set([
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
  "sineday"
]);

async function loadMembership(admin, plannerId, userId) {
  const { data, error } = await admin
    .from("social_planner_members")
    .select("planner_id, user_id, role, status")
    .eq("planner_id", plannerId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`Failed to verify membership: ${error.message}`);
  return data;
}

async function getOwnerProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name")
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
    const body = parseJsonBody(req);

    const action = String(body.action || "").trim();
    const plannerId = String(body.plannerId || "").trim();
    const dateYmd = String(body.date || "").trim();

    if (!plannerId) {
      return res.status(400).json({ ok: false, error: "plannerId is required" });
    }

    const membership = await loadMembership(admin, plannerId, user.id);
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You are not an active member of this planner" });
    }

    const ownerProfile = await getOwnerProfile(admin, user.id);

    if (action === "save_note") {
      if (!isValidYmd(dateYmd)) {
        return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
      }

      const content = String(body.content ?? "");

      const { data: savedEntry, error } = await admin
        .from("social_day_entries")
        .upsert(
          {
            planner_id: plannerId,
            entry_date: dateYmd,
            author_user_id: user.id,
            author_profile_id: ownerProfile.id,
            content
          },
          {
            onConflict: "planner_id,entry_date,author_user_id"
          }
        )
        .select("id, planner_id, entry_date, author_user_id, content, updated_at")
        .single();

      if (error) throw new Error(`Failed to save note: ${error.message}`);

      return res.status(200).json({
        ok: true,
        entry: savedEntry
      });
    }

    if (action === "add_task") {
      if (!isValidYmd(dateYmd)) {
        return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
      }

      const title = String(body.title || "").trim();
      if (!title) {
        return res.status(400).json({ ok: false, error: "title is required" });
      }

      const { error } = await admin
        .from("social_day_tasks")
        .insert({
          planner_id: plannerId,
          task_date: dateYmd,
          start_date: dateYmd,
          author_user_id: user.id,
          author_profile_id: ownerProfile.id,
          title,
          is_completed: false,
          sort_order: 0,
          repeat_mode: "none",
          repeat_interval: 1,
          repeat_sinedays: []
        });

      if (error) throw new Error(`Failed to add task: ${error.message}`);

      return res.status(200).json({ ok: true });
    }

    if (action === "toggle_task") {
      const taskId = String(body.taskId || "").trim();
      const occurrenceDate = String(body.date || "").trim();
      const checked = body.checked === true;

      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }
      if (!isValidYmd(occurrenceDate)) {
        return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
      }

      if (checked) {
        const { error } = await admin
          .from("social_day_task_completions")
          .upsert(
            {
              task_id: taskId,
              planner_id: plannerId,
              author_user_id: user.id,
              occurrence_date: occurrenceDate
            },
            { onConflict: "task_id,occurrence_date" }
          );

        if (error) throw new Error(`Failed to complete task: ${error.message}`);
      } else {
        const { error } = await admin
          .from("social_day_task_completions")
          .delete()
          .eq("task_id", taskId)
          .eq("planner_id", plannerId)
          .eq("author_user_id", user.id)
          .eq("occurrence_date", occurrenceDate);

        if (error) throw new Error(`Failed to uncomplete task: ${error.message}`);
      }

      return res.status(200).json({ ok: true });
    }

    if (action === "update_task") {
      const taskId = String(body.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }

      const patch = {};

      if (body.title !== undefined) {
        const title = String(body.title || "").trim();
        if (!title) {
          return res.status(400).json({ ok: false, error: "title is required" });
        }
        patch.title = title;
      }

      if (body.repeat_mode !== undefined) {
        const mode = String(body.repeat_mode || "none");
        if (!REPEAT_MODES.has(mode)) {
          return res.status(400).json({ ok: false, error: "Invalid repeat_mode" });
        }
        patch.repeat_mode = mode;
      }
      if (body.repeat_interval !== undefined) {
        patch.repeat_interval = Math.max(1, Math.min(365, Number(body.repeat_interval) || 1));
      }
      if (body.repeat_until !== undefined) {
        const u = body.repeat_until;
        if (u === null || u === "") {
          patch.repeat_until = null;
        } else {
          const s = String(u).trim();
          if (!isValidYmd(s)) {
            return res.status(400).json({ ok: false, error: "repeat_until must be YYYY-MM-DD or empty" });
          }
          patch.repeat_until = s;
        }
      }
      if (body.repeat_sinedays !== undefined) {
        const raw = Array.isArray(body.repeat_sinedays) ? body.repeat_sinedays : [];
        patch.repeat_sinedays = raw
          .map((x) => Number(x))
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 18);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: "No fields to update" });
      }

      const { error } = await admin
        .from("social_day_tasks")
        .update({
          ...patch,
          updated_at: new Date().toISOString()
        })
        .eq("id", taskId)
        .eq("planner_id", plannerId)
        .eq("author_user_id", user.id);

      if (error) throw new Error(`Failed to update task: ${error.message}`);

      return res.status(200).json({ ok: true });
    }

    if (action === "archive_task") {
      const taskId = String(body.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({ ok: false, error: "taskId is required" });
      }

      const { error } = await admin
        .from("social_day_tasks")
        .update({ is_archived: true })
        .eq("id", taskId)
        .eq("planner_id", plannerId)
        .eq("author_user_id", user.id);

      if (error) throw new Error(`Failed to archive task: ${error.message}`);

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "Unsupported action" });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/day-entry] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
