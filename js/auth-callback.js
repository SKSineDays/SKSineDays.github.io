import { getSupabaseClient } from './supabase-client.js';

(async function () {
  const client = await getSupabaseClient();
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.substring(1));
  const searchParams = new URLSearchParams(url.search);

  const access_token = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');

  if (access_token && refresh_token) {
    await client.auth.setSession({ access_token, refresh_token });
    window.location.replace('/dashboard.html');
    return;
  }

  if (searchParams.has('code')) {
    await client.auth.exchangeCodeForSession(window.location.href);
    window.location.replace('/dashboard.html');
    return;
  }

  // If nothing to do, just go dashboard
  window.location.replace('/dashboard.html');
})();
