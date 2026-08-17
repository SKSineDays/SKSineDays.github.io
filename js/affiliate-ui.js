const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const PENDING_CODE_KEY = "sineday_pending_affiliate_code";
const PENDING_CODE_SAVED_AT_KEY = "sineday_pending_affiliate_code_saved_at";
const PENDING_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hidden && element.offsetParent !== null);
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
      if (currentTab && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const tabs = [
          ...this.sheet.querySelectorAll("[data-affiliate-tab]"),
        ];
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const index = tabs.indexOf(currentTab);
        const next = tabs[(index + direction + tabs.length) % tabs.length];
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
    if (this.isOpen()) return;
    this.toggle.setAttribute("aria-expanded", "true");
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
    await this.refresh();
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen()) return;
    this.toggle.setAttribute("aria-expanded", "false");
    this.sheet.classList.remove("is-open");
    this.backdrop.classList.remove("is-open");
    if (this.openFrame) cancelAnimationFrame(this.openFrame);
    clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.isOpen()) return;
      this.sheet.hidden = true;
      this.backdrop.hidden = true;
      document.documentElement.style.overflow = this.previousOverflow.html;
      document.body.style.overflow = this.previousOverflow.body;
      this.inertElements.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      this.inertElements = [];
      if (restoreFocus) this.toggle.focus();
      this.onClose?.();
    }, 220);
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
    params.delete("affiliate");
    const query = params.toString();
    const nextUrl =
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  async loadStatus() {
    this.status = await this.request("/api/affiliate/status");
    if (
      this.status.affiliate?.status &&
      this.status.affiliate.status !== this.entitlement?.affiliateStatus
    ) {
      await this.onEntitlementChanged?.();
    }
    if (this.status.affiliate?.status === "active") {
      const [summary, assets] = await Promise.all([
        this.request("/api/affiliate/summary"),
        fetch("/assets/affiliate/assets.json", {
          cache: "no-store",
          signal: this.abortController.signal,
        })
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []),
      ]);
      this.summary = summary;
      this.assets = Array.isArray(assets)
        ? assets.filter((asset) =>
            /^\/assets\/affiliate\/[A-Za-z0-9._-]+$/.test(asset?.path || ""),
          )
        : [];
    } else {
      this.summary = null;
    }
  }

  async refreshStatus() {
    try {
      await this.request("/api/affiliate/refresh-status", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await this.loadStatus();
      this.render();
      this.showSuccess?.("Stripe setup status refreshed.");
    } catch (error) {
      this.showError?.(
        error?.message || "Unable to refresh Stripe setup status.",
      );
    }
  }

  async refresh() {
    if (this.loading) return;
    const generation = ++this.requestGeneration;
    this.loading = true;
    this.mount.setAttribute("aria-busy", "true");
    if (!this.status) this.renderLoading();
    try {
      await this.loadStatus();
      if (this.destroyed || generation !== this.requestGeneration) return;
      if (!this.destroyed && generation === this.requestGeneration) this.render();
    } catch (error) {
      if (error?.name !== "AbortError" && !this.destroyed) {
        this.renderError(error.message);
      }
    } finally {
      this.loading = false;
      this.mount.removeAttribute("aria-busy");
    }
  }

  setEntitlement(entitlement) {
    this.entitlement = entitlement;
    if (this.status) this.render();
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
        <p class="affiliate-sheet__eyebrow">SineDay Affiliate</p>
        <h2>${escapeHtml(affiliate.displayName)}</h2>
        <p class="affiliate-code">Your code: <strong>${escapeHtml(affiliate.code)}</strong></p>
        <p class="affiliate-link">${escapeHtml(affiliate.affiliateUrl)}</p>
        <div class="affiliate-sheet__actions">
          <button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(affiliate.code)}">Copy Code</button>
          <button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(affiliate.affiliateUrl)}">Copy Link</button>
          <button class="btn btn-primary btn-sm" type="button" data-affiliate-action="share">Share</button>
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
              >${tab[0].toUpperCase()}${tab.slice(1)}</button>
            `,
          )
          .join("")}
      </div>
      <div id="affiliate-panel-overview" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-overview" ${this.activeTab === "overview" ? "" : "hidden"}>${this.renderOverview()}</div>
      <div id="affiliate-panel-share" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-share" ${this.activeTab === "share" ? "" : "hidden"}>${this.renderShare(affiliate)}</div>
      <div id="affiliate-panel-payouts" class="affiliate-sheet__tab-content" role="tabpanel" aria-labelledby="affiliate-tab-payouts" ${this.activeTab === "payouts" ? "" : "hidden"}>${this.renderPayouts(affiliate)}</div>
      <p class="affiliate-copy-status" role="status" aria-live="polite"></p>
    `;
  }

  renderOverview() {
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
      <p class="affiliate-dashboard-note">Every active membership represents someone choosing to remember their days differently.</p>
      <section>
        <h3>Monthly activity</h3>
        <div class="affiliate-chart" aria-label="Affiliate earnings over the last 12 months">
          ${monthly
            .map((row) => {
              const height = Math.max(4, Math.round((row.earnedCents / max) * 100));
              const label = new Date(`${row.month}-01T00:00:00Z`).toLocaleDateString(
                undefined,
                { month: "short", timeZone: "UTC" },
              );
              return `
                <div class="affiliate-chart__month">
                  <span class="sr-only">${escapeHtml(row.month)}: ${escapeHtml(formatMoney(row.earnedCents))}, ${row.supporterCount} supporters</span>
                  <span class="affiliate-chart__bar" style="--affiliate-bar-height:${height}%" aria-hidden="true"></span>
                  <span aria-hidden="true">${escapeHtml(label)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  renderShare(affiliate) {
    const shortMessage = `Use my SineDay Affiliate Code ${affiliate.code} at checkout to save $1 each month on Premium.`;
    const disclosure =
      "Disclosure: I may earn from qualifying SineDay Premium memberships connected to my link or code.";
    return `
      <section class="affiliate-share-card">
        <h3>Share the wave</h3>
        <label>Approved short message</label>
        <p>${escapeHtml(shortMessage)}</p>
        <button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(shortMessage)}">Copy message</button>
        <label>Approved disclosure</label>
        <p>${escapeHtml(disclosure)}</p>
        <button class="btn btn-ghost btn-sm" type="button" data-affiliate-copy="${escapeHtml(disclosure)}">Copy disclosure</button>
      </section>
      <section class="affiliate-assets">
        <h3>Approved SineDay assets</h3>
        <div class="affiliate-assets__grid">
          ${this.assets
            .map(
              (asset) => `
                <a class="affiliate-asset-card" href="${escapeHtml(asset.path)}" download>
                  <img src="${escapeHtml(asset.path)}" alt="${escapeHtml(asset.altText)}">
                  <strong>${escapeHtml(asset.title)}</strong>
                  <span>${escapeHtml(asset.format)} · ${escapeHtml(asset.dimensions)}</span>
                </a>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  renderPayouts(affiliate) {
    const summary = this.summary?.summary || {};
    const payouts = this.summary?.payouts || [];
    return `
      <div class="affiliate-stat-grid">
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
                        <span>${escapeHtml(payout.status)} · ${payout.commissionCount} commissions</span>
                      </div>
                    `,
                  )
                  .join("")
              : "<p>No payouts yet.</p>"
          }
        </div>
      </section>
      <section class="affiliate-payout-status">
        <h3>Payout & tax details</h3>
        <p>Payout account: ${escapeHtml(affiliate.recipientPayoutsStatus)}</p>
        <p>Tax setup: ${escapeHtml(affiliate.taxSetupStatus.replaceAll("_", " "))}</p>
        <button class="btn btn-primary" type="button" data-affiliate-action="${affiliate.payoutsEnabled ? "login" : "onboarding"}">
          ${affiliate.payoutsEnabled ? "Manage payout & tax details" : "Complete payout setup"}
        </button>
        <p class="affiliate-disclosure">Stripe securely manages payout information and available tax documents. SineDay does not store your bank account or tax identification number.</p>
      </section>
    `;
  }

  async handleClick(event) {
    if (event.target.closest("[data-affiliate-close]")) {
      this.close();
      return;
    }
    const tab = event.target.closest("[data-affiliate-tab]")?.dataset.affiliateTab;
    if (tab) {
      this.activeTab = tab;
      this.render();
      this.mount.querySelector(`[data-affiliate-tab="${tab}"]`)?.focus();
      return;
    }

    const copyValue = event.target.closest("[data-affiliate-copy]")?.dataset
      .affiliateCopy;
    if (copyValue) {
      try {
        await navigator.clipboard.writeText(copyValue);
      } catch {
        const input = document.createElement("textarea");
        input.value = copyValue;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      const status = this.mount.querySelector(".affiliate-copy-status");
      if (status) status.textContent = "Copied.";
      this.showSuccess?.("Copied to clipboard.");
      return;
    }

    const action = event.target.closest("[data-affiliate-action]")?.dataset
      .affiliateAction;
    if (!action) return;
    if (action === "refresh") {
      await this.refreshStatus();
    } else if (action === "onboarding") {
      await this.openStripeRoute("/api/affiliate/onboarding-link");
    } else if (action === "login") {
      await this.openStripeRoute("/api/affiliate/login-link");
    } else if (action === "share") {
      await this.shareAffiliate();
    }
  }

  async openStripeRoute(path, body = {}) {
    try {
      const data = await this.request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      window.location.assign(data.url);
    } catch (error) {
      this.showError?.(error.message);
    }
  }

  async shareAffiliate() {
    const affiliate = this.status?.affiliate;
    if (!affiliate) return;
    const text = `Use my SineDay Affiliate Code ${affiliate.code} at checkout to save $1 each month on Premium.`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "SineDay Affiliate",
          text,
          url: affiliate.affiliateUrl,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${affiliate.affiliateUrl}`);
      this.showSuccess?.("Affiliate message copied.");
    } catch {
      this.showError?.("Sharing is unavailable. Copy your Affiliate Link instead.");
    }
  }

  async handleSubmit(event) {
    const formType = event.target.dataset.affiliateForm;
    if (!formType) return;
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
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
        window.location.assign(data.url);
      } else if (formType === "onboarding") {
        const form = new FormData(event.target);
        const data = await this.request("/api/affiliate/onboarding-link", {
          method: "POST",
          body: JSON.stringify({
            country: form.get("country"),
          }),
        });
        window.location.assign(data.url);
      }
    } catch (error) {
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
