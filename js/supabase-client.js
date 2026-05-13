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

function buildAuthCallbackUrl(config, params = {}) {
  const baseUrl = config.appUrl || window.location.origin;
  const url = new URL('/auth/callback.html', baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  const client = await getSupabaseClient();
  const config = await fetchConfig();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: buildAuthCallbackUrl(config)
    }
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Sign in with Apple OAuth
 */
export async function signInWithApple() {
  const client = await getSupabaseClient();
  const config = await fetchConfig();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: buildAuthCallbackUrl(config)
    }
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get identities connected to the current Supabase auth user.
 */
export async function getLinkedIdentities() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getUserIdentities();

  if (error) {
    throw error;
  }

  return data?.identities || [];
}

/**
 * Link Apple as an additional login method on the current signed-in account.
 *
 * This does not merge database rows. It connects the Apple OAuth identity
 * to the already-authenticated Supabase user, so all existing SineDay data
 * remains under the same user_id.
 */
export async function linkAppleIdentity() {
  const client = await getSupabaseClient();
  const config = await fetchConfig();

  const { data, error } = await client.auth.linkIdentity({
    provider: 'apple',
    options: {
      redirectTo: buildAuthCallbackUrl(config, { identity_link: 'apple' })
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
