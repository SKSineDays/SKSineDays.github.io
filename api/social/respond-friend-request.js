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
    const requestId = String(body.requestId || "").trim();
    const decision = String(body.decision || "").trim();

    if (!requestId) {
      return res.status(400).json({ ok: false, error: "requestId is required" });
    }
    if (decision !== "accepted" && decision !== "declined") {
      return res.status(400).json({ ok: false, error: "decision must be accepted or declined" });
    }

    const { data: requestRow, error: requestError } = await admin
      .from("social_friend_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      throw new Error(`Failed to load request: ${requestError.message}`);
    }
    if (!requestRow) {
      return res.status(404).json({ ok: false, error: "Friend request not found" });
    }
    if (requestRow.status !== "pending") {
      return res.status(400).json({ ok: false, error: "Friend request is no longer pending" });
    }

    const authedEmail = normalizeEmail(user.email);
    if (normalizeEmail(requestRow.recipient_email) !== authedEmail) {
      return res.status(403).json({ ok: false, error: "This request is not addressed to your account" });
    }

    const recipientOwnerProfile = await getOwnerProfile(admin, user.id);

    const { error: updateError } = await admin
      .from("social_friend_requests")
      .update({
        status: decision,
        recipient_user_id: user.id,
        responded_by_user_id: user.id,
        responded_at: new Date().toISOString()
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (updateError) {
      throw new Error(`Failed to update request: ${updateError.message}`);
    }

    const { error: removeRecipientNotificationError } = await admin
      .from("social_notifications")
      .delete()
      .eq("user_id", user.id)
      .eq("type", "friend_request")
      .contains("payload", { request_id: requestId });

    if (removeRecipientNotificationError) {
      throw new Error(
        `Failed to clear handled notification: ${removeRecipientNotificationError.message}`
      );
    }

    if (decision === "declined") {
      if (requestRow.requester_user_id) {
        await admin.from("social_notifications").insert({
          user_id: requestRow.requester_user_id,
          actor_user_id: user.id,
          type: "planner_update",
          title: `${recipientOwnerProfile.display_name || authedEmail} declined your friend request`,
          body: "You can send another request later if needed.",
          payload: {
            request_id: requestId,
            planner_id: requestRow.planner_id
          }
        });
      }

      return res.status(200).json({ ok: true });
    }

    const { data: requesterProfile, error: requesterProfileError } = await admin
      .from("profiles")
      .select("id, display_name")
      .eq("user_id", requestRow.requester_user_id)
      .eq("is_owner", true)
      .maybeSingle();

    if (requesterProfileError) {
      throw new Error(`Failed to load requester profile: ${requesterProfileError.message}`);
    }
    if (!requesterProfile?.id) {
      throw new Error("Requester owner profile not found");
    }

    const recipientDisplayName = recipientOwnerProfile.display_name || authedEmail;
    const requesterDisplayName = requesterProfile.display_name || requestRow.requester_email;

    const { error: addMemberError } = await admin
      .from("social_planner_members")
      .upsert(
        {
          planner_id: requestRow.planner_id,
          user_id: user.id,
          owner_profile_id: recipientOwnerProfile.id,
          role: "member",
          status: "active",
          invited_by_user_id: requestRow.requester_user_id
        },
        { onConflict: "planner_id,user_id" }
      );

    if (addMemberError) {
      throw new Error(`Failed to add planner membership: ${addMemberError.message}`);
    }

    const connectionRows = [
      {
        user_id: requestRow.requester_user_id,
        friend_user_id: user.id,
        friend_email: authedEmail,
        friend_display_name: recipientDisplayName,
        friend_owner_profile_id: recipientOwnerProfile.id,
        source_request_id: requestId
      },
      {
        user_id: user.id,
        friend_user_id: requestRow.requester_user_id,
        friend_email: normalizeEmail(requestRow.requester_email),
        friend_display_name: requesterDisplayName,
        friend_owner_profile_id: requesterProfile.id,
        source_request_id: requestId
      }
    ];

    const { error: connectionsError } = await admin
      .from("social_connections")
      .upsert(connectionRows, { onConflict: "user_id,friend_user_id" });

    if (connectionsError) {
      throw new Error(`Failed to create social connections: ${connectionsError.message}`);
    }

    await admin.from("social_notifications").insert([
      {
        user_id: requestRow.requester_user_id,
        actor_user_id: user.id,
        type: "friend_accept",
        title: `${recipientDisplayName} accepted your friend request`,
        body: "They now appear in your Social Planner.",
        payload: {
          planner_id: requestRow.planner_id,
          request_id: requestId
        }
      },
      {
        user_id: user.id,
        actor_user_id: requestRow.requester_user_id,
        type: "friend_accept",
        title: `You joined ${requesterDisplayName}'s Social Planner`,
        body: "You can now view shared month and day planning.",
        payload: {
          planner_id: requestRow.planner_id,
          request_id: requestId
        }
      }
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (
      err?.message === "Missing or invalid Authorization header" ||
      err?.message === "Invalid or expired token"
    ) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    console.error("[social/respond-friend-request] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
