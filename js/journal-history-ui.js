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
    this.mountEl.innerHTML = "";
    this.entriesCache.clear();
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
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
    loading.textContent = "Loading journal history…";
    this.mountEl.append(loading);
    this._loading = true;

    const firstDay = new Date(Date.UTC(this.year, this.month, 1, 12));
    const daysInMonth = new Date(Date.UTC(this.year, this.month + 1, 0, 12)).getUTCDate();
    const firstDow = firstDay.getUTCDay();
    const offset = (firstDow - this.weekStart + 7) % 7;
    const startYmd = ymdFromUTCDate(firstDay);
    const endYmd = ymdFromUTCDate(new Date(Date.UTC(this.year, this.month, daysInMonth, 12)));

    await this._loadEntries(this.ownerProfile.id, startYmd, endYmd);
    if (gen !== this._renderGen) return;

    this.mountEl.innerHTML = "";
    this._loading = false;

    const grid = el("div", "journal-history__grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `${this.getMonthLabel()} journal history`);

    for (let i = 0; i < 7; i++) {
      const refDate = new Date(Date.UTC(2024, 0, 7 + ((this.weekStart + i) % 7), 12));
      const hdr = el("div", "journal-history__weekday");
      hdr.setAttribute("role", "columnheader");
      hdr.textContent = new Intl.DateTimeFormat(this.locale, {
        weekday: "narrow",
        timeZone: "UTC",
      }).format(refDate);
      grid.append(hdr);
    }

    for (let i = 0; i < offset; i++) {
      grid.append(el("div", "journal-history__cell journal-history__cell--empty"));
    }

    const profileToday = todayYmdForTimeZone(this.ownerProfile.timezone);

    for (let day = 1; day <= daysInMonth; day++) {
      const dateYmd = ymdFromUTCDate(new Date(Date.UTC(this.year, this.month, day, 12)));
      const entry = this.entriesCache.get(dateYmd);
      const actual = calculateSineDayForYmd(this.ownerProfile.birthdate, dateYmd);
      const hasSignal = entryHasJournalSignal(entry);

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
        hasSignal
          ? `Open journal for ${dateLabel}. Entry saved.`
          : `Open journal for ${dateLabel}.`
      );
      if (dateYmd === profileToday) cell.classList.add("journal-history__cell--today");
      if (hasSignal) cell.classList.add("journal-history__cell--has-entry");

      const num = el("span", "journal-history__day-num");
      num.textContent = String(day);
      cell.append(num);

      if (actual?.day) {
        const actualImg = document.createElement("img");
        actualImg.className = "journal-history__duck journal-history__duck--actual";
        actualImg.src = duckUrlFromSinedayNumber(actual.day);
        actualImg.alt = `Actual Day ${actual.day}`;
        actualImg.loading = "lazy";
        cell.append(actualImg);
      }

      if (entry?.felt_sineday) {
        const felt = el("span", "journal-history__felt");
        const feltImg = document.createElement("img");
        feltImg.src = duckUrlFromSinedayNumber(entry.felt_sineday);
        feltImg.alt = `Felt Day ${entry.felt_sineday}`;
        feltImg.loading = "lazy";
        const label = el("span", "journal-history__felt-label");
        label.textContent = "felt";
        felt.append(feltImg, label);
        cell.append(felt);
      }

      if (hasSignal) {
        const marker = el("span", "journal-history__entry-dot");
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = entry.image_path ? "✦" : "•";
        cell.append(marker);
      }

      cell.addEventListener("click", () => this.onSelectDate?.(dateYmd));
      grid.append(cell);
    }

    const scroll = el("div", "journal-history-scroll");
    scroll.append(grid);
    this.mountEl.append(scroll);
  }

  async _loadEntries(profileId, startYmd, endYmd) {
    if (!this.supabaseClient) return;
    try {
      const { data, error } = await this.supabaseClient
        .from("journal_entries")
        .select("entry_date, actual_sineday, felt_sineday, content, image_path")
        .eq("profile_id", profileId)
        .gte("entry_date", startYmd)
        .lte("entry_date", endYmd);
      if (error) throw error;
      this.entriesCache.clear();
      for (const row of data || []) {
        this.entriesCache.set(row.entry_date, row);
      }
    } catch (err) {
      console.error("[JournalHistory] Load entries failed:", err);
    }
  }
}
