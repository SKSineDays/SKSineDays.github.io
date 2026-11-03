/**
 * Login Page Logic
 *
 * Handles sign-in with Google, Apple, and email magic links.
 */

import { getCurrentSession, signInWithApple, signInWithGoogle, signInWithEmail } from './supabase-client.js';

/**
 * Initialize login page
 */
function showStoredAuthError() {
  const statusEl = document.getElementById('login-status');
  if (!statusEl) return;

  let stored = null;

  try {
    stored = JSON.parse(sessionStorage.getItem('sineday_auth_error') || 'null');
    sessionStorage.removeItem('sineday_auth_error');
  } catch (_) {
    stored = null;
  }

  const params = new URLSearchParams(window.location.search);
  const hasAuthError = params.has('auth_error');

  if (!stored && !hasAuthError) return false;

  const description =
    stored?.description ||
    'Sign in could not be completed. Please try again.';

  statusEl.style.display = 'block';
  statusEl.className = 'status-message error';
  statusEl.textContent = description;

  if (hasAuthError) {
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }
  return true;
}

async function init() {
  console.log('Initializing login page...');

  const hasAuthError = showStoredAuthError();

  // Bind before awaiting configuration so a slow connection cannot submit email
  // through the browser's default form navigation.
  setupEventListeners();
  let session = null;
  try { session = await getCurrentSession(); } catch (_) {
    // Keep sign-in controls usable; each attempt can retry configuration.
  }
  if (session && !hasAuthError) {
    console.log('[Login] Already logged in, redirecting to dashboard');
    window.location.href = '/dashboard.html';
    return;
  }

}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('email-signin-form')?.addEventListener('submit', handleEmailSignIn);
  const emailInput = document.getElementById('signin-email');
  const emailButton = document.getElementById('email-signin-btn');
  if (emailInput) emailInput.disabled = false;
  if (emailButton) emailButton.disabled = false;
  // Google sign-in button
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', handleGoogleSignIn);
  }

  // Apple sign-in button
  const appleBtn = document.getElementById('apple-signin-btn');
  if (appleBtn) {
    appleBtn.addEventListener('click', handleAppleSignIn);
  }
}

/** Request only once while in flight; never display provider details or account status. */
async function handleEmailSignIn(e) {
  e.preventDefault();
  const form = document.getElementById('email-signin-form');
  const input = document.getElementById('signin-email');
  const button = document.getElementById('email-signin-btn');
  const status = document.getElementById('login-status');
  if (!input || !button || form?.dataset.sending === '1') return;
  input.value = input.value.trim().toLowerCase();
  const valid = input.checkValidity() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value);
  input.setAttribute('aria-invalid', String(!valid));
  status.style.display = 'block';
  if (!valid) {
    status.className = 'status-message error';
    status.textContent = 'Enter a valid email address.';
    input.focus();
    return;
  }
  form.dataset.sending = '1';
  form.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = 'Sending…';
  status.className = 'status-message info';
  status.textContent = 'Requesting your sign-in link…';
  try {
    await signInWithEmail(input.value);
    status.className = 'status-message success';
    status.textContent = 'Check your inbox. We sent you a secure sign-in link. Open the email and select Sign in to SineDay to continue.';
  } catch (error) {
    status.className = 'status-message error';
    status.textContent = error?.status === 429 || error?.code === 'over_email_send_rate_limit'
      ? 'Please wait a minute before requesting another sign-in link.'
      : 'We couldn’t send a sign-in link right now. Please try again shortly.';
  } finally {
    form.dataset.sending = '0';
    form.setAttribute('aria-busy', 'false');
    button.disabled = false;
    button.textContent = 'Email me a sign-in link';
  }
}

/**
 * Handle Google sign-in
 */
async function handleGoogleSignIn(e) {
  e.preventDefault();

  const googleBtn = document.getElementById('google-signin-btn');
  const googleText = googleBtn?.querySelector('.provider-text');
  const statusEl = document.getElementById('login-status');

  // Guard against spam clicks
  if (googleBtn?.dataset?.sending === '1') return;
  if (googleBtn) {
    googleBtn.dataset.sending = '1';
    googleBtn.disabled = true;
  }
  if (googleText) {
    googleText.textContent = 'Redirecting...';
  }

  // Show status
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.className = 'status-message info';
    statusEl.textContent = 'Redirecting to Google...';
  }

  try {
    await signInWithGoogle();
    // User will be redirected by OAuth flow
  } catch (error) {
    console.error('Google sign-in error:', error);

    const msg =
      error?.message?.includes('Failed to fetch config') || error?.message?.includes('Config')
        ? 'Server config error (/api/config). Check Vercel env vars SUPABASE_URL and SUPABASE_ANON_KEY.'
        : (error?.message || 'Unknown error');

    if (statusEl) {
      statusEl.textContent = `Failed to sign in with Google: ${msg}`;
      statusEl.className = 'status-message error';
    }

    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.dataset.sending = '0';
    }

    if (googleText) {
      googleText.textContent = 'Google';
    }
  }
}

/**
 * Handle Apple sign-in
 */
async function handleAppleSignIn(e) {
  e.preventDefault();

  const appleBtn = document.getElementById('apple-signin-btn');
  const appleText = appleBtn?.querySelector('.provider-text');
  const statusEl = document.getElementById('login-status');

  // Guard against spam clicks
  if (appleBtn?.dataset?.sending === '1') return;
  if (appleBtn) {
    appleBtn.dataset.sending = '1';
    appleBtn.disabled = true;
  }
  if (appleText) {
    appleText.textContent = 'Redirecting...';
  }

  // Show status
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.className = 'status-message info';
    statusEl.textContent = 'Redirecting to Apple...';
  }

  try {
    await signInWithApple();
    // User will be redirected by OAuth flow
  } catch (error) {
    console.error('Apple sign-in error:', error);

    const msg =
      error?.message?.includes('Failed to fetch config') || error?.message?.includes('Config')
        ? 'Server config error (/api/config). Check Vercel env vars SUPABASE_URL and SUPABASE_ANON_KEY.'
        : (error?.message || 'Unknown error');

    if (statusEl) {
      statusEl.textContent = `Failed to sign in with Apple: ${msg}`;
      statusEl.className = 'status-message error';
    }

    if (appleBtn) {
      appleBtn.disabled = false;
      appleBtn.dataset.sending = '0';
    }
    if (appleText) {
      appleText.textContent = 'Apple';
    }
  }
}


// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
      console.error('Login init failed:', err);
    });
  });
} else {
  init().catch(err => {
    console.error('Login init failed:', err);
  });
}
