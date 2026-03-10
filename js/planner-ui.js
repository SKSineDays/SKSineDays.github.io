/**
 * Planner UI — cloud-synced daily notes with SineDuck display.
 * Mounted inside CalendarsPdfUI when "Planner" tab is active.
 * Notes are restricted to the owner profile only (is_owner = true).
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

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

export class PlannerUI {
  /**
   * @param {HTMLElement} mountEl - Container element
   * @param {Object} opts - Options
   * @param {string} opts.locale
   * @param {number} opts.weekStart - 0 = Sunday, 1 = Monday
   * @param {Object} opts.ownerProfile - Single owner profile (notes are owner-only)
   * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabaseClient
   * @param {string} opts.userId - auth.users.id
   */
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.ownerProfile = opts.ownerProfile || null;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;

    const now = new Date();
    const todayUTC = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12)
    );
    this.weekStartDateUTC = startOfWeekUTC(todayUTC, this.weekStart);
    this.dayDateUTC = todayUTC; // Day view anchor
    this.view = "week"; // 'week' | 'day'

    // Cache: "profileId:YYYY-MM-DD" → content string
    this.notesCache = new Map();
    // Debounce timers: "profileId:YYYY-MM-DD" → timeout ID
    this.saveTimers = new Map();
    // Render generation — incremented on each render() call to cancel stale async continuations
    this._renderGen = 0;
  }

  destroy() {
    for (const [key, timerId] of this.saveTimers) {
      clearTimeout(timerId);
      const [profileId, dateYmd] = key.split(":");
      const content = this.notesCache.get(key);
      if (content !== undefined) {
        this._saveNote(profileId, dateYmd, content);
      }
    }
    this.saveTimers.clear();
    this.mountEl.innerHTML = "";
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
    this.render();
  }

  setSettings({ locale, weekStart }) {
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    this.weekStartDateUTC = startOfWeekUTC(this.weekStartDateUTC, this.weekStart);
    this.render();
  }

  setView(view) {
    if (view === "week" || view === "day") {
      this.view = view;
      this.render();
    }
  }

  navigateWeek(delta) {
    this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, delta * 7);
    this.render();
  }

  navigateDay(delta) {
    this.dayDateUTC = addDaysUTC(this.dayDateUTC, delta);
    this.render();
  }

  async render() {
    // Bump generation — any in-flight render with an older gen will abort after its await
    const gen = ++this._renderGen;

    this.mountEl.innerHTML = "";

    if (!this.ownerProfile) {
      const empty = el("div", "sdcal__empty");
      empty.textContent = "Planner notes are available for your owner profile.";
      this.mountEl.append(empty);
      return;
    }

    if (this.view === "day") {
      const d = this.dayDateUTC;
      const ymd = this._ymd(d);

      // Render shell immediately so the textarea is visible right away
      const wrap = el("div", "planner__day-view");
      const card = this._buildDayCard(d, ymd);
      wrap.append(card);
      this.mountEl.append(wrap);

      // Load notes async, then hydrate textarea if this render is still current
      await this._loadNotes(this.ownerProfile.id, ymd, ymd);
      if (gen !== this._renderGen) return; // stale — a newer render has taken over

      const textarea = card.querySelector(".planner__textarea");
      if (textarea) {
        const cached = this.notesCache.get(`${this.ownerProfile.id}:${ymd}`);
        if (cached !== undefined && textarea.value === "") {
          textarea.value = cached;
        }
      }
      return;
    }

    // Week view — build days array
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDaysUTC(this.weekStartDateUTC, i));
    }

    // Render shell immediately
    const wrap = el("div", "planner__week");
    const cards = new Map(); // ymd → card element

    for (const d of days) {
      const ymd = this._ymd(d);
      const card = this._buildDayCard(d, ymd);
      cards.set(ymd, card);
      wrap.append(card);
    }
    this.mountEl.append(wrap);

    // Load notes async, then hydrate all textareas if still current
    const startYmd = this._ymd(days[0]);
    const endYmd = this._ymd(days[6]);
    await this._loadNotes(this.ownerProfile.id, startYmd, endYmd);
    if (gen !== this._renderGen) return; // stale

    for (const [ymd, card] of cards) {
      const textarea = card.querySelector(".planner__textarea");
      if (textarea) {
        const cached = this.notesCache.get(`${this.ownerProfile.id}:${ymd}`);
        if (cached !== undefined && textarea.value === "") {
          textarea.value = cached;
        }
      }
    }
  }

  _buildDayCard(d, ymd) {
    const dtf = new Intl.DateTimeFormat(this.locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

    const cacheKey = `${this.ownerProfile.id}:${ymd}`;

    const dayEl = el("div", "planner__day");

    const header = el("div", "planner__day-header");

    const label = el("div", "planner__day-label");
    label.textContent = dtf.format(d);

    const duckWrap = el("div", "planner__duck-wrap");
    const result = calculateSineDayForYmd(this.ownerProfile.birthdate, ymd);

    if (result) {
      const img = document.createElement("img");
      img.className = "planner__duck";
      img.loading = "lazy";
      img.src = duckUrlFromSinedayNumber(result.day);
      img.alt = `Day ${result.day}`;
      img.title = `Day ${result.day}`;

      const duckLabel = el("span", "planner__duck-label");
      duckLabel.textContent = `Day ${result.day}`;

      duckWrap.append(img, duckLabel);
    }

    header.append(label, duckWrap);

    const textarea = document.createElement("textarea");
    textarea.className = "planner__textarea";
    textarea.placeholder = "Notes for this day…";
    textarea.dataset.date = ymd;
    textarea.value = this.notesCache.get(cacheKey) || "";

    if (this.view === "day") {
      textarea.classList.add("planner__textarea--day");
    }

    const indicator = el("div", "planner__save-indicator");
    indicator.textContent = "Saved ✓";

    textarea.addEventListener("input", () => {
      const key = `${this.ownerProfile.id}:${ymd}`;
      this.notesCache.set(key, textarea.value);

      if (this.saveTimers.has(key)) clearTimeout(this.saveTimers.get(key));

      const timerId = setTimeout(() => {
        this.saveTimers.delete(key);
        this._saveNote(this.ownerProfile.id, ymd, textarea.value).then(() => {
          this._flashIndicator(indicator);
        });
      }, 1500);

      this.saveTimers.set(key, timerId);
    });

    textarea.addEventListener("blur", () => {
      const key = `${this.ownerProfile.id}:${ymd}`;
      if (this.saveTimers.has(key)) {
        clearTimeout(this.saveTimers.get(key));
        this.saveTimers.delete(key);
      }
      this._saveNote(this.ownerProfile.id, ymd, textarea.value).then(() => {
        this._flashIndicator(indicator);
      });
    });

    dayEl.append(header, textarea, indicator);
    return dayEl;
  }

  getDateLabel(locale) {
    const dtf = new Intl.DateTimeFormat(locale || this.locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    if (this.view === "day") {
      return dtf.format(this.dayDateUTC);
    }

    const end = addDaysUTC(this.weekStartDateUTC, 6);
    return `${dtf.format(this.weekStartDateUTC)} – ${dtf.format(end)}`;
  }

  _ymd(d) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  async _loadNotes(profileId, startYmd, endYmd) {
    if (!this.supabaseClient) return;

    try {
      const { data, error } = await this.supabaseClient
        .from("planner_notes")
        .select("note_date, content")
        .eq("profile_id", profileId)
        .gte("note_date", startYmd)
        .lte("note_date", endYmd);

      if (error) {
        console.error("[Planner] Failed to load notes:", error);
        return;
      }

      for (const row of data || []) {
        this.notesCache.set(`${profileId}:${row.note_date}`, row.content);
      }
    } catch (err) {
      console.error("[Planner] Load notes error:", err);
    }
  }

  async _saveNote(profileId, dateYmd, content) {
    if (!this.supabaseClient || !this.userId) return;

    try {
      const { error } = await this.supabaseClient
        .from("planner_notes")
        .upsert(
          {
            user_id: this.userId,
            profile_id: profileId,
            note_date: dateYmd,
            content: content,
          },
          { onConflict: "profile_id,note_date" }
        );

      if (error) {
        console.error("[Planner] Failed to save note:", error);
      } else {
        this.notesCache.set(`${profileId}:${dateYmd}`, content);
      }
    } catch (err) {
      console.error("[Planner] Save note error:", err);
    }
  }

  _flashIndicator(indicatorEl) {
    indicatorEl.classList.add("is-visible");
    setTimeout(() => indicatorEl.classList.remove("is-visible"), 1500);
  }
}
