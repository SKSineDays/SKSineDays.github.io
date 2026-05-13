import { getSupabaseClient } from './supabase-client.js';

function readAuthError(url) {
  const hashParams = new URLSearchParams(url.hash.substring(1));
  const searchParams = new URLSearchParams(url.search);

  const error =
    searchParams.get('error') ||
    hashParams.get('error') ||
    searchParams.get('error_code') ||
    hashParams.get('error_code');

  const description =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error_message') ||
    hashParams.get('error_message');

  if (!error && !description) return null;

  return {
    error: error || 'auth_error',
    description: description || 'Authentication failed before a SineDay session could be created.'
  };
}

function redirectToLoginWithError(authError) {
  try {
    sessionStorage.setItem('sineday_auth_error', JSON.stringify(authError));
  } catch (_) {
    // If browser storage is unavailable, the query string still lets login show a generic error.
  }

  const params = new URLSearchParams({
    auth_error: authError.error || 'auth_error'
  });

  window.location.replace(`/login.html?${params.toString()}`);
}

(async function () {
  try {
    const url = new URL(window.location.href);
    const providerError = readAuthError(url);
    if (providerError) {
      redirectToLoginWithError(providerError);
      return;
    }

    const client = await getSupabaseClient();
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const searchParams = new URLSearchParams(url.search);

    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');

    if (access_token && refresh_token) {
      const { error } = await client.auth.setSession({ access_token, refresh_token });
      if (error) throw error;

      window.location.replace('/dashboard.html');
      return;
    }

    if (searchParams.has('code')) {
      const { error } = await client.auth.exchangeCodeForSession(window.location.href);
      if (error) throw error;

      window.location.replace('/dashboard.html');
      return;
    }

    redirectToLoginWithError({
      error: 'missing_auth_payload',
      description: 'No auth code or session tokens were returned from the provider.'
    });
  } catch (error) {
    console.error('[Auth Callback] Failed:', error);

    redirectToLoginWithError({
      error: 'callback_exchange_failed',
      description: error?.message || 'Unable to complete sign in.'
    });
  }
})();
