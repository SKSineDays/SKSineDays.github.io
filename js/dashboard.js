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
  getLinkedIdentities,
  linkAppleIdentity,
  signOut,
  onAuthStateChange
} from './supabase-client.js';
import { DuckCarousel } from "./duck-carousel.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "../shared/origin-wave.js";
import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { CalendarsPdfUI } from "./calendars-pdf-ui.js";
import { JournalUI } from "./journal-ui.js";
import { JournalHistoryUI } from "./journal-history-ui.js";
import { calculateSineDayForTimezone, getDayDetails } from "./sineday-engine.js";
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
let manageProfilesUI = null;
let calendarsUI = null;
let journalUI = null;
let journalHistoryUI = null;
let userSettings = null;
let linkedIdentities = [];

let dashboardPageIndex = 0;
let dashboardPageCount = 4;
let dashboardPagerBound = false;
let dashboardPagerResizeObserver = null;
let deferredInstallPrompt = null;
let installPromptAvailable = false;
let subscriptionRenderGen = 0;

/**
 * Initialize dashboard on page load
 */
async function init() {

  // ✅ Always attach UI handlers first
  setupEventListeners();
  bindDailyEmailEvents();
  setupInstallPromptUI();

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

      await loadLinkedIdentities();
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
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;

        loadLinkedIdentities()
          .then(() => renderIdentityLinkUI())
          .catch((err) => console.error('[Auth Identity] Refresh failed:', err));

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
        if (journalUI) {
          journalUI.destroy();
          journalUI = null;
        }
        if (journalHistoryUI) {
          journalHistoryUI.destroy();
          journalHistoryUI = null;
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
 * Ordered: profiles first so journal sections have owner profile when loadSubscription runs.
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

function getPremiumLockCopy(featureKey) {
  const copy = {
    journal: {
      eyebrow: "Today’s Thoughts",
      title: "A private place to remember",
      body: "Write the day in your own words, choose the duck that mirrored it, and keep one memory photo.",
      cta: "Open Premium Journal"
    },
    history: {
      eyebrow: "Remember your days differently",
      title: "Your memories become a map",
      body: "Revisit the actual wave, how each day felt, and the moments you chose to keep.",
      cta: "Open Premium History"
    },
    printables: {
      eyebrow: "From screen to paper",
      title: "Make your journal tangible",
      body: "Choose a daily, weekly, or monthly format and download the finished page as a private PDF.",
      cta: "Open Premium Print"
    }
  };
  return copy[featureKey] || copy.journal;
}

function renderPremiumLock(sectionId, featureKey) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const copy = getPremiumLockCopy(featureKey);

  section.innerHTML = `
    <section class="premium-lock-card" aria-label="${escapeHtml(copy.title)}">
      <div class="premium-lock-card__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7.5 10V7.75a4.5 4.5 0 0 1 9 0V10m-10 0h11a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-7A1.5 1.5 0 0 1 6.5 10Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>
      <p class="premium-lock-card__eyebrow">${escapeHtml(copy.eyebrow)}</p>
      <h3 class="premium-lock-card__title">${escapeHtml(copy.title)}</h3>
      <p class="premium-lock-card__body">${escapeHtml(copy.body)}</p>
      <button class="btn btn-primary btn-sm premium-lock-card__button" type="button" data-premium-upgrade>
        ${escapeHtml(copy.cta)}
      </button>
    </section>
  `;

  section.querySelector("[data-premium-upgrade]")?.addEventListener("click", () => {
    document.getElementById("upgrade-btn")?.click();
  });
}

function setPremiumPreviewVisibility(featureKey, visible) {
  const preview = document.querySelector(`[data-premium-preview="${featureKey}"]`);
  if (!preview) return;
  preview.hidden = !visible;
}

function setDashboardTabLocksVisible(visible) {
  document.querySelectorAll(".dashboard-tab__lock").forEach((lock) => {
    lock.hidden = !visible;
  });
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

function isStandaloneDisplayMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;
}

function renderInstallButton() {
  const btn = document.getElementById('install-app-btn');
  if (!btn) return;

  const shouldShow = installPromptAvailable && !!deferredInstallPrompt && !isStandaloneDisplayMode();
  btn.hidden = !shouldShow;
}

function setupInstallPromptUI() {
  const btn = document.getElementById('install-app-btn');
  if (!btn) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installPromptAvailable = true;
    renderInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installPromptAvailable = false;
    renderInstallButton();
    showSuccess('SineDay installed.');
  });

  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;

    try {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;

      await promptEvent.prompt();
      await promptEvent.userChoice;

      installPromptAvailable = false;
      renderInstallButton();
    } catch (err) {
      console.error('Install prompt failed:', err);
      renderInstallButton();
    }
  });

  renderInstallButton();
}

function getDashboardPages() {
  return Array.from(document.querySelectorAll(".dashboard-page"));
}

function getDashboardPageTabs() {
  return Array.from(document.querySelectorAll(".dashboard-tab"));
}

function clampDashboardPage(index) {
  return Math.max(0, Math.min(index, dashboardPageCount - 1));
}

function prefersReducedDashboardMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function syncActiveDashboardTabVisibility() {
  const tabs = getDashboardPageTabs();
  const activeTab = tabs[dashboardPageIndex];
  const tabsContainer = activeTab?.closest(".dashboard-tabs");

  if (!activeTab || !tabsContainer) return;
  if (tabsContainer.scrollWidth <= tabsContainer.clientWidth) return;

  const containerRect = tabsContainer.getBoundingClientRect();
  const activeRect = activeTab.getBoundingClientRect();
  const isFullyVisible =
    activeRect.left >= containerRect.left &&
    activeRect.right <= containerRect.right;

  if (isFullyVisible) return;

  const delta =
    activeRect.left +
    activeRect.width / 2 -
    (containerRect.left + containerRect.width / 2);

  tabsContainer.scrollBy({
    left: delta,
    behavior: prefersReducedDashboardMotion() ? "auto" : "smooth"
  });
}

function scrollDashboardShellIntoView() {
  const pager = document.querySelector(".dashboard-pager");
  if (!pager) return;

  const navWrap = pager.querySelector(".dashboard-app-nav-wrap");
  const stickyTop = navWrap
    ? Number.parseFloat(window.getComputedStyle(navWrap).top) || 0
    : 0;
  const targetTop = Math.max(
    0,
    window.scrollY + pager.getBoundingClientRect().top - stickyTop
  );

  if (Math.abs(window.scrollY - targetTop) < 1) return;

  window.scrollTo({
    top: targetTop,
    left: window.scrollX,
    behavior: prefersReducedDashboardMotion() ? "auto" : "smooth"
  });
}

function syncDashboardPagerHeight() {
  const viewport = document.querySelector(".dashboard-pager__viewport");
  const pages = getDashboardPages();
  const activePage = pages[dashboardPageIndex];

  if (!viewport || !activePage) return;

  const card = activePage.querySelector(".dashboard-page__card");
  const height = Math.ceil((card || activePage).getBoundingClientRect().height);

  if (height > 0) {
    viewport.style.height = `${height}px`;
  }
}

function updateDashboardPagerUI({ syncActiveTabVisibility = false } = {}) {
  const track = document.getElementById("dashboard-page-track");
  const pages = getDashboardPages();
  const tabs = getDashboardPageTabs();

  if (!track || !pages.length) return;

  dashboardPageCount = pages.length;
  dashboardPageIndex = clampDashboardPage(dashboardPageIndex);

  track.style.transform = `translateX(-${dashboardPageIndex * 100}%)`;

  pages.forEach((page, index) => {
    const isActive = index === dashboardPageIndex;
    page.classList.toggle("is-active", isActive);
    page.setAttribute("aria-hidden", isActive ? "false" : "true");
    page.toggleAttribute("inert", !isActive);
  });

  tabs.forEach((tab, index) => {
    const isActive = index === dashboardPageIndex;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (syncActiveTabVisibility) {
    requestAnimationFrame(() => {
      syncActiveDashboardTabVisibility();
    });
  }

  requestAnimationFrame(() => {
    syncDashboardPagerHeight();
  });
}

function trapFocusWithin(container, event) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setDashboardPage(index) {
  const nextIndex = clampDashboardPage(index);
  const changed = nextIndex !== dashboardPageIndex;
  dashboardPageIndex = nextIndex;
  updateDashboardPagerUI({ syncActiveTabVisibility: changed });

  if (dashboardPageIndex === 3 && calendarsUI?.refreshWhenVisible) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        calendarsUI.refreshWhenVisible().catch((err) => {
          console.error("Failed to refresh printables preview on page activation:", err);
        });
      });
    });
  }

  if (changed) {
    scrollDashboardShellIntoView();
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
      ".journal-feeling-sheet",
      ".journal-feeling-sheet__panel",
      ".journal-history-scroll",
      ".sdcal__viewer",
      ".dashboard-tabs",
      ".dashboard-tab",
      ".duck-ring",
      ".duck-ring__scene",
      ".duck-stack",
    ].join(", ")
  );
}

function bindDashboardPager() {
  if (dashboardPagerBound) return;

  const viewport = document.querySelector(".dashboard-pager__viewport");
  const tabs = getDashboardPageTabs();

  if (!viewport) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const index = Number(tab.dataset.pageTarget || "0");
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
    const modalOpen =
      document.body.classList.contains("modal-open") ||
      document.querySelector("#account-sheet:not([hidden])") ||
      document.querySelector('.add-profile-sheet[aria-hidden="false"]') ||
      document.querySelector('#owner-onboarding[aria-hidden="false"]');

    if (modalOpen) return;

    const target = e.target;
    if (
      e.defaultPrevented ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      (target instanceof Element &&
        target.closest("input, select, textarea, [contenteditable='true'], [role='textbox']"))
    ) {
      return;
    }

    if (e.key === "ArrowLeft") {
      setDashboardPage(dashboardPageIndex - 1);
    } else if (e.key === "ArrowRight") {
      setDashboardPage(dashboardPageIndex + 1);
    }
  });

  if (typeof ResizeObserver !== "undefined") {
    let resizeFrame = null;
    dashboardPagerResizeObserver = new ResizeObserver(() => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        syncDashboardPagerHeight();
      });
    });

    getDashboardPages().forEach((page) => {
      const card = page.querySelector(".dashboard-page__card");
      if (card) dashboardPagerResizeObserver.observe(card);
    });
  }

  window.addEventListener(
    "resize",
    () => {
      syncDashboardPagerHeight();
    },
    { passive: true }
  );

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
    container.innerHTML = `
      <div class="feature-empty-state">
        <p class="feature-empty-state__title">No saved people yet</p>
        <p>Your owner profile will appear here after setup.</p>
      </div>
    `;
  } else {
    container.innerHTML = profiles.map(profile => {
      const originDay = getOriginTypeForDob(profile.birthdate, ORIGIN_ANCHOR_DATE);
      const duckUrl = originDay ? duckUrlFromSinedayNumber(originDay) : "";
      const originLabel = originDay ? `Origin Day ${originDay}` : "Origin unavailable";
      const timezone = profile.timezone || "Local timezone";

      return `
        <div class="profile-item origin-profile-row" data-id="${profile.id}">
          ${duckUrl ? `
            <div class="duck-avatar origin-profile-row__duck">
              <img
                src="${duckUrl}"
                alt="${escapeHtml(profile.display_name)}’s Origin Duck, Day ${originDay}"
                width="44"
                height="44"
                loading="lazy"
              >
            </div>
          ` : ""}
          <div class="profile-info origin-profile-row__identity">
            <strong>${escapeHtml(profile.display_name)}</strong>
            <span class="text-muted">${escapeHtml(originLabel)} · ${escapeHtml(timezone)}</span>
          </div>
          <div class="profile-actions origin-profile-row__actions">
            ${profile.is_owner
              ? `<span class="owner-badge">Owner</span>`
              : `<button class="origin-profile-row__delete delete-profile" type="button" data-id="${profile.id}" aria-label="Delete ${escapeHtml(profile.display_name)}">Delete</button>`
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
  journalUI?.setOwnerProfile?.(getOwnerProfile());
  journalHistoryUI?.setOwnerProfile?.(getOwnerProfile());
  renderTodayWaveSection();

  // Safety remount if journal surfaces were not mounted (e.g. owner created during onboarding)
  if (isPaid()) {
    if (!journalUI && getOwnerProfile()) {
      mountJournalSection().catch(err => {
        console.error("Failed to mount journal after profiles render:", err);
      });
    }
    if (!journalHistoryUI && getOwnerProfile()) {
      mountWaveCalendarSection().catch(err => {
        console.error("Failed to mount journal history after profiles render:", err);
      });
    }
  }

  updateDashboardPagerUI();
}



function getDashboardLocale() {
  return `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
}

function syncJournalRangeLabel() {
  const label = document.querySelector("[data-journal-range]");
  if (!label || !journalUI) return;
  label.textContent = journalUI.getDateLabel(getDashboardLocale());
}

function getTodayYmdForProfile(profile) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function resolveDayImageUrl(imageUrl) {
  if (!imageUrl) return "";
  return imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
}

function clearTodayDayDetailsSection() {
  const section = document.getElementById("today-day-details-section");
  if (!section) return;
  section.innerHTML = "";
  section.hidden = true;
}

function renderTodayDayDetailsSection(result) {
  const section = document.getElementById("today-day-details-section");
  if (!section) return;

  if (!result || result.error) {
    clearTodayDayDetailsSection();
    return;
  }

  const details = getDayDetails(result.day);
  const imageUrl = resolveDayImageUrl(result.imageUrl);
  if (!imageUrl && !details) {
    clearTodayDayDetailsSection();
    return;
  }

  const bulletsHtml = details?.bullets?.length
    ? details.bullets
        .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
        .join("")
    : "";

  section.hidden = true;
  section.innerHTML = `
    <article class="today-wave-details feature-surface">
      ${
        imageUrl
          ? `
        <div class="today-wave-details__media">
          <img
            class="today-wave-details__image"
            src="${escapeHtml(imageUrl)}"
            alt="SineDay ${escapeHtml(String(result.day))} wave artwork"
            loading="lazy"
          >
        </div>
      `
          : ""
      }
      ${
        details
          ? `
        <div class="today-wave-details__copy">
          <p class="feature-hero__eyebrow">A little deeper</p>
          <h3 class="feature-section-heading">Explore today’s wave</h3>
          ${details.paragraph ? `<p class="today-wave-details__paragraph">${escapeHtml(details.paragraph)}</p>` : ""}
          ${bulletsHtml ? `<ul class="today-wave-details__bullets">${bulletsHtml}</ul>` : ""}
        </div>
      `
          : ""
      }
    </article>
  `;
}

function renderTodayWaveSection() {
  const section = document.getElementById("today-wave-section");
  if (!section) return;

  const ownerProfile = getOwnerProfile();
  if (!ownerProfile) {
    section.innerHTML = `
      <div class="feature-empty-state">
        <p class="feature-empty-state__title">Today’s Wave is waiting</p>
        <p>Create your owner profile to begin.</p>
      </div>
    `;
    clearTodayDayDetailsSection();
    return;
  }

  const todayYmd = getTodayYmdForProfile(ownerProfile);
  const result = calculateSineDayForTimezone(ownerProfile.birthdate, ownerProfile.timezone);
  if (!result || result.error) {
    section.innerHTML = `
      <div class="feature-empty-state">
        <p class="feature-empty-state__title">Today’s Wave is still forming</p>
        <p>It could not be calculated yet. Try again in a moment.</p>
      </div>
    `;
    clearTodayDayDetailsSection();
    return;
  }

  const locale = `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
  const date = new Date(`${todayYmd}T12:00:00Z`);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);

  section.innerHTML = `
    <article class="today-wave-hero feature-hero">
      <div class="today-wave-hero__ambient" aria-hidden="true"></div>
      <div class="today-wave-hero__top">
        <div>
          <p class="today-wave-hero__eyebrow feature-hero__eyebrow">Today’s Wave</p>
          <p class="today-wave-hero__date">${escapeHtml(dateLabel)}</p>
        </div>
        <span class="today-wave-hero__day-pill">Day ${escapeHtml(String(result.day))}</span>
      </div>
      <div class="today-wave-hero__main">
        <div class="today-wave-hero__copy">
          <h2 class="today-wave-hero__title feature-hero__title">${escapeHtml(result.phase || "")}</h2>
          <p class="today-wave-hero__description feature-hero__subtitle">${escapeHtml(result.description || "")}</p>
        </div>
        <div class="today-wave-hero__duck">
          <img
            src="/${duckUrlFromSinedayNumber(result.day)}"
            alt="Today’s SineDuck, Day ${escapeHtml(String(result.day))}"
            fetchpriority="high"
          >
        </div>
      </div>
      <div class="today-wave-hero__actions">
          <button id="write-today-journal" class="feature-floating-action" type="button">
            Write today
          </button>
          <button
            id="explore-today-wave"
            class="feature-floating-action feature-floating-action--secondary"
            type="button"
            aria-expanded="false"
            aria-controls="today-day-details-section"
          >
            Explore this wave
          </button>
      </div>
    </article>
  `;

  document.getElementById("write-today-journal")?.addEventListener("click", async () => {
    setDashboardPage(1);
    if (!isPaid()) {
      return;
    }
    if (journalUI) {
      await journalUI.setDate(todayYmd);
      syncJournalRangeLabel();
    } else {
      await mountJournalSection();
      await journalUI?.setDate?.(todayYmd);
      syncJournalRangeLabel();
    }
  });

  renderTodayDayDetailsSection(result);

  document.getElementById("explore-today-wave")?.addEventListener("click", (event) => {
    const detailsSection = document.getElementById("today-day-details-section");
    if (!detailsSection) return;
    const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
    detailsSection.hidden = expanded;
    event.currentTarget.setAttribute("aria-expanded", String(!expanded));
    event.currentTarget.textContent = expanded ? "Explore this wave" : "Close reflection";
    if (!expanded) {
      requestAnimationFrame(() => {
        detailsSection.scrollIntoView({
          behavior: prefersReducedDashboardMotion() ? "auto" : "smooth",
          block: "nearest",
        });
      });
    }
  });
}

/**
 * Mount standalone Journal section (owner-profile anchored)
 */
async function mountJournalSection(expectedSubscriptionGen = null) {
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen
  ) {
    return;
  }
  const section = document.getElementById("journal-section");
  if (!section) return;

  if (journalUI) {
    journalUI.destroy();
    journalUI = null;
  }

  const ownerProfile = getOwnerProfile();
  if (!ownerProfile) {
    section.innerHTML = "";
    return;
  }

  const locale = getDashboardLocale();
  const weekStart = resolveWeekStart(userSettings);
  const client = await getSupabaseClient();
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen
  ) {
    return;
  }

  const frame = document.createElement("div");
  frame.className = "journal-frame is-day-view";
  frame.dataset.view = "journal";

  const mount = document.createElement("div");
  mount.className = "journal-mount";

  frame.append(mount);
  section.innerHTML = "";
  section.append(frame);

  const instance = new JournalUI(mount, {
    locale,
    weekStart,
    ownerProfile,
    supabaseClient: client,
    userId: currentUser.id,
    onEntrySaved: () => {
      journalHistoryUI?.refreshVisibleMonth?.();
    },
  });
  journalUI = instance;

  await instance.render();
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen &&
    journalUI === instance
  ) {
    instance.destroy();
    journalUI = null;
  }
}

/**
 * Mount Journal History section (owner-profile anchored).
 * Function name is kept for compatibility with the existing dashboard page mount flow.
 */
async function mountWaveCalendarSection(expectedSubscriptionGen = null) {
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen
  ) {
    return;
  }
  const section = document.getElementById("wave-calendar-section");
  if (!section) return;

  if (journalHistoryUI) {
    journalHistoryUI.destroy();
    journalHistoryUI = null;
  }

  const ownerProfile = getOwnerProfile();
  if (!ownerProfile) {
    section.innerHTML = "";
    return;
  }

  const locale = getDashboardLocale();
  const weekStart = resolveWeekStart(userSettings);
  const client = await getSupabaseClient();
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen
  ) {
    return;
  }

  const frame = document.createElement("div");
  frame.className = "wcal-frame journal-history-frame";

  const mount = document.createElement("div");
  mount.className = "wcal-mount journal-history-mount";

  frame.append(mount);
  section.innerHTML = "";
  section.append(frame);

  const instance = new JournalHistoryUI(mount, {
    locale,
    weekStart,
    ownerProfile,
    supabaseClient: client,
    userId: currentUser.id,
    onSelectDate: async (dateYmd) => {
      setDashboardPage(1);
      if (journalUI) {
        await journalUI.setDate(dateYmd);
        syncJournalRangeLabel();
      } else {
        await mountJournalSection();
        await journalUI?.setDate?.(dateYmd);
        syncJournalRangeLabel();
      }
    },
  });
  journalHistoryUI = instance;

  await instance.render();
  if (
    expectedSubscriptionGen !== null &&
    expectedSubscriptionGen !== subscriptionRenderGen &&
    journalHistoryUI === instance
  ) {
    instance.destroy();
    journalHistoryUI = null;
  }
}

/**
 * Render subscription status (single source: plan pill + renewal in drawer)
 */
async function renderSubscriptionStatus() {
  const renderGen = ++subscriptionRenderGen;
  const paid = !!isPaid();
  const pill = document.getElementById('plan-pill');
  const renewalEl = document.getElementById('renewal-date');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const billingBtn = document.getElementById('billing-btn');
  const subscriptionMini = document.getElementById('subscription-mini');
  const syncPremiumBtn = document.getElementById('sync-premium-btn');
  const syncPremiumNote = document.getElementById('sync-premium-note');
  const calendarsSection = document.getElementById('calendars-section');

  if (pill) {
    if (paid) {
      pill.className = 'pill pill--ok';
      pill.innerHTML = '<span class="pill-dot"></span>Premium';
    } else {
      pill.className = 'pill pill--neutral';
      pill.innerHTML = 'Free';
    }
  }

  if (paid) {
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
      `;

      const mount = document.getElementById("calendar-app");
      const locale = `${(userSettings?.language || "en")}-${(userSettings?.region || "US")}`;
      const weekStart = resolveWeekStart(userSettings);
      const client = await getSupabaseClient();
      if (renderGen !== subscriptionRenderGen) return;
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

    await mountJournalSection(renderGen);
    if (renderGen !== subscriptionRenderGen) return;
    await mountWaveCalendarSection(renderGen);
    if (renderGen !== subscriptionRenderGen) return;

    setPremiumPreviewVisibility("journal", false);
    setPremiumPreviewVisibility("history", false);
    setPremiumPreviewVisibility("printables", false);
    setDashboardTabLocksVisible(false);
  } else {
    if (renewalEl) renewalEl.textContent = '—';
    if (subscriptionMini) subscriptionMini.style.display = 'none';

    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    if (billingBtn) billingBtn.style.display = 'none';
    if (syncPremiumBtn) syncPremiumBtn.style.display = '';
    if (syncPremiumNote) syncPremiumNote.style.display = '';

    calendarsUI?.destroy?.();
    calendarsUI = null;
    journalUI?.destroy?.();
    journalUI = null;
    journalHistoryUI?.destroy?.();
    journalHistoryUI = null;

    renderPremiumLock("journal-section", "journal");
    renderPremiumLock("wave-calendar-section", "history");
    renderPremiumLock("calendars-section", "printables");

    setPremiumPreviewVisibility("journal", true);
    setPremiumPreviewVisibility("history", true);
    setPremiumPreviewVisibility("printables", true);
    setDashboardTabLocksVisible(true);
  }

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
      toggle.focus();
    }, 220);
  };

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    expanded ? close() : open();
  });

  backdrop.addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (e.key === 'Escape') close();
    trapFocusWithin(sheet, e);
  });
}

async function loadLinkedIdentities() {
  try {
    linkedIdentities = await getLinkedIdentities();
  } catch (err) {
    console.error('[Auth Identity] Failed to load linked identities:', err);
    linkedIdentities = [];
  }
}

function hasLinkedIdentity(provider) {
  return linkedIdentities.some((identity) => identity?.provider === provider);
}

function renderIdentityLinkUI() {
  const appleBtn = document.getElementById('connect-apple-btn');
  const note = document.getElementById('identity-link-note');
  if (!appleBtn || !note) return;

  const appleLinked = hasLinkedIdentity('apple');

  appleBtn.style.display = appleLinked ? 'none' : 'inline-flex';
  appleBtn.disabled = false;
  appleBtn.textContent = 'Connect Apple Login';

  note.textContent = appleLinked
    ? 'Apple sign-in is connected to this SineDay account.'
    : 'Connect Apple so this same SineDay account can be opened with Apple or Google.';
}

async function handleConnectAppleIdentity() {
  const appleBtn = document.getElementById('connect-apple-btn');
  const note = document.getElementById('identity-link-note');

  try {
    if (appleBtn) {
      appleBtn.disabled = true;
      appleBtn.textContent = 'Opening Apple...';
    }

    if (note) {
      note.textContent = 'Apple will open to confirm this login method.';
    }

    await linkAppleIdentity();
    // Browser redirects to Apple.
  } catch (err) {
    console.error('[Auth Identity] Apple link failed:', err);

    if (appleBtn) {
      appleBtn.disabled = false;
      appleBtn.textContent = 'Connect Apple Login';
    }

    if (note) {
      note.textContent = err?.message || 'Apple login could not be connected.';
    }

    showError(err?.message || 'Apple login could not be connected.');
  }
}

function consumeIdentityLinkNotice() {
  let linkedProvider = null;

  try {
    linkedProvider = sessionStorage.getItem('sineday_identity_link_success');
    sessionStorage.removeItem('sineday_identity_link_success');
  } catch (_) {
    linkedProvider = null;
  }

  const params = new URLSearchParams(window.location.search);
  const linkedParam = params.get('linked');

  if (linkedProvider === 'apple' || linkedParam === 'apple') {
    showSuccess('Apple sign-in is now connected to this SineDay account.');

    if (linkedParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
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
    journalUI?.setSettings({ locale, weekStart });
    journalHistoryUI?.setSettings({ locale, weekStart });
    syncJournalRangeLabel();
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
    document.body.classList.add("modal-open");

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
    if (!document.querySelector(".add-profile-sheet.is-open")) {
      document.body.classList.remove("modal-open");
    }
    toggle.focus();
  };

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    expanded ? close() : open();
  });

  cancel?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    trapFocusWithin(panel, e);
  });

  return { close, open };
}

function setupManageProfilesSheet() {
  const toggle = document.getElementById("manage-profiles-toggle");
  const sheet = document.getElementById("manage-profiles-sheet");
  const panel = document.getElementById("manage-profiles-panel");
  const closeButton = document.getElementById("manage-profiles-close");
  const backdrop = sheet?.querySelector("[data-close='manage-profiles-sheet']");

  if (!toggle || !sheet || !panel) return null;

  const open = () => {
    toggle.setAttribute("aria-expanded", "true");
    sheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => sheet.classList.add("is-open"));
    document.body.classList.add("modal-open");
    closeButton?.focus();
  };

  const close = () => {
    toggle.setAttribute("aria-expanded", "false");
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".add-profile-sheet.is-open")) {
      document.body.classList.remove("modal-open");
    }
    toggle.focus();
  };

  toggle.addEventListener("click", () => {
    toggle.getAttribute("aria-expanded") === "true" ? close() : open();
  });
  closeButton?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    trapFocusWithin(panel, event);
  });

  return { close, open };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  setupAccountSheet();
  addProfileUI = setupAddProfileCollapse();
  manageProfilesUI = setupManageProfilesSheet();

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

  const connectAppleBtn = document.getElementById('connect-apple-btn');
  if (connectAppleBtn) {
    connectAppleBtn.addEventListener('click', handleConnectAppleIdentity);
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

  renderTodayWaveSection();

  // Init duck carousel once dashboard is visible (so sizing works)
  ensureDuckCarousel();
  if (duckCarousel) duckCarousel.setProfiles(profiles);

  bindDashboardPager();
  updateDashboardPagerUI();
  renderInstallButton();
  renderIdentityLinkUI();
  consumeIdentityLinkNotice();
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
