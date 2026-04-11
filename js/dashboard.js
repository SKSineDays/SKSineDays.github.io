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
import { WaveCalendarUI } from "./wave-calendar-ui.js";
import { SocialPlannerUI } from "./social-planner-ui.js";
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
let pendingCheckoutSessionId = null;
let hasAttemptedAutoPremiumSync = false;
let dailyEmailState = {
  subscribed: false,
  loading: false
};
let duckCarousel = null;
let addProfileUI = null;
let calendarsUI = null;
let plannerUI = null;
let waveCalendarUI = null;
let socialPlannerUI = null;
let userSettings = null;

let dashboardPageIndex = 0;
let dashboardPageCount = 5;
let dashboardPagerBound = false;

/**
 * Initialize dashboard on page load
 */
async function init() {
  console.log('Initializing dashboard...');

  // ✅ Always attach UI handlers first
  setupEventListeners();
  bindDailyEmailEvents();

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
      await loadDailyEmailState();

      // Gate: require owner profile before showing dashboard
      if (!hasOwnerProfile()) {
        hideLoading();
        await showOwnerOnboarding();
        // After onboarding completes, profiles array is updated
      }

      renderDailyEmailBox();
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
        loadDailyEmailState();
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
        if (waveCalendarUI) {
          waveCalendarUI.destroy();
          waveCalendarUI = null;
        }
        if (socialPlannerUI) {
          socialPlannerUI.destroy();
          socialPlannerUI = null;
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
 * Ordered: profiles first so mountPlannerSection() has owner profile when loadSubscription runs.
 */
async function loadUserData() {
  await loadProfiles();
  await loadSubscription();
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
    renderDailyEmailBox();
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

// ── Daily Email Helpers ──────────────────────────────────────────

function calculateDayOfYear(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function setDailyEmailStatus(message = '', tone = '') {
  const el = document.getElementById('daily-email-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

function renderDailyEmailBox() {
  const box = document.getElementById('daily-email-box');
  const toggle = document.getElementById('daily-email-optin');
  const meta = document.getElementById('daily-email-meta');
  const owner = getOwnerProfile();

  if (!box || !toggle) return;

  if (!owner?.birthdate || !currentUser?.email) {
    box.hidden = true;
    return;
  }

  const originDay = getOriginTypeForDob(owner.birthdate, ORIGIN_ANCHOR_DATE);
  box.hidden = false;
  toggle.setAttribute('aria-pressed', dailyEmailState.subscribed ? 'true' : 'false');
  toggle.disabled = !!dailyEmailState.loading;
  const label = toggle.querySelector('.daily-email-pill__label');
  if (label) label.textContent = dailyEmailState.subscribed ? 'On' : 'Off';

  if (meta) {
    meta.textContent = originDay
      ? `Sends to ${currentUser.email} · Origin Day ${originDay}`
      : `Sends to ${currentUser.email}`;
  }
}

async function loadDailyEmailState() {
  if (!currentUser?.email) return;

  try {
    const accessToken = await getAccessToken();
    const response = await fetch('/api/email-status', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    dailyEmailState.subscribed = !!data.ok && !!data.subscribed;
  } catch (err) {
    console.error('Failed to load daily email state:', err);
    dailyEmailState.subscribed = false;
  }

  renderDailyEmailBox();
}

async function enableDailyEmailFromOwnerProfile() {
  const owner = getOwnerProfile();

  if (!owner?.birthdate || !currentUser?.email) {
    showError('Owner profile is required before enabling daily email.');
    renderDailyEmailBox();
    return;
  }

  const timezone =
    owner.timezone ||
    Intl.DateTimeFormat?.().resolvedOptions?.().timeZone ||
    'America/Chicago';

  const originDay = getOriginTypeForDob(owner.birthdate, ORIGIN_ANCHOR_DATE);
  const birthDayOfYear = calculateDayOfYear(owner.birthdate);

  if (!originDay) {
    showError('Could not determine Origin Day from owner profile.');
    renderDailyEmailBox();
    return;
  }

  dailyEmailState.loading = true;
  renderDailyEmailBox();

  try {
    const accessToken = await getAccessToken();
    const headers = { 'Content-Type': 'application/json' };
    // Bearer: server uses JWT email so the row matches GET /api/email-status.
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch('/api/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: currentUser.email.toLowerCase().trim(),
        consent: true,
        timezone,
        birth_day_of_year: birthDayOfYear,
        origin_day: originDay,
        source: 'dashboard-owner'
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data?.error || 'Failed to enable daily email');
    }

    dailyEmailState.subscribed = true;
    showSuccess(`Daily Duck email enabled for Origin Day ${originDay}.`);
  } catch (err) {
    console.error('Enable daily email failed:', err);
    dailyEmailState.subscribed = false;
    showError(err.message || 'Failed to enable daily email.');
  } finally {
    dailyEmailState.loading = false;
    renderDailyEmailBox();
  }
}

async function disableDailyEmail() {
  if (!currentUser?.email) return;

  dailyEmailState.loading = true;
  renderDailyEmailBox();

  try {
    const accessToken = await getAccessToken();
    const response = await fetch('/api/email-status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to disable');

    dailyEmailState.subscribed = false;
    showSuccess('Daily Duck email disabled.');
  } catch (err) {
    console.error('Disable daily email failed:', err);
    showError(err.message || 'Failed to disable daily email.');
  } finally {
    dailyEmailState.loading = false;
    renderDailyEmailBox();
  }
}

function bindDailyEmailEvents() {
  const toggle = document.getElementById('daily-email-optin');
  if (!toggle) return;

  toggle.addEventListener('click', async () => {
    if (dailyEmailState.loading) return;

    if (dailyEmailState.subscribed) {
      await disableDailyEmail();
      return;
    }

    await enableDailyEmailFromOwnerProfile();
  });
}

async function loadNotificationsBadge() {
  const badge = document.getElementById("notifications-badge");
  const toggle = document.getElementById("notifications-toggle");
  if (!badge || !toggle || !currentUser?.id) return;

  try {
    const client = await getSupabaseClient();
    const { count, error } = await client
      .from("social_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", currentUser.id)
      .eq("is_read", false);

    if (error) throw error;

    const unread = count || 0;
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    toggle.classList.toggle("is-unread", unread > 0);
  } catch (err) {
    console.error("Failed to load notifications badge:", err);
    badge.hidden = true;
    toggle.classList.remove("is-unread");
  }
}

async function fetchNotifications(limit = 20) {
  if (!currentUser?.id) return [];
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("social_notifications")
    .select("id, type, title, body, payload, is_read, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function markNotificationsRead(ids) {
  if (!ids?.length || !currentUser?.id) return;
  const client = await getSupabaseClient();
  const { error } = await client
    .from("social_notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .in("id", ids)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

function closeNotificationsSheet() {
  const toggle = document.getElementById("notifications-toggle");
  const sheet = document.getElementById("notifications-sheet");
  const backdrop = document.getElementById("notifications-backdrop");
  if (!toggle || !sheet || !backdrop) return;

  toggle.setAttribute("aria-expanded", "false");
  sheet.classList.remove("is-open");
  backdrop.classList.remove("is-open");

  setTimeout(() => {
    sheet.hidden = true;
    backdrop.hidden = true;
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }, 220);
}

function renderNotificationsList(items) {
  const list = document.getElementById("notifications-list");
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<p class="text-muted">No notifications yet.</p>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const payload = item.payload || {};
    const created = item.created_at
      ? new Date(item.created_at).toLocaleString()
      : "";
    const isFriendRequest = item.type === "friend_request" && payload.request_id;

    return `
      <article class="notification-item ${item.is_read ? "" : "is-unread"}" data-id="${item.id}">
        <div class="notification-item__body">
          <div class="notification-item__title">${escapeHtml(item.title || "Notification")}</div>
          ${item.body ? `<p class="notification-item__copy">${escapeHtml(item.body)}</p>` : ""}
          <div class="notification-item__meta">${escapeHtml(created)}</div>
        </div>

        <div class="notification-item__actions">
          ${isFriendRequest ? `
            <button
              class="btn btn-primary btn-sm"
              type="button"
              data-notification-action="accept-request"
              data-request-id="${escapeHtml(String(payload.request_id))}"
            >
              Accept
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              data-notification-action="decline-request"
              data-request-id="${escapeHtml(String(payload.request_id))}"
            >
              Decline
            </button>
          ` : ""}

          ${payload.target_date ? `
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              data-notification-action="open-social"
              data-target-date="${escapeHtml(String(payload.target_date))}"
              data-planner-id="${escapeHtml(String(payload.planner_id || ""))}"
            >
              Open
            </button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

async function respondToFriendRequest(requestId, decision) {
  const accessToken = await getAccessToken();
  const response = await fetch("/api/social/respond-friend-request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ requestId, decision })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.error || "Failed to respond to request");
  }
  return data;
}

async function openNotificationsSheet() {
  const toggle = document.getElementById("notifications-toggle");
  const sheet = document.getElementById("notifications-sheet");
  const backdrop = document.getElementById("notifications-backdrop");
  if (!toggle || !sheet || !backdrop || !currentUser?.id) return;

  try {
    const items = await fetchNotifications(20);
    renderNotificationsList(items);

    toggle.setAttribute("aria-expanded", "true");
    sheet.hidden = false;
    backdrop.hidden = false;

    requestAnimationFrame(() => {
      sheet.classList.add("is-open");
      backdrop.classList.add("is-open");
    });

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const unreadIds = items.filter((item) => !item.is_read).map((item) => item.id);
    if (unreadIds.length) {
      await markNotificationsRead(unreadIds);
      await loadNotificationsBadge();
    }
  } catch (err) {
    console.error("Failed to open notifications sheet:", err);
    showError(err.message || "Failed to load notifications.");
  }
}

function setupNotificationsSheet() {
  const toggle = document.getElementById("notifications-toggle");
  const backdrop = document.getElementById("notifications-backdrop");
  const sheet = document.getElementById("notifications-sheet");
  const markAll = document.getElementById("notifications-mark-all");

  if (!toggle || !backdrop || !sheet) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    if (expanded) {
      closeNotificationsSheet();
    } else {
      openNotificationsSheet();
    }
  });

  backdrop.addEventListener("click", closeNotificationsSheet);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      closeNotificationsSheet();
    }
  });

  markAll?.addEventListener("click", async () => {
    try {
      const items = await fetchNotifications(50);
      const unreadIds = items.filter((item) => !item.is_read).map((item) => item.id);
      if (unreadIds.length) {
        await markNotificationsRead(unreadIds);
      }
      renderNotificationsList(items.map((item) => ({ ...item, is_read: true })));
      await loadNotificationsBadge();
    } catch (err) {
      console.error("Failed to mark notifications read:", err);
      showError("Failed to mark notifications read.");
    }
  });

  sheet.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-notification-action]");
    if (!btn) return;

    const action = btn.dataset.notificationAction;

    try {
      if (action === "accept-request" || action === "decline-request") {
        const requestId = btn.dataset.requestId;
        await respondToFriendRequest(
          requestId,
          action === "accept-request" ? "accepted" : "declined"
        );
        showSuccess(action === "accept-request" ? "Friend request accepted." : "Friend request declined.");
        await loadNotificationsBadge();
        await openNotificationsSheet();
        await mountSocialPlannerSection();
        return;
      }

      if (action === "open-social") {
        const targetDate = btn.dataset.targetDate;
        const plannerId = btn.dataset.plannerId || null;
        closeNotificationsSheet();
        setDashboardPage(4);

        if (!isPaid()) {
          showInfo(
            "Social Planner is a Premium feature. Notifications still work here, but hosting and viewing the shared calendar require Premium."
          );
          return;
        }

        await mountSocialPlannerSection();
        await socialPlannerUI?.openDaySheet?.(targetDate, plannerId || undefined);
      }
    } catch (err) {
      console.error("Notification action failed:", err);
      showError(err.message || "Notification action failed.");
    }
  });
}

function getDashboardPages() {
  return Array.from(document.querySelectorAll(".dashboard-page"));
}

function getDashboardPageDots() {
  return Array.from(document.querySelectorAll(".dashboard-page-nav__dot"));
}

function clampDashboardPage(index) {
  return Math.max(0, Math.min(index, dashboardPageCount - 1));
}

function updateDashboardPagerUI() {
  const track = document.getElementById("dashboard-page-track");
  const prev = document.getElementById("dashboard-page-prev");
  const next = document.getElementById("dashboard-page-next");
  const pages = getDashboardPages();
  const dots = getDashboardPageDots();

  if (!track || !pages.length) return;

  dashboardPageCount = pages.length;
  dashboardPageIndex = clampDashboardPage(dashboardPageIndex);

  track.style.transform = `translateX(-${dashboardPageIndex * 100}%)`;

  pages.forEach((page, index) => {
    const isActive = index === dashboardPageIndex;
    page.classList.toggle("is-active", isActive);
    page.setAttribute("aria-hidden", isActive ? "false" : "true");
  });

  dots.forEach((dot, index) => {
    const isActive = index === dashboardPageIndex;
    dot.classList.toggle("is-active", isActive);
    dot.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (prev) prev.disabled = dashboardPageIndex === 0;
  if (next) next.disabled = dashboardPageIndex === dashboardPageCount - 1;
}

function setDashboardPage(index) {
  const nextIndex = clampDashboardPage(index);
  const changed = nextIndex !== dashboardPageIndex;
  dashboardPageIndex = nextIndex;
  updateDashboardPagerUI();

  if (changed) {
    const activeCard = document.querySelector(".dashboard-page.is-active .dashboard-page__card");
    activeCard?.scrollIntoView({ block: "start", behavior: "auto" });
  }
}

function shouldIgnoreDashboardSwipeStart(target) {
  if (!(target instanceof Element)) return false;

  return !!target.closest(
    [
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "summary",
      "details",
      "label",
      ".sheet",
      ".sheet-backdrop",
      ".add-profile-sheet",
      ".planner-frame__header",
      ".planner-frame__nav",
      ".planner-frame__view-toggle",
      ".wcal-frame__header",
      ".social-frame__header",
      ".social-frame__actions",
      ".social-frame__nav",
      ".social-day-sheet",
      ".social-friends-sheet",
      ".social-add-sheet",
      ".notifications-sheet",
      ".duck-ring",
      ".duck-ring__scene",
      ".duck-stack",
    ].join(", ")
  );
}

function bindDashboardPager() {
  if (dashboardPagerBound) return;

  const viewport = document.querySelector(".dashboard-pager__viewport");
  const prev = document.getElementById("dashboard-page-prev");
  const next = document.getElementById("dashboard-page-next");
  const dots = getDashboardPageDots();

  if (!viewport) return;

  prev?.addEventListener("click", () => setDashboardPage(dashboardPageIndex - 1));
  next?.addEventListener("click", () => setDashboardPage(dashboardPageIndex + 1));

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const index = Number(dot.dataset.pageTarget || "0");
      setDashboardPage(index);
    });
  });

  let startX = 0;
  let startY = 0;
  let tracking = false;

  viewport.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches?.[0];
      if (!touch) return;

      const pointerTarget = e.target;
      if (shouldIgnoreDashboardSwipeStart(pointerTarget)) {
        tracking = false;
        return;
      }

      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    },
    { passive: true }
  );

  viewport.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;

      const touch = e.changedTouches?.[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) < 50) return;
      if (Math.abs(dx) <= Math.abs(dy)) return;

      if (dx < 0) {
        setDashboardPage(dashboardPageIndex + 1);
      } else {
        setDashboardPage(dashboardPageIndex - 1);
      }
    },
    { passive: true }
  );

  window.addEventListener("keydown", (e) => {
    const accountSheet = document.getElementById("account-sheet");
    const addProfileSheet = document.getElementById("add-profile-sheet");
    const onboarding = document.getElementById("owner-onboarding");

    const accountOpen = accountSheet && !accountSheet.hidden;
    const notifToggle = document.getElementById("notifications-toggle");
    const notificationsOpen =
      notifToggle?.getAttribute("aria-expanded") === "true";
    const addProfileOpen =
      addProfileSheet && addProfileSheet.getAttribute("aria-hidden") === "false";
    const onboardingOpen =
      onboarding && onboarding.getAttribute("aria-hidden") === "false";

    if (accountOpen || notificationsOpen || addProfileOpen || onboardingOpen) return;

    if (e.key === "ArrowLeft") {
      setDashboardPage(dashboardPageIndex - 1);
    } else if (e.key === "ArrowRight") {
      setDashboardPage(dashboardPageIndex + 1);
    }
  });

  dashboardPagerBound = true;
  updateDashboardPagerUI();
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
  waveCalendarUI?.setOwnerProfile?.(getOwnerProfile());
  socialPlannerUI?.setOwnerProfile?.(getOwnerProfile());

  // Safety remount if planner wasn't mounted (e.g. owner created during onboarding)
  if (isPaid() && !plannerUI && getOwnerProfile()) {
    mountPlannerSection().catch(err => {
      console.error("Failed to mount planner after profiles render:", err);
    });
  }
  if (isPaid() && !waveCalendarUI && getOwnerProfile()) {
    mountWaveCalendarSection().catch(err => {
      console.error("Failed to mount wave calendar after profiles render:", err);
    });
  }

  if (isPaid() && getOwnerProfile() && !socialPlannerUI) {
    mountSocialPlannerSection().catch(err => {
      console.error("Failed to mount social planner after profiles render:", err);
    });
  }

  updateDashboardPagerUI();
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

    frame.classList.toggle("is-week-view", isWeek);
    frame.classList.toggle("is-day-view", !isWeek);
    frame.dataset.view = view;
  }

  syncViewToggle(plannerUI.view);
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
 * Mount standalone Wave Calendar section (owner-only, premium-gated)
 */
async function mountWaveCalendarSection() {
  const section = document.getElementById("wave-calendar-section");
  if (!section) return;

  if (waveCalendarUI) {
    waveCalendarUI.destroy();
    waveCalendarUI = null;
  }

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

  const frame = document.createElement("div");
  frame.className = "wcal-frame";

  const header = document.createElement("div");
  header.className = "wcal-frame__header";

  const titleRow = document.createElement("div");
  titleRow.className = "wcal-frame__title-row";

  const title = document.createElement("div");
  title.className = "wcal-frame__title";
  title.textContent = "Wave Calendar";

  const gearBtn = document.createElement("button");
  gearBtn.className = "wcal-frame__gear";
  gearBtn.type = "button";
  gearBtn.textContent = "⚙";
  gearBtn.setAttribute("aria-label", "Customize tag colors");
  gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    waveCalendarUI.openPaletteConfig(gearBtn);
  });

  titleRow.append(title, gearBtn);

  const nav = document.createElement("div");
  nav.className = "planner-frame__nav";

  const btnPrev = document.createElement("button");
  btnPrev.className = "planner-frame__navbtn";
  btnPrev.type = "button";
  btnPrev.textContent = "←";
  btnPrev.setAttribute("aria-label", "Previous month");

  const rangeLabel = document.createElement("div");
  rangeLabel.className = "planner-frame__range";

  const btnNext = document.createElement("button");
  btnNext.className = "planner-frame__navbtn";
  btnNext.type = "button";
  btnNext.textContent = "→";
  btnNext.setAttribute("aria-label", "Next month");

  nav.append(btnPrev, rangeLabel, btnNext);
  header.append(titleRow, nav);

  const mount = document.createElement("div");
  mount.className = "wcal-mount";

  frame.append(header, mount);

  section.innerHTML = "";
  section.append(frame);

  waveCalendarUI = new WaveCalendarUI(mount, {
    locale,
    weekStart,
    ownerProfile,
    supabaseClient: client,
    userId: currentUser.id,
  });

  await waveCalendarUI.render();

  rangeLabel.textContent = waveCalendarUI.getMonthLabel();

  btnPrev.addEventListener("click", () => {
    waveCalendarUI.navigateMonth(-1);
    rangeLabel.textContent = waveCalendarUI.getMonthLabel();
  });

  btnNext.addEventListener("click", () => {
    waveCalendarUI.navigateMonth(1);
    rangeLabel.textContent = waveCalendarUI.getMonthLabel();
  });
}

async function mountSocialPlannerSection() {
  const section = document.getElementById("social-planner-section");
  if (!section || !currentUser?.id) return;

  if (socialPlannerUI) {
    socialPlannerUI.destroy();
    socialPlannerUI = null;
  }

  if (!isPaid()) {
    section.innerHTML = `
      <div class="locked-section">
        <p>🔒 Premium Feature Locked</p>
        <p class="text-muted">Upgrade to Premium to unlock the Social Planner, shared month view, friend list, and hosted collaboration tools. Notifications can still alert you to requests.</p>
      </div>
    `;
    return;
  }

  const locale = `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
  const weekStart = resolveWeekStart(userSettings);
  const client = await getSupabaseClient();

  socialPlannerUI = new SocialPlannerUI(section, {
    locale,
    weekStart,
    ownerProfile: getOwnerProfile(),
    supabaseClient: client,
    userId: currentUser.id,
    canHost: isPaid(),
    getAccessToken,
    onSuccess: showSuccess,
    onError: showError,
    onChange: async () => {
      await loadNotificationsBadge();
    }
  });

  await socialPlannerUI.render();
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
  const syncPremiumBtn = document.getElementById('sync-premium-btn');
  const syncPremiumNote = document.getElementById('sync-premium-note');
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
    if (syncPremiumBtn) syncPremiumBtn.style.display = 'none';
    if (syncPremiumNote) syncPremiumNote.style.display = 'none';

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
    // Mount wave calendar
    await mountWaveCalendarSection();
    await mountSocialPlannerSection();
  } else {
    if (renewalEl) renewalEl.textContent = '—';
    if (subscriptionMini) subscriptionMini.style.display = 'none';

    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    if (billingBtn) billingBtn.style.display = 'none';
    if (syncPremiumBtn) syncPremiumBtn.style.display = '';
    if (syncPremiumNote) syncPremiumNote.style.display = '';

    if (calendarsSection) {
      calendarsSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to access printable monthly calendars and weekly planner pages.</p>
        </div>
      `;
    }

    // Show locked state for planner (free users)
    const plannerSection = document.getElementById("planner-section");
    if (plannerSection) {
      plannerSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to unlock your cloud-synced journal, weekly planner, and recurring task tools.</p>
        </div>
      `;
    }
    if (plannerUI) { plannerUI.destroy(); plannerUI = null; }

    // Show locked state for wave calendar (free users)
    const waveCalSection = document.getElementById("wave-calendar-section");
    if (waveCalSection) {
      waveCalSection.innerHTML = `
        <div class="locked-section">
          <p>🔒 Premium Feature Locked</p>
          <p class="text-muted">Upgrade to Premium to unlock your interactive monthly Wave Calendar and rhythm-based planning view.</p>
        </div>
      `;
    }
    if (waveCalendarUI) { waveCalendarUI.destroy(); waveCalendarUI = null; }

    await mountSocialPlannerSection();
  }

  loadNotificationsBadge().catch((err) => {
    console.error("Failed to refresh notification badge:", err);
  });

  updateDashboardPagerUI();
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
    waveCalendarUI?.setSettings({ locale, weekStart });
    socialPlannerUI?.setSettings({ locale, weekStart });
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
  setupNotificationsSheet();
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

  // Sync Premium button
  const syncPremiumBtn = document.getElementById('sync-premium-btn');
  if (syncPremiumBtn) {
    syncPremiumBtn.addEventListener('click', handleSyncPremium);
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

async function syncPremiumStatus({ silent = false } = {}) {
  const accessToken = await getAccessToken();

  const response = await fetch('/api/sync-subscription-status', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      checkout_session_id: pendingCheckoutSessionId || null
    })
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to sync Premium status');
  }

  await loadSubscription();

  if (isPaid()) {
    pendingCheckoutSessionId = null;
    if (!silent) {
      showSuccess('Premium synced successfully. Your access is now active.');
    }
  } else if (!silent) {
    showInfo('We refreshed your subscription state, but Premium is not active on this account yet.');
  }

  return data;
}

/**
 * Handle Sync Premium button (fallback when webhook is delayed)
 */
async function handleSyncPremium() {
  const syncBtn = document.getElementById('sync-premium-btn');
  const originalText = syncBtn?.textContent || 'Sync Premium';

  try {
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
    }

    await syncPremiumStatus({ silent: false });
  } catch (error) {
    console.error('Sync Premium error:', error);
    showError('Failed to sync Premium: ' + error.message);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = originalText;
    }
  }
}

async function attemptAutoPremiumSyncAfterCheckout() {
  if (hasAttemptedAutoPremiumSync) return;
  if (!pendingCheckoutSessionId) return;
  if (isPaid()) return;

  hasAttemptedAutoPremiumSync = true;

  try {
    await syncPremiumStatus({ silent: true });
  } catch (error) {
    console.warn('Auto premium sync skipped or failed:', error);
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
  const sessionId = params.get('session_id');

  if (sessionId) {
    pendingCheckoutSessionId = sessionId;
  }

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

        if (!isPaid() && checkoutStatus === 'success' && pendingCheckoutSessionId) {
          await attemptAutoPremiumSyncAfterCheckout();
        }

        if (isPaid()) {
          showSuccess('Premium activated! You now have access to all features.');
          pendingCheckoutSessionId = null;
          hasAttemptedAutoPremiumSync = false;
          window.history.replaceState({}, '', '/dashboard.html');
        } else {
          showInfo('Subscription is still processing. If Premium does not appear in a moment, tap Sync Premium in your account drawer.');
        }
      }
    }, 2000);
  } else if (checkoutStatus === 'cancel') {
    showInfo('Checkout cancelled. You can upgrade anytime.');
    pendingCheckoutSessionId = null;
    hasAttemptedAutoPremiumSync = false;
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

  loadNotificationsBadge().catch((err) => {
    console.error("Failed to load notification badge:", err);
  });

  // Init duck carousel once dashboard is visible (so sizing works)
  ensureDuckCarousel();
  if (duckCarousel) duckCarousel.setProfiles(profiles);

  bindDashboardPager();
  updateDashboardPagerUI();
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
        await loadDailyEmailState();
        renderDailyEmailBox();

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
