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

export async function requirePremium(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to check subscription");

  const ok = data && (data.status === "active" || data.status === "trialing");
  if (!ok) {
    const e = new Error("Premium required");
    e.code = "PREMIUM_REQUIRED";
    throw e;
  }
}
