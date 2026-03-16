/**
 * Wave Calendar UI — Interactive color-tagged monthly calendar
 * with per-day sine wave visualization.
 *
 * Owner-only, premium-gated. Mounted by dashboard.js.
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd, DAY_DATA } from "./sineday-engine.js";

/** Preset tag palette */
const TAG_PALETTE = [
  { color: "#22c55e", label: "Build", emoji: "🟢" },
  { color: "#3b82f6", label: "Social", emoji: "🔵" },
  { color: "#a855f7", label: "Creative", emoji: "🟣" },
  { color: "#ef4444", label: "Deep Work", emoji: "🔴" },
  { color: "#eab308", label: "Rest", emoji: "🟡" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class WaveCalendarUI {
  /**
   * @param {HTMLElement} mountEl
   * @param {Object} opts
   * @param {string} opts.locale
   * @param {number} opts.weekStart - 0=Sunday, 1=Monday
   * @param {Object} opts.ownerProfile
   * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabaseClient
   * @param {string} opts.userId
   */
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.ownerProfile = opts.ownerProfile || null;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;

    // Current month anchor (UTC noon on the 1st)
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth(); // 0-indexed

    // Tag cache: "YYYY-MM-DD" → { color, label }
    this.tagsCache = new Map();

    // Active picker state
    this._activePicker = null; // { ymd, element }
    this._pickerEl = null;

    // Render generation for async safety
    this._renderGen = 0;

    // Bound close handler for document clicks
    this._onDocClick = (e) => this._handleDocClick(e);
    document.addEventListener("click", this._onDocClick, true);
  }

  destroy() {
    this._closePicker();
    document.removeEventListener("click", this._onDocClick, true);
    this.mountEl.innerHTML = "";
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
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

  /** Currently displayed month label */
  getMonthLabel() {
    const d = new Date(Date.UTC(this.year, this.month, 1));
    return new Intl.DateTimeFormat(this.locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }

  async render() {
    const gen = ++this._renderGen;
    this._closePicker();
    this.mountEl.innerHTML = "";

    if (!this.ownerProfile) {
      const empty = el("div", "wcal__empty");
      empty.textContent = "Wave Calendar is available for your owner profile.";
      this.mountEl.append(empty);
      return;
    }

    const birthYmd = this.ownerProfile.birthdate;
    const firstDay = new Date(Date.UTC(this.year, this.month, 1));
    const daysInMonth = new Date(
      Date.UTC(this.year, this.month + 1, 0)
    ).getUTCDate();

    // Day-of-week offset for first day
    const firstDow = firstDay.getUTCDay();
    const offset = (firstDow - this.weekStart + 7) % 7;

    // Build grid shell
    const grid = el("div", "wcal__grid");

    // Weekday headers
    for (let i = 0; i < 7; i++) {
      const dow = (this.weekStart + i) % 7;
      const refDate = new Date(Date.UTC(2024, 0, 7 + dow));
      const hdr = el("div", "wcal__weekday");
      hdr.textContent = new Intl.DateTimeFormat(this.locale, {
        weekday: "narrow",
        timeZone: "UTC",
      }).format(refDate);
      grid.append(hdr);
    }

    // Empty cells before first day
    for (let i = 0; i < offset; i++) {
      grid.append(el("div", "wcal__cell wcal__cell--empty"));
    }

    // Day cells
    const cellMap = new Map(); // ymd → cell element
    const nowDate = new Date();
    const todayYmd = ymd(
      new Date(
        Date.UTC(
          nowDate.getFullYear(),
          nowDate.getMonth(),
          nowDate.getDate()
        )
      )
    );

    for (let day = 1; day <= daysInMonth; day++) {
      const dateUTC = new Date(Date.UTC(this.year, this.month, day));
      const dateYmd = ymd(dateUTC);

      const cell = el("div", "wcal__cell");
      cell.dataset.date = dateYmd;
      if (dateYmd === todayYmd) cell.classList.add("wcal__cell--today");

      // SineDay calc
      const result = calculateSineDayForYmd(birthYmd, dateYmd);
      const dayNum = result ? result.day : null;

      // Day number
      const numEl = el("div", "wcal__day-num");
      numEl.textContent = String(day);
      cell.append(numEl);

      // SineDuck image + badge (the duck IS the wave indicator)
      if (dayNum) {
        const duckWrap = el("div", "wcal__duck-wrap");

        const duckImg = document.createElement("img");
        duckImg.className = "wcal__duck";
        duckImg.src = duckUrlFromSinedayNumber(dayNum);
        duckImg.alt = `Day ${dayNum}`;
        duckImg.loading = "lazy";
        duckImg.width = 32;
        duckImg.height = 32;
        duckWrap.append(duckImg);

        const badge = el("span", "wcal__day-badge");
        badge.textContent = dayNum;
        duckWrap.append(badge);

        cell.append(duckWrap);

        // Phase abbreviation
        const phaseEl = el("div", "wcal__phase");
        const phaseData = DAY_DATA[dayNum - 1];
        if (phaseData) {
          const parts = phaseData.phase.split("•");
          phaseEl.textContent = (parts[1] || parts[0]).trim();
        }
        cell.append(phaseEl);
      }

      // Tag display area (populated after load)
      const tagDisplay = el("div", "wcal__tag-display");
      tagDisplay.dataset.date = dateYmd;
      cell.append(tagDisplay);

      // Click handler → open tag picker
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._openPicker(dateYmd, cell);
      });

      cellMap.set(dateYmd, cell);
      grid.append(cell);
    }

    this.mountEl.append(grid);

    // Load tags from DB
    const startYmd = ymd(firstDay);
    const endYmd = ymd(
      new Date(Date.UTC(this.year, this.month, daysInMonth))
    );
    await this._loadTags(this.ownerProfile.id, startYmd, endYmd);
    if (gen !== this._renderGen) return;

    // Hydrate tag displays
    for (const [dateYmd, cell] of cellMap) {
      this._applyTagToCell(dateYmd, cell);
    }
  }

  /** Apply cached tag data to a cell */
  _applyTagToCell(dateYmd, cell) {
    const tag = this.tagsCache.get(dateYmd);
    const display = cell.querySelector(".wcal__tag-display");

    cell.style.removeProperty("--wcal-tag-color");
    cell.classList.remove("wcal__cell--tagged");
    if (display) display.textContent = "";

    if (tag && tag.color) {
      cell.style.setProperty("--wcal-tag-color", tag.color);
      cell.classList.add("wcal__cell--tagged");
      if (display && tag.label) {
        display.textContent = tag.label;
      }
    }
  }

  /** Open the tag picker popover for a specific day */
  _openPicker(dateYmd, anchorCell) {
    this._closePicker();

    const picker = el("div", "wcal__picker");
    picker.addEventListener("click", (e) => e.stopPropagation());

    // Date label at top
    const dateLabel = el("div", "wcal__picker-date");
    const d = new Date(dateYmd + "T12:00:00Z");
    dateLabel.textContent = new Intl.DateTimeFormat(this.locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(d);
    picker.append(dateLabel);

    // Color buttons
    const colors = el("div", "wcal__picker-colors");

    for (const preset of TAG_PALETTE) {
      const btn = el("button", "wcal__color-btn");
      btn.type = "button";
      btn.style.setProperty("--btn-color", preset.color);
      btn.title = preset.label;
      btn.setAttribute("aria-label", preset.label);

      const currentTag = this.tagsCache.get(dateYmd);
      if (currentTag && currentTag.color === preset.color) {
        btn.classList.add("is-selected");
      }

      btn.addEventListener("click", () => {
        this._selectTag(
          dateYmd,
          anchorCell,
          preset.color,
          labelInput.value.trim() || preset.label
        );
        labelInput.value = labelInput.value.trim() || preset.label;

        colors
          .querySelectorAll(".wcal__color-btn")
          .forEach((b) => b.classList.remove("is-selected"));
        btn.classList.add("is-selected");
      });

      colors.append(btn);
    }

    // Clear button
    const clearBtn = el("button", "wcal__color-btn wcal__color-btn--clear");
    clearBtn.type = "button";
    clearBtn.textContent = "✕";
    clearBtn.title = "Clear tag";
    clearBtn.setAttribute("aria-label", "Clear tag");
    clearBtn.addEventListener("click", () => {
      this._clearTag(dateYmd, anchorCell);
      this._closePicker();
    });
    colors.append(clearBtn);

    picker.append(colors);

    // Label input
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "wcal__picker-label";
    labelInput.placeholder = "Label…";
    labelInput.maxLength = 30;

    const currentTag = this.tagsCache.get(dateYmd);
    if (currentTag) labelInput.value = currentTag.label || "";

    // Save label on change (debounced)
    let labelTimer = null;
    labelInput.addEventListener("input", () => {
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => {
        const tag = this.tagsCache.get(dateYmd);
        if (tag && tag.color) {
          this._selectTag(
            dateYmd,
            anchorCell,
            tag.color,
            labelInput.value.trim()
          );
        }
      }, 600);
    });

    // Enter key saves and closes
    labelInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const tag = this.tagsCache.get(dateYmd);
        if (tag && tag.color) {
          this._selectTag(
            dateYmd,
            anchorCell,
            tag.color,
            labelInput.value.trim()
          );
        }
        this._closePicker();
      }
      if (e.key === "Escape") {
        this._closePicker();
      }
    });

    picker.append(labelInput);

    // Position the picker relative to the cell
    anchorCell.style.position = "relative";
    anchorCell.append(picker);

    this._activePicker = { ymd: dateYmd, element: picker, cell: anchorCell };

    requestAnimationFrame(() => labelInput.focus());
  }

  _closePicker() {
    if (this._activePicker) {
      this._activePicker.element.remove();
      this._activePicker = null;
    }
  }

  _handleDocClick(e) {
    if (this._activePicker) {
      const picker = this._activePicker.element;
      if (!picker.contains(e.target)) {
        this._closePicker();
      }
    }
  }

  /** Select a tag (color + label) for a day, save to cache + DB */
  _selectTag(dateYmd, cell, color, label) {
    this.tagsCache.set(dateYmd, { color, label });
    this._applyTagToCell(dateYmd, cell);
    this._saveTag(this.ownerProfile.id, dateYmd, color, label);
  }

  /** Clear tag for a day */
  _clearTag(dateYmd, cell) {
    this.tagsCache.delete(dateYmd);
    this._applyTagToCell(dateYmd, cell);
    this._deleteTag(this.ownerProfile.id, dateYmd);
  }

  // ── Supabase I/O ─────────────────────────────────────────

  async _loadTags(profileId, startYmd, endYmd) {
    if (!this.supabaseClient) return;

    try {
      const { data, error } = await this.supabaseClient
        .from("wave_calendar_tags")
        .select("tag_date, color, label")
        .eq("profile_id", profileId)
        .gte("tag_date", startYmd)
        .lte("tag_date", endYmd);

      if (error) {
        console.error("[WaveCal] Failed to load tags:", error);
        return;
      }

      for (const row of data || []) {
        this.tagsCache.set(row.tag_date, {
          color: row.color,
          label: row.label,
        });
      }
    } catch (err) {
      console.error("[WaveCal] Load tags error:", err);
    }
  }

  async _saveTag(profileId, dateYmd, color, label) {
    if (!this.supabaseClient || !this.userId) return;

    try {
      const { error } = await this.supabaseClient.from("wave_calendar_tags").upsert(
        {
          user_id: this.userId,
          profile_id: profileId,
          tag_date: dateYmd,
          color,
          label,
        },
        { onConflict: "profile_id,tag_date" }
      );

      if (error) {
        console.error("[WaveCal] Failed to save tag:", error);
      }
    } catch (err) {
      console.error("[WaveCal] Save tag error:", err);
    }
  }

  async _deleteTag(profileId, dateYmd) {
    if (!this.supabaseClient || !this.userId) return;

    try {
      const { error } = await this.supabaseClient
        .from("wave_calendar_tags")
        .delete()
        .eq("profile_id", profileId)
        .eq("tag_date", dateYmd);

      if (error) {
        console.error("[WaveCal] Failed to delete tag:", error);
      }
    } catch (err) {
      console.error("[WaveCal] Delete tag error:", err);
    }
  }
}
