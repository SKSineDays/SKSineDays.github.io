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
    // Ignore storage failures.
  }

  const params = new URLSearchParams({
    auth_error: authError.error || 'auth_error'
  });

  window.location.replace(`/login.html?${params.toString()}`);
}

function redirectToDashboard(params = {}) {
  const url = new URL('/dashboard.html', window.location.origin);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  window.location.replace(url.toString());
}

(async function () {
  try {
    const client = await getSupabaseClient();
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const searchParams = new URLSearchParams(url.search);

    const providerError = readAuthError(url);
    if (providerError) {
      redirectToLoginWithError(providerError);
      return;
    }

    const identityLink = searchParams.get('identity_link');
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');

    if (access_token && refresh_token) {
      const { error } = await client.auth.setSession({ access_token, refresh_token });
      if (error) throw error;

      if (identityLink === 'apple') {
        sessionStorage.setItem('sineday_identity_link_success', 'apple');
        redirectToDashboard({ linked: 'apple' });
        return;
      }

      redirectToDashboard();
      return;
    }

    const code = searchParams.get('code');

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(window.location.href);
      if (error) throw error;

      if (identityLink === 'apple') {
        sessionStorage.setItem('sineday_identity_link_success', 'apple');
        redirectToDashboard({ linked: 'apple' });
        return;
      }

      redirectToDashboard();
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
