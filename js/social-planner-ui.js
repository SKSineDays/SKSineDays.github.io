import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { getAccessToken as defaultGetAccessToken } from "./supabase-client.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthStartUTC(date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function ymd(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function startOfCalendarGrid(year, monthIndex, weekStart) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const dow = first.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(first, -delta);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class SocialPlannerUI {
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.ownerProfile = opts.ownerProfile || null;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;
    this.canHost = !!opts.canHost;
    this.getAccessToken = opts.getAccessToken || defaultGetAccessToken;
    this.onSuccess = opts.onSuccess || (() => {});
    this.onError = opts.onError || (() => {});
    this.onChange = opts.onChange || (() => {});

    this.monthDateUTC = monthStartUTC();
    this.planner = null;
    this.friends = [];
    this.monthSummary = null;
    this.activeDateYmd = null;
    this.activePlannerId = null;
    this.preferredPlannerId = null;
    this.noteTimers = new Map();
    this._renderGen = 0;
    this.els = null;
  }

  destroy() {
    for (const timerId of this.noteTimers.values()) {
      clearTimeout(timerId);
    }
    this.noteTimers.clear();
    this.preferredPlannerId = null;
    this.mountEl.innerHTML = "";
  }

  setOwnerProfile(profile) {
    this.ownerProfile = profile || null;
    void this.render();
  }

  setSettings({ locale, weekStart }) {
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    void this.render();
  }

  setCanHost(value) {
    this.canHost = !!value;
    void this.render();
  }

  _currentPlannerId() {
    return this.activePlannerId || this.planner?.id || null;
  }

  async render() {
    const gen = ++this._renderGen;
    this.mountEl.innerHTML = "";

    const frame = el("div", "social-frame");
    frame.innerHTML = `
      <div class="social-frame__header">
        <div>
          <div class="social-frame__eyebrow">Shared planning</div>
          <div class="social-frame__title">Social Planner</div>
        </div>

        <div class="social-frame__nav planner-frame__nav">
          <button class="planner-frame__navbtn" type="button" data-social-nav="-1" aria-label="Previous month">←</button>
          <div class="planner-frame__range" data-social-range></div>
          <button class="planner-frame__navbtn" type="button" data-social-nav="1" aria-label="Next month">→</button>
        </div>
      </div>

      <div class="social-frame__actions">
        <button class="btn btn-primary btn-sm" type="button" data-social-open-add>+ Add Friend</button>
        <button class="btn btn-ghost btn-sm" type="button" data-social-open-friends>Friends List</button>
        <span class="social-frame__chip" data-social-chip>Invite-only</span>
      </div>

      <div class="social-frame__mount" data-social-mount>
        <div class="text-muted">Loading Social Planner…</div>
      </div>

      <div class="sheet-backdrop" data-social-add-backdrop hidden></div>
      <section class="sheet social-add-sheet" data-social-add-sheet hidden role="dialog" aria-modal="true" aria-label="Add Friend">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content">
          <h3 class="social-sheet__title">Add Friend</h3>
          <p class="text-muted" style="margin-top:0;">Send a request by email. Once accepted, they appear in this shared planner.</p>
          <form data-social-add-form>
            <div class="form-group">
              <label for="social-friend-email">Friend email</label>
              <input id="social-friend-email" name="email" type="email" placeholder="friend@example.com" required>
            </div>
            <div class="add-profile-sheet__actions">
              <button class="btn btn-ghost" type="button" data-social-close-add>Cancel</button>
              <button class="btn btn-primary" type="submit">Send Request</button>
            </div>
          </form>
        </div>
      </section>

      <div class="sheet-backdrop" data-social-friends-backdrop hidden></div>
      <section class="sheet social-friends-sheet" data-social-friends-sheet hidden role="dialog" aria-modal="true" aria-label="Friends List">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content">
          <h3 class="social-sheet__title">Friends</h3>
          <div data-social-friends-list></div>
        </div>
      </section>

      <div class="sheet-backdrop" data-social-day-backdrop hidden></div>
      <section class="sheet social-day-sheet" data-social-day-sheet hidden role="dialog" aria-modal="true" aria-label="Social Day View">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content" data-social-day-content></div>
      </section>
    `;

    this.mountEl.append(frame);

    this.els = {
      frame,
      range: frame.querySelector("[data-social-range]"),
      chip: frame.querySelector("[data-social-chip]"),
      mount: frame.querySelector("[data-social-mount]"),
      addBackdrop: frame.querySelector("[data-social-add-backdrop]"),
      addSheet: frame.querySelector("[data-social-add-sheet]"),
      addForm: frame.querySelector("[data-social-add-form]"),
      addClose: frame.querySelector("[data-social-close-add]"),
      friendsBackdrop: frame.querySelector("[data-social-friends-backdrop]"),
      friendsSheet: frame.querySelector("[data-social-friends-sheet]"),
      friendsList: frame.querySelector("[data-social-friends-list]"),
      dayBackdrop: frame.querySelector("[data-social-day-backdrop]"),
      daySheet: frame.querySelector("[data-social-day-sheet]"),
      dayContent: frame.querySelector("[data-social-day-content]"),
    };

    frame.querySelectorAll("[data-social-nav]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const delta = Number(btn.dataset.socialNav || "0");
        this.monthDateUTC = new Date(Date.UTC(
          this.monthDateUTC.getUTCFullYear(),
          this.monthDateUTC.getUTCMonth() + delta,
          1
        ));
        await this._refresh();
      });
    });

    frame.querySelector("[data-social-open-add]")?.addEventListener("click", () => {
      if (!this.canHost) {
        this.onError("Hosting the Social Planner requires Premium. Accepted invites can still appear here.");
        return;
      }
      this._openSheet(this.els.addSheet, this.els.addBackdrop);
      this.els.addForm?.querySelector("input")?.focus();
    });

    frame.querySelector("[data-social-open-friends]")?.addEventListener("click", () => {
      this._renderFriendsList();
      this._openSheet(this.els.friendsSheet, this.els.friendsBackdrop);
    });

    this.els.addClose?.addEventListener("click", () => {
      this._closeSheet(this.els.addSheet, this.els.addBackdrop);
    });

    this.els.addBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.addSheet, this.els.addBackdrop);
    });

    this.els.friendsBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.friendsSheet, this.els.friendsBackdrop);
    });

    this.els.dayBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.daySheet, this.els.dayBackdrop);
    });

    this.els.addForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this._submitFriendRequest();
    });

    await this._refresh();
    if (gen !== this._renderGen) return;
  }

  async openDaySheet(dateYmd, plannerId = null) {
    if (plannerId) {
      this.preferredPlannerId = plannerId;
    }
    if (dateYmd && /^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
      const [y, m] = dateYmd.split("-").map(Number);
      this.monthDateUTC = new Date(Date.UTC(y, m - 1, 1));
    }
    await this._refresh();
    if (dateYmd) {
      await this._loadAndRenderDaySheet(dateYmd);
    }
  }

  async _refresh() {
    this.els.range.textContent = new Intl.DateTimeFormat(this.locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(this.monthDateUTC);

    try {
      this.friends = await this._loadFriends();
      this.planner = await this._resolvePlanner();
      this._renderFriendsList();

      if (!this.planner) {
        this.activePlannerId = null;
        this._renderEmptyState();
        return;
      }

      this.activePlannerId = this.planner.id;
      const pid = this.planner.id;
      this.monthSummary = await this._apiJson(
        `/api/social/month-summary?planner_id=${encodeURIComponent(pid)}&year=${this.monthDateUTC.getUTCFullYear()}&month=${this.monthDateUTC.getUTCMonth() + 1}&week_start=${encodeURIComponent(String(this.weekStart))}`
      );

      this.els.chip.textContent = `${this.monthSummary?.planner?.memberCount || 0} members`;
      this._renderMonthGrid();
    } catch (err) {
      console.error("Social Planner refresh failed:", err);
      this.els.mount.innerHTML = `<div class="locked-section"><p>Could not load Social Planner.</p><p class="text-muted">${escapeHtml(err.message || "Try again.")}</p></div>`;
    }
  }

  async _resolvePlanner() {
    if (!this.supabaseClient || !this.userId) return null;

    if (this.preferredPlannerId) {
      const { data: preferred, error: prefErr } = await this.supabaseClient
        .from("social_planners")
        .select("id, title, owner_user_id, owner_profile_id, timezone")
        .eq("id", this.preferredPlannerId)
        .eq("is_archived", false)
        .maybeSingle();

      if (!prefErr && preferred) {
        return preferred;
      }
      this.preferredPlannerId = null;
    }

    if (this.canHost && this.ownerProfile?.id) {
      const { data: ownedPlanner, error: ownedErr } = await this.supabaseClient
        .from("social_planners")
        .select("id, title, owner_user_id, owner_profile_id, timezone")
        .eq("owner_user_id", this.userId)
        .eq("is_archived", false)
        .maybeSingle();

      if (ownedErr) throw ownedErr;
      if (ownedPlanner) return ownedPlanner;
    }

    const { data: membership, error: memberErr } = await this.supabaseClient
      .from("social_planner_members")
      .select("planner_id, created_at")
      .eq("user_id", this.userId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberErr) throw memberErr;
    if (!membership?.planner_id) return null;

    const { data: planner, error: plannerErr } = await this.supabaseClient
      .from("social_planners")
      .select("id, title, owner_user_id, owner_profile_id, timezone")
      .eq("id", membership.planner_id)
      .eq("is_archived", false)
      .maybeSingle();

    if (plannerErr) throw plannerErr;
    return planner || null;
  }

  async _loadFriends() {
    if (!this.supabaseClient || !this.userId) return [];
    const { data, error } = await this.supabaseClient
      .from("social_connections")
      .select("id, friend_user_id, friend_email, friend_display_name")
      .eq("user_id", this.userId)
      .order("friend_display_name", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  _renderEmptyState() {
    const canHostText = this.canHost
      ? "Use Add Friend to start your shared planner."
      : "Hosting requires Premium. If someone invites you, their shared planner will appear here.";

    this.els.chip.textContent = this.canHost ? "Ready to host" : "Invite-only";
    this.els.mount.innerHTML = `
      <div class="locked-section">
        <p>Social Planner is ready.</p>
        <p class="text-muted">${escapeHtml(canHostText)}</p>
      </div>
    `;
  }

  _renderFriendsList() {
    if (!this.els?.friendsList) return;

    if (!this.friends.length) {
      this.els.friendsList.innerHTML = `<p class="text-muted">No friends connected yet.</p>`;
      return;
    }

    this.els.friendsList.innerHTML = `
      <div class="social-friends-list">
        ${this.friends.map((friend) => `
          <article class="social-friend-row">
            <div class="social-friend-row__name">${escapeHtml(friend.friend_display_name || friend.friend_email)}</div>
            <div class="social-friend-row__meta">${escapeHtml(friend.friend_email)}</div>
          </article>
        `).join("")}
      </div>
    `;
  }

  _renderMonthGrid() {
    const summary = this.monthSummary;
    const year = this.monthDateUTC.getUTCFullYear();
    const monthIndex = this.monthDateUTC.getUTCMonth();
    const gridStart = startOfCalendarGrid(year, monthIndex, this.weekStart);
    const todayYmd = ymd(new Date(Date.UTC(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate()
    )));
    const monthData = new Map((summary?.days || []).map((day) => [day.date, day]));

    const weekdayNames = [];
    for (let i = 0; i < 7; i++) {
      const ref = addDaysUTC(new Date(Date.UTC(2024, 0, 7)), (this.weekStart + i) % 7);
      weekdayNames.push(
        new Intl.DateTimeFormat(this.locale, { weekday: "short", timeZone: "UTC" }).format(ref)
      );
    }

    const grid = el("div", "social-frame__month");

    weekdayNames.forEach((label) => {
      const cell = el("div", "social-frame__weekday");
      cell.textContent = label;
      grid.append(cell);
    });

    for (let i = 0; i < 42; i++) {
      const dateUTC = addDaysUTC(gridStart, i);
      const dateYmd = ymd(dateUTC);
      const inMonth = dateUTC.getUTCMonth() === monthIndex;
      const dayPayload = monthData.get(dateYmd);
      const memberDays = dayPayload?.members || [];
      const activityCount = dayPayload?.activityCount || 0;

      const cell = el("button", "social-frame__cell");
      cell.type = "button";
      cell.dataset.date = dateYmd;
      if (!inMonth) cell.classList.add("is-outside");
      if (dateYmd === todayYmd) cell.classList.add("is-today");

      cell.innerHTML = `
        <div class="social-frame__cell-top">
          <span class="social-frame__day-num">${dateUTC.getUTCDate()}</span>
          ${activityCount > 0 ? `<span class="social-frame__activity-dot" aria-hidden="true"></span>` : ""}
        </div>
        <div class="social-frame__member-stack">
          ${memberDays.slice(0, 4).map((member) => `
            <img
              class="social-frame__member-duck"
              src="${duckUrlFromSinedayNumber(member.dayNumber)}"
              alt="${escapeHtml(member.displayName)} Day ${member.dayNumber}"
              title="${escapeHtml(member.displayName)} • Day ${member.dayNumber}"
              loading="lazy"
            >
          `).join("")}
        </div>
      `;

      cell.addEventListener("click", async () => {
        await this._loadAndRenderDaySheet(dateYmd);
      });

      grid.append(cell);
    }

    this.els.mount.innerHTML = "";
    this.els.mount.append(grid);
  }

  async _loadAndRenderDaySheet(dateYmd) {
    try {
      const plannerId = this._currentPlannerId();
      if (!plannerId) return;

      const data = await this._apiJson(
        `/api/social/day-summary?planner_id=${encodeURIComponent(plannerId)}&date=${encodeURIComponent(dateYmd)}&locale=${encodeURIComponent(this.locale)}`
      );

      this.activeDateYmd = dateYmd;
      this._renderDaySheet(data);
      this._openSheet(this.els.daySheet, this.els.dayBackdrop);
    } catch (err) {
      console.error("Failed to open social day:", err);
      this.onError(err.message || "Failed to open social day.");
    }
  }

  _renderDaySheet(data) {
    const dayLabel = data?.label || this.activeDateYmd;
    const members = data?.members || [];

    this.els.dayContent.innerHTML = `
      <div class="social-day-sheet__header">
        <div>
          <div class="muted">Shared day view</div>
          <h3 class="social-sheet__title">${escapeHtml(dayLabel)}</h3>
        </div>
      </div>

      <div class="social-day-sheet__cards">
        ${members.map((member) => {
          const ownCard = member.isCurrentUser === true;
          const note = member.note?.content || "";
          const tasks = (member.tasks || []).filter((task) => !task.is_archived);

          return `
            <article class="social-day-card ${ownCard ? "is-own" : "is-readonly"}" data-member-user-id="${escapeHtml(member.userId)}">
              <div class="social-day-card__header">
                <div class="social-day-card__identity">
                  <img
                    class="social-day-card__duck"
                    src="${duckUrlFromSinedayNumber(member.dayNumber)}"
                    alt="${escapeHtml(member.displayName)} Day ${member.dayNumber}"
                  >
                  <div>
                    <div class="social-day-card__name">${escapeHtml(member.displayName)}</div>
                    <div class="social-day-card__meta">Day ${member.dayNumber}</div>
                  </div>
                </div>
                <div class="social-day-card__badge">${ownCard ? "You" : "Read only"}</div>
              </div>

              <div class="social-day-card__section">
                ${ownCard ? `
                  <label class="social-day-card__label" for="social-note-${escapeHtml(member.userId)}">Notes</label>
                  <textarea
                    id="social-note-${escapeHtml(member.userId)}"
                    class="social-day-card__note"
                    data-social-note
                    data-user-id="${escapeHtml(member.userId)}"
                    placeholder="Write your note for this shared day…"
                  >${escapeHtml(note)}</textarea>
                  <div class="social-day-card__savehint">Auto-saves to your own card only.</div>
                ` : `
                  <div class="social-day-card__label">Notes</div>
                  <div class="social-day-card__readbox">${note ? escapeHtml(note).replace(/\n/g, "<br>") : `<span class="text-muted">No note yet.</span>`}</div>
                `}
              </div>

              <div class="social-day-card__section">
                <div class="social-day-card__label">Tasks</div>

                ${ownCard ? `
                  <div class="social-day-card__taskadd">
                    <input type="text" class="social-day-card__taskinput" data-social-task-input placeholder="Add a task for this day">
                    <button class="btn btn-primary btn-sm" type="button" data-social-task-add>Add</button>
                  </div>
                ` : ""}

                <div class="social-day-card__tasks">
                  ${tasks.length ? tasks.map((task) => `
                    <div class="social-task-row" data-task-id="${escapeHtml(task.id)}">
                      <label class="social-task-row__check">
                        <input
                          type="checkbox"
                          ${task.is_completed ? "checked" : ""}
                          ${ownCard ? `data-social-task-toggle` : "disabled"}
                        >
                        <span class="${task.is_completed ? "is-complete" : ""}">${escapeHtml(task.title)}</span>
                      </label>
                      ${ownCard ? `<button class="social-task-row__archive" type="button" data-social-task-archive>Archive</button>` : ""}
                    </div>
                  `).join("") : `<div class="text-muted">No tasks yet.</div>`}
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;

    this.els.dayContent.querySelectorAll("[data-social-note]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        this._scheduleSaveNote(this.activeDateYmd, textarea.value);
      });
      textarea.addEventListener("blur", () => {
        this._saveNote(this.activeDateYmd, textarea.value).catch((err) => {
          console.error("Note save failed:", err);
          this.onError("Failed to save note.");
        });
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-add]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".social-day-card");
        const input = card?.querySelector("[data-social-task-input]");
        const title = input?.value?.trim();
        if (!title) return;

        try {
          await this._addTask(this.activeDateYmd, title);
          input.value = "";
          await this._loadAndRenderDaySheet(this.activeDateYmd);
          await this._refresh();
        } catch (err) {
          console.error("Add task failed:", err);
          this.onError("Failed to add task.");
        }
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-toggle]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const row = checkbox.closest(".social-task-row");
        const taskId = row?.dataset.taskId;
        if (!taskId) return;

        try {
          await this._toggleTask(taskId, checkbox.checked);
          await this._loadAndRenderDaySheet(this.activeDateYmd);
          await this._refresh();
        } catch (err) {
          console.error("Toggle task failed:", err);
          this.onError("Failed to update task.");
        }
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-archive]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".social-task-row");
        const taskId = row?.dataset.taskId;
        if (!taskId) return;

        try {
          await this._archiveTask(taskId);
          await this._loadAndRenderDaySheet(this.activeDateYmd);
          await this._refresh();
        } catch (err) {
          console.error("Archive task failed:", err);
          this.onError("Failed to archive task.");
        }
      });
    });
  }

  _scheduleSaveNote(dateYmd, content) {
    const key = `${this._currentPlannerId()}:${dateYmd}`;
    const existing = this.noteTimers.get(key);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      this._saveNote(dateYmd, content).catch((err) => {
        console.error("Debounced note save failed:", err);
      });
    }, 450);

    this.noteTimers.set(key, timerId);
  }

  async _saveNote(dateYmd, content) {
    const plannerId = this._currentPlannerId();
    if (!this.supabaseClient || !plannerId || !this.ownerProfile?.id) return;

    const { error } = await this.supabaseClient
      .from("social_day_entries")
      .upsert({
        planner_id: plannerId,
        entry_date: dateYmd,
        author_user_id: this.userId,
        author_profile_id: this.ownerProfile.id,
        content: content ?? ""
      }, {
        onConflict: "planner_id,entry_date,author_user_id"
      });

    if (error) throw error;
    this.onChange();
  }

  async _addTask(dateYmd, title) {
    const plannerId = this._currentPlannerId();
    if (!this.supabaseClient || !plannerId || !this.ownerProfile?.id) return;

    const { error } = await this.supabaseClient
      .from("social_day_tasks")
      .insert({
        planner_id: plannerId,
        task_date: dateYmd,
        author_user_id: this.userId,
        author_profile_id: this.ownerProfile.id,
        title,
        is_completed: false,
        sort_order: 0
      });

    if (error) throw error;
    this.onChange();
  }

  async _toggleTask(taskId, checked) {
    const { error } = await this.supabaseClient
      .from("social_day_tasks")
      .update({
        is_completed: checked,
        completed_at: checked ? new Date().toISOString() : null
      })
      .eq("id", taskId)
      .eq("author_user_id", this.userId);

    if (error) throw error;
    this.onChange();
  }

  async _archiveTask(taskId) {
    const { error } = await this.supabaseClient
      .from("social_day_tasks")
      .update({ is_archived: true })
      .eq("id", taskId)
      .eq("author_user_id", this.userId);

    if (error) throw error;
    this.onChange();
  }

  async _submitFriendRequest() {
    const input = this.els.addForm?.querySelector("input[name='email']");
    const recipientEmail = input?.value?.trim().toLowerCase();
    if (!recipientEmail) return;

    try {
      const accessToken = await this.getAccessToken();
      const response = await fetch("/api/social/friend-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ recipientEmail })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "Failed to send friend request");
      }

      input.value = "";
      this._closeSheet(this.els.addSheet, this.els.addBackdrop);
      this.onSuccess("Friend request sent.");
      this.onChange();
      await this._refresh();
    } catch (err) {
      console.error("Friend request failed:", err);
      this.onError(err.message || "Failed to send friend request.");
    }
  }

  async _apiJson(url, options = {}) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data?.error || "Request failed");
    }
    return data;
  }

  _openSheet(sheet, backdrop) {
    if (!sheet || !backdrop) return;
    sheet.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      sheet.classList.add("is-open");
      backdrop.classList.add("is-open");
    });
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }

  _closeSheet(sheet, backdrop) {
    if (!sheet || !backdrop) return;
    sheet.classList.remove("is-open");
    backdrop.classList.remove("is-open");

    setTimeout(() => {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }, 220);
  }
}
