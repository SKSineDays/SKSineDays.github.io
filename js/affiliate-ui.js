const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const PENDING_CODE_KEY = "sineday_pending_affiliate_code";
const PENDING_CODE_SAVED_AT_KEY = "sineday_pending_affiliate_code_saved_at";
const PENDING_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const AFFILIATE_DISCLOSURE =
  "Disclosure: I may earn from qualifying SineDay Premium memberships connected to my link or code.";

export function affiliateShareText(affiliate, { includeUrl = true } = {}) {
  return [
    AFFILIATE_DISCLOSURE,
    "Make a little room for your day. SineDay is a guided journal built around an 18-day personal wave.",
    `Use my SineDay Affiliate Code ${affiliate.code} at checkout to save $1 each month on Premium while the promotion remains valid.`,
    includeUrl ? affiliate.affiliateUrl : "",
  ].filter(Boolean).join("\n\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(cents) {
  return MONEY.format(Number(cents || 0) / 100);
}

export function getPendingAffiliateCode() {
  try {
    const savedAt = Number(localStorage.getItem(PENDING_CODE_SAVED_AT_KEY));
    if (!savedAt || Date.now() - savedAt > PENDING_CODE_TTL_MS) {
      localStorage.removeItem(PENDING_CODE_KEY);
      localStorage.removeItem(PENDING_CODE_SAVED_AT_KEY);
      return "";
    }
    const code = localStorage.getItem(PENDING_CODE_KEY) || "";
    return /^[A-Z0-9-]{4,20}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}

export function clearPendingAffiliateCode() {
  try {
    localStorage.removeItem(PENDING_CODE_KEY);
    localStorage.removeItem(PENDING_CODE_SAVED_AT_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }
}

function formatSubmittedDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function hasSocialProfile(form) {
  return ["instagram", "tiktok", "youtube", "website", "otherSocial"]
    .some((name) => String(form.get(name) || "").trim());
}

function payoutCountrySelect(id) {
  return `
    <label for="${id}">Payout country</label>
    <select id="${id}" name="country" required>
      <option value="">Select country</option>
      <option value="US">United States</option>
    </select>
  `;
}

function focusableElements(root) {
  return [
    ...root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.tabIndex >= 0 && !element.hidden && element.offsetParent !== null);
}

export class AffiliateUI {
  constructor({
    mount,
    toggle,
    sheet,
    backdrop,
    getAccessToken,
    entitlement,
    termsVersion,
    onEntitlementChanged,
    onClose,
    showSuccess,
    showError,
  }) {
    this.mount = mount;
    this.toggle = toggle;
    this.sheet = sheet;
    this.backdrop = backdrop;
    this.getAccessToken = getAccessToken;
    this.entitlement = entitlement;
    this.termsVersion = termsVersion;
    this.onEntitlementChanged = onEntitlementChanged;
    this.onClose = onClose;
    this.showSuccess = showSuccess;
    this.showError = showError;
    this.status = null;
    this.summary = null;
    this.assets = [];
    this.assetsError = false;
    this.summaryError = false;
    this.pendingActions = new Set();
    this.activeTab = "overview";
    this.loading = false;
    this.abortController = new AbortController();
    this.previousOverflow = { html: "", body: "" };
    this.inertElements = [];
    this.closeTimer = null;
    this.openFrame = null;
    this.requestGeneration = 0;
    this.destroyed = false;
    this.stripeReturnReconciled = false;
    this.bind();
  }

  bind() {
    const signal = this.abortController.signal;
    this.toggle.addEventListener("click", () => {
      if (this.isOpen()) this.close();
      else this.open();
    }, { signal });
    this.backdrop.addEventListener("click", () => this.close(), { signal });
    this.sheet.addEventListener("keydown", (event) => {
      const currentTab = event.target.closest?.("[data-affiliate-tab]");
      if (currentTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const tabs = [
          ...this.sheet.querySelectorAll("[data-affiliate-tab]"),
        ];
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const index = tabs.indexOf(currentTab);
        const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : tabs[(index + direction + tabs.length) % tabs.length];
        next?.click();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(this.sheet);
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
    }, { signal });
    this.mount.addEventListener("click", (event) => this.handleClick(event), {
      signal,
    });
    this.mount.addEventListener("submit", (event) => this.handleSubmit(event), {
      signal,
    });
    this.sheet.querySelector("[data-affiliate-close]")?.addEventListener(
      "click",
      () => this.close(),
      { signal },
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen()) {
        event.preventDefault();
        this.close();
      }
    }, { signal });
  }

  isOpen() {
    return this.toggle.getAttribute("aria-expanded") === "true";
  }

  async open() {
    if (this.isOpen() || this.destroyed) return;
    clearTimeout(this.closeTimer);
    this.toggle.setAttribute("aria-expanded", "true");
    this.sheet.inert = false;
    this.sheet.hidden = false;
    this.backdrop.hidden = false;
    this.previousOverflow = {
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    this.inertElements = [
      ...this.sheet.parentElement.children,
      ...[...document.body.children].filter(
        (element) => !element.contains(this.sheet),
      ),
    ]
      .filter((element) => element !== this.sheet && element !== this.backdrop)
      .map((element) => ({ element, inert: element.inert }));
    this.inertElements.forEach(({ element }) => {
      element.inert = true;
    });
    this.sheet.querySelector("[data-affiliate-close]")?.focus();
    this.openFrame = requestAnimationFrame(() => {
      this.sheet.classList.add("is-open");
      this.backdrop.classList.add("is-open");
    });
    await this.reconcileStripeReturn();
    if (this.destroyed) return;
    await this.refresh();
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen()) return;
    this.toggle.setAttribute("aria-expanded", "false");
    this.sheet.inert = true;
    this.sheet.classList.remove("is-open");
    this.backdrop.classList.remove("is-open");
    if (this.openFrame) cancelAnimationFrame(this.openFrame);
    clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.isOpen()) return;
      this.sheet.hidden = true;
      this.backdrop.hidden = true;
    }, 220);
    // Restore immediately so reopening during the closing animation starts cleanly.
    document.documentElement.style.overflow = this.previousOverflow.html;
    document.body.style.overflow = this.previousOverflow.body;
    this.inertElements.forEach(({ element, inert }) => { element.inert = inert; });
    this.inertElements = [];
    if (restoreFocus) this.toggle.focus();
    this.onClose?.();
  }

  async request(path, options = {}) {
    const accessToken = await this.getAccessToken();
    if (!accessToken) throw new Error("Your session expired. Please sign in again.");
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: this.abortController.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to complete this request.");
    }
    return data;
  }

  async reconcileStripeReturn() {
    if (this.stripeReturnReconciled) return;
    const params = new URLSearchParams(window.location.search);
    const affiliateReturn = params.get("affiliate");
    if (!["return", "refresh"].includes(affiliateReturn)) {
      return;
    }
    this.stripeReturnReconciled = true;
    try {
      await this.request("/api/affiliate/refresh-status", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Status load will still attempt reconciliation through /api/affiliate/status.
    }
    if (this.destroyed) return;
    params.delete("affiliate");
    const query = params.toString();
    const nextUrl =
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  async loadStatus() {
    const status = await this.request("/api/affiliate/status");
    if (this.destroyed) return;
    this.status = status;
    if (
      this.status.affiliate?.status &&
      this.status.affiliate.status !== this.entitlement?.affiliateStatus
    ) {
      await this.onEntitlementChanged?.();
    }
    if (this.destroyed) return;
    if (this.status.affiliate?.status === "active") {
      const [summary] = await Promise.allSettled([
        this.request("/api/affiliate/summary"),
        this.loadAssets(),
      ]);
      if (this.destroyed) return;
      this.summaryError = summary.status !== "fulfilled";
      this.summary = this.summaryError ? null : summary.value;
    } else {
      this.summary = null;
      this.assets = [];
      this.summaryError = false;
      this.assetsError = false;
    }
  }

  async loadAssets() {
    try {
      const response = await fetch("/assets/affiliate/assets.json", {
        cache: "no-store",
        signal: this.abortController.signal,
      });
      if (!response.ok) throw new Error("Assets unavailable");
      const assets = await response.json();
      if (this.destroyed) return;
      if (!Array.isArray(assets)) throw new Error("Invalid asset list");
      this.assets = assets.filter((asset) =>
        /^\/assets\/affiliate\/[A-Za-z0-9._-]+\.(png|svg|jpg|webp)$/.test(asset?.path || ""),
      );
      this.assetsError = this.assets.length === 0;
    } catch {
      if (this.destroyed) return;
      this.assets = [];
      this.assetsError = true;
    }
  }

  async refreshStatus() {
    try {
      await this.request("/api/affiliate/refresh-status", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (this.destroyed) return;
      await this.loadStatus();
      if (this.destroyed) return;
      this.renderPreservingFocus();
      this.showSuccess?.("Stripe setup status refreshed.");
    } catch (error) {
      if (this.destroyed || error?.name === "AbortError") return;
      this.showError?.(
        error?.message || "Unable to refresh Stripe setup status.",
      );
    }
  }

  async refresh() {
    if (this.loading || this.destroyed) return;
    const generation = ++this.requestGeneration;
    this.loading = true;
    this.mount.setAttribute("aria-busy", "true");
    if (!this.status) this.renderLoading();
    try {
      await this.loadStatus();
      if (this.destroyed || generation !== this.requestGeneration) return;
      this.renderPreservingFocus();
    } catch (error) {
      if (error?.name !== "AbortError" && !this.destroyed) {
        this.renderError(error.message);
      }
    } finally {
      this.loading = false;
      if (!this.destroyed) this.mount.removeAttribute("aria-busy");
    }
  }

  setEntitlement(entitlement) {
    if (this.destroyed) return;
    this.entitlement = entitlement;
    if (this.status) this.renderPreservingFocus();
  }

  renderPreservingFocus() {
    if (this.destroyed) return;
    const hadFocus = this.mount.contains(document.activeElement);
    this.render();
    if (!hadFocus || !this.isOpen()) return;
    const target = this.mount.querySelector('[data-affiliate-tab][aria-selected="true"]') ||
      this.mount.querySelector("h2") || this.sheet.querySelector("[data-affiliate-close]");
    if (target?.tagName === "H2") target.tabIndex = -1;
    target?.focus({ preventScroll: true });
  }

  renderLoading() {
    this.mount.innerHTML = `
      <div class="affiliate-sheet__loading" role="status">
        Loading Affiliate program…
      </div>
    `;
  }

  renderError(message) {
    this.mount.innerHTML = `
      <div class="affiliate-sheet__error" role="alert">
        <p>${escapeHtml(message)}</p>
        <button class="btn btn-ghost btn-sm" type="button" data-affiliate-action="refresh">
          Try again
        </button>
      </div>
    `;
  }

  render() {
    const affiliate = this.status?.affiliate;
    if (affiliate?.status === "active") {
      this.renderActive(affiliate);
      return;
    }
    if (affiliate?.status === "onboarding") {
      this.renderOnboarding(affiliate);
      return;
    }
    if (affiliate?.status === "paused" || affiliate?.status === "closed") {
      this.renderUnavailable(affiliate);
      return;
    }

    const reviewStatus = this.status?.application?.reviewStatus;
    if (reviewStatus === "approved") {
      this.renderApprovedApplicant();
      return;
    }
    if (reviewStatus === "pending") {
      this.renderPendingApplication();
      return;
    }
    if (reviewStatus === "declined") {
      this.renderDeclinedApplication();
      return;
    }
    this.renderAffiliateApplication();
  }

  supportCard() {
    const support = this.status?.support;
    if (support) {
      return `
        <section class="affiliate-support-card">
          <p class="affiliate-sheet__eyebrow">Affiliate support</p>
          <h3>You support ${escapeHtml(support.affiliateDisplayName)}</h3>
          <p>Affiliate Code: <strong>${escapeHtml(support.affiliateCode)}</strong></p>
        </section>
      `;
    }

    if (this.entitlement?.source === "affiliate_gift") {
      return `<section class="affiliate-support-card"><p>Affiliate-gift Premium cannot support another affiliate.</p></section>`;
    }

    if (this.entitlement?.source === "stripe") {
      return `<section class="affiliate-support-card"><p>Affiliate Codes are applied in Stripe Checkout when you upgrade. This membership is not connected to an affiliate.</p></section>`;
    }

    return `
      <section class="affiliate-support-card">
        <p class="affiliate-sheet__eyebrow">Have an Affiliate Code?</p>
        <p>Enter it securely in Stripe Checkout when you upgrade to Premium. Affiliate Codes save you $1 each month while the promotion remains active.</p>
      </section>
    `;
  }

  affiliateSetupForm() {
    const displayName = this.status?.application?.displayName || "";
    return `
      <form class="affiliate-apply-form" data-affiliate-form="apply">
        <label for="affiliate-display-name">Public display name</label>
        <input id="affiliate-display-name" name="displayName" type="text" minlength="2" maxlength="80" value="${escapeHtml(displayName)}" required>
        <label for="affiliate-requested-code">Requested Affiliate Code</label>
        <input id="affiliate-requested-code" name="requestedCode" type="text" minlength="4" maxlength="20" pattern="[A-Za-z0-9-]{4,20}" autocapitalize="characters" required>
        ${payoutCountrySelect("affiliate-payout-country-apply")}
        <label class="affiliate-terms-check">
          <input name="acceptedTerms" type="checkbox" required>
          <span>I accept the <a href="/affiliate-terms.html" target="_blank" rel="noopener">Affiliate Terms</a> and acknowledge the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
        </label>
        <button class="btn btn-primary" type="submit">Start Affiliate Setup</button>
        <p class="affiliate-disclosure">Affiliate earnings are not guaranteed. Program terms apply. Affiliates must clearly disclose their relationship with SineDay when sharing.</p>
      </form>
    `;
  }

  renderAffiliateApplication() {
    const application = this.status?.application;
    const viewerEmail = this.status?.viewerEmail || "";
    this.mount.innerHTML = `
      ${this.supportCard()}
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>Help more people write with their own wave.</h2>
        <p>Share SineDay with your community and help more people notice the wave inside their days. Tell us a little about yourself and where you share your work. Affiliate applications are reviewed before payout setup begins.</p>
      </section>
      <form class="affiliate-application-form" data-affiliate-form="application">
        <label for="affiliate-applicant-name">Name / creator name</label>
        <input id="affiliate-applicant-name" name="displayName" type="text" minlength="2" maxlength="80" autocomplete="name" value="${escapeHtml(application?.displayName || "")}" required>
        <label for="affiliate-applicant-email">Email</label>
        <input id="affiliate-applicant-email" name="email" type="email" value="${escapeHtml(viewerEmail)}" maxlength="254" autocomplete="email" readonly>
        <div class="affiliate-application-form__social">
          <div>
            <label for="affiliate-applicant-instagram">Instagram</label>
            <input id="affiliate-applicant-instagram" name="instagram" type="text" maxlength="300" autocomplete="off" value="${escapeHtml(application?.instagram || "")}">
          </div>
          <div>
            <label for="affiliate-applicant-tiktok">TikTok</label>
            <input id="affiliate-applicant-tiktok" name="tiktok" type="text" maxlength="300" autocomplete="off" value="${escapeHtml(application?.tiktok || "")}">
          </div>
          <div>
            <label for="affiliate-applicant-youtube">YouTube</label>
            <input id="affiliate-applicant-youtube" name="youtube" type="text" maxlength="300" autocomplete="off" value="${escapeHtml(application?.youtube || "")}">
          </div>
          <div>
            <label for="affiliate-applicant-website">Website</label>
            <input id="affiliate-applicant-website" name="website" type="text" maxlength="300" autocomplete="url" value="${escapeHtml(application?.website || "")}">
          </div>
        </div>
        <label for="affiliate-applicant-other">Other social / profile</label>
        <input id="affiliate-applicant-other" name="otherSocial" type="text" maxlength="300" autocomplete="off" value="${escapeHtml(application?.otherSocial || "")}">
        <label for="affiliate-applicant-intro">Tell us about yourself</label>
        <textarea id="affiliate-applicant-intro" name="introduction" minlength="20" maxlength="1000" rows="5" required>${escapeHtml(application?.introduction || "")}</textarea>
        <button class="btn btn-primary" type="submit">Submit Affiliate Application</button>
        <p class="affiliate-disclosure">Applications are reviewed before Affiliate Code and payout setup are unlocked.</p>
      </form>
    `;
  }

  renderPendingApplication() {
    const application = this.status?.application;
    const submitted = formatSubmittedDate(application?.createdAt);
    this.mount.innerHTML = `
      ${this.supportCard()}
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>Application received</h2>
        <p>Thanks for your interest in sharing SineDay.</p>
        <p>Your Affiliate application is being reviewed. If approved, this page will unlock your Affiliate Code and secure payout setup.</p>
      </section>
      <dl class="affiliate-application-summary">
        <div>
          <dt>Name</dt>
          <dd>${escapeHtml(application?.displayName || "")}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>${escapeHtml(application?.email || this.status?.viewerEmail || "")}</dd>
        </div>
        ${submitted ? `
          <div>
            <dt>Submitted</dt>
            <dd>${escapeHtml(submitted)}</dd>
          </div>
        ` : ""}
      </dl>
    `;
  }

  renderApprovedApplicant() {
    this.mount.innerHTML = `
      ${this.supportCard()}
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>You're approved to continue</h2>
        <p>Your SineDay Affiliate application has been approved. You can now create your Affiliate Code and complete secure payout setup.</p>
      </section>
      ${this.affiliateSetupForm()}
    `;
  }

  renderDeclinedApplication() {
    this.mount.innerHTML = `
      ${this.supportCard()}
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>Thanks for your interest in SineDay Affiliate.</h2>
        <p>We aren't opening Affiliate setup for this application right now.</p>
        <p>For questions: <a href="mailto:support@sineday.app">support@sineday.app</a></p>
      </section>
    `;
  }

  renderOnboarding(affiliate) {
    const complete = (value) => (value ? "is-complete" : "");
    this.mount.innerHTML = `
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>Finish setting up your wave</h2>
        <p>Stripe securely collects the identity, payout, and tax details SineDay does not store.</p>
      </section>
      <ol class="affiliate-setup-checklist">
        <li class="is-complete">Affiliate terms accepted</li>
        <li class="is-complete">Affiliate code created: <strong>${escapeHtml(affiliate.code)}</strong></li>
        <li class="${complete(affiliate.detailsSubmitted)}">Identity details complete</li>
        <li class="${complete(affiliate.recipientPayoutsStatus === "active")}">Payout details complete</li>
        <li class="${complete(affiliate.payoutsEnabled)}">Account ready</li>
      </ol>
      <form class="affiliate-onboarding-form" data-affiliate-form="onboarding">
        ${payoutCountrySelect("affiliate-payout-country-onboarding")}
        <div class="affiliate-sheet__actions">
          <button class="btn btn-primary" type="submit">
            Continue Secure Setup
          </button>
          <button class="btn btn-ghost" type="button" data-affiliate-action="refresh">
            Refresh status
          </button>
        </div>
      </form>
      <p class="affiliate-disclosure">Stripe securely manages payout information. SineDay does not store your bank account or tax identification number.</p>
    `;
  }

  renderUnavailable(affiliate) {
    const paused = affiliate.status === "paused";
    this.mount.innerHTML = `
      <section class="affiliate-sheet__hero">
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>${paused ? "Your Affiliate account is paused" : "Your Affiliate account is closed"}</h2>
        <p>${paused ? "New attributions, commissions, and gifted Premium are paused. Financial history remains protected." : "Affiliate controls are no longer active. Valid financial history remains on record."}</p>
      </section>
      <p class="affiliate-disclosure">Contact <a href="mailto:support@sineday.app">support@sineday.app</a> if you need help.</p>
    `;
  }

  renderActive(affiliate) {
    this.mount.innerHTML = `
      <header class="affiliate-active-head">
        <div class="affiliate-active-head__label"><p class="affiliate-sheet__eyebrow">Your affiliate dashboard</p><span class="affiliate-state">Active</span></div>
        <h2>${escapeHtml(affiliate.displayName)}</h2>
        <p>Share SineDay. Give someone a reason to start writing.</p>
        <div class="affiliate-referral">
          <div class="affiliate-referral__code"><p class="affiliate-code">Your code <strong>${escapeHtml(affiliate.code)}</strong></p><button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(affiliate.code)}" data-copy-label="Code">Copy code</button></div>
          <label for="affiliate-referral-link">Your referral link</label>
          <div class="affiliate-referral__link"><input id="affiliate-referral-link" readonly type="text" value="${escapeHtml(affiliate.affiliateUrl)}"><button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(affiliate.affiliateUrl)}" data-copy-label="Link">Copy link</button></div>
        </div>
      </header>
      <div class="affiliate-sheet__tabs" role="tablist" aria-label="Affiliate dashboard sections">
        ${["overview", "share", "payouts"]
          .map(
            (tab) => `
              <button
                class="affiliate-sheet__tab ${this.activeTab === tab ? "is-active" : ""}"
                type="button"
                role="tab"
                id="affiliate-tab-${tab}"
                aria-controls="affiliate-panel-${tab}"
                aria-selected="${this.activeTab === tab}"
                tabindex="${this.activeTab === tab ? "0" : "-1"}"
                data-affiliate-tab="${tab}"
              >${tab === "share" ? "Share kit" : tab[0].toUpperCase() + tab.slice(1)}</button>
            `,
          )
          .join("")}
      </div>
      <div id="affiliate-panel-overview" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-overview" ${this.activeTab === "overview" ? "" : "hidden"}>${this.renderOverview()}</div>
      <div id="affiliate-panel-share" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-share" ${this.activeTab === "share" ? "" : "hidden"}>${this.renderShare(affiliate)}</div>
      <div id="affiliate-panel-payouts" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-payouts" ${this.activeTab === "payouts" ? "" : "hidden"}>${this.renderPayouts(affiliate)}</div>
      <div class="affiliate-manual-copy" hidden>
        <label for="affiliate-manual-copy-text">Copy this text manually</label>
        <textarea id="affiliate-manual-copy-text" readonly rows="5"></textarea>
      </div>
      <p class="affiliate-copy-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <footer class="affiliate-dashboard-footer"><a href="/affiliate-terms.html" target="_blank" rel="noopener">Affiliate terms</a><a href="mailto:support@sineday.app">Get help</a></footer>
    `;
  }

  renderDataError() {
    return `<section class="affiliate-inline-notice" role="status"><h3>Earnings are temporarily unavailable</h3><p>Your sharing tools still work. Try loading your balances again.</p><button class="btn btn-ghost btn-sm" type="button" data-affiliate-action="reload">Reload earnings</button></section>`;
  }

  renderOverview() {
    if (this.summaryError) return this.renderDataError();
    const summary = this.summary?.summary || {};
    const monthly = this.summary?.monthly || [];
    const max = Math.max(100, ...monthly.map((row) => Number(row.earnedCents || 0)));
    return `
      <div class="affiliate-stat-grid">
        ${[
          ["Active supporters", summary.activeSupporters ?? 0],
          ["Estimated this month", formatMoney(summary.estimatedThisMonthCents)],
          ["Available for payout", formatMoney(summary.availableBalanceCents)],
          ["Lifetime paid", formatMoney(summary.lifetimePaidCents)],
        ]
          .map(
            ([label, value]) => `
              <article class="affiliate-stat-card">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
              </article>
            `,
          )
          .join("")}
      </div>
      <section class="affiliate-next-step">
        <div><h3>${summary.activeSupporters ? "Ready to share again?" : "Start with one thoughtful post"}</h3><p>Choose a ready-made image and copy a caption with your link and disclosure included.</p></div>
        <button class="btn btn-primary btn-sm" type="button" data-affiliate-go="share">Open share kit</button>
      </section>
      <p class="affiliate-dashboard-note">Estimates include eligible commissions before adjustments. Commissions have a 30-day hold; payouts are reviewed monthly.</p>
      <section>
        <h3>Monthly activity</h3>
        ${monthly.some((row) => row.earnedCents > 0) ? `<p class="affiliate-dashboard-note">Eligible commissions over the last 12 months. Amounts are in USD.</p><div class="affiliate-chart" aria-label="Affiliate earnings over the last 12 months">
          ${monthly
            .map((row) => {
              const height = Math.max(0, Math.round((row.earnedCents / max) * 100));
              const label = new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString(
                undefined,
                { month: "short", timeZone: "UTC" },
              );
              return `
                <div class="affiliate-chart__month" title="${escapeHtml(row.month)}: ${escapeHtml(formatMoney(row.earnedCents))}">
                  <span class="sr-only">${escapeHtml(row.month)}: ${escapeHtml(formatMoney(row.earnedCents))}, ${escapeHtml(row.supporterCount)} supporters</span>
                  <span class="affiliate-chart__bar" style="--affiliate-bar-height:${height}%" aria-hidden="true"></span>
                  <span aria-hidden="true">${escapeHtml(label)}</span>
                </div>
              `;
            })
            .join("")}
        </div>` : `<p class="affiliate-empty-state">No eligible commissions yet. Your monthly activity will appear here after a qualifying Premium payment, not a click or a free signup.</p>`}
      </section>
    `;
  }

  renderShare(affiliate) {
    const fullPost = affiliateShareText(affiliate);
    return `
      <section class="affiliate-share-card">
        <h3>A post, ready to share</h3>
        <p class="affiliate-dashboard-note">Your code, link, and disclosure are already included. Pair this caption with an image below.</p>
        <label for="affiliate-share-caption">Caption</label>
        <textarea id="affiliate-share-caption" class="affiliate-share-caption" readonly rows="8">${escapeHtml(fullPost)}</textarea>
        <div class="affiliate-sheet__actions">
          <button class="btn btn-primary" type="button" data-affiliate-copy="${escapeHtml(fullPost)}" data-copy-label="Full post">Copy full post</button>
          ${typeof navigator !== "undefined" && navigator.share ? `<button class="btn btn-ghost" type="button" data-affiliate-action="share">Share post</button>` : ""}
        </div>
        <p class="affiliate-disclosure">Keep the disclosure visible with your post. On a story, add it as visible text and use your referral link in the link sticker.</p>
      </section>
      <section class="affiliate-assets">
        <h3>Choose your image</h3>
        <p class="affiliate-dashboard-note">Download the size for your post. Images are ready to use; your personal link and code are in the caption above.</p>
        ${this.assetsError ? `<div class="affiliate-inline-notice" role="status"><p>Images couldn’t load. You can still copy and share your post.</p><button class="btn btn-ghost btn-sm" type="button" data-affiliate-action="reload-assets">Retry images</button></div>` : `
        <div class="affiliate-assets__grid">
          ${this.assets.map((asset) => `
            <article class="affiliate-asset-card">
              <a class="affiliate-asset-card__preview" href="${escapeHtml(asset.path)}" target="_blank" rel="noopener" aria-label="Preview ${escapeHtml(asset.title)} (opens in a new tab)"><img src="${escapeHtml(asset.path)}" alt="${escapeHtml(asset.altText)}" loading="lazy" decoding="async"></a>
              <h4>${escapeHtml(asset.title)}</h4>
              <p>${escapeHtml(asset.usage || "Use with your referral link and a clear disclosure.")}</p>
              <span>${escapeHtml(asset.format)} · ${escapeHtml(asset.dimensions)}</span>
              <a class="btn btn-ghost btn-sm" href="${escapeHtml(asset.path)}" download="${escapeHtml(asset.path.split("/").at(-1))}" aria-label="Download ${escapeHtml(asset.title)}">Download ${escapeHtml(asset.format)}</a>
            </article>`).join("")}
        </div>`}
        <p class="affiliate-disclosure">Use the approved artwork as supplied. Do not stretch the SineDay or SineDuck artwork or promise health benefits, predictions, or guaranteed results.</p>
      </section>
    `;
  }

  renderPayouts(affiliate) {
    const summary = this.summary?.summary || {};
    const payouts = this.summary?.payouts || [];
    return `
      ${this.summaryError ? this.renderDataError() : `<div class="affiliate-stat-grid">
        <article class="affiliate-stat-card"><span>Available balance</span><strong>${escapeHtml(formatMoney(summary.availableBalanceCents))}</strong></article>
        <article class="affiliate-stat-card"><span>Pending 30-day balance</span><strong>${escapeHtml(formatMoney(summary.pendingBalanceCents))}</strong></article>
      </div>
      <section>
        <h3>Payout history</h3>
        <div class="affiliate-payout-list">
          ${
            payouts.length
              ? payouts
                  .map(
                    (payout) => `
                      <div class="affiliate-payout-row">
                        <span>${escapeHtml(payout.month)}</span>
                        <strong>${escapeHtml(formatMoney(payout.amountCents))}</strong>
                        <span>${escapeHtml(payout.status)} · ${escapeHtml(payout.commissionCount)} commissions</span>
                      </div>
                    `,
                  )
                  .join("")
              : "<p class=\"affiliate-empty-state\">No payouts yet. Completed and pending monthly payouts will appear here.</p>"
          }
        </div>
      </section>`}
      <p class="affiliate-dashboard-note">Commissions become eligible after a 30-day hold. Available balances are ordinarily reviewed for a monthly payout, subject to the program terms.</p>
      <section class="affiliate-payout-status">
        <h3>Payout & tax details</h3>
        <p>Payout account: ${escapeHtml(affiliate.recipientPayoutsStatus || "Not available")}</p>
        <p>Tax setup: ${escapeHtml(String(affiliate.taxSetupStatus || "Not available").replaceAll("_", " "))}</p>
        <button class="btn btn-primary" type="button" data-affiliate-action="${affiliate.payoutsEnabled ? "login" : "onboarding"}">
          ${affiliate.payoutsEnabled ? "Manage payout & tax details" : "Complete payout setup"}
        </button>
        <p class="affiliate-disclosure">Stripe securely manages payout information and available tax documents. SineDay does not store your bank account or tax identification number.</p>
      </section>
    `;
  }

  async handleClick(event) {
    if (this.destroyed) return;
    if (event.target.closest("[data-affiliate-close]")) {
      this.close();
      return;
    }
    const tab = event.target.closest("[data-affiliate-tab]")?.dataset.affiliateTab || event.target.closest("[data-affiliate-go]")?.dataset.affiliateGo;
    if (["overview", "share", "payouts"].includes(tab)) {
      this.activeTab = tab;
      this.render();
      this.mount.querySelector(`[data-affiliate-tab="${tab}"]`)?.focus();
      return;
    }

    const copyButton = event.target.closest("[data-affiliate-copy]");
    if (copyButton) {
      if (copyButton.disabled) return;
      const hadFocus = document.activeElement === copyButton;
      copyButton.disabled = true;
      try { await this.copyText(copyButton.dataset.affiliateCopy, copyButton.dataset.copyLabel); }
      finally {
        copyButton.disabled = false;
        this.restoreActionFocus(copyButton, hadFocus);
      }
      return;
    }

    const button = event.target.closest("[data-affiliate-action]");
    const action = button?.dataset.affiliateAction;
    if (!action || this.pendingActions.has(action)) return;
    const hadFocus = document.activeElement === button;
    this.pendingActions.add(action);
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      if (action === "refresh") {
        await this.refreshStatus();
      } else if (action === "reload") {
        await this.refresh();
      } else if (action === "reload-assets") {
        await this.loadAssets();
        if (!this.destroyed) {
          this.renderPreservingFocus();
        }
      } else if (action === "onboarding") {
        await this.openStripeRoute("/api/affiliate/onboarding-link");
      } else if (action === "login") {
        await this.openStripeRoute("/api/affiliate/login-link");
      } else if (action === "share") {
        await this.shareAffiliate();
      }
    } finally {
      this.pendingActions.delete(action);
      button.disabled = false;
      button.removeAttribute("aria-busy");
      this.restoreActionFocus(button, hadFocus);
    }
  }

  restoreActionFocus(button, hadFocus) {
    if (!hadFocus || this.destroyed || !this.isOpen() || document.activeElement !== document.body) return;
    const target = button.isConnected ? button :
      this.mount.querySelector('[data-affiliate-tab][aria-selected="true"], .affiliate-sheet__error button');
    target?.focus({ preventScroll: true });
  }

  async copyText(value, label = "Text") {
    if (this.destroyed || !this.isOpen()) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      if (this.destroyed || !this.isOpen()) return;
      const input = document.createElement("textarea");
      const focused = document.activeElement;
      input.value = value;
      input.setAttribute("aria-label", "Copy text");
      input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      // Keep the fallback inside the active dialog, outside the inert background.
      this.mount.append(input);
      input.select();
      try { copied = document.execCommand("copy") === true; } catch { /* Manual copy below. */ }
      input.remove();
      focused?.focus();
    }
    if (this.destroyed || !this.isOpen()) return;
    const status = this.mount.querySelector(".affiliate-copy-status");
    const fallback = this.mount.querySelector(".affiliate-manual-copy");
    if (fallback) fallback.hidden = copied;
    if (copied) {
      if (status) status.textContent = `${label} copied.`;
      this.showSuccess?.(`${label} copied to clipboard.`);
    } else {
      if (status) status.textContent = "Automatic copying is unavailable. Select and copy the text provided.";
      const input = fallback?.querySelector("textarea");
      if (input) { input.value = value; input.focus(); input.select(); }
    }
  }

  async openStripeRoute(path, body = {}) {
    try {
      const data = await this.request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!this.destroyed) window.location.assign(data.url);
    } catch (error) {
      if (this.destroyed || error?.name === "AbortError") return;
      this.showError?.(error.message);
    }
  }

  async shareAffiliate() {
    const affiliate = this.status?.affiliate;
    if (!affiliate) return;
    const text = affiliateShareText(affiliate, { includeUrl: false });
    if (navigator.share) {
      try {
        await navigator.share({ title: "SineDay", text, url: affiliate.affiliateUrl });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await this.copyText(affiliateShareText(affiliate), "Full post");
  }

  async handleSubmit(event) {
    const formType = event.target.dataset.affiliateForm;
    if (!formType || this.destroyed) return;
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      if (formType === "application") {
        const form = new FormData(event.target);
        if (!hasSocialProfile(form)) {
          throw new Error("Please share at least one social profile or website.");
        }
        await this.request("/api/affiliate/application", {
          method: "POST",
          body: JSON.stringify({
            displayName: form.get("displayName"),
            instagram: form.get("instagram"),
            tiktok: form.get("tiktok"),
            youtube: form.get("youtube"),
            website: form.get("website"),
            otherSocial: form.get("otherSocial"),
            introduction: form.get("introduction"),
          }),
        });
        if (this.destroyed) return;
        this.showSuccess?.("Thanks — your Affiliate application has been received.");
        await this.refresh();
      } else if (formType === "apply") {
        const form = new FormData(event.target);
        const data = await this.request("/api/affiliate/apply", {
          method: "POST",
          body: JSON.stringify({
            displayName: form.get("displayName"),
            requestedCode: form.get("requestedCode"),
            country: form.get("country"),
            acceptedTermsVersion: this.termsVersion,
          }),
        });
        if (!this.destroyed) window.location.assign(data.url);
      } else if (formType === "onboarding") {
        const form = new FormData(event.target);
        const data = await this.request("/api/affiliate/onboarding-link", {
          method: "POST",
          body: JSON.stringify({
            country: form.get("country"),
          }),
        });
        if (!this.destroyed) window.location.assign(data.url);
      }
    } catch (error) {
      if (this.destroyed || error?.name === "AbortError") return;
      this.showError?.(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  destroy() {
    this.destroyed = true;
    this.requestGeneration += 1;
    this.abortController.abort();
    if (this.openFrame) cancelAnimationFrame(this.openFrame);
    clearTimeout(this.closeTimer);
    this.toggle.setAttribute("aria-expanded", "false");
    this.sheet.classList.remove("is-open");
    this.backdrop.classList.remove("is-open");
    this.sheet.hidden = true;
    this.backdrop.hidden = true;
    document.documentElement.style.overflow = this.previousOverflow.html;
    document.body.style.overflow = this.previousOverflow.body;
    this.inertElements.forEach(({ element, inert }) => {
      element.inert = inert;
    });
    this.inertElements = [];
    this.mount.innerHTML = "";
  }
}
