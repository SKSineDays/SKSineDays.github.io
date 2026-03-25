/**
 * Planner UI — cloud-synced daily notes with SineDuck display + recurring tasks.
 * Notes use planner_tasks (separate tables). Notes stay on planner_notes.
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

const MS_PER_DAY = 86400000;

const REPEAT_MODES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
  "sineday",
];

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

function compareYmd(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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

    this.taskSeries = [];
    this.taskSeriesLoadedForProfileId = null;
    this.taskCompletionCache = new Map();
    this.repeatSheetState = { open: false, taskId: null, occurrenceYmd: null };
    this.repeatSheetEls = null;
    this._draftSeq = 0;
    this._draftMeta = new Map();
    this._repeatSheetEscape = null;
    this._repeatSheetOverflowPrev = { html: "", body: "" };
  }

  destroy() {
    this._closeRepeatSheet(true);
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
    this.taskSeries = [];
    this.taskSeriesLoadedForProfileId = null;
    this.taskCompletionCache.clear();
    this._draftMeta.clear();
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
    if (this.taskSeriesLoadedForProfileId !== (profile && profile.id)) {
      this.taskSeriesLoadedForProfileId = null;
      this.taskSeries = [];
    }
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
    this._closeRepeatSheet(false);

    const gen = ++this._renderGen;

    this.mountEl.innerHTML = "";

    if (!this.ownerProfile) {
      const empty = el("div", "sdcal__empty");
      empty.textContent = "Planner notes are available for your owner profile.";
      this.mountEl.append(empty);
      return;
    }

    const profileId = this.ownerProfile.id;

    if (this.view === "day") {
      const d = this.dayDateUTC;
      const ymd = this._ymd(d);

      const wrap = el("div", "planner__day-view");
      const card = this._buildDayCard(d, ymd);
      wrap.append(card);
      this.mountEl.append(wrap);

      await this._loadNotes(profileId, ymd, ymd);
      await this._loadTaskSeries(profileId);
      await this._loadTaskCompletions(profileId, ymd, ymd);
      if (gen !== this._renderGen) return;

      const textarea = card.querySelector(".planner__textarea");
      if (textarea) {
        const cached = this.notesCache.get(`${profileId}:${ymd}`);
        if (cached !== undefined && textarea.value === "") {
          textarea.value = cached;
        }
      }
      const listEl = card.querySelector(".planner__task-list");
      if (listEl) this._renderTaskList(listEl, ymd);
      return;
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDaysUTC(this.weekStartDateUTC, i));
    }

    const wrap = el("div", "planner__week");
    const cards = new Map();

    for (const d of days) {
      const ymd = this._ymd(d);
      const card = this._buildDayCard(d, ymd);
      cards.set(ymd, card);
      wrap.append(card);
    }
    this.mountEl.append(wrap);

    const startYmd = this._ymd(days[0]);
    const endYmd = this._ymd(days[6]);
    await this._loadNotes(profileId, startYmd, endYmd);
    await this._loadTaskSeries(profileId);
    await this._loadTaskCompletions(profileId, startYmd, endYmd);
    if (gen !== this._renderGen) return;

    for (const [ymd, card] of cards) {
      const textarea = card.querySelector(".planner__textarea");
      if (textarea) {
        const cached = this.notesCache.get(`${profileId}:${ymd}`);
        if (cached !== undefined && textarea.value === "") {
          textarea.value = cached;
        }
      }
      const listEl = card.querySelector(".planner__task-list");
      if (listEl) this._renderTaskList(listEl, ymd);
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

    const body = el("div", "planner__body");

    const notesPane = el("div", "planner__notes-pane");
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

    notesPane.append(textarea);

    const tasksPane = el("div", "planner__tasks-pane");
    const tasksHeader = el("div", "planner__tasks-header");
    const tasksTitle = el("div", "planner__tasks-title");
    tasksTitle.textContent = "Tasks";
    const addBtn = el("button", "planner__task-addbtn");
    addBtn.type = "button";
    addBtn.textContent = "Add task";
    addBtn.setAttribute("aria-label", "Add task");
    const listEl = el("div", "planner__task-list");
    listEl.dataset.ymd = ymd;

    addBtn.addEventListener("click", () => {
      this._addDraftTaskRow(listEl, ymd);
    });

    tasksHeader.append(tasksTitle, addBtn);
    tasksPane.append(tasksHeader, listEl);

    body.append(notesPane, tasksPane);

    dayEl.append(header, body, indicator);
    return dayEl;
  }

  _addDraftTaskRow(listEl, ymd) {
    listEl.querySelector(".planner__task-empty")?.remove();
    const draftId = `draft-${++this._draftSeq}`;
    const row = this._buildDraftTaskRow(listEl, ymd, draftId);
    listEl.append(row);
    this._draftMeta.set(draftId, { ymd, listEl });
    row.querySelector(".planner__task-title")?.focus();
  }

  _buildDraftTaskRow(listEl, ymd, draftId) {
    const row = el("div", "planner__task-row");
    row.dataset.draftId = draftId;

    const check = el("input", "planner__task-check");
    check.type = "checkbox";
    check.disabled = true;
    check.title = "Save the task to enable completion";

    const mid = el("div", "planner__task-row-middle");
    const titleInput = el("input", "planner__task-title");
    titleInput.type = "text";
    titleInput.placeholder = "Task title…";
    titleInput.setAttribute("aria-label", "Task title");

    const titleWrap = el("div", "planner__task-title-wrap");
    titleWrap.append(titleInput);

    const repeatBtn = el("button", "planner__task-repeatbtn");
    repeatBtn.type = "button";
    repeatBtn.innerHTML = "&#128339;";
    repeatBtn.title = "Repeat settings";
    repeatBtn.disabled = true;

    const delBtn = el("button", "planner__task-deletebtn");
    delBtn.type = "button";
    delBtn.textContent = "×";
    delBtn.title = "Remove";

    const btnRow = el("div", "planner__task-actions");
    btnRow.append(repeatBtn, delBtn);

    const flushDraft = async () => {
      if (!row.isConnected) return;
      const v = titleInput.value.trim();
      if (!v) {
        row.remove();
        this._draftMeta.delete(draftId);
        return;
      }
      await this._persistDraftTask(listEl, ymd, draftId, v, row);
    };

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      }
    });

    titleInput.addEventListener("blur", () => {
      flushDraft();
    });

    delBtn.addEventListener("click", () => {
      row.remove();
      this._draftMeta.delete(draftId);
    });

    mid.append(titleWrap, btnRow);
    row.append(check, mid);
    return row;
  }

  async _persistDraftTask(listEl, ymd, draftId, title, rowEl) {
    if (!this.supabaseClient || !this.userId) return;

    const profileId = this.ownerProfile.id;
    const maxOrder = this.taskSeries.reduce(
      (m, t) => Math.max(m, t.sort_order ?? 0),
      0
    );

    try {
      const { error } = await this.supabaseClient.from("planner_tasks").insert({
        user_id: this.userId,
        profile_id: profileId,
        title,
        start_date: ymd,
        repeat_mode: "none",
        repeat_interval: 1,
        repeat_sinedays: [],
        sort_order: maxOrder + 1,
      });

      if (error) {
        console.error("[Planner] Draft task insert failed:", error);
        return;
      }

      rowEl.remove();
      this._draftMeta.delete(draftId);
      await this._loadTaskSeries(profileId);
      this._renderTaskList(listEl, ymd);
    } catch (err) {
      console.error("[Planner] Draft task error:", err);
    }
  }

  _renderTaskList(listEl, ymd) {
    const drafts = [...listEl.querySelectorAll(".planner__task-row[data-draft-id]")];
    listEl.replaceChildren();
    const visible = this._getVisibleTasksForDate(ymd);
    for (const t of visible) {
      listEl.append(this._buildTaskRow(t, ymd, listEl));
    }
    if (visible.length === 0 && drafts.length === 0) {
      const empty = el("div", "planner__task-empty");
      empty.textContent = "No tasks for this day.";
      listEl.append(empty);
    }
    for (const d of drafts) {
      listEl.append(d);
    }
  }

  _refreshAllTaskLists() {
    this.mountEl
      .querySelectorAll(".planner__task-list[data-ymd]")
      .forEach((listEl) => {
        const ymd = listEl.dataset.ymd;
        if (ymd) this._renderTaskList(listEl, ymd);
      });
  }

  _buildTaskRow(task, ymd, listEl) {
    const row = el("div", "planner__task-row");
    row.dataset.taskId = task.id;

    const cacheKey = `${task.id}:${ymd}`;
    const completed = !!this.taskCompletionCache.get(cacheKey);

    const check = el("input", "planner__task-check");
    check.type = "checkbox";
    check.checked = completed;
    check.setAttribute("aria-label", `Complete: ${task.title}`);
    if (completed) row.classList.add("is-completed");

    check.addEventListener("change", () => {
      this._toggleTaskCompletion(task, ymd, check.checked, row, check);
    });

    const mid = el("div", "planner__task-row-middle");
    const titleInput = el("input", "planner__task-title");
    titleInput.type = "text";
    titleInput.value = task.title;
    titleInput.setAttribute("aria-label", "Task title");

    const meta = el("div", "planner__task-repeatmeta");
    meta.textContent = this._formatRepeatMeta(task);

    const titleWrap = el("div", "planner__task-title-wrap");
    titleWrap.append(titleInput, meta);

    const repeatBtn = el("button", "planner__task-repeatbtn");
    repeatBtn.type = "button";
    repeatBtn.innerHTML = "&#128339;";
    repeatBtn.title = "Repeat settings";
    const mode = task.repeat_mode || "none";
    if (mode !== "none") repeatBtn.classList.add("is-active");

    repeatBtn.addEventListener("click", () => {
      this._openRepeatSheet(task, ymd);
    });

    const delBtn = el("button", "planner__task-deletebtn");
    delBtn.type = "button";
    delBtn.textContent = "×";
    delBtn.title = "Archive task";

    const saveTitle = async () => {
      const v = titleInput.value.trim();
      if (!v) {
        await this._archiveTask(task.id);
        this._renderTaskList(listEl, ymd);
        return;
      }
      if (v !== task.title) {
        await this._updateTask(task.id, { title: v });
        task.title = v;
      }
    };

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      }
    });

    titleInput.addEventListener("blur", () => {
      saveTitle();
    });

    delBtn.addEventListener("click", async () => {
      await this._archiveTask(task.id);
      this._renderTaskList(listEl, ymd);
    });

    const btnRow = el("div", "planner__task-actions");
    btnRow.append(repeatBtn, delBtn);

    mid.append(titleWrap, btnRow);
    row.append(check, mid);
    return row;
  }

  async _toggleTaskCompletion(task, ymd, checked, rowEl, checkEl) {
    if (!this.supabaseClient || !this.userId) return;

    const cacheKey = `${task.id}:${ymd}`;
    const profileId = this.ownerProfile.id;

    if (checked) {
      this.taskCompletionCache.set(cacheKey, true);
      rowEl.classList.add("is-completed");
      try {
        const { error } = await this.supabaseClient
          .from("planner_task_completions")
          .insert({
            task_id: task.id,
            user_id: this.userId,
            profile_id: profileId,
            occurrence_date: ymd,
          });

        if (
          error &&
          error.code !== "23505" &&
          !`${error.message}`.toLowerCase().includes("duplicate")
        ) {
          console.error("[Planner] Completion insert failed:", error);
          this.taskCompletionCache.delete(cacheKey);
          checkEl.checked = false;
          rowEl.classList.remove("is-completed");
        }
      } catch (err) {
        console.error("[Planner] Completion error:", err);
        this.taskCompletionCache.delete(cacheKey);
        checkEl.checked = false;
        rowEl.classList.remove("is-completed");
      }
    } else {
      this.taskCompletionCache.delete(cacheKey);
      rowEl.classList.remove("is-completed");
      try {
        const { error } = await this.supabaseClient
          .from("planner_task_completions")
          .delete()
          .eq("task_id", task.id)
          .eq("occurrence_date", ymd);

        if (error) {
          console.error("[Planner] Completion delete failed:", error);
        }
      } catch (err) {
        console.error("[Planner] Completion delete error:", err);
      }
    }
  }

  async _updateTask(taskId, patch) {
    if (!this.supabaseClient) return;

    try {
      const { error } = await this.supabaseClient
        .from("planner_tasks")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (error) console.error("[Planner] Task update failed:", error);
      else await this._loadTaskSeries(this.ownerProfile.id);
    } catch (err) {
      console.error("[Planner] Task update error:", err);
    }
  }

  async _archiveTask(taskId) {
    if (!this.supabaseClient) return;

    try {
      const { error } = await this.supabaseClient
        .from("planner_tasks")
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq("id", taskId);

      if (error) console.error("[Planner] Archive task failed:", error);
      else await this._loadTaskSeries(this.ownerProfile.id);
    } catch (err) {
      console.error("[Planner] Archive task error:", err);
    }
  }

  _ensureRepeatSheet() {
    if (this.repeatSheetEls) return;

    const backdrop = el("div", "sheet-backdrop planner-repeat-sheet__backdrop");
    backdrop.hidden = true;

    const sheet = el("div", "sheet planner-repeat-sheet");
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Repeat settings");

    const handle = el("div", "sheet__handle");
    const content = el("div", "sheet__content planner-repeat-sheet__content");

    const title = el("div", "planner-repeat-sheet__title");
    title.textContent = "Repeat";

    const modeGroup = el("div", "planner-repeat-sheet__group");
    const modeLabel = el("div", "planner-repeat-sheet__label");
    modeLabel.textContent = "Frequency";
    const modeOptions = el("div", "planner-repeat-sheet__options");
    modeGroup.append(modeLabel, modeOptions);

    const modeRadios = {};
    const modeLabels = [
      ["none", "Does not repeat"],
      ["daily", "Daily"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
      ["yearly", "Yearly"],
      ["weekdays", "Weekdays"],
      ["sineday", "SineDuck days"],
    ];

    for (const [value, text] of modeLabels) {
      const id = `planner-repeat-${value}`;
      const wrap = el("label", "planner-repeat-sheet__radio");
      wrap.htmlFor = id;
      const radio = el("input", "planner-repeat-sheet__radio-input");
      radio.type = "radio";
      radio.name = "planner_repeat_mode";
      radio.value = value;
      radio.id = id;
      const span = el("span");
      span.textContent = text;
      wrap.prepend(radio);
      wrap.append(span);
      modeOptions.append(wrap);
      modeRadios[value] = radio;
    }

    const intervalGroup = el(
      "div",
      "planner-repeat-sheet__group planner-repeat-sheet__interval-wrap"
    );
    const intervalLabel = el("label", "planner-repeat-sheet__label");
    intervalLabel.textContent = "Every (interval)";
    intervalLabel.htmlFor = "planner-repeat-interval";
    const intervalInput = el("input", "planner-repeat-sheet__interval");
    intervalInput.id = "planner-repeat-interval";
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.max = "365";
    intervalInput.value = "1";
    intervalGroup.append(intervalLabel, intervalInput);

    const untilGroup = el("div", "planner-repeat-sheet__group");
    const untilLabel = el("label", "planner-repeat-sheet__label");
    untilLabel.textContent = "Repeat until (optional)";
    untilLabel.htmlFor = "planner-repeat-until";
    const untilInput = el("input", "planner-repeat-sheet__until");
    untilInput.id = "planner-repeat-until";
    untilInput.type = "date";
    untilGroup.append(untilLabel, untilInput);

    const chipGroup = el("div", "planner-repeat-sheet__group planner-repeat-sheet__chipsection");
    const chipLabel = el("div", "planner-repeat-sheet__label");
    chipLabel.textContent = "SineDuck days (1–18)";
    const chipGrid = el("div", "planner-repeat-sheet__chipgrid");
    const chipToggles = {};
    for (let day = 1; day <= 18; day++) {
      const chip = el("button", "planner-repeat-sheet__chip");
      chip.type = "button";
      chip.textContent = `Day ${day}`;
      chip.dataset.sineday = String(day);
      chipGrid.append(chip);
      chipToggles[day] = chip;
    }
    chipGroup.append(chipLabel, chipGrid);

    const actions = el("div", "planner-repeat-sheet__actions");
    const saveBtn = el("button", "planner-repeat-sheet__save btn btn-primary");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    const cancelBtn = el("button", "planner-repeat-sheet__cancel btn btn-ghost");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    actions.append(cancelBtn, saveBtn);

    content.append(
      title,
      modeGroup,
      intervalGroup,
      untilGroup,
      chipGroup,
      actions
    );
    sheet.append(handle, content);

    document.body.append(backdrop, sheet);

    const syncModeUI = () => {
      const mode =
        Object.keys(modeRadios).find((k) => modeRadios[k].checked) || "none";
      const showInterval = ["daily", "weekly", "monthly", "yearly"].includes(
        mode
      );
      intervalGroup.style.display = showInterval ? "" : "none";
      chipGroup.style.display = mode === "sineday" ? "" : "none";
    };

    for (const r of Object.values(modeRadios)) {
      r.addEventListener("change", syncModeUI);
    }

    for (let day = 1; day <= 18; day++) {
      chipToggles[day].addEventListener("click", () => {
        chipToggles[day].classList.toggle("is-selected");
      });
    }

    backdrop.addEventListener("click", () => this._closeRepeatSheet(false));
    cancelBtn.addEventListener("click", () => this._closeRepeatSheet(false));

    saveBtn.addEventListener("click", async () => {
      const st = this.repeatSheetState;
      if (!st.taskId) return;

      const mode =
        Object.keys(modeRadios).find((k) => modeRadios[k].checked) || "none";
      let interval = Math.max(
        1,
        Math.min(365, Number(intervalInput.value) || 1)
      );
      if (!["daily", "weekly", "monthly", "yearly"].includes(mode)) {
        interval = 1;
      }

      const untilVal = untilInput.value.trim();
      const repeat_until = untilVal || null;

      let repeat_sinedays = [];
      if (mode === "sineday") {
        for (let d = 1; d <= 18; d++) {
          if (chipToggles[d].classList.contains("is-selected")) {
            repeat_sinedays.push(d);
          }
        }
        repeat_sinedays.sort((a, b) => a - b);
      }

      await this._updateTask(st.taskId, {
        repeat_mode: mode,
        repeat_interval: interval,
        repeat_until,
        repeat_sinedays,
      });

      this._closeRepeatSheet(false);
      this._refreshAllTaskLists();
    });

    this.repeatSheetEls = {
      backdrop,
      sheet,
      modeRadios,
      intervalInput,
      untilInput,
      chipToggles,
      syncModeUI,
    };
  }

  _openRepeatSheet(task, occurrenceYmd) {
    this._ensureRepeatSheet();
    const els = this.repeatSheetEls;

    this.repeatSheetState = {
      open: true,
      taskId: task.id,
      occurrenceYmd,
    };

    const mode = task.repeat_mode || "none";
    for (const m of REPEAT_MODES) {
      els.modeRadios[m].checked = m === mode;
    }

    els.intervalInput.value = String(
      Math.max(1, Math.min(365, task.repeat_interval ?? 1))
    );

    if (task.repeat_until) {
      els.untilInput.value = task.repeat_until;
    } else {
      els.untilInput.value = "";
    }

    for (let d = 1; d <= 18; d++) {
      const arr = task.repeat_sinedays || [];
      els.chipToggles[d].classList.toggle(
        "is-selected",
        arr.some((x) => Number(x) === d)
      );
    }

    els.syncModeUI();

    els.backdrop.hidden = false;
    els.sheet.hidden = false;

    this._repeatSheetOverflowPrev.html = document.documentElement.style.overflow;
    this._repeatSheetOverflowPrev.body = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      els.backdrop.classList.add("is-open");
      els.sheet.classList.add("is-open");
    });

    if (this._repeatSheetEscape) {
      document.removeEventListener("keydown", this._repeatSheetEscape);
    }
    this._repeatSheetEscape = (e) => {
      if (e.key === "Escape" && this.repeatSheetState.open) {
        this._closeRepeatSheet(false);
      }
    };
    document.addEventListener("keydown", this._repeatSheetEscape);
  }

  _closeRepeatSheet(removeDom) {
    if (this._repeatSheetEscape) {
      document.removeEventListener("keydown", this._repeatSheetEscape);
      this._repeatSheetEscape = null;
    }

    this.repeatSheetState = {
      open: false,
      taskId: null,
      occurrenceYmd: null,
    };

    if (!this.repeatSheetEls) return;

    const { backdrop, sheet } = this.repeatSheetEls;
    sheet.classList.remove("is-open");
    backdrop.classList.remove("is-open");

    document.documentElement.style.overflow = this._repeatSheetOverflowPrev.html;
    document.body.style.overflow = this._repeatSheetOverflowPrev.body;

    if (removeDom) {
      backdrop.remove();
      sheet.remove();
      this.repeatSheetEls = null;
      return;
    }

    setTimeout(() => {
      if (!this.repeatSheetEls) return;
      backdrop.hidden = true;
      sheet.hidden = true;
    }, 220);
  }

  _dateFromYmd(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  }

  _diffDaysUTC(a, b) {
    return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
  }

  _diffMonthsUTC(a, b) {
    return (
      (a.getUTCFullYear() - b.getUTCFullYear()) * 12 +
      (a.getUTCMonth() - b.getUTCMonth())
    );
  }

  _lastDomUtc(y, monthIndex) {
    return new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
  }

  _alignDomUtc(d, domStart) {
    const last = this._lastDomUtc(d.getUTCFullYear(), d.getUTCMonth());
    return Math.min(domStart, last);
  }

  _taskOccursOnDate(task, ymd) {
    const D = this._dateFromYmd(ymd);
    const S = this._dateFromYmd(task.start_date);

    if (compareYmd(ymd, task.start_date) < 0) return false;
    if (task.repeat_until && compareYmd(ymd, task.repeat_until) > 0) {
      return false;
    }

    const mode = task.repeat_mode || "none";
    const n = Math.max(1, Math.min(365, task.repeat_interval ?? 1));

    switch (mode) {
      case "none":
        return ymd === task.start_date;
      case "daily": {
        const diff = this._diffDaysUTC(D, S);
        return diff >= 0 && diff % n === 0;
      }
      case "weekly": {
        const diff = this._diffDaysUTC(D, S);
        return diff >= 0 && diff % (7 * n) === 0;
      }
      case "monthly": {
        const months = this._diffMonthsUTC(D, S);
        if (months < 0 || months % n !== 0) return false;
        const domS = S.getUTCDate();
        return D.getUTCDate() === this._alignDomUtc(D, domS);
      }
      case "yearly": {
        const years = D.getUTCFullYear() - S.getUTCFullYear();
        if (years < 0 || years % n !== 0) return false;
        if (D.getUTCMonth() !== S.getUTCMonth()) return false;
        const domS = S.getUTCDate();
        return D.getUTCDate() === this._alignDomUtc(D, domS);
      }
      case "weekdays": {
        if (compareYmd(ymd, task.start_date) < 0) return false;
        const dow = D.getUTCDay();
        const isWeekday = dow >= 1 && dow <= 5;
        return isWeekday;
      }
      case "sineday": {
        const arr = task.repeat_sinedays || [];
        if (!arr.length) return false;
        const result = calculateSineDayForYmd(
          this.ownerProfile.birthdate,
          ymd
        );
        if (!result) return false;
        return arr.some((x) => Number(x) === result.day);
      }
      default:
        return false;
    }
  }

  _getVisibleTasksForDate(ymd) {
    return this.taskSeries
      .filter((t) => this._taskOccursOnDate(t, ymd))
      .sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (so !== 0) return so;
        return String(a.created_at).localeCompare(String(b.created_at));
      });
  }

  _formatRepeatMeta(task) {
    const mode = task.repeat_mode || "none";
    if (mode === "none") return "";

    const n = Math.max(1, task.repeat_interval ?? 1);

    switch (mode) {
      case "daily":
        return n === 1 ? "Repeats daily" : `Repeats every ${n} days`;
      case "weekly":
        return n === 1 ? "Repeats weekly" : `Repeats every ${n} weeks`;
      case "monthly":
        return n === 1 ? "Repeats monthly" : `Repeats every ${n} months`;
      case "yearly":
        return n === 1 ? "Repeats yearly" : `Repeats every ${n} years`;
      case "weekdays":
        return "Repeats weekdays";
      case "sineday": {
        const arr = [...(task.repeat_sinedays || [])]
          .map(Number)
          .filter((d) => d >= 1 && d <= 18)
          .sort((a, b) => a - b);
        if (!arr.length) return "Repeats on SineDuck days";
        return `Repeats on ${arr.map((d) => `Day ${d}`).join(" · ")}`;
      }
      default:
        return "";
    }
  }

  async _loadTaskSeries(profileId) {
    if (!this.supabaseClient) return;

    try {
      const { data, error } = await this.supabaseClient
        .from("planner_tasks")
        .select("*")
        .eq("profile_id", profileId)
        .eq("is_archived", false)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[Planner] Load tasks failed:", error);
        this.taskSeries = [];
        return;
      }

      this.taskSeries = data || [];
      this.taskSeriesLoadedForProfileId = profileId;
    } catch (err) {
      console.error("[Planner] Load tasks error:", err);
      this.taskSeries = [];
    }
  }

  async _loadTaskCompletions(profileId, startYmd, endYmd) {
    if (!this.supabaseClient) return;

    try {
      for (const key of [...this.taskCompletionCache.keys()]) {
        const parts = key.split(":");
        const dt = parts[parts.length - 1];
        if (dt >= startYmd && dt <= endYmd) {
          this.taskCompletionCache.delete(key);
        }
      }

      const { data, error } = await this.supabaseClient
        .from("planner_task_completions")
        .select("task_id, occurrence_date")
        .eq("profile_id", profileId)
        .gte("occurrence_date", startYmd)
        .lte("occurrence_date", endYmd);

      if (error) {
        console.error("[Planner] Load completions failed:", error);
        return;
      }

      for (const row of data || []) {
        this.taskCompletionCache.set(
          `${row.task_id}:${row.occurrence_date}`,
          true
        );
      }
    } catch (err) {
      console.error("[Planner] Load completions error:", err);
    }
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
