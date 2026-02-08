/**
 * Dashboard Logic
 *
 * Handles authentication, profiles, and subscription management.
 */

import {
  getSupabaseClient,
  getCurrentSession,
  getCurrentUser,
  getAccessToken,
  signOut,
  onAuthStateChange
} from './supabase-client.js';
import { DuckPond } from "./duck-pond.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "./origin-wave.js";
import { duckUrlFromSinedayNumber } from "./sineducks.js";

// State
let currentUser = null;
let currentSubscription = null;
let profiles = [];
let duckPond = null;

/**
 * Initialize dashboard on page load
 */
async function init() {
  console.log('Initializing dashboard...');

  // ✅ Always attach UI handlers first
  setupEventListeners();

  // Show loading (optional)
  showLoading();

  try {
    // Get current session
    const session = await getCurrentSession();

    if (session) {
      currentUser = session.user;
      await loadUserData();
      showAuthenticatedView();
    } else {
      // Redirect to login page if not authenticated
      window.location.href = '/login.html';
      return;
    }

    // Listen to auth changes
    onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        loadUserData();
        showAuthenticatedView();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentSubscription = null;
        profiles = [];
        if (duckPond) {
          duckPond.destroy();
          duckPond = null;
        }
        window.location.href = '/login.html';
      }
    });

    // Check checkout success
    await checkCheckoutSuccess();
  } catch (err) {
    console.error('[Dashboard Init] Failed:', err);
    // Redirect to login on error
    window.location.href = '/login.html';
  } finally {
    hideLoading?.();
  }
}


/**
 * Load user data (profiles and subscription)
 */
async function loadUserData() {
  await Promise.all([
    loadProfiles(),
    loadSubscription()
  ]);
}

/**
 * Load user profiles
 */
async function loadProfiles() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading profiles:', error);
      showError('Failed to load profiles');
      return;
    }

    profiles = data || [];
    renderProfiles();
  } catch (error) {
    console.error('Error loading profiles:', error);
    showError('Failed to load profiles');
  }
}

/**
 * Load subscription status
 */
async function loadSubscription() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) {
      console.error('Error loading subscription:', error);
      currentSubscription = null;
    } else {
      currentSubscription = data;
    }

    renderSubscriptionStatus();
  } catch (error) {
    console.error('Error loading subscription:', error);
    currentSubscription = null;
    renderSubscriptionStatus();
  }
}

/**
 * Check if user is paid
 */
function isPaid() {
  return currentSubscription &&
         (currentSubscription.status === 'active' ||
          currentSubscription.status === 'trialing');
}

/**
 * Ensure duck pond is initialized
 */
function ensureDuckPond() {
  if (duckPond) return duckPond;

  const canvas = document.getElementById("duck-pond-canvas");
  const stageEl = document.getElementById("duck-pond-stage");
  const emptyEl = document.getElementById("duck-pond-empty");
  const statusEl = document.getElementById("duck-pond-status");
  const scoreEl = document.getElementById("duck-pond-score");

  if (!canvas || !stageEl) return null;

  duckPond = new DuckPond(canvas, {
    stageEl,
    emptyEl,
    statusEl,
    scoreEl,
    anchorDate: ORIGIN_ANCHOR_DATE
  });

  return duckPond;
}

/**
 * Render profiles list
 */
function renderProfiles() {
  const container = document.getElementById('profiles-list');
  if (!container) return;

  if (profiles.length === 0) {
    container.innerHTML = '<p class="text-muted">No profiles yet. Add your first profile below!</p>';
  } else {
    container.innerHTML = profiles.map(profile => {
      const originDay = getOriginTypeForDob(profile.birthdate, ORIGIN_ANCHOR_DATE);
      const duckUrl = originDay ? duckUrlFromSinedayNumber(originDay) : "";
      const originLabel = originDay ? `Origin: Day ${originDay}` : "Origin: N/A";

      return `
        <div class="profile-item" data-id="${profile.id}">
          <div class="profile-info">
            <strong>${escapeHtml(profile.display_name)}</strong>
            <span class="text-muted">
              Born: ${profile.birthdate || "N/A"} | ${profile.timezone || "N/A"} | ${originLabel}
            </span>
          </div>
          <div class="profile-actions" style="display:flex; gap:10px; align-items:center;">
            ${duckUrl ? `
              <div class="duck-avatar" title="Origin Day ${originDay}">
                <img src="${duckUrl}" alt="SineDuck origin day ${originDay}" width="34" height="34">
              </div>
            ` : ""}
            <button class="btn btn-sm btn-danger delete-profile" data-id="${profile.id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Update limit message
  const limitMsg = document.getElementById('profile-limit-message');
  const addBtn = document.getElementById('add-profile-btn');

  if (profiles.length >= 10) {
    if (limitMsg) limitMsg.style.display = 'block';
    if (addBtn) addBtn.disabled = true;
  } else {
    if (limitMsg) limitMsg.style.display = 'none';
    if (addBtn) addBtn.disabled = false;
  }

  // Update duck pond
  const stageEl = document.getElementById("duck-pond-stage");
  if (stageEl) stageEl.dataset.empty = profiles.length === 0 ? "true" : "false";

  if (!duckPond) ensureDuckPond();
  if (duckPond) duckPond.setProfiles(profiles);
}

/**
 * Render subscription status
 */
function renderSubscriptionStatus() {
  const container = document.getElementById('subscription-status');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const billingBtn = document.getElementById('billing-btn');
  const calendarsSection = document.getElementById('calendars-section');

  // Update mini subscription pill
  const pill = document.getElementById('mini-sub-pill');
  if (pill) {
    if (isPaid()) {
      pill.className = 'sub-pill is-paid';
      pill.textContent = '✓ Premium Active';
    } else {
      pill.className = 'sub-pill is-free';
      pill.textContent = 'Free Plan';
    }
  }

  if (!container) return;

  if (isPaid()) {
    // Paid user
    const renewalDate = currentSubscription.current_period_end
      ? new Date(currentSubscription.current_period_end).toLocaleDateString()
      : 'N/A';

    container.innerHTML = `
      <div class="alert alert-success">
        <strong>✓ Premium Active</strong><br>
        Next renewal: ${renewalDate}
      </div>
    `;

    if (upgradeBtn) upgradeBtn.style.display = 'none';
    if (billingBtn) billingBtn.style.display = 'inline-block';

    // Show calendars (placeholder for now)
    if (calendarsSection) {
      calendarsSection.innerHTML = `
        <p>Monthly and Weekly calendars coming next!</p>
        <p class="text-muted">Premium features will be available here.</p>
      `;
    }
  } else {
    // Not paid
    container.innerHTML = `
      <div class="alert alert-warning">
        <strong>Free Plan</strong><br>
        Upgrade to Premium to unlock calendar features.
      </div>
    `;

    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    if (billingBtn) billingBtn.style.display = 'none';

    // Show locked calendars
    if (calendarsSection) {
      calendarsSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to access monthly and weekly calendars.</p>
        </div>
      `;
    }
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Sign out button
  const signOutBtn = document.getElementById('signout-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', handleSignOut);
  }

  // Add profile form
  const addProfileForm = document.getElementById('add-profile-form');
  if (addProfileForm) {
    addProfileForm.addEventListener('submit', handleAddProfile);
  }

  // Upgrade button
  const upgradeBtn = document.getElementById('upgrade-btn');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', handleUpgrade);
  }

  // Billing button
  const billingBtn = document.getElementById('billing-btn');
  if (billingBtn) {
    billingBtn.addEventListener('click', handleBilling);
  }

  // Reload ducks button
  const reloadBtn = document.getElementById('reload-ducks-btn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      if (!duckPond) ensureDuckPond();
      if (duckPond) duckPond.reload(profiles);
    });
  }

  // Delete profile buttons (delegated)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-profile')) {
      const profileId = e.target.dataset.id;
      handleDeleteProfile(profileId);
    }
  });
}


/**
 * Handle sign out
 */
async function handleSignOut() {
  try {
    await signOut();
    // Auth state change listener will handle UI update
  } catch (error) {
    console.error('Sign out error:', error);
    showError('Failed to sign out');
  }
}

/**
 * Handle add profile
 */
async function handleAddProfile(e) {
  e.preventDefault();

  if (profiles.length >= 10) {
    showError('Maximum 10 profiles reached');
    return;
  }

  const name = document.getElementById('profile-name').value;
  const birthdate = document.getElementById('profile-birthdate').value;
  const timezone = document.getElementById('profile-timezone').value;

  if (!name || !birthdate) {
    showError('Name and birthdate are required');
    return;
  }

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client
      .from('profiles')
      .insert({
        user_id: currentUser.id,
        display_name: name,
        birthdate: birthdate,
        timezone: timezone || 'America/Chicago'
      })
      .select()
      .single();

    if (error) {
      if (error.message.includes('limit reached') || error.message.includes('10 max')) {
        showError('Profile limit reached (10 max)');
      } else {
        showError('Failed to add profile: ' + error.message);
      }
      return;
    }

    // Add to list
    profiles.unshift(data);
    renderProfiles();

    // Clear form
    document.getElementById('add-profile-form').reset();
    showSuccess('Profile added successfully!');
  } catch (error) {
    console.error('Add profile error:', error);
    showError('Failed to add profile');
  }
}

/**
 * Handle delete profile
 */
async function handleDeleteProfile(profileId) {
  if (!confirm('Are you sure you want to delete this profile?')) {
    return;
  }

  try {
    const client = await getSupabaseClient();
    const { error } = await client
      .from('profiles')
      .delete()
      .eq('id', profileId)
      .eq('user_id', currentUser.id);

    if (error) {
      showError('Failed to delete profile: ' + error.message);
      return;
    }

    // Remove from list
    profiles = profiles.filter(p => p.id !== profileId);
    renderProfiles();
    showSuccess('Profile deleted successfully!');
  } catch (error) {
    console.error('Delete profile error:', error);
    showError('Failed to delete profile');
  }
}

/**
 * Handle upgrade button
 */
async function handleUpgrade() {
  try {
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Creating session...';
    }

    const accessToken = await getAccessToken();
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Failed to create checkout session');
    }

    // Redirect to Stripe Checkout
    window.location.href = data.url;
  } catch (error) {
    console.error('Upgrade error:', error);
    showError('Failed to start checkout: ' + error.message);

    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = 'Upgrade to Premium';
    }
  }
}

/**
 * Handle billing button
 */
async function handleBilling() {
  try {
    const billingBtn = document.getElementById('billing-btn');
    if (billingBtn) {
      billingBtn.disabled = true;
      billingBtn.textContent = 'Loading...';
    }

    const accessToken = await getAccessToken();
    const response = await fetch('/api/create-portal-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Failed to create portal session');
    }

    // Redirect to Stripe Billing Portal
    window.location.href = data.url;
  } catch (error) {
    console.error('Billing error:', error);
    showError('Failed to open billing portal: ' + error.message);

    const billingBtn = document.getElementById('billing-btn');
    if (billingBtn) {
      billingBtn.disabled = false;
      billingBtn.textContent = 'Manage Billing';
    }
  }
}

/**
 * Check for checkout success and poll subscription
 */
async function checkCheckoutSuccess() {
  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get('checkout');

  if (checkoutStatus === 'success') {
    showSuccess('Payment successful! Your subscription is being activated...');

    // Poll subscription status a few times
    let attempts = 0;
    const maxAttempts = 5;

    const pollInterval = setInterval(async () => {
      attempts++;

      await loadSubscription();

      if (isPaid() || attempts >= maxAttempts) {
        clearInterval(pollInterval);

        if (isPaid()) {
          showSuccess('Premium activated! You now have access to all features.');
        } else {
          showInfo('Subscription is being processed. This may take a moment.');
        }

        // Clean up URL
        window.history.replaceState({}, '', '/dashboard.html');
      }
    }, 2000);
  } else if (checkoutStatus === 'cancel') {
    showInfo('Checkout cancelled. You can upgrade anytime.');
    // Clean up URL
    window.history.replaceState({}, '', '/dashboard.html');
  }
}

/**
 * Show loading view
 */
function showLoading() {
  const loading = document.getElementById('loading');
  const dashboardSection = document.getElementById('dashboard-section');

  if (loading) loading.style.display = 'block';
  if (dashboardSection) dashboardSection.style.display = 'none';
}

/**
 * Hide loading view
 */
function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
}

/**
 * Show authenticated view
 */
function showAuthenticatedView() {
  const loading = document.getElementById('loading');
  const dashboardSection = document.getElementById('dashboard-section');

  if (loading) loading.style.display = 'none';
  if (dashboardSection) dashboardSection.style.display = 'block';

  // Update user email display
  const userEmailEl = document.getElementById('user-email');
  if (userEmailEl) {
    userEmailEl.textContent = currentUser.email;
  }

  // Init duck pond once dashboard is visible (so sizing works)
  ensureDuckPond();
  if (duckPond) duckPond.setProfiles(profiles);
}

/**
 * Show error message
 */
function showError(message) {
  showNotification(message, 'error');
}

/**
 * Show success message
 */
function showSuccess(message) {
  showNotification(message, 'success');
}

/**
 * Show info message
 */
function showInfo(message) {
  showNotification(message, 'info');
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const container = document.getElementById('notifications');
  if (!container) {
    alert(message);
    return;
  }

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  container.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
      console.error('Dashboard init failed:', err);
      const loading = document.getElementById('loading');
      if (loading) loading.innerText = 'Something went wrong. Please refresh.';
    });
  });
} else {
  init().catch(err => {
    console.error('Dashboard init failed:', err);
    const loading = document.getElementById('loading');
    if (loading) loading.innerText = 'Something went wrong. Please refresh.';
  });
}
