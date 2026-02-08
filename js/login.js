/**
 * Login Page Logic
 *
 * Handles sign-in with Google and email magic link.
 */

import {
  getSupabaseClient,
  getCurrentSession,
  signInWithEmail,
  signInWithGoogle
} from './supabase-client.js';

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

  // Email login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleEmailLogin);
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

/**
 * Handle email login form submission
 */
async function handleEmailLogin(e) {
  e.preventDefault();

  const emailInput = document.getElementById('login-email');
  const email = (emailInput?.value || '').trim();
  const statusEl = document.getElementById('login-status');
  const form = document.getElementById('login-form');
  const submitBtn = form?.querySelector('button[type="submit"]');

  // Show status area
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.className = 'status-message info';
  }

  if (!email) {
    if (statusEl) statusEl.textContent = 'Please enter an email.';
    return;
  }

  // Guard against spam clicks
  if (form?.dataset?.sending === '1') return;
  if (form) form.dataset.sending = '1';

  // UI: disable button
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.textContent || '';
    submitBtn.textContent = 'Sending…';
    submitBtn.setAttribute('aria-busy', 'true');
  }

  try {
    if (statusEl) statusEl.textContent = 'Sending magic link…';

    await signInWithEmail(email);

    if (statusEl) {
      statusEl.textContent = 'Magic link sent! Check your email.';
      statusEl.className = 'status-message success';
    }

    if (emailInput) emailInput.value = '';
  } catch (error) {
    console.error('Login error:', error);

    const msg =
      error?.message?.includes('Failed to fetch config') || error?.message?.includes('Config')
        ? 'Server config error (/api/config). Check Vercel env vars SUPABASE_URL and SUPABASE_ANON_KEY.'
        : (error?.message || 'Unknown error');

    if (statusEl) {
      statusEl.textContent = `Failed to send magic link: ${msg}`;
      statusEl.className = 'status-message error';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || 'Send Magic Link';
      submitBtn.removeAttribute('aria-busy');
    }
    if (form) form.dataset.sending = '0';
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
