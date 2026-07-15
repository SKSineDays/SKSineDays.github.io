/**
 * Journal History UI — monthly calendar of actual SineDays and saved felt ducks.
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromUTCDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function todayYmdForTimeZone(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
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

function monthAnchorFromYmd(ymd) {
  const [year, month] = String(ymd || "").split("-").map(Number);
  if (!year || !month) return null;
  return { year, month: month - 1 };
}

function entryHasJournalSignal(entry) {
  if (!entry) return false;
  if ((entry.content || "").trim()) return true;
  if (entry.felt_sineday != null) return true;
  if (entry.image_path) return true;
  return false;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class JournalHistoryUI {
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.ownerProfile = opts.ownerProfile || null;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;
    this.onSelectDate = typeof opts.onSelectDate === "function" ? opts.onSelectDate : null;

    const anchor = this.ownerProfile
      ? monthAnchorFromYmd(todayYmdForTimeZone(this.ownerProfile.timezone))
      : null;
    const now = new Date();
    this.year = anchor?.year ?? now.getFullYear();
    this.month = anchor?.month ?? now.getMonth();
    this.entriesCache = new Map();
    this._renderGen = 0;
    this._loading = false;
  }

  destroy() {
    this._renderGen++;
    this.mountEl.innerHTML = "";
    this.entriesCache.clear();
  }

  setOwnerProfile(profile) {
    const previousId = this.ownerProfile?.id || null;
    this.ownerProfile = profile || null;
    if ((this.ownerProfile?.id || null) === previousId) return;
    this.entriesCache.clear();
    const anchor = profile
      ? monthAnchorFromYmd(todayYmdForTimeZone(profile.timezone))
      : null;
    if (anchor) {
      this.year = anchor.year;
      this.month = anchor.month;
    }
    this.render();
  }

  setSettings({ locale, weekStart }) {
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    this.render();
  }

  navigateMonth(delta) {
    this.month += delta;
    if (this.month > 11) {
      this.month = 0;
      this.year++;
    }
    if (this.month < 0) {
      this.month = 11;
      this.year--;
    }
    this.render();
  }

  jumpToCurrentMonth() {
    if (!this.ownerProfile) return;
    const anchor = monthAnchorFromYmd(todayYmdForTimeZone(this.ownerProfile.timezone));
    if (!anchor) return;
    this.year = anchor.year;
    this.month = anchor.month;
    this.render();
  }

  refreshVisibleMonth() {
    this.entriesCache.clear();
    return this.render();
  }

  getMonthLabel() {
    return new Intl.DateTimeFormat(this.locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(this.year, this.month, 1, 12)));
  }

  isViewingCurrentMonth() {
    if (!this.ownerProfile) return true;
    const anchor = monthAnchorFromYmd(todayYmdForTimeZone(this.ownerProfile.timezone));
    if (!anchor) return true;
    return this.year === anchor.year && this.month === anchor.month;
  }

  async render() {
    const gen = ++this._renderGen;
    this.mountEl.innerHTML = "";

    if (!this.ownerProfile) {
      const empty = el("div", "journal-history__empty");
      empty.textContent = "Create your owner profile to see journal history.";
      this.mountEl.append(empty);
      return;
    }

    const loading = el("div", "journal-history__loading");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.innerHTML = `
      <span class="sr-only">Loading journal history…</span>
      <span class="journal-history__loading-orb" aria-hidden="true"></span>
      <span aria-hidden="true">Gathering this month’s memories…</span>
    `;
    this.mountEl.append(loading);
    this._loading = true;

    const firstDay = new Date(Date.UTC(this.year, this.month, 1, 12));
    const daysInMonth = new Date(Date.UTC(this.year, this.month + 1, 0, 12)).getUTCDate();
    const firstDow = firstDay.getUTCDay();
    const offset = (firstDow - this.weekStart + 7) % 7;
    const startYmd = ymdFromUTCDate(firstDay);
    const endYmd = ymdFromUTCDate(new Date(Date.UTC(this.year, this.month, daysInMonth, 12)));

    const loadedEntries = await this._loadEntries(this.ownerProfile.id, startYmd, endYmd);
    if (gen !== this._renderGen) return;

    this.mountEl.innerHTML = "";
    this._loading = false;

    if (!loadedEntries) {
      const error = el("div", "feature-empty-state journal-history__error");
      const title = el("p", "feature-empty-state__title");
      title.textContent = "This month could not be gathered";
      const copy = el("p", "");
      copy.textContent = "Your journal is unchanged. Try loading the month again.";
      const retry = el("button", "feature-floating-action feature-floating-action--secondary");
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => this.render());
      error.append(title, copy, retry);
      this.mountEl.append(error);
      return;
    }
    this.entriesCache = loadedEntries;

    const root = el("div", "journal-history");
    const header = el("header", "history-month-header");
    const headerCopy = el("div", "history-month-header__copy");
    const eyebrow = el("p", "feature-hero__eyebrow");
    eyebrow.textContent = "Journal History";
    const title = el("h2", "history-month-header__title");
    title.textContent = this.getMonthLabel();
    headerCopy.append(eyebrow, title);

    const headerActions = el("div", "history-month-header__actions");
    const previousMonth = el("button", "feature-icon-button history-month-header__nav");
    previousMonth.type = "button";
    previousMonth.innerHTML = '<span aria-hidden="true">‹</span>';
    previousMonth.setAttribute("aria-label", "Previous month");
    previousMonth.addEventListener("click", () => this.navigateMonth(-1));
    const nextMonth = el("button", "feature-icon-button history-month-header__nav");
    nextMonth.type = "button";
    nextMonth.innerHTML = '<span aria-hidden="true">›</span>';
    nextMonth.setAttribute("aria-label", "Next month");
    nextMonth.addEventListener("click", () => this.navigateMonth(1));
    headerActions.append(previousMonth, nextMonth);
    header.append(headerCopy, headerActions);
    root.append(header);

    if (!this.isViewingCurrentMonth()) {
      const currentMonth = el("button", "history-current-month");
      currentMonth.type = "button";
      currentMonth.textContent = "This month";
      currentMonth.setAttribute("aria-label", "Jump to current month");
      currentMonth.addEventListener("click", () => this.jumpToCurrentMonth());
      root.append(currentMonth);
    }

    const entries = Array.from(this.entriesCache.values());
    const rememberedCount = entries.filter(entryHasJournalSignal).length;
    const feltCount = entries.filter((entry) => entry?.felt_sineday != null).length;
    const photoCount = entries.filter((entry) => !!entry?.image_path).length;
    const summary = el("section", "history-memory-summary");
    summary.setAttribute("aria-label", "Your month at a glance");
    const summaryIntro = el("div", "history-memory-summary__intro");
    const summaryEyebrow = el("span", "");
    summaryEyebrow.textContent = "Your month at a glance";
    const summaryLead = el("strong", "");
    summaryLead.textContent = `${rememberedCount} ${rememberedCount === 1 ? "day" : "days"} remembered`;
    summaryIntro.append(summaryEyebrow, summaryLead);
    const summaryDetails = el("div", "history-memory-summary__details");
    summaryDetails.innerHTML = `
      <span><strong>${feltCount}</strong> felt ${feltCount === 1 ? "duck" : "ducks"}</span>
      <span><strong>${photoCount}</strong> memory ${photoCount === 1 ? "photo" : "photos"}</span>
    `;
    summary.append(summaryIntro, summaryDetails);
    root.append(summary);

    const legend = el("div", "history-legend");
    legend.setAttribute("aria-label", "Calendar legend");
    legend.innerHTML = `
      <span><i class="history-legend__actual" aria-hidden="true"></i>actual wave</span>
      <span><i class="history-legend__felt" aria-hidden="true"></i>how it felt</span>
      <span><i class="history-legend__saved" aria-hidden="true"></i>journal saved</span>
    `;
    root.append(legend);

    const grid = el("div", "journal-history__grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `${this.getMonthLabel()} journal history`);

    const headerRow = el("div", "journal-history__row");
    headerRow.setAttribute("role", "row");
    for (let i = 0; i < 7; i++) {
      const refDate = new Date(Date.UTC(2024, 0, 7 + ((this.weekStart + i) % 7), 12));
      const hdr = el("div", "journal-history__weekday");
      hdr.setAttribute("role", "columnheader");
      hdr.textContent = new Intl.DateTimeFormat(this.locale, {
        weekday: "narrow",
        timeZone: "UTC",
      }).format(refDate);
      headerRow.append(hdr);
    }
    grid.append(headerRow);

    let cellIndex = 0;
    let weekRow = null;
    const appendCell = (cell) => {
      if (cellIndex % 7 === 0) {
        weekRow = el("div", "journal-history__row");
        weekRow.setAttribute("role", "row");
        grid.append(weekRow);
      }
      weekRow.append(cell);
      cellIndex++;
    };
    for (let i = 0; i < offset; i++) {
      const emptyCell = el("div", "journal-history__cell journal-history__cell--empty");
      emptyCell.setAttribute("role", "gridcell");
      emptyCell.setAttribute("aria-hidden", "true");
      appendCell(emptyCell);
    }

    const profileToday = todayYmdForTimeZone(this.ownerProfile.timezone);

    for (let day = 1; day <= daysInMonth; day++) {
      const dateYmd = ymdFromUTCDate(new Date(Date.UTC(this.year, this.month, day, 12)));
      const entry = this.entriesCache.get(dateYmd);
      const actual = calculateSineDayForYmd(this.ownerProfile.birthdate, dateYmd);
      const hasSignal = entryHasJournalSignal(entry);
      const isToday = dateYmd === profileToday;

      const dateLabel = new Intl.DateTimeFormat(this.locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${dateYmd}T12:00:00Z`));

      const cell = el("button", "journal-history__cell");
      cell.type = "button";
      cell.dataset.date = dateYmd;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute(
        "aria-label",
        [
          `Open journal for ${dateLabel}.`,
          actual?.day ? `Actual SineDay ${actual.day}.` : "",
          entry?.felt_sineday ? `Felt SineDay ${entry.felt_sineday}.` : "",
          hasSignal ? "Journal saved." : "No journal saved yet.",
          isToday ? "Today." : "",
        ].filter(Boolean).join(" ")
      );
      if (isToday) cell.classList.add("journal-history__cell--today");
      if (hasSignal) cell.classList.add("journal-history__cell--has-entry");

      const cellTop = el("span", "journal-history__cell-top");
      const num = el("span", "journal-history__day-num");
      num.textContent = String(day);
      cellTop.append(num);
      if (isToday) {
        const today = el("span", "journal-history__today-label");
        today.textContent = "Today";
        cellTop.append(today);
      } else if (hasSignal) {
        const memoryDot = el("span", "journal-history__memory-dot");
        memoryDot.setAttribute("aria-hidden", "true");
        cellTop.append(memoryDot);
      }
      cell.append(cellTop);

      if (actual?.day) {
        const actualWrap = el("span", "journal-history__actual");
        const actualImg = document.createElement("img");
        actualImg.className = "journal-history__duck journal-history__duck--actual";
        actualImg.src = duckUrlFromSinedayNumber(actual.day);
        actualImg.alt = "";
        actualImg.setAttribute("aria-hidden", "true");
        actualImg.loading = "lazy";
        actualWrap.append(actualImg);
        cell.append(actualWrap);
      }

      if (entry?.felt_sineday) {
        const felt = el("span", "journal-history__felt");
        const feltImg = document.createElement("img");
        feltImg.src = duckUrlFromSinedayNumber(entry.felt_sineday);
        feltImg.alt = "";
        feltImg.setAttribute("aria-hidden", "true");
        feltImg.loading = "lazy";
        felt.append(feltImg);
        cell.append(felt);
      }

      cell.addEventListener("click", () => this.onSelectDate?.(dateYmd));
      appendCell(cell);
    }

    const scroll = el("div", "journal-history-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("aria-label", `${this.getMonthLabel()} horizontally scrollable memory calendar`);
    scroll.append(grid);
    const stage = el("div", "journal-history-stage");
    const scrollHint = el("div", "journal-history-scroll-hint");
    scrollHint.setAttribute("aria-hidden", "true");
    scrollHint.textContent = "Swipe to explore";
    const dismissHint = () => {
      if (Math.abs(scroll.scrollLeft) < 12) return;
      stage.classList.add("is-scrolled");
      scrollHint.hidden = true;
      scroll.removeEventListener("scroll", dismissHint);
    };
    scroll.addEventListener("scroll", dismissHint, { passive: true });
    stage.append(scroll, scrollHint);
    root.append(stage);
    this.mountEl.append(root);
    requestAnimationFrame(() => {
      scroll.scrollLeft = 0;
      scrollHint.hidden = false;
      stage.classList.remove("is-scrolled");
    });
  }

  async _loadEntries(profileId, startYmd, endYmd) {
    const entries = new Map();
    if (!this.supabaseClient) return entries;
    try {
      const { data, error } = await this.supabaseClient
        .from("journal_entries")
        .select("entry_date, actual_sineday, felt_sineday, content, image_path")
        .eq("profile_id", profileId)
        .gte("entry_date", startYmd)
        .lte("entry_date", endYmd);
      if (error) throw error;
      for (const row of data || []) {
        entries.set(row.entry_date, row);
      }
      return entries;
    } catch (err) {
      console.error("[JournalHistory] Load entries failed:", err);
      return false;
    }
  }
}
