import { authenticateUser, getAdminClient } from "../_lib/auth.js";
import { isAffiliateProgramEnabled } from "../_lib/affiliate.js";
import {
  AFFILIATE_APPLICATION_RECEIVED_MESSAGE,
  affiliateApiError,
  findAffiliateApplicationByEmail,
  getAffiliateApplicationForUser,
  handleOptions,
  hasAffiliateApplicationHoneypot,
  insertAffiliateApplication,
  updatePendingAffiliateApplication,
  validateAffiliateApplicationInput,
} from "../_lib/affiliate-server.js";

function setApplicationApiHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "private, no-store");
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

function received(res, extra = {}) {
  return res.status(200).json({
    ok: true,
    message: AFFILIATE_APPLICATION_RECEIVED_MESSAGE,
    ...extra,
  });
}

function validationError(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function hasBearerAuthorization(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  return typeof header === "string" && header.startsWith("Bearer ");
}

async function handleAuthenticatedApplication(req, res, body) {
  const { user } = await authenticateUser(req);
  const validated = validateAffiliateApplicationInput(body, {
    emailSource: user.email,
  });
  if (!validated.ok) {
    return validationError(res, validated.error);
  }

  const supabaseAdmin = getAdminClient();

  const existing = await getAffiliateApplicationForUser({ supabaseAdmin, user });
  if (existing?.review_status === "approved") {
    return received(res, { reviewStatus: "approved" });
  }
  if (existing?.review_status === "declined") {
    return received(res, { reviewStatus: "declined" });
  }

  if (existing?.review_status === "pending") {
    const updated = await updatePendingAffiliateApplication({
      supabaseAdmin,
      applicationId: existing.id,
      fields: validated.fields,
      userId: user.id,
    });
    return received(res, {
      reviewStatus: updated?.review_status || "pending",
    });
  }

  const inserted = await insertAffiliateApplication({
    supabaseAdmin,
    fields: validated.fields,
    source: "dashboard",
    userId: user.id,
  });

  if (inserted.duplicate) {
    const duplicate = await findAffiliateApplicationByEmail(
      supabaseAdmin,
      validated.fields.email,
    );
    if (duplicate?.review_status === "approved") {
      return received(res, { reviewStatus: "approved" });
    }
    if (duplicate?.review_status === "declined") {
      return received(res, { reviewStatus: "declined" });
    }
    if (duplicate?.review_status === "pending") {
      if (duplicate.user_id && duplicate.user_id !== user.id) {
        return received(res);
      }
      const updated = await updatePendingAffiliateApplication({
        supabaseAdmin,
        applicationId: duplicate.id,
        fields: validated.fields,
        userId: user.id,
      });
      return received(res, {
        reviewStatus: updated?.review_status || "pending",
      });
    }
    return received(res);
  }

  return received(res, {
    reviewStatus: inserted.application?.review_status || "pending",
  });
}

async function handlePublicApplication(res, body) {
  const validated = validateAffiliateApplicationInput(body);
  if (!validated.ok) {
    return validationError(res, validated.error);
  }

  const supabaseAdmin = getAdminClient();

  const inserted = await insertAffiliateApplication({
    supabaseAdmin,
    fields: validated.fields,
    source: "public",
    userId: null,
  });

  if (inserted.duplicate) {
    return received(res);
  }

  return received(res);
}

export default async function handler(req, res) {
  setApplicationApiHeaders(res);
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!isAffiliateProgramEnabled()) {
      const error = new Error("Affiliate program unavailable");
      error.code = "AFFILIATE_DISABLED";
      throw error;
    }

    const body = parseJsonBody(req);
    if (hasAffiliateApplicationHoneypot(body)) {
      return received(res);
    }

    if (hasBearerAuthorization(req)) {
      return handleAuthenticatedApplication(req, res, body);
    }

    return handlePublicApplication(res, body);
  } catch (error) {
    return affiliateApiError(res, error, "application submit failed");
  }
}
