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
import { DuckCarousel } from "./duck-carousel.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "../shared/origin-wave.js";
import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { CalendarsPdfUI } from "./calendars-pdf-ui.js";
import { PlannerUI } from "./planner-ui.js";
import {
  loadUserSettings,
  saveUserSettings,
  resolveWeekStart,
  SUPPORTED_LANGUAGES,
  SUPPORTED_REGIONS
} from "./user-settings.js";
import { dirFromLocale } from "../shared/i18n.js";

// State
let currentUser = null;
let currentSubscription = null;
let profiles = [];
let duckCarousel = null;
let addProfileUI = null;
let calendarsUI = null;
let plannerUI = null;
let userSettings = null;

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

      // Load per-account settings (locale/weekstart)
      userSettings = await loadUserSettings(currentUser.id);
      setupLanguageRegionUI();

      await loadUserData();

      // Gate: require owner profile before showing dashboard
      if (!hasOwnerProfile()) {
        hideLoading();
        await showOwnerOnboarding();
        // After onboarding completes, profiles array is updated
      }

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
        if (duckCarousel) {
          duckCarousel.destroy();
          duckCarousel = null;
        }
        if (plannerUI) {
          plannerUI.destroy();
          plannerUI = null;
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
      .order('is_owner', { ascending: false })
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

    await renderSubscriptionStatus();
  } catch (error) {
    console.error('Error loading subscription:', error);
    currentSubscription = null;
    await renderSubscriptionStatus();
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
 * Check if user has an owner profile
 */
function hasOwnerProfile() {
  return profiles.some(p => p.is_owner === true);
}

/**
 * Get owner profile
 */
function getOwnerProfile() {
  return profiles.find(p => p.is_owner === true) || null;
}

/**
 * Ensure duck carousel is initialized
 */
function ensureDuckCarousel() {
  if (duckCarousel) return duckCarousel;

  const wrapEl = document.getElementById("duck-carousel-wrap");
  if (!wrapEl) return null;

  duckCarousel = new DuckCarousel(wrapEl, {
    anchorDate: ORIGIN_ANCHOR_DATE
  });

  return duckCarousel;
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
            ${profile.is_owner
              ? `<span class="owner-badge">Owner</span>`
              : `<button class="btn btn-sm btn-danger delete-profile" data-id="${profile.id}">Delete</button>`
            }
          </div>
        </div>
      `;
    }).join("");
  }

  // Update limit message and add-profile controls
  const limitMsg = document.getElementById('profile-limit-message');
  const addBtn = document.getElementById('add-profile-btn');
  const addToggle = document.getElementById('add-profile-toggle');

  if (profiles.length >= 10) {
    if (limitMsg) limitMsg.style.display = 'block';
    if (addBtn) addBtn.disabled = true;
    if (addToggle) addToggle.disabled = true;
  } else {
    if (limitMsg) limitMsg.style.display = 'none';
    if (addBtn) addBtn.disabled = false;
    if (addToggle) addToggle.disabled = false;
  }

  // Update duck carousel
  if (!duckCarousel) ensureDuckCarousel();
  if (duckCarousel) duckCarousel.setProfiles(profiles);
  calendarsUI?.setProfiles?.(profiles);
  calendarsUI?.setOwnerProfile?.(getOwnerProfile());
  plannerUI?.setOwnerProfile?.(getOwnerProfile());
}

/**
 * Mount standalone Planner section (owner-only, premium-gated)
 */
async function mountPlannerSection() {
  const section = document.getElementById("planner-section");
  if (!section) return;

  // Destroy previous instance
  if (plannerUI) {
    plannerUI.destroy();
    plannerUI = null;
  }

  // Gate: must be premium + have owner profile
  if (!isPaid()) {
    section.innerHTML = "";
    return;
  }

  const ownerProfile = getOwnerProfile();
  if (!ownerProfile) {
    section.innerHTML = "";
    return;
  }

  const locale = `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
  const weekStart = resolveWeekStart(userSettings);
  const client = await getSupabaseClient();

  // Build the frame chrome
  const frame = document.createElement("div");
  frame.className = "planner-frame";

  // Header row: title + nav
  const header = document.createElement("div");
  header.className = "planner-frame__header";

  const title = document.createElement("div");
  title.className = "planner-frame__title";
  title.textContent = "Weekly Planner";

  const viewToggle = document.createElement("div");
  viewToggle.className = "planner-frame__view-toggle";

  const btnViewWeek = document.createElement("button");
  btnViewWeek.type = "button";
  btnViewWeek.className = "planner-frame__viewbtn is-active";
  btnViewWeek.textContent = "Week";
  btnViewWeek.setAttribute("aria-pressed", "true");

  const btnViewDay = document.createElement("button");
  btnViewDay.type = "button";
  btnViewDay.className = "planner-frame__viewbtn";
  btnViewDay.textContent = "Day";
  btnViewDay.setAttribute("aria-pressed", "false");

  viewToggle.append(btnViewWeek, btnViewDay);

  const nav = document.createElement("div");
  nav.className = "planner-frame__nav";

  const btnPrev = document.createElement("button");
  btnPrev.className = "planner-frame__navbtn";
  btnPrev.type = "button";
  btnPrev.textContent = "←";
  btnPrev.setAttribute("aria-label", "Previous week");

  const rangeLabel = document.createElement("div");
  rangeLabel.className = "planner-frame__range";

  const btnNext = document.createElement("button");
  btnNext.className = "planner-frame__navbtn";
  btnNext.type = "button";
  btnNext.textContent = "→";
  btnNext.setAttribute("aria-label", "Next week");

  nav.append(btnPrev, rangeLabel, btnNext);
  header.append(title, viewToggle, nav);

  const mount = document.createElement("div");
  mount.className = "planner-mount";

  frame.append(header, mount);

  section.innerHTML = "";
  section.append(frame);

  // Instantiate PlannerUI
  plannerUI = new PlannerUI(mount, {
    locale,
    weekStart,
    ownerProfile,
    supabaseClient: client,
    userId: currentUser.id,
  });

  // Initial render (constructor does not auto-render)
  await plannerUI.render();

  // Helper to update the range label
  function updateRangeLabel() {
    rangeLabel.textContent = plannerUI.getDateLabel(locale);
  }

  function syncViewToggle(view) {
    const isWeek = view === "week";
    btnViewWeek.classList.toggle("is-active", isWeek);
    btnViewDay.classList.toggle("is-active", !isWeek);
    btnViewWeek.setAttribute("aria-pressed", String(isWeek));
    btnViewDay.setAttribute("aria-pressed", String(!isWeek));
    title.textContent = isWeek ? "Weekly Planner" : "Daily Planner";
    btnPrev.setAttribute("aria-label", isWeek ? "Previous week" : "Previous day");
    btnNext.setAttribute("aria-label", isWeek ? "Next week" : "Next day");
  }

  updateRangeLabel();

  btnViewWeek.addEventListener("click", () => {
    plannerUI.setView("week");
    syncViewToggle("week");
    updateRangeLabel();
  });

  btnViewDay.addEventListener("click", () => {
    plannerUI.setView("day");
    syncViewToggle("day");
    updateRangeLabel();
  });

  btnPrev.addEventListener("click", () => {
    if (plannerUI.view === "week") {
      plannerUI.navigateWeek(-1);
    } else {
      plannerUI.navigateDay(-1);
    }
    updateRangeLabel();
  });

  btnNext.addEventListener("click", () => {
    if (plannerUI.view === "week") {
      plannerUI.navigateWeek(1);
    } else {
      plannerUI.navigateDay(1);
    }
    updateRangeLabel();
  });
}

/**
 * Render subscription status (single source: plan pill + renewal in drawer)
 */
async function renderSubscriptionStatus() {
  const pill = document.getElementById('plan-pill');
  const renewalEl = document.getElementById('renewal-date');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const billingBtn = document.getElementById('billing-btn');
  const subscriptionMini = document.getElementById('subscription-mini');
  const calendarsSection = document.getElementById('calendars-section');

  if (pill) {
    if (isPaid()) {
      pill.className = 'pill pill--ok';
      pill.innerHTML = '<span class="pill-dot"></span>Premium';
    } else {
      pill.className = 'pill pill--neutral';
      pill.innerHTML = 'Free';
    }
  }

  if (isPaid()) {
    const renewalDate = currentSubscription?.current_period_end
      ? new Date(currentSubscription.current_period_end).toLocaleDateString()
      : '—';
    if (renewalEl) renewalEl.textContent = renewalDate;
    if (subscriptionMini) subscriptionMini.style.display = '';

    if (upgradeBtn) upgradeBtn.style.display = 'none';
    if (billingBtn) billingBtn.style.display = 'inline-block';

    if (calendarsSection) {
      calendarsSection.innerHTML = `
        <div id="calendar-app"></div>
        <p class="text-muted" style="margin-top:12px;">
          Tip: Use "Download PDF" to save clean monthly & weekly pages.
        </p>
      `;

      const mount = document.getElementById("calendar-app");
      const locale = `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
      const weekStart = resolveWeekStart(userSettings);
      const client = await getSupabaseClient();
      const ownerProfile = getOwnerProfile();

      // (Re)mount calendars (PDF-first preview)
      calendarsUI?.destroy?.();
      calendarsUI = new CalendarsPdfUI(mount, {
        locale,
        weekStart,
        profiles,
        supabaseClient: client,
        userId: currentUser.id,
        ownerProfile
      });
    }

    // Mount standalone planner
    await mountPlannerSection();
  } else {
    if (renewalEl) renewalEl.textContent = '—';
    if (subscriptionMini) subscriptionMini.style.display = 'none';

    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    if (billingBtn) billingBtn.style.display = 'none';

    if (calendarsSection) {
      calendarsSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to access monthly and weekly calendars.</p>
        </div>
      `;
    }

    // Show locked state for planner (free users)
    const plannerSection = document.getElementById("planner-section");
    if (plannerSection) {
      plannerSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to access your cloud-synced weekly planner.</p>
        </div>
      `;
    }
    if (plannerUI) { plannerUI.destroy(); plannerUI = null; }
  }
}

/**
 * Set up Account bottom sheet (iOS-style)
 */
function setupAccountSheet() {
  const toggle = document.getElementById('account-toggle');
  const sheet = document.getElementById('account-sheet');
  const backdrop = document.getElementById('account-backdrop');
  if (!toggle || !sheet || !backdrop) return;

  const open = () => {
    toggle.setAttribute('aria-expanded', 'true');
    sheet.hidden = false;
    backdrop.hidden = false;

    requestAnimationFrame(() => {
      sheet.classList.add('is-open');
      backdrop.classList.add('is-open');
    });

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };

  const close = () => {
    toggle.setAttribute('aria-expanded', 'false');
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');

    setTimeout(() => {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }, 220);
  };

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    expanded ? close() : open();
  });

  backdrop.addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') close();
  });
}

/**
 * Set up Language & Region controls in account sheet
 */
function setupLanguageRegionUI() {
  const langSel = document.getElementById("language-select");
  const regionSel = document.getElementById("region-select");
  const weekSel = document.getElementById("weekstart-select");
  if (!langSel || !regionSel || !weekSel) return;

  // Populate selects once
  if (!langSel.options.length) {
    for (const l of SUPPORTED_LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = l.value;
      opt.textContent = l.label;
      langSel.append(opt);
    }
  }

  if (!regionSel.options.length) {
    for (const r of SUPPORTED_REGIONS) {
      const opt = document.createElement("option");
      opt.value = r.value;
      opt.textContent = r.label;
      regionSel.append(opt);
    }
  }

  // Set current values
  langSel.value = userSettings?.language || "en";
  regionSel.value = userSettings?.region || "US";
  weekSel.value = String(userSettings?.week_start ?? -1);

  // Apply lang and dir to document
  document.documentElement.lang = langSel.value;
  document.documentElement.dir = dirFromLocale(`${langSel.value}-${regionSel.value}`);

  const applyAndSave = async () => {
    const patch = {
      language: langSel.value,
      region: regionSel.value,
      week_start: Number(weekSel.value)
    };

    userSettings = await saveUserSettings(currentUser.id, patch);
    document.documentElement.lang = userSettings.language;
    document.documentElement.dir = dirFromLocale(`${userSettings.language}-${userSettings.region}`);

    const locale = `${userSettings.language}-${userSettings.region}`;
    const weekStart = resolveWeekStart(userSettings);

    calendarsUI?.setSettings({ locale, weekStart });
    plannerUI?.setSettings({ locale, weekStart });
  };

  langSel.addEventListener("change", applyAndSave);
  regionSel.addEventListener("change", applyAndSave);
  weekSel.addEventListener("change", applyAndSave);
}

/**
 * Set up Add Profile bottom sheet (iOS-style)
 */
function setupAddProfileCollapse() {
  const toggle = document.getElementById("add-profile-toggle");
  const sheet = document.getElementById("add-profile-sheet");
  const panel = document.getElementById("add-profile-panel");
  const cancel = document.getElementById("add-profile-cancel");
  const backdrop = sheet?.querySelector("[data-close='add-profile-sheet']");

  if (!toggle || !sheet || !panel) return null;

  const open = () => {
    toggle.setAttribute("aria-expanded", "true");
    sheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => sheet.classList.add("is-open"));

    const nameInput =
      panel.querySelector('input[name="name"]') ||
      panel.querySelector("#profile-name") ||
      panel.querySelector("input");
    nameInput?.focus();
  };

  const close = () => {
    toggle.setAttribute("aria-expanded", "false");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    const form = document.getElementById("add-profile-form");
    form?.reset?.();
  };

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    expanded ? close() : open();
  });

  cancel?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return { close, open };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  setupAccountSheet();
  addProfileUI = setupAddProfileCollapse();

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

    // Clear form and close drawer
    const form = document.getElementById('add-profile-form');
    form?.reset?.();
    addProfileUI?.close?.();
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
  if (!profileId) return;
  if (!confirm('Are you sure you want to delete this profile?')) {
    return;
  }

  // Never allow deleting the owner profile
  const target = profiles.find(p => p.id === profileId);
  if (target?.is_owner) {
    showError('The owner profile cannot be deleted.');
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

  // Update signed-in email (in account drawer)
  const emailEl = document.getElementById('signed-in-email');
  if (emailEl) {
    emailEl.textContent = currentUser.email;
  }

  // Init duck carousel once dashboard is visible (so sizing works)
  ensureDuckCarousel();
  if (duckCarousel) duckCarousel.setProfiles(profiles);
}

/**
 * Show owner onboarding modal and wait for completion
 */
function showOwnerOnboarding() {
  return new Promise((resolve) => {
    const modal = document.getElementById('owner-onboarding');
    const inputPhase = document.getElementById('onboarding-input');
    const confirmPhase = document.getElementById('onboarding-confirm');

    const nameInput = document.getElementById('owner-name');
    const birthdateInput = document.getElementById('owner-birthdate');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const backBtn = document.getElementById('onboarding-back-btn');
    const acceptBtn = document.getElementById('onboarding-accept-btn');

    const confirmName = document.getElementById('confirm-name');
    const confirmBirthdate = document.getElementById('confirm-birthdate');

    if (!modal || !inputPhase || !confirmPhase) {
      resolve();
      return;
    }

    // Already closed/resolved guard (safety for edge cases)
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    // Show modal
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    nameInput?.focus();

    // Enable/disable Continue based on input validity
    const validateInputs = () => {
      const valid = nameInput?.value?.trim().length > 0 && birthdateInput?.value?.length > 0;
      if (nextBtn) nextBtn.disabled = !valid;
    };

    const onInput = () => validateInputs();
    nameInput?.addEventListener('input', onInput);
    birthdateInput?.addEventListener('input', onInput);
    birthdateInput?.addEventListener('change', onInput);

    // Phase 1 → Phase 2
    nextBtn?.addEventListener('click', () => {
      const name = nameInput?.value?.trim() ?? '';
      const birthdate = birthdateInput?.value ?? '';
      if (confirmName) confirmName.textContent = name;
      if (confirmBirthdate) {
        // Format birthdate for display (e.g. "1990-05-15" → "May 15, 1990")
        try {
          const d = new Date(birthdate + 'T12:00:00');
          confirmBirthdate.textContent = Number.isNaN(d.getTime()) ? birthdate : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        } catch {
          confirmBirthdate.textContent = birthdate;
        }
      }
      inputPhase.style.display = 'none';
      confirmPhase.style.display = '';
    });

    // Phase 2 → back to Phase 1
    backBtn?.addEventListener('click', () => {
      confirmPhase.style.display = 'none';
      inputPhase.style.display = '';
      nameInput?.focus();
    });

    // Accept & create owner profile
    acceptBtn?.addEventListener('click', async () => {
      if (!currentUser) {
        showError('Session expired. Please sign in again.');
        finish();
        return;
      }

      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Creating…';

      try {
        const client = await getSupabaseClient();
        const displayName = nameInput?.value?.trim() ?? '';
        const birthdate = birthdateInput?.value ?? '';

        if (!displayName || !birthdate) {
          showError('Name and birthdate are required.');
          acceptBtn.disabled = false;
          acceptBtn.textContent = 'Accept & Create Profile';
          return;
        }

        const timezone = Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || 'America/Chicago';

        const { data, error } = await client
          .from('profiles')
          .insert({
            user_id: currentUser.id,
            display_name: displayName,
            birthdate,
            timezone,
            is_owner: true
          })
          .select()
          .single();

        if (error) {
          showError('Failed to create profile: ' + error.message);
          acceptBtn.disabled = false;
          acceptBtn.textContent = 'Accept & Create Profile';
          return;
        }

        // Add owner to front of profiles array
        profiles.unshift(data);
        renderProfiles();

        // Close modal
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';

        showSuccess('Welcome to SineDay! Your Origin Duck is ready.');
        finish();
      } catch (err) {
        console.error('[Onboarding] Error:', err);
        showError('Something went wrong. Please try again.');
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'Accept & Create Profile';
      }
    });
  });
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
