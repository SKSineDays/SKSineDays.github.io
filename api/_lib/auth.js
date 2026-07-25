import { createClient } from "@supabase/supabase-js";

/**
 * Authenticate user from Authorization header
 */
export async function authenticateUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const accessToken = authHeader.substring(7);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase configuration");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });

  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new Error("Invalid or expired token");

  return { user, supabase, accessToken };
}

export function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing admin Supabase config");

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function getPremiumEntitlement(supabaseAdmin, userId) {
  const [subscriptionResult, affiliateResult] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("affiliates")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (subscriptionResult.error) {
    throw new Error("Failed to check subscription");
  }

  const missingAffiliateTable =
    affiliateResult.error &&
    ["42P01", "PGRST205"].includes(affiliateResult.error.code);
  if (affiliateResult.error && !missingAffiliateTable) {
    throw new Error("Failed to check affiliate entitlement");
  }

  const subscription = subscriptionResult.data;
  const affiliate = affiliateResult.data;
  const hasStripePremium =
    subscription?.status === "active" || subscription?.status === "trialing";
  const hasAffiliateGift = affiliate?.status === "active";

  return {
    premium: hasStripePremium || hasAffiliateGift,
    source: hasStripePremium
      ? "stripe"
      : hasAffiliateGift
        ? "affiliate_gift"
        : "none",
    subscriptionStatus: subscription?.status || null,
    currentPeriodEnd: subscription?.current_period_end || null,
    affiliateStatus: affiliate?.status || null,
  };
}

export async function requirePremium(supabaseAdmin, userId) {
  const entitlement = await getPremiumEntitlement(supabaseAdmin, userId);
  if (!entitlement.premium) {
    const e = new Error("Premium required");
    e.code = "PREMIUM_REQUIRED";
    throw e;
  }
  return entitlement;
}
