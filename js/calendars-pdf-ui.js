/**
 * PDF-first Calendars UI — preview and download from server-generated PDFs.
 * Replaces HTML calendar grid with iframe showing the actual PDF.
 */

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
    this.weekStartDateUTC = startOfWeekUTC(todayUTC, this.weekStart);

    this.currentPdfUrl = null;
    this._build();
    this.render();
  }

  destroy() {
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

  _build() {
    this.root = el("div", "sdcal");

    const bar = el("div", "sdcal__bar");

    this.btnMonth = el("button", "sdcal__tab is-active");
    this.btnMonth.type = "button";
    this.btnMonth.textContent = "Month";
    this.btnMonth.addEventListener("click", () => {
      this.view = "month";
      this.btnMonth.classList.add("is-active");
      this.btnWeek.classList.remove("is-active");
      this.render();
    });

    this.btnWeek = el("button", "sdcal__tab");
    this.btnWeek.type = "button";
    this.btnWeek.textContent = "Week";
    this.btnWeek.addEventListener("click", () => {
      this.view = "week";
      this.btnWeek.classList.add("is-active");
      this.btnMonth.classList.remove("is-active");
      this.render();
    });

    const tabs = el("div", "sdcal__tabs");
    tabs.append(this.btnMonth, this.btnWeek);

    const filterWrap = el("div", "sdcal__filter");
    const filterLabel = el("label", "sdcal__label");
    filterLabel.textContent = "Profiles";
    filterLabel.setAttribute("for", "sdcal-profile-pdf");

    this.profileSelect = el("select", "sdcal__select");
    this.profileSelect.id = "sdcal-profile-pdf";
    this.profileSelect.addEventListener("change", () => {
      this.profileFilter = this.profileSelect.value;
      this.render();
    });

    filterWrap.append(filterLabel, this.profileSelect);

    const nav = el("div", "sdcal__nav");

    this.btnPrev = el("button", "sdcal__navbtn");
    this.btnPrev.type = "button";
    this.btnPrev.textContent = "←";
    this.btnPrev.setAttribute("aria-label", "Previous");

    this.btnNext = el("button", "sdcal__navbtn");
    this.btnNext.type = "button";
    this.btnNext.textContent = "→";
    this.btnNext.setAttribute("aria-label", "Next");

    this.title = el("div", "sdcal__title");

    nav.append(this.btnPrev, this.title, this.btnNext);

    const actions = el("div", "sdcal__actions");
    this.btnDownload = el("button", "sdcal__action");
    this.btnDownload.type = "button";
    this.btnDownload.textContent = "Download PDF";
    this.btnDownload.addEventListener("click", () => this.downloadPdf());

    actions.append(this.btnDownload);

    bar.append(tabs, filterWrap, nav, actions);

    this.content = el("div", "sdcal__content");
    this.viewerWrap = el("div", "sdcal__viewer");
    this.loadingOverlay = el("div", "sdcal__loading");
    this.loadingOverlay.textContent = "Loading…";
    this.loadingOverlay.setAttribute("aria-live", "polite");

    this.iframe = document.createElement("iframe");
    this.iframe.className = "sdcal__pdf";
    this.iframe.setAttribute("title", "Calendar PDF preview");
    this.viewerWrap.append(this.iframe);

    this.root.append(bar, this.content);
    this.content.append(this.viewerWrap, this.loadingOverlay);

    this.mountEl.innerHTML = "";
    this.mountEl.append(this.root);

    this.btnPrev.addEventListener("click", () => {
      if (this.view === "month") {
        this.monthIndex--;
        if (this.monthIndex < 0) {
          this.monthIndex = 11;
          this.year--;
        }
      } else {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, -7);
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
      } else {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, 7);
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
  }

  _activeProfiles() {
    if (!this.profileFilter) return [];
    return this.profiles.filter((p) => p.id === this.profileFilter);
  }

  render() {
    if (this.view === "month") {
      const dtf = new Intl.DateTimeFormat(this.locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = dtf.format(
        new Date(Date.UTC(this.year, this.monthIndex, 1, 12))
      );
    } else {
      const end = addDaysUTC(this.weekStartDateUTC, 6);
      const dtf = new Intl.DateTimeFormat(this.locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = `${dtf.format(this.weekStartDateUTC)} – ${dtf.format(end)}`;
    }

    this.content.innerHTML = "";
    this.content.append(this.viewerWrap, this.loadingOverlay);

    if (this.profiles.length === 0) {
      const empty = el("div", "sdcal__empty");
      empty.textContent = "Add at least one profile to generate calendars.";
      this.content.append(empty);
      this.viewerWrap.style.display = "none";
      this.loadingOverlay.style.display = "none";
      return;
    }

    this.viewerWrap.style.display = "";
    this.refreshPdfPreview();
  }

  async refreshPdfPreview() {
    this.loadingOverlay.style.display = "";
    this.loadingOverlay.textContent = "Generating PDF…";
    this.iframe.src = "";
    this.currentPdfUrl = null;
    this.btnDownload.disabled = true;

    try {
      const { getSupabaseClient } = await import("./supabase-client.js");
      const client = await getSupabaseClient();

      const { data: { session } } = await client.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not logged in");

      const active = this._activeProfiles();
      const profileId = active[0]?.id;
      if (!profileId) throw new Error("No profile selected");

      const endpoint = this.view === "month" ? "/api/print-monthly" : "/api/print-weekly";

      const payload =
        this.view === "month"
          ? {
              year: this.year,
              month: this.monthIndex + 1,
              profileId,
              locale: this.locale,
              weekStart: this.weekStart
            }
          : {
              profileId,
              locale: this.locale,
              weekStart: this.weekStart,
              anchorYmd: `${this.weekStartDateUTC.getUTCFullYear()}-${pad2(this.weekStartDateUTC.getUTCMonth() + 1)}-${pad2(this.weekStartDateUTC.getUTCDate())}`
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

      this.currentPdfUrl = j.url;
      this.iframe.src = j.url;
      this.btnDownload.disabled = false;
    } catch (e) {
      this.loadingOverlay.textContent = e?.message || "Unable to load PDF";
    } finally {
      this.loadingOverlay.style.display = "none";
    }
  }

  downloadPdf() {
    if (this.currentPdfUrl) {
      window.location.href = this.currentPdfUrl;
    } else {
      this.refreshPdfPreview().then(() => {
        if (this.currentPdfUrl) window.location.href = this.currentPdfUrl;
      });
    }
  }
}
