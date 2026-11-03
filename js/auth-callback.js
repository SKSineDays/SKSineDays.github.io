import { getSupabaseClient } from './supabase-client.js';

const SIGN_IN_ERROR = {
  error: 'sign_in_failed',
  description: 'This sign-in link may have expired or already been used. Please request a new link or try Google or Apple again.'
};

function redirectToLoginWithError() {
  try {
    // Never retain raw provider errors, codes, or tokens in storage or the UI.
    sessionStorage.setItem('sineday_auth_error', JSON.stringify(SIGN_IN_ERROR));
  } catch (_) {
    // The login query flag still provides a friendly fallback without storage.
  }
  window.location.replace('/login.html?auth_error=sign_in_failed');
}

function redirectToDashboard(identityLink) {
  const url = new URL('/dashboard.html', window.location.origin);
  if (identityLink === 'apple') {
    try { sessionStorage.setItem('sineday_identity_link_success', 'apple'); } catch (_) {}
    url.searchParams.set('linked', 'apple');
  }
  window.location.replace(url.toString());
}

(async function () {
  // Snapshot before initialization. This page alone owns callback consumption.
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.substring(1));
  const search = url.searchParams;
  const identityLink = search.get('identity_link');
  try {
    window.history.replaceState({}, document.title, url.pathname);
    if (['error', 'error_code', 'error_description', 'error_message'].some(key => search.has(key) || hash.has(key))) {
      redirectToLoginWithError();
      return;
    }

    const client = await getSupabaseClient();
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    const code = search.get('code');
    let result;
    if (access_token && refresh_token && !code) {
      result = await client.auth.setSession({ access_token, refresh_token });
    } else if (code && !access_token && !refresh_token) {
      result = await client.auth.exchangeCodeForSession(code);
    } else if (!code && !access_token && !refresh_token && !identityLink) {
      // A clean callback revisit may reuse an already established session.
      result = await client.auth.getSession();
    } else {
      redirectToLoginWithError();
      return;
    }
    if (result.error || !result.data?.session) {
      redirectToLoginWithError();
      return;
    }
    redirectToDashboard(identityLink);
  } catch (_) {
    // SDK/provider error messages can contain sensitive callback details.
    redirectToLoginWithError();
  }
})();
