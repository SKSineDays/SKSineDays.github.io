/**
 * Supabase Client Setup for Browser
 *
 * This module initializes the Supabase client for use in the browser.
 * It fetches public configuration from /api/config and creates a client.
 */

let supabaseClient = null;
let configCache = null;

/**
 * Fetch public configuration from server
 */
async function fetchConfig() {
  if (configCache) {
    return configCache;
  }

  try {
    // Add cache-busting timestamp to prevent stale config
    const cacheBuster = Date.now();
    const response = await fetch(`/api/config?t=${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error('Config response not ok');
    }

    configCache = {
      supabaseUrl: data.supabaseUrl,
      supabaseAnonKey: data.supabaseAnonKey,
      appUrl: data.appUrl
    };

    console.log('[Config Debug] Fetched config:', configCache);

    return configCache;
  } catch (error) {
    console.error('Error fetching config:', error);
    throw error;
  }
}

/**
 * Initialize and return Supabase client
 */
export async function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = await fetchConfig();

  // Import Supabase from CDN
  const { createClient } = window.supabase;

  supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClient;
}

/**
 * Get current user session
 */
export async function getCurrentSession() {
  const client = await getSupabaseClient();
  const { data: { session }, error } = await client.auth.getSession();

  if (error) {
    console.error('Error getting session:', error);
    return null;
  }

  return session;
}

/**
 * Get current user
 */
export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

/**
 * Get access token for API calls
 */
export async function getAccessToken() {
  const session = await getCurrentSession();
  return session?.access_token || null;
}

/**
 * Sign in with email (magic link)
 */
export async function signInWithEmail(email) {
  const client = await getSupabaseClient();
  const config = await fetchConfig();

  // Always redirect back to dashboard.html where handleAuthCallback() runs
  // Use appUrl from config if available (for production), otherwise use current origin
  const baseUrl = config.appUrl || window.location.origin;
  const redirectTo = `${baseUrl}/dashboard.html`;

  // Debug logging
  console.log('[Magic Link Debug] Using base URL:', baseUrl);
  console.log('[Magic Link Debug] Full redirect URL:', redirectTo);
  console.log('[Magic Link Debug] window.location.origin:', window.location.origin);

  const { data, error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo
    }
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Sign out
 */
export async function signOut() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}

/**
 * Listen to auth state changes
 */
export async function onAuthStateChange(callback) {
  const client = await getSupabaseClient();
  const { data: { subscription } } = client.auth.onAuthStateChange(callback);
  return subscription;
}
