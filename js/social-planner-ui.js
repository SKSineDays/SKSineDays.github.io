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

const REPEAT_MODES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
  "sineday"
];

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
    this.viewMode = "list";
    this.planners = [];
    this.activePlanner = null;
    this.planner = null;
    this.friends = [];
    this.monthSummary = null;
    this.activeDateYmd = null;
    this.activePlannerId = null;
    this.noteTimers = new Map();
    this._noteIndicatorTimer = null;
    this._renderGen = 0;
    this.els = null;
    this._draftSeq = 0;
    this._draftMeta = new Map();
    this._socialDayTaskIndex = new Map();
    this.repeatSheetState = { open: false, taskId: null, occurrenceYmd: null };
    this.repeatSheetEls = null;
    this._repeatSheetEscape = null;
    this._repeatSheetOverflowPrev = { html: "", body: "" };
  }

  destroy() {
    this._closeRepeatSheet(true);
    this._draftMeta.clear();
    this._socialDayTaskIndex.clear();

    void this._flushPendingNoteSave();

    for (const timerId of this.noteTimers.values()) {
      clearTimeout(timerId);
    }
    this.noteTimers.clear();
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
    return this.activePlannerId || this.activePlanner?.id || null;
  }

  async render() {
    const gen = ++this._renderGen;
    this.mountEl.innerHTML = "";

    const frame = el("div", "social-frame");
    frame.innerHTML = `
      <div class="social-frame__list-head" data-social-list-head>
        <div class="social-frame__header social-frame__header--list">
          <div>
            <div class="social-frame__eyebrow">Shared planning</div>
            <div class="social-frame__title">Social Planner</div>
          </div>
        </div>
        <div class="social-frame__actions social-frame__actions--list">
          <button class="btn btn-primary btn-sm" type="button" data-social-new-calendar>New Social Calendar</button>
          <button class="btn btn-primary btn-sm" type="button" data-social-open-add>+ Add Friend</button>
          <button class="btn btn-ghost btn-sm" type="button" data-social-open-friends>Friends List</button>
        </div>
      </div>

      <div class="social-frame__month-head" data-social-month-head hidden>
        <div class="social-frame__month-top">
          <button class="btn btn-ghost btn-sm social-frame__backbtn" type="button" data-social-back>← Calendars</button>
          <div class="social-frame__month-titles">
            <div class="social-frame__eyebrow">Shared calendar</div>
            <div class="social-frame__title" data-social-planner-title>Calendar</div>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-social-manage-members hidden>Manage Members</button>
        </div>
        <div class="social-frame__header social-frame__header--month">
          <div class="social-frame__nav planner-frame__nav">
            <button class="planner-frame__navbtn" type="button" data-social-nav="-1" aria-label="Previous month">←</button>
            <div class="planner-frame__range" data-social-range></div>
            <button class="planner-frame__navbtn" type="button" data-social-nav="1" aria-label="Next month">→</button>
          </div>
          <span class="social-frame__chip" data-social-chip>0 members</span>
        </div>
      </div>

      <div class="social-frame__mount" data-social-mount>
        <div class="text-muted">Loading Social Planner…</div>
      </div>

      <div class="sheet-backdrop" data-social-add-backdrop hidden></div>
      <section class="sheet social-add-sheet" data-social-add-sheet hidden role="dialog" aria-modal="true" aria-label="Add Friend">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content">
          <h3 class="social-sheet__title">Add Friend</h3>
          <p class="text-muted" style="margin-top:0;">Send a request by email. Once accepted, they appear in your friend list. You can add them to a shared calendar afterward.</p>
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

      <div class="sheet-backdrop" data-social-create-backdrop hidden></div>
      <section class="sheet social-create-sheet" data-social-create-sheet hidden role="dialog" aria-modal="true" aria-label="New Social Calendar">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content">
          <h3 class="social-sheet__title">New Social Calendar</h3>
          <form data-social-create-form>
            <div class="form-group">
              <label for="social-create-title">Calendar title</label>
              <input id="social-create-title" name="title" type="text" required maxlength="200" placeholder="Family, School, Trip…">
            </div>
            <div class="form-group">
              <div class="social-create-friends-label">Add friends now (optional)</div>
              <div class="social-create-friends" data-social-create-friends></div>
            </div>
            <div class="add-profile-sheet__actions">
              <button class="btn btn-ghost" type="button" data-social-close-create>Cancel</button>
              <button class="btn btn-primary" type="submit">Create</button>
            </div>
          </form>
        </div>
      </section>

      <div class="sheet-backdrop" data-social-manage-backdrop hidden></div>
      <section class="sheet social-manage-sheet" data-social-manage-sheet hidden role="dialog" aria-modal="true" aria-label="Manage Members">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__content">
          <h3 class="social-sheet__title">Manage members</h3>
          <div data-social-manage-content></div>
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
      listHead: frame.querySelector("[data-social-list-head]"),
      monthHead: frame.querySelector("[data-social-month-head]"),
      plannerTitle: frame.querySelector("[data-social-planner-title]"),
      manageMembersBtn: frame.querySelector("[data-social-manage-members]"),
      range: frame.querySelector("[data-social-range]"),
      chip: frame.querySelector("[data-social-chip]"),
      mount: frame.querySelector("[data-social-mount]"),
      addBackdrop: frame.querySelector("[data-social-add-backdrop]"),
      addSheet: frame.querySelector("[data-social-add-sheet]"),
      addForm: frame.querySelector("[data-social-add-form]"),
      addClose: frame.querySelector("[data-social-close-add]"),
      createBackdrop: frame.querySelector("[data-social-create-backdrop]"),
      createSheet: frame.querySelector("[data-social-create-sheet]"),
      createForm: frame.querySelector("[data-social-create-form]"),
      createFriends: frame.querySelector("[data-social-create-friends]"),
      createClose: frame.querySelector("[data-social-close-create]"),
      manageBackdrop: frame.querySelector("[data-social-manage-backdrop]"),
      manageSheet: frame.querySelector("[data-social-manage-sheet]"),
      manageContent: frame.querySelector("[data-social-manage-content]"),
      friendsBackdrop: frame.querySelector("[data-social-friends-backdrop]"),
      friendsSheet: frame.querySelector("[data-social-friends-sheet]"),
      friendsList: frame.querySelector("[data-social-friends-list]"),
      dayBackdrop: frame.querySelector("[data-social-day-backdrop]"),
      daySheet: frame.querySelector("[data-social-day-sheet]"),
      dayContent: frame.querySelector("[data-social-day-content]")
    };

    frame.querySelectorAll("[data-social-nav]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.viewMode !== "month") return;
        const delta = Number(btn.dataset.socialNav || "0");
        this.monthDateUTC = new Date(Date.UTC(
          this.monthDateUTC.getUTCFullYear(),
          this.monthDateUTC.getUTCMonth() + delta,
          1
        ));
        await this._refresh();
      });
    });

    frame.querySelector("[data-social-back]")?.addEventListener("click", async () => {
      await this._flushPendingNoteSave();
      this._goToListView();
    });

    frame.querySelector("[data-social-new-calendar]")?.addEventListener("click", () => {
      if (!this.canHost) {
        this.onError("Premium is required to host your own social calendars.");
        return;
      }
      if (!this.ownerProfile?.id) {
        this.onError("Owner profile required to create a calendar.");
        return;
      }
      this._populateCreateFriendsChecklist();
      this._openSheet(this.els.createSheet, this.els.createBackdrop);
      this.els.createForm?.querySelector("input[name='title']")?.focus();
    });

    frame.querySelector("[data-social-open-add]")?.addEventListener("click", () => {
      if (!this.canHost) {
        this.onError("Sending friend requests requires Premium.");
        return;
      }
      this._openSheet(this.els.addSheet, this.els.addBackdrop);
      this.els.addForm?.querySelector("input")?.focus();
    });

    frame.querySelector("[data-social-open-friends]")?.addEventListener("click", () => {
      this._renderFriendsList();
      this._openSheet(this.els.friendsSheet, this.els.friendsBackdrop);
    });

    frame.querySelector("[data-social-manage-members]")?.addEventListener("click", () => {
      void this._openManageMembersSheet();
    });

    this.els.addClose?.addEventListener("click", () => {
      this._closeSheet(this.els.addSheet, this.els.addBackdrop);
    });

    this.els.addBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.addSheet, this.els.addBackdrop);
    });

    this.els.createClose?.addEventListener("click", () => {
      this._closeSheet(this.els.createSheet, this.els.createBackdrop);
    });

    this.els.createBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.createSheet, this.els.createBackdrop);
    });

    this.els.createForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this._submitCreateCalendar();
    });

    this.els.manageBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.manageSheet, this.els.manageBackdrop);
    });

    this.els.friendsBackdrop?.addEventListener("click", () => {
      this._closeSheet(this.els.friendsSheet, this.els.friendsBackdrop);
    });

    this.els.dayBackdrop?.addEventListener("click", async () => {
      await this._flushPendingNoteSave();
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
    const pid = plannerId ? String(plannerId).trim() : "";
    if (pid) {
      this.activePlannerId = pid;
      this.viewMode = "month";
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

  async _loadPlannerList() {
    const bust = `t=${Date.now()}`;
    const data = await this._apiJson(`/api/social/planners?${bust}`);
    return data.planners || [];
  }

  _goToListView() {
    this.viewMode = "list";
    this.activePlannerId = null;
    this.activePlanner = null;
    this.planner = null;
    void this._refresh();
  }

  _goToMonthView(plannerId) {
    this.activePlannerId = plannerId;
    this.viewMode = "month";
    this.activePlanner = this.planners.find((p) => p.id === plannerId) || null;
    void this._refresh();
  }

  _syncViewChrome() {
    if (!this.els?.listHead || !this.els?.monthHead) return;
    const isList = this.viewMode === "list";
    this.els.listHead.hidden = !isList;
    this.els.monthHead.hidden = isList;

    if (this.viewMode === "month" && this.activePlanner) {
      this.els.plannerTitle.textContent = this.activePlanner.title || "Calendar";
      const showManage = this.canHost && this.activePlanner.isOwner === true;
      this.els.manageMembersBtn.hidden = !showManage;
    }

    if (this.els.range) {
      this.els.range.textContent = new Intl.DateTimeFormat(this.locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC"
      }).format(this.monthDateUTC);
    }
  }

  _populateCreateFriendsChecklist() {
    const box = this.els?.createFriends;
    if (!box) return;

    if (!this.friends.length) {
      box.innerHTML = `<p class="text-muted">No friends yet. Add friends from the list view first.</p>`;
      return;
    }

    box.innerHTML = `
      <div class="social-create-friends__list">
        ${this.friends
          .map(
            (friend) => `
          <label class="social-create-friends__row">
            <input type="checkbox" name="member" value="${escapeHtml(friend.friend_user_id)}">
            <span>${escapeHtml(friend.friend_display_name || friend.friend_email || "Friend")}</span>
          </label>
        `
          )
          .join("")}
      </div>
    `;
  }

  async _submitCreateCalendar() {
    const form = this.els?.createForm;
    if (!form) return;

    const titleInput = form.querySelector("input[name='title']");
    const title = titleInput?.value?.trim() || "";
    if (!title) return;

    const memberUserIds = Array.from(form.querySelectorAll("input[name='member']:checked"))
      .map((input) => input.value)
      .filter(Boolean);

    try {
      const data = await this._apiJson("/api/social/create-planner", {
        method: "POST",
        body: JSON.stringify({ title, memberUserIds })
      });

      const p = data.planner;
      if (p?.id) {
        this.planners = await this._loadPlannerList();
        this.activePlannerId = p.id;
        this.activePlanner = this.planners.find((x) => x.id === p.id) || p;
        this.viewMode = "month";
      }

      form.reset();
      this._closeSheet(this.els.createSheet, this.els.createBackdrop);
      this.onSuccess("Calendar created.");
      this.onChange();
      await this._refresh();
    } catch (err) {
      console.error("Create calendar failed:", err);
      this.onError(err.message || "Failed to create calendar.");
    }
  }

  async _openManageMembersSheet() {
    const plannerId = this._currentPlannerId();
    if (!plannerId) return;

    try {
      await this._renderManageMembersContent(plannerId);
      this._openSheet(this.els.manageSheet, this.els.manageBackdrop);
    } catch (err) {
      console.error("Manage members failed:", err);
      this.onError(err.message || "Failed to load members.");
    }
  }

  async _renderManageMembersContent(plannerId) {
    const bust = `t=${Date.now()}`;
    const data = await this._apiJson(
      `/api/social/planner-members?planner_id=${encodeURIComponent(plannerId)}&${bust}`
    );

    const members = data.members || [];
    const addable = data.addableFriends || [];

    const content = this.els.manageContent;
    if (!content) return;

    content.innerHTML = `
      <p class="text-muted" style="margin-top:0;">${escapeHtml(data.planner?.title || "Calendar")}</p>
      <div class="social-manage-members__section">
        <div class="social-manage-members__label">Members</div>
        <div class="social-manage-members__list">
          ${members
            .map((m) => {
              const isOwner = m.role === "owner";
              return `
            <div class="social-member-row">
              <div class="social-member-row__identity">
                <div class="social-member-row__name">${escapeHtml(m.displayName)}</div>
                <div class="social-member-row__meta">${escapeHtml(m.email || "")}</div>
              </div>
              <div class="social-member-row__actions">
                ${
                  isOwner
                    ? `<span class="social-frame__chip" style="margin:0;">Owner</span>`
                    : `<button class="btn btn-ghost btn-sm" type="button" data-social-remove-member="${escapeHtml(m.userId)}">Remove</button>`
                }
              </div>
            </div>
          `;
            })
            .join("")}
        </div>
      </div>
      ${
        addable.length
          ? `
        <div class="social-manage-members__section">
          <div class="social-manage-members__label">Add friends</div>
          <div class="social-manage-members__list">
            ${addable
              .map(
                (f) => `
              <div class="social-member-row">
                <div class="social-member-row__identity">
                  <div class="social-member-row__name">${escapeHtml(f.displayName)}</div>
                  <div class="social-member-row__meta">${escapeHtml(f.email || "")}</div>
                </div>
                <div class="social-member-row__actions">
                  <button class="btn btn-primary btn-sm" type="button" data-social-add-member="${escapeHtml(f.userId)}">Add</button>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : ""
      }
    `;

    content.querySelectorAll("[data-social-remove-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.getAttribute("data-social-remove-member");
        if (!uid) return;
        const ok = window.confirm("Remove this member from the calendar? Their notes and tasks on this calendar will be deleted.");
        if (!ok) return;
        try {
          await this._apiJson("/api/social/planner-members", {
            method: "POST",
            body: JSON.stringify({
              action: "remove_member",
              plannerId,
              memberUserId: uid
            })
          });
          this.onSuccess("Member removed.");
          this.onChange();
          await this._refresh();
          await this._renderManageMembersContent(plannerId);
        } catch (err) {
          console.error("Remove member failed:", err);
          this.onError(err.message || "Failed to remove member.");
        }
      });
    });

    content.querySelectorAll("[data-social-add-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.getAttribute("data-social-add-member");
        if (!uid) return;
        try {
          await this._apiJson("/api/social/planner-members", {
            method: "POST",
            body: JSON.stringify({
              action: "add_members",
              plannerId,
              memberUserIds: [uid]
            })
          });
          this.onSuccess("Member added.");
          this.onChange();
          await this._refresh();
          await this._renderManageMembersContent(plannerId);
        } catch (err) {
          console.error("Add member failed:", err);
          this.onError(err.message || "Failed to add member.");
        }
      });
    });
  }

  async _refresh() {
    try {
      this.friends = await this._loadFriends();
      this.planners = await this._loadPlannerList();
      this._renderFriendsList();

      if (this.viewMode === "list") {
        this.activePlannerId = null;
        this.activePlanner = null;
        this.planner = null;
        this._syncViewChrome();
        this._renderPlannerList();
        return;
      }

      this.activePlanner = this.planners.find((p) => p.id === this.activePlannerId) || null;
      if (!this.activePlanner) {
        this.viewMode = "list";
        this.activePlannerId = null;
        this.activePlanner = null;
        this.planner = null;
        this._syncViewChrome();
        this._renderPlannerList();
        return;
      }

      this.planner = this.activePlanner;
      this._syncViewChrome();

      const pid = this.activePlanner.id;
      const bust = `t=${Date.now()}`;
      this.monthSummary = await this._apiJson(
        `/api/social/month-summary?planner_id=${encodeURIComponent(pid)}&year=${this.monthDateUTC.getUTCFullYear()}&month=${this.monthDateUTC.getUTCMonth() + 1}&week_start=${encodeURIComponent(String(this.weekStart))}&${bust}`
      );

      this.els.chip.textContent = `${this.monthSummary?.planner?.memberCount || 0} members`;
      this._renderMonthGrid();
    } catch (err) {
      console.error("Social Planner refresh failed:", err);
      this.els.mount.innerHTML = `<div class="locked-section"><p>Could not load Social Planner.</p><p class="text-muted">${escapeHtml(err.message || "Try again.")}</p></div>`;
    }
  }

  _renderPlannerList() {
    if (!this.els?.mount) return;

    if (!this.planners.length) {
      const emptyPremium =
        this.canHost && this.ownerProfile?.id
          ? "No calendars yet. Create your first shared social calendar."
          : "No shared calendars yet. Calendars shared with you will appear here. Premium is required to host your own calendars.";

      this.els.mount.innerHTML = `
        <div class="locked-section social-calendar-list social-calendar-list--empty">
          <p>${escapeHtml(emptyPremium)}</p>
        </div>
      `;
      return;
    }

    this.els.mount.innerHTML = `
      <div class="social-calendar-list">
        ${this.planners
          .map(
            (p) => `
          <article class="social-calendar-card">
            <div class="social-calendar-card__main">
              <div class="social-calendar-card__title">${escapeHtml(p.title || "Calendar")}</div>
              <div class="social-calendar-card__meta">
                ${p.memberCount ?? 0} member${(p.memberCount ?? 0) === 1 ? "" : "s"}
                · ${p.isOwner ? "Owner" : "Member"}
              </div>
            </div>
            <div class="social-calendar-card__actions">
              <button class="btn btn-primary btn-sm" type="button" data-social-open-planner="${escapeHtml(p.id)}">Open</button>
            </div>
          </article>
        `
          )
          .join("")}
      </div>
    `;

    this.els.mount.querySelectorAll("[data-social-open-planner]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-social-open-planner");
        if (id) this._goToMonthView(id);
      });
    });
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

  _renderFriendsList() {
    if (!this.els?.friendsList) return;

    if (!this.friends.length) {
      this.els.friendsList.innerHTML = `<p class="text-muted">No friends connected yet.</p>`;
      return;
    }

    this.els.friendsList.innerHTML = `
      <div class="social-friends-list">
        ${this.friends.map((friend) => `
          <article class="social-friend-row" data-friend-user-id="${escapeHtml(friend.friend_user_id)}">
            <div class="social-friend-row__identity">
              <div class="social-friend-row__name">${escapeHtml(friend.friend_display_name || friend.friend_email || "Friend")}</div>
              <div class="social-friend-row__meta">${escapeHtml(friend.friend_email || "")}</div>
            </div>

            <div class="social-friend-row__actions">
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                data-social-friend-action="remove"
                data-friend-user-id="${escapeHtml(friend.friend_user_id)}"
                data-friend-name="${escapeHtml(friend.friend_display_name || friend.friend_email || "Friend")}"
              >
                Remove
              </button>
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                data-social-friend-action="block"
                data-friend-user-id="${escapeHtml(friend.friend_user_id)}"
                data-friend-name="${escapeHtml(friend.friend_display_name || friend.friend_email || "Friend")}"
              >
                Block
              </button>
            </div>
          </article>
        `).join("")}
      </div>
    `;

    this.els.friendsList.querySelectorAll("[data-social-friend-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.socialFriendAction;
        const friendUserId = btn.dataset.friendUserId;
        const friendName = btn.dataset.friendName || "Friend";
        if (!action || !friendUserId) return;

        const confirmed = window.confirm(
          action === "block"
            ? `Block ${friendName}? This also removes the connection and shared planner access.`
            : `Remove ${friendName} from your friends list and shared planner access?`
        );

        if (!confirmed) return;

        try {
          await this._manageFriend(action, friendUserId);
          this.onSuccess(action === "block" ? "Friend blocked." : "Friend removed.");
          await this._refresh();
        } catch (err) {
          console.error("Friend action failed:", err);
          this.onError(err.message || "Failed to update friend connection.");
        }
      });
    });
  }

  async _manageFriend(action, friendUserId) {
    await this._apiJson("/api/social/manage-connection", {
      method: "POST",
      body: JSON.stringify({
        action,
        friendUserId
      })
    });
    this.onChange();
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

      const bust = `t=${Date.now()}`;
      const data = await this._apiJson(
        `/api/social/day-summary?planner_id=${encodeURIComponent(plannerId)}&date=${encodeURIComponent(dateYmd)}&locale=${encodeURIComponent(this.locale)}&${bust}`
      );

      this.activeDateYmd = dateYmd;
      const normalized = {
        ...data,
        members: (data.members || []).map((member) => {
          const note = member.note || {};
          const noteAuthor =
            note.author_display_name ||
            note.author_name ||
            note.author_email ||
            member.displayName ||
            "Member";
          const tasks = (member.tasks || []).map((task) => ({
            ...task,
            author_display_name:
              task.author_display_name ||
              task.author_name ||
              task.author_email ||
              member.displayName ||
              "Member"
          }));
          return {
            ...member,
            note: { ...note, author_display_name: noteAuthor },
            tasks
          };
        })
      };
      this._renderDaySheet(normalized);
      this._openSheet(this.els.daySheet, this.els.dayBackdrop);
    } catch (err) {
      console.error("Failed to open social day:", err);
      this.onError(err.message || "Failed to open social day.");
    }
  }

  _renderDaySheet(data) {
    const dayLabel = data?.label || this.activeDateYmd;
    const members = data?.members || [];

    this._socialDayTaskIndex = new Map();
    for (const m of members) {
      for (const task of (m.tasks || []).filter((t) => !t.is_archived)) {
        this._socialDayTaskIndex.set(task.id, task);
      }
    }

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
          const noteEntry = member.note || {};
          const authorName =
            noteEntry.author_display_name ||
            noteEntry.author_name ||
            noteEntry.author_email ||
            "Member";
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
                    <div class="social-day-card__meta">
                      <span class="social-day-card__energy-pill">Day ${member.dayNumber}</span>
                    </div>
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
                  <div class="social-day-card__savebar">
                    <div class="social-day-card__savehint">Auto-saves to your own card only.</div>
                    <div class="social-day-card__save-indicator" data-social-note-indicator>Saved ✓</div>
                  </div>
                ` : `
                  <div class="social-day-card__label">${escapeHtml(authorName)}</div>
                  <div class="social-day-card__readbox">${note ? escapeHtml(note).replace(/\n/g, "<br>") : `<span class="text-muted">No note yet.</span>`}</div>
                `}
              </div>

              <div class="social-day-card__section">
                <div class="planner__tasks-pane social-day-card__tasks-pane">
                  <div class="planner__tasks-header">
                    <div class="planner__tasks-title">Tasks</div>
                    ${ownCard ? `<button class="planner__task-addbtn" type="button" data-social-task-add-row>Add task</button>` : ""}
                  </div>

                  <div class="planner__task-list social-day-card__task-list" data-social-task-list data-user-id="${escapeHtml(member.userId)}">
                    ${tasks.length ? tasks.map((task) => {
                    const repeatMeta = escapeHtml(task.repeat_meta || "");
                    const mode = task.repeat_mode || "none";

                    return `
                      <div class="planner__task-row ${task.is_completed ? "is-completed" : ""}" data-task-id="${escapeHtml(task.id)}">
                        <input
                          class="planner__task-check"
                          type="checkbox"
                          ${task.is_completed ? "checked" : ""}
                          ${ownCard ? `data-social-task-toggle` : "disabled"}
                        >

                        <div class="planner__task-row-middle">
                          <div class="planner__task-title-wrap">
                            ${
                              ownCard
                                ? `<input class="planner__task-title" type="text" value="${escapeHtml(task.title)}" data-social-task-title>`
                                : `<input class="planner__task-title" type="text" value="${escapeHtml(task.title)}" disabled>`
                            }
                            <div class="planner__task-repeatmeta">${repeatMeta}</div>
                          </div>

                          <div class="planner__task-actions">
                            ${
                              ownCard
                                ? `<button class="planner__task-repeatbtn ${mode !== "none" ? "is-active" : ""}" type="button" data-social-task-repeat>&#128339;</button>`
                                : ""
                            }
                            ${
                              ownCard
                                ? `<button class="planner__task-deletebtn" type="button" data-social-task-archive>×</button>`
                                : ""
                            }
                          </div>
                        </div>
                      </div>
                    `;
                  }).join("") : `<div class="planner__task-empty">No tasks for this day.</div>`}
                  </div>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;

    this.els.dayContent.querySelectorAll("[data-social-note]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        this._setActiveNoteIndicator("Saving…", "is-pending");
        this._scheduleSaveNote(this.activeDateYmd, textarea.value);
      });

      textarea.addEventListener("blur", async () => {
        try {
          await this._flushPendingNoteSave(this.activeDateYmd, textarea.value);
        } catch (err) {
          console.error("Note save failed:", err);
          this._setActiveNoteIndicator("Save failed", "is-error");
          this.onError("Failed to save note.");
        }
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-add-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".social-day-card");
        const listEl = card?.querySelector("[data-social-task-list]");
        if (!listEl || !this.activeDateYmd) return;
        this._addDraftSocialTaskRow(listEl, this.activeDateYmd);
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-toggle]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const row = checkbox.closest(".planner__task-row");
        const taskId = row?.dataset.taskId;
        if (!taskId) return;

        try {
          await this._toggleTask(taskId, this.activeDateYmd, checkbox.checked);
          await this._loadAndRenderDaySheet(this.activeDateYmd);
          await this._refresh();
        } catch (err) {
          console.error("Toggle task failed:", err);
          checkbox.checked = !checkbox.checked;
          this.onError("Failed to update task.");
        }
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-archive]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".planner__task-row");
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

    this.els.dayContent.querySelectorAll("[data-social-task-title]").forEach((input) => {
      if (input.disabled) return;
      const row = input.closest(".planner__task-row");
      const taskId = row?.dataset.taskId;
      if (!taskId) return;

      const originalTitle = input.value;

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
      });

      input.addEventListener("blur", async () => {
        const v = input.value.trim();
        if (!v) {
          try {
            await this._archiveTask(taskId);
            await this._loadAndRenderDaySheet(this.activeDateYmd);
            await this._refresh();
          } catch (err) {
            console.error("Archive task failed:", err);
            this.onError("Failed to archive task.");
            input.value = originalTitle;
          }
          return;
        }
        if (v === originalTitle) return;
        try {
          await this._updateTask(taskId, { title: v });
          input.value = v;
          await this._loadAndRenderDaySheet(this.activeDateYmd);
          await this._refresh();
        } catch (err) {
          console.error("Title update failed:", err);
          this.onError("Failed to update task.");
          input.value = originalTitle;
        }
      });
    });

    this.els.dayContent.querySelectorAll("[data-social-task-repeat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".planner__task-row");
        const taskId = row?.dataset.taskId;
        if (!taskId) return;
        const task = this._socialDayTaskIndex.get(taskId);
        if (!task) return;
        this._openRepeatSheet(task, this.activeDateYmd);
      });
    });
  }

  _scheduleSaveNote(dateYmd, content) {
    const key = `${this._currentPlannerId()}:${dateYmd}`;
    const existing = this.noteTimers.get(key);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(async () => {
      this.noteTimers.delete(key);

      try {
        await this._saveNote(dateYmd, content);
        this._flashActiveNoteSaved();
      } catch (err) {
        console.error("Debounced note save failed:", err);
        this._setActiveNoteIndicator("Save failed", "is-error");
        this.onError(err.message || "Failed to save note.");
      }
    }, 700);

    this.noteTimers.set(key, timerId);
  }

  async _saveNote(dateYmd, content) {
    const plannerId = this._currentPlannerId();
    if (!plannerId || !this.ownerProfile?.id) {
      throw new Error("Missing planner or owner profile for note save");
    }

    const result = await this._apiJson("/api/social/day-entry", {
      method: "POST",
      body: JSON.stringify({
        action: "save_note",
        plannerId,
        date: dateYmd,
        content: content ?? ""
      })
    });

    this.onChange();
    return result;
  }

  _setActiveNoteIndicator(text, stateClass = "") {
    const indicator = this.els?.dayContent?.querySelector("[data-social-note-indicator]");
    if (!indicator) return;

    indicator.textContent = text;
    indicator.classList.remove("is-visible", "is-pending", "is-error", "is-saved");

    if (stateClass) {
      indicator.classList.add(stateClass);
    }

    indicator.classList.add("is-visible");
  }

  _flashActiveNoteSaved() {
    const indicator = this.els?.dayContent?.querySelector("[data-social-note-indicator]");
    if (!indicator) return;

    indicator.textContent = "Saved ✓";
    indicator.classList.remove("is-pending", "is-error");
    indicator.classList.add("is-saved", "is-visible");

    clearTimeout(this._noteIndicatorTimer);
    this._noteIndicatorTimer = setTimeout(() => {
      const current = this.els?.dayContent?.querySelector("[data-social-note-indicator]");
      if (!current) return;
      current.classList.remove("is-visible");
    }, 1500);
  }

  async _flushPendingNoteSave(dateYmd = this.activeDateYmd, contentOverride = null) {
    const plannerId = this._currentPlannerId();
    if (!plannerId || !dateYmd) return;

    const key = `${plannerId}:${dateYmd}`;
    if (this.noteTimers.has(key)) {
      clearTimeout(this.noteTimers.get(key));
      this.noteTimers.delete(key);
    }

    const textarea = this.els?.dayContent?.querySelector("[data-social-note]");
    const content = contentOverride ?? textarea?.value ?? "";

    this._setActiveNoteIndicator("Saving…", "is-pending");
    await this._saveNote(dateYmd, content);
    this._flashActiveNoteSaved();
  }

  async _addTask(dateYmd, title) {
    const plannerId = this._currentPlannerId();
    if (!plannerId || !this.ownerProfile?.id) return;

    await this._apiJson("/api/social/day-entry", {
      method: "POST",
      body: JSON.stringify({
        action: "add_task",
        plannerId,
        date: dateYmd,
        title
      })
    });

    this.onChange();
  }

  async _toggleTask(taskId, dateYmd, checked) {
    const plannerId = this._currentPlannerId();
    if (!plannerId) return;

    await this._apiJson("/api/social/day-entry", {
      method: "POST",
      body: JSON.stringify({
        action: "toggle_task",
        plannerId,
        taskId,
        date: dateYmd,
        checked
      })
    });

    this.onChange();
  }

  async _updateTask(taskId, patch) {
    const plannerId = this._currentPlannerId();
    if (!plannerId) return;

    await this._apiJson("/api/social/day-entry", {
      method: "POST",
      body: JSON.stringify({
        action: "update_task",
        plannerId,
        taskId,
        ...patch
      })
    });

    this.onChange();
  }

  async _archiveTask(taskId) {
    const plannerId = this._currentPlannerId();
    if (!plannerId) return;

    await this._apiJson("/api/social/day-entry", {
      method: "POST",
      body: JSON.stringify({
        action: "archive_task",
        plannerId,
        taskId
      })
    });

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
    const hasBody = options.body != null;

    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
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

  _addDraftSocialTaskRow(listEl, ymd) {
    listEl.querySelector(".planner__task-empty")?.remove();
    const draftId = `draft-${++this._draftSeq}`;
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

    const meta = el("div", "planner__task-repeatmeta");
    const titleWrap = el("div", "planner__task-title-wrap");
    titleWrap.append(titleInput, meta);

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

    mid.append(titleWrap, btnRow);
    row.append(check, mid);
    listEl.append(row);
    this._draftMeta.set(draftId, { ymd, listEl });

    const flushDraft = async () => {
      if (!row.isConnected) return;
      const v = titleInput.value.trim();
      if (!v) {
        row.remove();
        this._draftMeta.delete(draftId);
        return;
      }
      try {
        await this._addTask(ymd, v);
        row.remove();
        this._draftMeta.delete(draftId);
        await this._loadAndRenderDaySheet(this.activeDateYmd);
        await this._refresh();
      } catch (err) {
        console.error("Draft task save failed:", err);
        this.onError("Failed to add task.");
      }
    };

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      }
    });

    titleInput.addEventListener("blur", () => {
      void flushDraft();
    });

    delBtn.addEventListener("click", () => {
      row.remove();
      this._draftMeta.delete(draftId);
    });

    titleInput.focus();
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
      ["sineday", "SineDuck days"]
    ];

    for (const [value, text] of modeLabels) {
      const id = `social-planner-repeat-${value}`;
      const wrap = el("label", "planner-repeat-sheet__radio");
      wrap.htmlFor = id;
      const radio = el("input", "planner-repeat-sheet__radio-input");
      radio.type = "radio";
      radio.name = "social_planner_repeat_mode";
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
    intervalLabel.htmlFor = "social-planner-repeat-interval";
    const intervalInput = el("input", "planner-repeat-sheet__interval");
    intervalInput.id = "social-planner-repeat-interval";
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.max = "365";
    intervalInput.value = "1";
    intervalGroup.append(intervalLabel, intervalInput);

    const untilGroup = el("div", "planner-repeat-sheet__group");
    const untilLabel = el("label", "planner-repeat-sheet__label");
    untilLabel.textContent = "Repeat until (optional)";
    untilLabel.htmlFor = "social-planner-repeat-until";
    const untilInput = el("input", "planner-repeat-sheet__until");
    untilInput.id = "social-planner-repeat-until";
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

    content.append(title, modeGroup, intervalGroup, untilGroup, chipGroup, actions);
    sheet.append(handle, content);

    document.body.append(backdrop, sheet);

    const syncModeUI = () => {
      const mode =
        Object.keys(modeRadios).find((k) => modeRadios[k].checked) || "none";
      const showInterval = ["daily", "weekly", "monthly", "yearly"].includes(mode);
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
      let interval = Math.max(1, Math.min(365, Number(intervalInput.value) || 1));
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

      try {
        await this._updateTask(st.taskId, {
          repeat_mode: mode,
          repeat_interval: interval,
          repeat_until,
          repeat_sinedays
        });
        this._closeRepeatSheet(false);
        await this._loadAndRenderDaySheet(this.activeDateYmd);
        await this._refresh();
      } catch (err) {
        console.error("Repeat save failed:", err);
        this.onError(err.message || "Failed to save repeat settings.");
      }
    });

    this.repeatSheetEls = {
      backdrop,
      sheet,
      modeRadios,
      intervalInput,
      untilInput,
      chipToggles,
      syncModeUI
    };
  }

  _openRepeatSheet(task, occurrenceYmd) {
    this._ensureRepeatSheet();
    const els = this.repeatSheetEls;

    this.repeatSheetState = {
      open: true,
      taskId: task.id,
      occurrenceYmd
    };

    const mode = task.repeat_mode || "none";
    for (const m of REPEAT_MODES) {
      els.modeRadios[m].checked = m === mode;
    }

    els.intervalInput.value = String(Math.max(1, Math.min(365, task.repeat_interval ?? 1)));

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
      occurrenceYmd: null
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
