/**
 * PDF-first Calendars UI — preview and download from server-generated PDFs.
 * Replaces HTML calendar grid with iframe showing the actual PDF.
 */

import { getSineDayCopyrightText } from "../shared/footer-text.js";
import { getOriginTypeForDob } from "../shared/origin-wave.js";
import { duckUrlFromSinedayNumber } from "./sineducks.js";

const MS_PER_DAY = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class CalendarsPdfUI {
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.profiles = opts.profiles || [];

    const now = new Date();
    this.year = now.getFullYear();
    this.monthIndex = now.getMonth();

    this.view = "month";
    this.profileFilter = null;

    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
    this.dayDateUTC = todayUTC;
    this.weekStartDateUTC = startOfWeekUTC(todayUTC, this.weekStart);

    this.currentPdfUrl = null;
    this._previewRequestGen = 0;
    this._activePreviewKey = "";
    this._previewInFlight = false;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;
    this.ownerProfile = opts.ownerProfile || null;
    this._build();
    this.render();
  }

  destroy() {
    this._previewRequestGen++;
    this._previewInFlight = false;
    this.mountEl.innerHTML = "";
    this.currentPdfUrl = null;
  }

  setProfiles(profiles) {
    this.profiles = Array.isArray(profiles) ? profiles : [];
    this._syncProfileSelect();
    this.render();
  }

  setSettings({ locale, weekStart }) {
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    this.weekStartDateUTC = startOfWeekUTC(this.weekStartDateUTC, this.weekStart);
    this.render();
  }

  setSupabaseContext(client, userId) {
    this.supabaseClient = client;
    this.userId = userId;
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
    this.render();
  }

  _build() {
    this.root = el("div", "sdcal");

    const hero = el("header", "print-hero");
    const heroEyebrow = el("p", "feature-hero__eyebrow");
    heroEyebrow.textContent = "From memory to paper";
    const heroTitle = el("h2", "print-hero__title");
    heroTitle.textContent = "Print your journal";
    const heroCopy = el("p", "print-hero__copy");
    heroCopy.textContent = "Choose a shape for the days you want to hold onto.";
    hero.append(heroEyebrow, heroTitle, heroCopy);

    const formatHeading = el("h3", "print-format-heading");
    formatHeading.textContent = "Choose a format";
    const tabs = el("div", "sdcal__tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Journal page format");

    const buildFormatButton = (view, name, purpose) => {
      const button = el("button", `sdcal__tab sdcal__tab--${view}`);
      button.type = "button";
      button.dataset.view = view;
      button.setAttribute("aria-pressed", String(this.view === view));
      button.innerHTML = `
        <span class="sdcal__format-page sdcal__format-page--${view}" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span class="sdcal__format-copy">
          <strong>${name}</strong>
          <small>${purpose}</small>
        </span>
        <span class="sdcal__format-check" aria-hidden="true">✓</span>
      `;
      button.addEventListener("click", () => {
        if (this.view === view) return;
        this.view = view;
        this.render();
      });
      return button;
    };

    this.btnMonth = buildFormatButton("month", "Month", "See the whole wave");
    this.btnWeek = buildFormatButton("week", "Week", "Reflect across a week");
    this.btnDay = buildFormatButton("day", "Day", "One day, one page");
    tabs.append(this.btnMonth, this.btnWeek, this.btnDay);

    this.filterWrap = el("div", "sdcal__filter");
    const filterLabel = el("label", "sdcal__label");
    filterLabel.textContent = "Journal for";
    filterLabel.setAttribute("for", "sdcal-profile-pdf");

    const profileField = el("div", "sdcal__profile-field");
    this.profileAvatar = document.createElement("img");
    this.profileAvatar.className = "sdcal__profile-avatar";
    this.profileAvatar.alt = "";
    this.profileAvatar.setAttribute("aria-hidden", "true");
    this.profileSelect = el("select", "sdcal__select");
    this.profileSelect.id = "sdcal-profile-pdf";
    this.profileSelect.addEventListener("change", () => {
      this.profileFilter = this.profileSelect.value;
      this._syncProfileAvatar();
      this.render();
    });
    profileField.append(this.profileAvatar, this.profileSelect);
    this.filterWrap.append(filterLabel, profileField);

    const nav = el("div", "sdcal__nav");

    this.btnPrev = el("button", "sdcal__navbtn");
    this.btnPrev.type = "button";
    this.btnPrev.innerHTML = '<span aria-hidden="true">‹</span>';
    this.btnPrev.setAttribute("aria-label", "Previous");

    this.btnNext = el("button", "sdcal__navbtn");
    this.btnNext.type = "button";
    this.btnNext.innerHTML = '<span aria-hidden="true">›</span>';
    this.btnNext.setAttribute("aria-label", "Next");

    this.title = el("div", "sdcal__title");

    nav.append(this.btnPrev, this.title, this.btnNext);

    const bar = el("div", "sdcal__bar");
    bar.append(this.filterWrap, nav);

    this.content = el("div", "sdcal__content");
    this.previewStage = el("section", "sdcal__preview-stage");
    this.previewStage.setAttribute("aria-label", "Journal PDF preview");
    const previewHeader = el("div", "sdcal__preview-header");
    const previewHeading = el("div", "");
    const previewEyebrow = el("span", "sdcal__preview-eyebrow");
    previewEyebrow.textContent = "Paper preview";
    this.previewTitle = el("strong", "sdcal__preview-title");
    previewHeading.append(previewEyebrow, this.previewTitle);
    this.openPreviewLink = el("a", "sdcal__open-preview");
    this.openPreviewLink.textContent = "Open preview";
    this.openPreviewLink.target = "_blank";
    this.openPreviewLink.rel = "noopener";
    this.openPreviewLink.hidden = true;
    previewHeader.append(previewHeading, this.openPreviewLink);

    this.btnDownload = el("button", "sdcal__action");
    this.btnDownload.type = "button";
    this.btnDownload.textContent = "Download PDF";
    this.btnDownload.addEventListener("click", () => this.downloadPdf());

    this.viewerWrap = el("div", "sdcal__viewer");
    this.loadingOverlay = el("div", "sdcal__loading");
    this.loadingOverlay.setAttribute("role", "status");
    this.loadingOverlay.setAttribute("aria-live", "polite");
    this.loadingOverlay.setAttribute("aria-atomic", "true");
    this.loadingOverlay.innerHTML = `
      <span class="sdcal__loading-mark" aria-hidden="true"></span>
      <span data-preview-status>Preparing your journal page…</span>
    `;

    this.iframe = document.createElement("iframe");
    this.iframe.className = "sdcal__pdf";
    this.iframe.setAttribute("title", "SineDay journal PDF preview");
    this.viewerWrap.append(this.iframe);

    this.copyrightFooter = el("div", "sineday-copyright-footer");
    this.copyrightFooter.id = "sineday-copyright-footer";
    this.viewerWrap.append(this.copyrightFooter);

    this.previewStage.append(previewHeader, this.viewerWrap, this.loadingOverlay);
    this.content.append(this.previewStage);

    const downloadBar = el("div", "print-download-bar");
    const downloadCopy = el("div", "print-download-bar__copy");
    this.downloadFormat = el("span", "print-download-bar__format");
    this.downloadStatus = el("small", "print-download-bar__status");
    this.downloadStatus.setAttribute("role", "status");
    this.downloadStatus.setAttribute("aria-live", "polite");
    downloadCopy.append(this.downloadFormat, this.downloadStatus);
    downloadBar.append(downloadCopy, this.btnDownload);

    this.root.append(hero, formatHeading, tabs, bar, this.content, downloadBar);

    this.mountEl.innerHTML = "";
    this.mountEl.append(this.root);

    this.btnPrev.addEventListener("click", () => {
      if (this.view === "month") {
        this.monthIndex--;
        if (this.monthIndex < 0) {
          this.monthIndex = 11;
          this.year--;
        }
      } else if (this.view === "week") {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, -7);
      } else if (this.view === "day") {
        this.dayDateUTC = addDaysUTC(this.dayDateUTC, -1);
      }
      this.render();
    });

    this.btnNext.addEventListener("click", () => {
      if (this.view === "month") {
        this.monthIndex++;
        if (this.monthIndex > 11) {
          this.monthIndex = 0;
          this.year++;
        }
      } else if (this.view === "week") {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, 7);
      } else if (this.view === "day") {
        this.dayDateUTC = addDaysUTC(this.dayDateUTC, 1);
      }
      this.render();
    });

    this._syncProfileSelect();
  }

  _syncProfileSelect() {
    const sel = this.profileSelect;
    if (!sel) return;

    const prev = sel.value;
    sel.innerHTML = "";

    for (const p of this.profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.display_name || "Unnamed";
      sel.append(opt);
    }

    const firstId = this.profiles[0]?.id;
    const stillExists = prev && this.profiles.some((p) => p.id === prev);
    sel.value = stillExists ? prev : firstId || "";
    this.profileFilter = sel.value;
    this._syncProfileAvatar();
  }

  _syncProfileAvatar() {
    if (!this.profileAvatar) return;
    const profile = this.profiles.find((item) => item.id === this.profileFilter);
    const originDay = profile?.birthdate ? getOriginTypeForDob(profile.birthdate) : null;
    if (!originDay) {
      this.profileAvatar.removeAttribute("src");
      this.profileAvatar.hidden = true;
      return;
    }
    this.profileAvatar.src = `/${duckUrlFromSinedayNumber(originDay)}`;
    this.profileAvatar.hidden = false;
  }

  _activeProfiles() {
    if (!this.profileFilter) return [];
    return this.profiles.filter((p) => p.id === this.profileFilter);
  }

  _ymdUTC(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  _getPreviewKey() {
    const active = this._activeProfiles();
    const profileId = active[0]?.id || "";

    if (this.view === "month") {
      return `month:${profileId}:${this.year}:${this.monthIndex}:${this.locale}:${this.weekStart}`;
    }

    if (this.view === "week") {
      return `week:${profileId}:${this._ymdUTC(this.weekStartDateUTC)}:${this.locale}:${this.weekStart}`;
    }

    return `day:${profileId}:${this._ymdUTC(this.dayDateUTC)}:${this.locale}`;
  }

  _isVisibleInPager() {
    const page = this.mountEl?.closest?.(".dashboard-page");
    if (!page) return true;
    return page.classList.contains("is-active");
  }

  async refreshWhenVisible() {
    if (!this._isVisibleInPager()) return;
    await this.refreshPdfPreview();
  }

  _viewLabel() {
    return this.view === "month"
      ? "Monthly journal"
      : this.view === "week"
        ? "Weekly journal"
        : "Daily journal";
  }

  _setPreviewState(state, message = "") {
    this.root.dataset.previewState = state;
    const statusText = this.loadingOverlay?.querySelector("[data-preview-status]");
    const loading =
      state === "loading" ||
      state === "deferred" ||
      state === "error";

    this.loadingOverlay.style.display = loading ? "" : "none";
    this.loadingOverlay.classList.toggle("is-error", state === "error");
    if (statusText) {
      statusText.textContent =
        message ||
        (state === "loading"
          ? "Preparing your journal page…"
          : state === "deferred"
            ? "Open Print to prepare this preview."
            : state === "error"
              ? "Unable to prepare this preview."
              : "");
    }

    if (state === "ready") {
      this.downloadStatus.textContent = "Ready to download";
    } else if (state === "loading") {
      this.downloadStatus.textContent = "Preparing…";
    } else if (state === "error") {
      this.downloadStatus.textContent = "Unable to prepare";
    } else if (state === "empty") {
      this.downloadStatus.textContent = "Add a profile first";
    } else {
      this.downloadStatus.textContent = "Preview waits until opened";
    }
  }

  render() {
    const year =
      this.view === "month"
        ? this.year
        : this.view === "week"
          ? this.weekStartDateUTC.getUTCFullYear()
          : this.dayDateUTC.getUTCFullYear();
    if (this.copyrightFooter) {
      this.copyrightFooter.textContent = getSineDayCopyrightText(year);
    }

    [this.btnMonth, this.btnWeek, this.btnDay].forEach((button) => {
      const active = button.dataset.view === this.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (this.view === "month") {
      const dtf = new Intl.DateTimeFormat(this.locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = dtf.format(
        new Date(Date.UTC(this.year, this.monthIndex, 1, 12))
      );
    } else if (this.view === "week") {
      const end = addDaysUTC(this.weekStartDateUTC, 6);
      const dtf = new Intl.DateTimeFormat(this.locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = `${dtf.format(this.weekStartDateUTC)} – ${dtf.format(end)}`;
    } else {
      const dtf = new Intl.DateTimeFormat(this.locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = dtf.format(this.dayDateUTC);
    }

    const viewLabel = this._viewLabel();
    this.previewTitle.textContent = viewLabel;
    this.downloadFormat.textContent = viewLabel;
    this.iframe.setAttribute("title", `${viewLabel} PDF preview`);

    this.content.innerHTML = "";
    this.content.append(this.previewStage);

    if (this.profiles.length === 0) {
      const empty = el("div", "feature-empty-state sdcal__empty");
      const emptyTitle = el("p", "feature-empty-state__title");
      emptyTitle.textContent = "Add a profile before creating a journal page";
      const emptyCopy = el("p", "");
      emptyCopy.textContent = "Print uses an Origin profile to shape each page.";
      const addProfile = el("button", "feature-floating-action");
      addProfile.type = "button";
      addProfile.textContent = "Add person";
      const addProfileToggle = document.getElementById("add-profile-toggle");
      addProfile.hidden = !addProfileToggle;
      addProfile.addEventListener("click", () => addProfileToggle?.click());
      empty.append(emptyTitle, emptyCopy, addProfile);
      this.content.append(empty);
      this.previewStage.hidden = true;
      this.currentPdfUrl = null;
      this.btnDownload.disabled = true;
      this.openPreviewLink.hidden = true;
      this._setPreviewState("empty");
      return;
    }
    this.previewStage.hidden = false;

    if (!this._isVisibleInPager()) {
      this.iframe.src = "";
      this.currentPdfUrl = null;
      this.btnDownload.disabled = true;
      this.openPreviewLink.hidden = true;
      this._setPreviewState("deferred");
      return;
    }

    this.refreshPdfPreview();
  }

  async refreshPdfPreview() {
    const requestGen = ++this._previewRequestGen;
    const previewKey = this._getPreviewKey();

    this._previewInFlight = true;
    this._setPreviewState("loading");
    this.iframe.src = "";
    this.currentPdfUrl = null;
    this.btnDownload.disabled = true;
    this.openPreviewLink.hidden = true;
    this._activePreviewKey = previewKey;

    try {
      let client = this.supabaseClient;
      if (!client) {
        const { getSupabaseClient } = await import("./supabase-client.js");
        client = await getSupabaseClient();
      }

      const {
        data: { session }
      } = await client.auth.getSession();

      const token = session?.access_token;
      if (!token) throw new Error("Not logged in");

      const active = this._activeProfiles();
      const profileId = active[0]?.id;
      if (!profileId) throw new Error("No profile selected");

      const endpoint =
        this.view === "month"
          ? "/api/print-monthly"
          : this.view === "week"
            ? "/api/print-weekly"
            : "/api/print-daily";

      const payload =
        this.view === "month"
          ? {
              year: this.year,
              month: this.monthIndex + 1,
              profileId,
              locale: this.locale,
              weekStart: this.weekStart
            }
          : this.view === "week"
            ? {
                profileId,
                locale: this.locale,
                weekStart: this.weekStart,
                anchorYmd: this._ymdUTC(this.weekStartDateUTC)
              }
            : {
                profileId,
                locale: this.locale,
                dateYmd: this._ymdUTC(this.dayDateUTC)
              };

      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed to generate PDF");

      if (requestGen !== this._previewRequestGen) return;
      if (previewKey !== this._activePreviewKey) return;

      this.currentPdfUrl = j.url;

      const iframeUrl = new URL(j.url, window.location.origin);
      iframeUrl.searchParams.set("_preview", String(Date.now()));

      this.iframe.src = iframeUrl.toString();
      this.btnDownload.disabled = false;
      this.openPreviewLink.href = j.url;
      this.openPreviewLink.hidden = false;
      this._setPreviewState("ready");
    } catch (e) {
      if (requestGen !== this._previewRequestGen) return;
      this.currentPdfUrl = null;
      this.btnDownload.disabled = true;
      this.openPreviewLink.hidden = true;
      this._setPreviewState(
        "error",
        e?.message ? `Unable to prepare: ${e.message}` : "Unable to prepare this preview."
      );
    } finally {
      if (requestGen === this._previewRequestGen) {
        this._previewInFlight = false;
      }
    }
  }

  downloadPdf() {
    if (this._previewInFlight) return;
    const previewKey = this._getPreviewKey();

    if (this.currentPdfUrl && this._activePreviewKey === previewKey) {
      window.location.href = this.currentPdfUrl;
      return;
    }

    this.refreshPdfPreview().then(() => {
      if (this.currentPdfUrl && this._activePreviewKey === this._getPreviewKey()) {
        window.location.href = this.currentPdfUrl;
      }
    });
  }
}
