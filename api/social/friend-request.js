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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function findAuthUserByEmail(admin, email) {
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to look up recipient: ${error.message}`);

    const users = data?.users || [];
    const match = users.find((u) => normalizeEmail(u.email) === email);
    if (match) return match;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
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

async function ensureNotBlocked(admin, requesterUserId, recipientUserId, recipientEmail) {
  if (recipientUserId) {
    const { data: blockedBySender, error: blockedBySenderError } = await admin
      .from("social_blocks")
      .select("id")
      .eq("user_id", requesterUserId)
      .eq("blocked_user_id", recipientUserId)
      .maybeSingle();

    if (blockedBySenderError) {
      throw new Error(`Failed to verify sender block list: ${blockedBySenderError.message}`);
    }

    if (blockedBySender?.id) {
      throw new Error("You have blocked this user");
    }

    const { data: blockedByRecipient, error: blockedByRecipientError } = await admin
      .from("social_blocks")
      .select("id")
      .eq("user_id", recipientUserId)
      .eq("blocked_user_id", requesterUserId)
      .maybeSingle();

    if (blockedByRecipientError) {
      throw new Error(`Failed to verify recipient block list: ${blockedByRecipientError.message}`);
    }

    if (blockedByRecipient?.id) {
      throw new Error("This user is unavailable for friend requests");
    }
  }

  const normalizedEmail = normalizeEmail(recipientEmail);

  const { data: blockedByEmail, error: blockedByEmailError } = await admin
    .from("social_blocks")
    .select("id")
    .eq("user_id", requesterUserId)
    .eq("blocked_email", normalizedEmail)
    .maybeSingle();

  if (blockedByEmailError) {
    throw new Error(`Failed to verify blocked email list: ${blockedByEmailError.message}`);
  }

  if (blockedByEmail?.id) {
    throw new Error("You have blocked this user");
  }
}

async function getOrCreatePlanner(admin, user, ownerProfile) {
  const { data: existing, error: existingError } = await admin
    .from("social_planners")
    .select("id, owner_user_id, owner_profile_id, title, timezone")
    .eq("owner_user_id", user.id)
    .eq("is_archived", false)
    .maybeSingle();

  if (existingError) throw new Error(`Failed to load planner: ${existingError.message}`);
  if (existing?.id) {
    await admin
      .from("social_planner_members")
      .upsert(
        {
          planner_id: existing.id,
          user_id: user.id,
          owner_profile_id: ownerProfile.id,
          role: "owner",
          status: "active",
          invited_by_user_id: user.id
        },
        { onConflict: "planner_id,user_id" }
      );
    return existing;
  }

  const { data: planner, error: createError } = await admin
    .from("social_planners")
    .insert({
      owner_user_id: user.id,
      owner_profile_id: ownerProfile.id,
      title: "Social Planner",
      timezone: ownerProfile.timezone || "America/Chicago"
    })
    .select("id, owner_user_id, owner_profile_id, title, timezone")
    .single();

  if (createError) throw new Error(`Failed to create planner: ${createError.message}`);

  const { error: memberError } = await admin
    .from("social_planner_members")
    .upsert(
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

  if (memberError) throw new Error(`Failed to create owner membership: ${memberError.message}`);

  return planner;
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

    const body = parseJsonBody(req);
    const recipientEmail = normalizeEmail(body.recipientEmail);

    if (!recipientEmail) {
      return res.status(400).json({ ok: false, error: "recipientEmail is required" });
    }

    const senderEmail = normalizeEmail(user.email);
    if (!senderEmail) {
      return res.status(400).json({ ok: false, error: "Signed-in account is missing an email" });
    }

    if (recipientEmail === senderEmail) {
      return res.status(400).json({ ok: false, error: "You cannot add yourself" });
    }

    const ownerProfile = await getOwnerProfile(admin, user.id);
    const planner = await getOrCreatePlanner(admin, user, ownerProfile);

    const recipientAuthUser = await findAuthUserByEmail(admin, recipientEmail);

    await ensureNotBlocked(admin, user.id, recipientAuthUser?.id || null, recipientEmail);

    const { data: existingConnection, error: existingConnectionError } = await admin
      .from("social_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("friend_email", recipientEmail)
      .maybeSingle();

    if (existingConnectionError) {
      throw new Error(`Failed to check existing connection: ${existingConnectionError.message}`);
    }

    if (existingConnection?.id) {
      return res.status(409).json({ ok: false, error: "That friend is already connected" });
    }

    const requesterDisplayName = ownerProfile.display_name || senderEmail;

    const { data: insertedRequest, error: requestError } = await admin
      .from("social_friend_requests")
      .insert({
        requester_user_id: user.id,
        requester_owner_profile_id: ownerProfile.id,
        requester_display_name: requesterDisplayName,
        requester_email: senderEmail,
        recipient_email: recipientEmail,
        recipient_user_id: recipientAuthUser?.id || null,
        planner_id: planner.id,
        status: "pending"
      })
      .select("id, planner_id")
      .single();

    if (requestError) {
      const message = requestError.code === "23505"
        ? "A pending request already exists for that email"
        : `Failed to create friend request: ${requestError.message}`;
      return res.status(400).json({ ok: false, error: message });
    }

    if (recipientAuthUser?.id) {
      await admin.from("social_notifications").insert({
        user_id: recipientAuthUser.id,
        actor_user_id: user.id,
        type: "friend_request",
        title: `${requesterDisplayName} invited you to a Social Planner`,
        body: "Open notifications to accept or decline the request.",
        payload: {
          request_id: insertedRequest.id,
          planner_id: planner.id,
          requester_display_name: requesterDisplayName
        }
      });
    }

    return res.status(200).json({
      ok: true,
      plannerId: planner.id,
      requestId: insertedRequest.id
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

    if (
      err?.message === "You have blocked this user" ||
      err?.message === "This user is unavailable for friend requests"
    ) {
      return res.status(403).json({ ok: false, error: err.message });
    }

    console.error("[social/friend-request] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
