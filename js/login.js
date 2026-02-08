/**
 * Login Page Logic
 *
 * Handles sign-in with Google.
 */

import { getCurrentSession, signInWithGoogle } from './supabase-client.js';

/**
 * Initialize login page
 */
async function init() {
  console.log('Initializing login page...');

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
}

/**
 * Handle Google sign-in
 */
async function handleGoogleSignIn(e) {
  e.preventDefault();

  const googleBtn = document.getElementById('google-signin-btn');
  const statusEl = document.getElementById('login-status');

  // Guard against spam clicks
  if (googleBtn?.dataset?.sending === '1') return;
  if (googleBtn) {
    googleBtn.dataset.sending = '1';
    googleBtn.disabled = true;
    googleBtn.textContent = 'Redirecting...';
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
      googleBtn.textContent = 'Continue with Google';
      googleBtn.dataset.sending = '0';
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
