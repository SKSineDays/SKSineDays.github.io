/**
 * Login Page Logic
 *
 * Handles sign-in with Google and Apple.
 */

import { getCurrentSession, signInWithApple, signInWithGoogle } from './supabase-client.js';

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

  if (!stored && !hasAuthError) return;

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
}

async function init() {
  console.log('Initializing login page...');

  showStoredAuthError();

  // Check if already logged in
  const session = await getCurrentSession();
  if (session) {
    console.log('[Login] Already logged in, redirecting to dashboard');
    window.location.href = '/dashboard.html';
    return;
  }

  // Set up event listeners
  setupEventListeners();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
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
