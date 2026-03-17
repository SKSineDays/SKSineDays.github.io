/**
 * Wave Calendar UI — Interactive color-tagged monthly calendar
 * with SineDuck per day. Owner-only, premium-gated.
 *
 * Tag interaction:
 *  - Click a day → popover with labeled color buttons → tap to assign
 *  - Gear button → palette config popout to rename color labels
 *  - Labels stored in localStorage (wcal_palette_labels)
 *  - Tag assignments stored in Supabase (wave_calendar_tags)
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

/** Default color palette */
const DEFAULT_PALETTE = [
  { color: "#22c55e", label: "Build" },
  { color: "#3b82f6", label: "Social" },
  { color: "#a855f7", label: "Creative" },
  { color: "#ef4444", label: "Deep Work" },
  { color: "#eab308", label: "Rest" },
];

const STORAGE_KEY = "wcal_palette_labels";

function pad2(n) { return String(n).padStart(2, "0"); }

function ymd(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Load user's palette labels from localStorage, merged with defaults */
function loadPaletteLabels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge: keep saved labels for known colors, fill gaps with defaults
      return DEFAULT_PALETTE.map(p => ({
        color: p.color,
        label: (saved[p.color] !== undefined && saved[p.color] !== "") ? saved[p.color] : p.label,
      }));
    }
  } catch { /* ignore */ }
  return DEFAULT_PALETTE.map(p => ({ ...p }));
}

/** Save palette labels to localStorage */
function savePaletteLabels(palette) {
  const map = {};
  for (const p of palette) {
    map[p.color] = p.label;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
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

    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();

    // Tag cache: "YYYY-MM-DD" → { color, label }
    this.tagsCache = new Map();

    // Palette labels (user-customizable)
    this.palette = loadPaletteLabels();

    // Active popover state
    this._activePicker = null;
    this._paletteConfigEl = null;

    // Render generation for async safety
    this._renderGen = 0;

    // Cell map for re-applying tags without full re-render
    this._cellMap = new Map();

    // Bound close handler — use bubbling phase (not capture) so the
    // cell's stopPropagation() prevents the doc handler from firing
    // on the same click that opened the picker.
    this._onDocClick = (e) => this._handleDocClick(e);
    document.addEventListener("click", this._onDocClick);
  }

  destroy() {
    this._closePicker();
    this._closePaletteConfig();
    document.removeEventListener("click", this._onDocClick);
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
    if (this.month > 11) { this.month = 0; this.year++; }
    if (this.month < 0) { this.month = 11; this.year--; }
    this.render();
  }

  getMonthLabel() {
    const d = new Date(Date.UTC(this.year, this.month, 1));
    return new Intl.DateTimeFormat(this.locale, {
      month: "long", year: "numeric", timeZone: "UTC"
    }).format(d);
  }

  // ── Render ────────────────────────────────────────────

  async render() {
    const gen = ++this._renderGen;
    this._closePicker();
    this.mountEl.innerHTML = "";
    this._cellMap.clear();

    if (!this.ownerProfile) {
      const empty = el("div", "wcal__empty");
      empty.textContent = "Wave Calendar is available for your owner profile.";
      this.mountEl.append(empty);
      return;
    }

    const birthYmd = this.ownerProfile.birthdate;
    const firstDay = new Date(Date.UTC(this.year, this.month, 1));
    const daysInMonth = new Date(Date.UTC(this.year, this.month + 1, 0)).getUTCDate();

    const firstDow = firstDay.getUTCDay();
    const offset = (firstDow - this.weekStart + 7) % 7;

    const grid = el("div", "wcal__grid");

    // Weekday headers
    for (let i = 0; i < 7; i++) {
      const refDate = new Date(Date.UTC(2024, 0, 7 + (this.weekStart + i) % 7));
      const hdr = el("div", "wcal__weekday");
      hdr.textContent = new Intl.DateTimeFormat(this.locale, {
        weekday: "narrow", timeZone: "UTC"
      }).format(refDate);
      grid.append(hdr);
    }

    // Empty cells before first day
    for (let i = 0; i < offset; i++) {
      grid.append(el("div", "wcal__cell wcal__cell--empty"));
    }

    // Day cells
    const nowDate = new Date();
    const todayYmd = ymd(new Date(Date.UTC(
      nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()
    )));

    for (let day = 1; day <= daysInMonth; day++) {
      const dateUTC = new Date(Date.UTC(this.year, this.month, day));
      const dateYmd = ymd(dateUTC);

      const cell = el("div", "wcal__cell");
      cell.dataset.date = dateYmd;
      if (dateYmd === todayYmd) cell.classList.add("wcal__cell--today");

      const result = calculateSineDayForYmd(birthYmd, dateYmd);
      const dayNum = result ? result.day : null;

      // Day number
      const numEl = el("div", "wcal__day-num");
      numEl.textContent = String(day);
      cell.append(numEl);

      // SineDuck image only — no badge, no phase label
      if (dayNum) {
        const duckBox = el("div", "wcal__duck-box");

        const duckImg = document.createElement("img");
        duckImg.className = "wcal__duck";
        duckImg.src = duckUrlFromSinedayNumber(dayNum);
        duckImg.alt = `Day ${dayNum}`;
        duckImg.loading = "lazy";
        duckImg.decoding = "async";

        duckBox.append(duckImg);
        cell.append(duckBox);
      }

      // Tag label display (populated after load)
      const tagDisplay = el("div", "wcal__tag-display");
      tagDisplay.dataset.date = dateYmd;
      cell.append(tagDisplay);

      // Click → open color picker
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._openPicker(dateYmd, cell);
      });

      this._cellMap.set(dateYmd, cell);
      grid.append(cell);
    }

    this.mountEl.append(grid);

    // Load tags from DB
    const startYmd = ymd(firstDay);
    const endYmd = ymd(new Date(Date.UTC(this.year, this.month, daysInMonth)));
    await this._loadTags(this.ownerProfile.id, startYmd, endYmd);
    if (gen !== this._renderGen) return;

    // Hydrate tag displays
    for (const [dateYmd, cell] of this._cellMap) {
      this._applyTagToCell(dateYmd, cell);
    }
  }

  // ── Tag display ───────────────────────────────────────

  _applyTagToCell(dateYmd, cell) {
    const tag = this.tagsCache.get(dateYmd);
    const display = cell.querySelector(".wcal__tag-display");

    cell.style.removeProperty("--wcal-tag-color");
    cell.classList.remove("wcal__cell--tagged");
    if (display) display.textContent = "";

    if (tag && tag.color) {
      cell.style.setProperty("--wcal-tag-color", tag.color);
      cell.classList.add("wcal__cell--tagged");

      // Show the palette label for this color
      if (display) {
        const match = this.palette.find(p => p.color === tag.color);
        display.textContent = tag.label || (match ? match.label : "");
      }
    }
  }

  /** Re-apply all visible tags (after palette rename) */
  _refreshAllTags() {
    for (const [dateYmd, cell] of this._cellMap) {
      const tag = this.tagsCache.get(dateYmd);
      if (tag && tag.color) {
        // Update the stored label to match current palette
        const match = this.palette.find(p => p.color === tag.color);
        if (match) {
          tag.label = match.label;
          this._saveTag(this.ownerProfile.id, dateYmd, tag.color, tag.label);
        }
      }
      this._applyTagToCell(dateYmd, cell);
    }
  }

  // ── Day picker (color selection) ──────────────────────

  _openPicker(dateYmd, anchorCell) {
    this._closePicker();
    this._closePaletteConfig();

    const picker = el("div", "wcal__picker");
    picker.addEventListener("click", (e) => e.stopPropagation());

    // Date label
    const dateLabel = el("div", "wcal__picker-date");
    const d = new Date(dateYmd + "T12:00:00Z");
    dateLabel.textContent = new Intl.DateTimeFormat(this.locale, {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC"
    }).format(d);
    picker.append(dateLabel);

    // Color rows — each is a labeled button
    const list = el("div", "wcal__picker-list");

    const currentTag = this.tagsCache.get(dateYmd);

    for (const preset of this.palette) {
      const row = el("button", "wcal__picker-row");
      row.type = "button";

      const dot = el("span", "wcal__picker-dot");
      dot.style.background = preset.color;
      row.append(dot);

      const label = el("span", "wcal__picker-row-label");
      label.textContent = preset.label;
      row.append(label);

      if (currentTag && currentTag.color === preset.color) {
        row.classList.add("is-selected");
      }

      row.addEventListener("click", () => {
        // Toggle: if already this color, clear it
        if (currentTag && currentTag.color === preset.color) {
          this._clearTag(dateYmd, anchorCell);
          this._closePicker();
          return;
        }

        this._selectTag(dateYmd, anchorCell, preset.color, preset.label);
        this._closePicker();
      });

      list.append(row);
    }

    picker.append(list);

    // Clear button (only show if tagged)
    if (currentTag && currentTag.color) {
      const clearRow = el("button", "wcal__picker-row wcal__picker-row--clear");
      clearRow.type = "button";

      const clearLabel = el("span", "wcal__picker-row-label");
      clearLabel.textContent = "Clear";
      clearRow.append(clearLabel);

      clearRow.addEventListener("click", () => {
        this._clearTag(dateYmd, anchorCell);
        this._closePicker();
      });

      picker.append(clearRow);
    }

    const frame = this.mountEl.closest(".wcal-frame") || this.mountEl;
    frame.append(picker);

    anchorCell.classList.add("is-picker-open");

    requestAnimationFrame(() => {
      this._positionPicker(picker, anchorCell);
    });

    this._activePicker = { ymd: dateYmd, element: picker, cell: anchorCell };
  }

  _positionPicker(picker, anchorCell) {
    const frame = this.mountEl.closest(".wcal-frame") || this.mountEl;
    const frameRect = frame.getBoundingClientRect();
    const cellRect = anchorCell.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const gutter = 8;

    let left = (cellRect.left - frameRect.left) + ((cellRect.width - pickerRect.width) / 2);
    const maxLeft = Math.max(gutter, frameRect.width - pickerRect.width - gutter);
    left = Math.max(gutter, Math.min(left, maxLeft));

    let top = (cellRect.bottom - frameRect.top) + 6;
    if (top + pickerRect.height > frameRect.height - gutter) {
      top = (cellRect.top - frameRect.top) - pickerRect.height - 6;
    }
    top = Math.max(gutter, top);

    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
  }

  _closePicker() {
    if (this._activePicker) {
      this._activePicker.cell?.classList.remove("is-picker-open");
      this._activePicker.element.remove();
      this._activePicker = null;
    }
  }

  // ── Palette config popout ─────────────────────────────

  /**
   * Open the palette config popout.
   * Called from the gear button in dashboard.js frame header.
   * @param {HTMLElement} anchorEl — element to position relative to
   */
  openPaletteConfig(anchorEl) {
    this._closePicker();
    this._closePaletteConfig();

    const overlay = el("div", "wcal__config-overlay");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this._closePaletteConfig();
    });

    const panel = el("div", "wcal__config-panel");
    panel.addEventListener("click", (e) => e.stopPropagation());

    const heading = el("div", "wcal__config-heading");
    heading.textContent = "Customize Tags";
    panel.append(heading);

    const desc = el("div", "wcal__config-desc");
    desc.textContent = "Rename each color to match how you plan your days.";
    panel.append(desc);

    const rows = el("div", "wcal__config-rows");

    for (let i = 0; i < this.palette.length; i++) {
      const preset = this.palette[i];

      const row = el("div", "wcal__config-row");

      const dot = el("span", "wcal__config-dot");
      dot.style.background = preset.color;
      row.append(dot);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "wcal__config-input";
      input.value = preset.label;
      input.maxLength = 20;
      input.placeholder = DEFAULT_PALETTE[i].label;

      // Save on input (immediate to palette array, debounced to localStorage)
      input.addEventListener("input", () => {
        this.palette[i].label = input.value.trim() || DEFAULT_PALETTE[i].label;
      });

      row.append(input);
      rows.append(row);
    }

    panel.append(rows);

    // Done button
    const doneBtn = el("button", "wcal__config-done");
    doneBtn.type = "button";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => {
      // Finalize: ensure empty inputs get defaults
      for (let i = 0; i < this.palette.length; i++) {
        if (!this.palette[i].label.trim()) {
          this.palette[i].label = DEFAULT_PALETTE[i].label;
        }
      }
      savePaletteLabels(this.palette);
      this._refreshAllTags();
      this._closePaletteConfig();
    });
    panel.append(doneBtn);

    // Escape to close
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        doneBtn.click(); // save & close
      }
    });

    overlay.append(panel);
    this.mountEl.closest(".wcal-frame").append(overlay);
    this._paletteConfigEl = overlay;

    // Focus first input
    requestAnimationFrame(() => {
      const firstInput = panel.querySelector(".wcal__config-input");
      if (firstInput) firstInput.focus();
    });
  }

  _closePaletteConfig() {
    if (this._paletteConfigEl) {
      this._paletteConfigEl.remove();
      this._paletteConfigEl = null;
    }
  }

  // ── Document click handler ────────────────────────────

  _handleDocClick(e) {
    if (this._activePicker) {
      const picker = this._activePicker.element;
      if (!picker.contains(e.target)) {
        this._closePicker();
      }
    }
  }

  // ── Tag operations ────────────────────────────────────

  _selectTag(dateYmd, cell, color, label) {
    this.tagsCache.set(dateYmd, { color, label });
    this._applyTagToCell(dateYmd, cell);
    this._saveTag(this.ownerProfile.id, dateYmd, color, label);
  }

  _clearTag(dateYmd, cell) {
    this.tagsCache.delete(dateYmd);
    this._applyTagToCell(dateYmd, cell);
    this._deleteTag(this.ownerProfile.id, dateYmd);
  }

  // ── Supabase I/O ──────────────────────────────────────

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
        this.tagsCache.set(row.tag_date, { color: row.color, label: row.label });
      }
    } catch (err) {
      console.error("[WaveCal] Load tags error:", err);
    }
  }

  async _saveTag(profileId, dateYmd, color, label) {
    if (!this.supabaseClient || !this.userId) return;

    try {
      const { error } = await this.supabaseClient
        .from("wave_calendar_tags")
        .upsert({
          user_id: this.userId,
          profile_id: profileId,
          tag_date: dateYmd,
          color,
          label,
        }, { onConflict: "profile_id,tag_date" });

      if (error) console.error("[WaveCal] Failed to save tag:", error);
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

      if (error) console.error("[WaveCal] Failed to delete tag:", error);
    } catch (err) {
      console.error("[WaveCal] Delete tag error:", err);
    }
  }
}
