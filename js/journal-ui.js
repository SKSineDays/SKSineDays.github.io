/**
 * Journal UI — one cloud-synced reflection entry per profile/date.
 * Replaces the old productivity surface without touching legacy tables.
 */

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

const MS_PER_DAY = 86400000;
const IMAGE_BUCKET = "journal-images";
const SAVE_DEBOUNCE_MS = 900;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function ymdFromUTCDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function utcDateFromYmd(ymd) {
  const [year, month, day] = String(ymd || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
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

function safeExt(file) {
  const fallback = file.type === "image/png" ? "png" : "jpg";
  const fromName = String(file.name || "").split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) return fromName;
  return fallback;
}

function entryKey(profileId, ymd) {
  return `${profileId}:${ymd}`;
}

function entryHasPersistableContent(entry) {
  if (!entry) return false;
  if (entry.id) return true;
  if ((entry.content || "").trim()) return true;
  if (entry.felt_sineday != null) return true;
  if (entry.image_path) return true;
  return false;
}

function trapFocusWithin(container, event) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export class JournalUI {
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0;
    this.ownerProfile = opts.ownerProfile || null;
    this.supabaseClient = opts.supabaseClient || null;
    this.userId = opts.userId || null;
    this.onEntrySaved =
      typeof opts.onEntrySaved === "function" ? opts.onEntrySaved : null;

    this.currentYmd = this.ownerProfile
      ? todayYmdForTimeZone(this.ownerProfile.timezone)
      : todayYmdForTimeZone();

    this.entryCache = new Map();
    this.saveTimers = new Map();
    this._saveInFlight = new Map();
    this._saveQueued = new Set();
    this._renderGen = 0;
    this._activeIndicator = null;
    this._activeSheetKeydown = null;
  }

  destroy() {
    if (this._activeSheetKeydown) {
      document.removeEventListener("keydown", this._activeSheetKeydown, true);
      this._activeSheetKeydown = null;
    }
    document.body.classList.remove("modal-open");
    const pending = Array.from(this.saveTimers.keys());
    for (const key of pending) {
      clearTimeout(this.saveTimers.get(key));
      this.saveTimers.delete(key);
      const entry = this.entryCache.get(key);
      if (entry && entryHasPersistableContent(entry)) {
        this._saveEntry(entry).catch(() => {});
      }
    }
    this.mountEl.innerHTML = "";
  }

  setOwnerProfile(profile) {
    const previousId = this.ownerProfile?.id || null;
    this._flushCurrentEntrySync();
    this.ownerProfile = profile || null;
    if (this.ownerProfile && this.ownerProfile.id !== previousId) {
      this.currentYmd = todayYmdForTimeZone(this.ownerProfile.timezone);
      this.entryCache.clear();
    }
    this.render();
  }

  setSettings({ locale, weekStart }) {
    this._flushCurrentEntrySync();
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    this.render();
  }

  async setDate(dateYmd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateYmd || ""))) return;
    await this._flushCurrentEntry();
    this.currentYmd = dateYmd;
    await this.render();
  }

  async navigateDay(delta) {
    const current = utcDateFromYmd(this.currentYmd);
    if (!current) return;
    await this._flushCurrentEntry();
    this.currentYmd = ymdFromUTCDate(addDaysUTC(current, delta));
    await this.render();
  }

  getDateLabel(locale) {
    const d = utcDateFromYmd(this.currentYmd);
    if (!d) return this.currentYmd;
    return new Intl.DateTimeFormat(locale || this.locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }

  async render() {
    const gen = ++this._renderGen;
    if (this._activeSheetKeydown) {
      document.removeEventListener("keydown", this._activeSheetKeydown, true);
      this._activeSheetKeydown = null;
    }
    document.body.classList.remove("modal-open");
    this.mountEl.innerHTML = "";

    if (!this.ownerProfile) {
      const empty = el("div", "journal__empty");
      empty.textContent = "Create your owner profile to begin your journal.";
      this.mountEl.append(empty);
      return;
    }

    const ymd = this.currentYmd;
    const profileId = this.ownerProfile.id;
    const actual = calculateSineDayForYmd(this.ownerProfile.birthdate, ymd);
    const profileToday = todayYmdForTimeZone(this.ownerProfile.timezone);
    const isToday = ymd === profileToday;

    await this._loadEntry(profileId, ymd);
    if (gen !== this._renderGen) return;

    const entry = this._getEntry(profileId, ymd, actual?.day || 1);
    entry.actual_sineday = actual?.day || entry.actual_sineday || 1;

    const frame = el("div", "journal");

    const dateBar = el("header", "journal-date-bar");
    const prev = el("button", "feature-icon-button journal-date-bar__nav");
    prev.type = "button";
    prev.innerHTML = '<span aria-hidden="true">‹</span>';
    prev.setAttribute("aria-label", "Previous day");
    prev.addEventListener("click", async () => {
      await this.navigateDay(-1);
    });

    const dateCopy = el("div", "journal-date-bar__copy");
    const heading = el("h2", "journal-date-bar__heading");
    heading.textContent = isToday ? "Today’s Thoughts" : "Thoughts from this day";
    const dateLabel = el("p", "journal-date-bar__date");
    dateLabel.textContent = this.getDateLabel(this.locale);
    dateCopy.append(heading, dateLabel);

    if (!isToday) {
      const returnToday = el("button", "journal-date-bar__today");
      returnToday.type = "button";
      returnToday.textContent = "Return to today";
      returnToday.addEventListener("click", async () => {
        await this.setDate(profileToday);
      });
      dateCopy.append(returnToday);
    } else {
      const todayMarker = el("span", "journal-date-bar__today-marker");
      todayMarker.textContent = "Today";
      dateCopy.append(todayMarker);
    }

    const next = el("button", "feature-icon-button journal-date-bar__nav");
    next.type = "button";
    next.innerHTML = '<span aria-hidden="true">›</span>';
    next.setAttribute("aria-label", "Next day");
    next.addEventListener("click", async () => {
      await this.navigateDay(1);
    });
    dateBar.append(prev, dateCopy, next);

    const actualWrap = el("section", "journal-day-context");
    actualWrap.setAttribute("aria-label", "Actual SineDay context");
    if (actual?.day) {
      const imgWrap = el("div", "journal-actual-duck-image duck-image-on-white");
      const img = document.createElement("img");
      img.src = duckUrlFromSinedayNumber(actual.day);
      img.alt = `Actual SineDuck Day ${actual.day}`;
      img.loading = "eager";
      imgWrap.append(img);
      const contextCopy = el("div", "journal-day-context__copy");
      const label = el("span", "journal__actual-label");
      label.textContent = `Actual SineDay ${actual.day}`;
      const phase = el("strong", "journal__actual-phase");
      phase.textContent = actual.phase || "";
      contextCopy.append(label, phase);
      actualWrap.append(imgWrap, contextCopy);
    }

    const textarea = document.createElement("textarea");
    textarea.className = "journal__textarea journal-entry-field-light";
    textarea.placeholder = isToday
      ? "What do you want to remember from today?"
      : "What do you want to remember from this day?";
    textarea.value = entry.content || "";
    textarea.dataset.date = ymd;
    textarea.setAttribute("aria-label", `Journal entry for ${this.getDateLabel(this.locale)}`);

    const indicator = el("div", "journal__save-indicator");
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.setAttribute("aria-atomic", "true");
    this._activeIndicator = indicator;

    textarea.addEventListener("input", () => {
      entry.content = textarea.value;
      this._cacheEntry(entry);
      this._queueSave(entry, indicator);
    });

    textarea.addEventListener("blur", () => {
      entry.content = textarea.value;
      this._cacheEntry(entry);
      this._flushSave(entry, indicator);
    });

    const writing = el("section", "journal-writing");
    writing.append(textarea, indicator);

    const tools = el("div", "journal-tools");
    tools.setAttribute("aria-label", "Reflection tools");

    const feltTool = el("button", "journal-tool-button journal-tool-button--felt");
    feltTool.type = "button";
    feltTool.setAttribute("aria-haspopup", "dialog");
    feltTool.setAttribute("aria-expanded", "false");

    const syncFeltTool = () => {
      feltTool.innerHTML = "";
      const visual = el("span", "journal-tool-button__visual");
      if (entry.felt_sineday) {
        const selectedImg = document.createElement("img");
        selectedImg.src = duckUrlFromSinedayNumber(entry.felt_sineday);
        selectedImg.alt = "";
        selectedImg.setAttribute("aria-hidden", "true");
        visual.append(selectedImg);
      } else {
        visual.textContent = "∿";
        visual.setAttribute("aria-hidden", "true");
      }
      const copy = el("span", "journal-tool-button__copy");
      const title = el("strong", "");
      title.textContent = entry.felt_sineday ? `Felt like Day ${entry.felt_sineday}` : "How did it feel?";
      const helper = el("small", "");
      helper.textContent = entry.felt_sineday ? "Tap to change or clear" : "Choose your mirror";
      copy.append(title, helper);
      feltTool.append(visual, copy);
      feltTool.setAttribute(
        "aria-label",
        entry.felt_sineday
          ? `Felt SineDuck Day ${entry.felt_sineday}. Change or clear selection.`
          : "Choose how the day felt"
      );
    };
    syncFeltTool();

    const imageParts = this._buildImageSection(entry, indicator);
    const photoTool = el("button", "journal-tool-button journal-tool-button--photo");
    photoTool.type = "button";
    photoTool.dataset.journalPhotoAction = "true";
    photoTool.innerHTML = `
      <span class="journal-tool-button__visual" aria-hidden="true">+</span>
      <span class="journal-tool-button__copy">
        <strong>${entry.image_path ? "Replace photo" : "Add memory photo"}</strong>
        <small>${entry.image_path ? "One photo attached" : "Keep one image from the day"}</small>
      </span>
    `;
    photoTool.setAttribute(
      "aria-label",
      entry.image_path ? "Replace memory photo" : "Add memory photo"
    );
    photoTool.addEventListener("click", () => imageParts.input.click());
    tools.append(feltTool, photoTool);

    const feelingSheet = el("div", "journal-feeling-sheet add-profile-sheet");
    feelingSheet.setAttribute("aria-hidden", "true");
    const feelingBackdrop = el("div", "add-profile-sheet__backdrop");
    const feelingPanel = el("div", "add-profile-sheet__panel journal-feeling-sheet__panel");
    feelingPanel.setAttribute("role", "dialog");
    feelingPanel.setAttribute("aria-modal", "true");
    const feelingTitleId = `journal-feeling-title-${ymd}`;
    feelingPanel.setAttribute("aria-labelledby", feelingTitleId);
    const feelingInner = el("div", "add-profile-sheet__inner journal-feeling-sheet__inner");
    const handle = el("div", "feature-sheet__handle");
    handle.setAttribute("aria-hidden", "true");
    const sheetHeader = el("div", "journal-feeling-sheet__header");
    const sheetHeadingWrap = el("div", "");
    const sheetEyebrow = el("p", "feature-hero__eyebrow");
    sheetEyebrow.textContent = "SineDuck is a mirror without words";
    const sheetHeading = el("h3", "journal-feeling-sheet__title");
    sheetHeading.id = feelingTitleId;
    sheetHeading.textContent = "How did the day feel?";
    sheetHeadingWrap.append(sheetEyebrow, sheetHeading);
    const closeFeeling = el("button", "feature-icon-button");
    closeFeeling.type = "button";
    closeFeeling.textContent = "×";
    closeFeeling.setAttribute("aria-label", "Close felt SineDuck selector");
    sheetHeader.append(sheetHeadingWrap, closeFeeling);
    const feltHelp = el("p", "journal-feeling-sheet__help");
    feltHelp.textContent = "Choose the duck that mirrors the day you lived. Tap it again to clear.";
    const duckGrid = el("div", "journal__duck-grid");
    duckGrid.setAttribute("role", "group");
    duckGrid.setAttribute("aria-label", "Felt SineDuck selector");

    const closeFeelingSheet = () => {
      feelingSheet.classList.remove("is-open");
      feelingSheet.setAttribute("aria-hidden", "true");
      feltTool.setAttribute("aria-expanded", "false");
      document.body.classList.remove("modal-open");
      feltTool.focus();
    };

    const openFeelingSheet = () => {
      feelingSheet.setAttribute("aria-hidden", "false");
      feltTool.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => feelingSheet.classList.add("is-open"));
      document.body.classList.add("modal-open");
      const selected = duckGrid.querySelector(".journal__duck-choice.is-selected");
      (selected || closeFeeling).focus();
    };

    for (let day = 1; day <= 18; day++) {
      const btn = el("button", "journal__duck-choice");
      btn.type = "button";
      btn.dataset.day = String(day);
      btn.setAttribute("aria-pressed", String(entry.felt_sineday === day));
      btn.setAttribute("aria-label", `Felt SineDay ${day}`);
      if (entry.felt_sineday === day) btn.classList.add("is-selected");

      const imgWrap = el("span", "felt-duck-image duck-image-on-white");
      const img = document.createElement("img");
      img.src = duckUrlFromSinedayNumber(day);
      img.alt = "";
      img.loading = "lazy";
      img.setAttribute("aria-hidden", "true");
      imgWrap.append(img);
      const label = el("span", "journal__duck-choice-label");
      label.textContent = `Day ${day}`;
      btn.append(imgWrap, label);

      btn.addEventListener("click", async () => {
        const current = entry.felt_sineday === day ? null : day;
        entry.felt_sineday = current;
        this._cacheEntry(entry);
        duckGrid.querySelectorAll(".journal__duck-choice").forEach((choice) => {
          const selected = Number(choice.dataset.day) === current;
          choice.classList.toggle("is-selected", selected);
          choice.setAttribute("aria-pressed", String(selected));
        });
        syncFeltTool();
        await this._flushSave(entry, indicator);
        closeFeelingSheet();
      });

      duckGrid.append(btn);
    }
    feelingInner.append(handle, sheetHeader, feltHelp, duckGrid);
    feelingPanel.append(feelingInner);
    feelingSheet.append(feelingBackdrop, feelingPanel);
    feltTool.addEventListener("click", openFeelingSheet);
    closeFeeling.addEventListener("click", closeFeelingSheet);
    feelingBackdrop.addEventListener("click", closeFeelingSheet);
    this._activeSheetKeydown = (event) => {
      if (
        event.key === "Escape" &&
        feelingSheet.getAttribute("aria-hidden") === "false"
      ) {
        event.preventDefault();
        closeFeelingSheet();
        return;
      }
      if (feelingSheet.getAttribute("aria-hidden") === "false") {
        trapFocusWithin(feelingPanel, event);
      }
    };
    document.addEventListener("keydown", this._activeSheetKeydown, true);

    frame.append(
      dateBar,
      actualWrap,
      writing,
      tools,
      imageParts.input,
      imageParts.section,
      feelingSheet
    );
    this.mountEl.append(frame);
  }

  _buildImageSection(entry, indicator) {
    const section = el("section", "journal__image");
    section.hidden = !entry.image_path;
    const heading = el("div", "journal__image-heading");
    heading.textContent = "Memory photo";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.className = "journal__image-input sr-only";
    input.tabIndex = -1;
    input.setAttribute("aria-label", "Upload journal image");

    const preview = el("div", "journal__image-preview");
    this._renderImagePreview(preview, entry);

    const actions = el("div", "journal__image-actions");

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      await this._uploadImage(entry, file, indicator, preview, actions, section);
      input.value = "";
    });

    section.append(heading, preview, actions);
    this._syncImageActions(actions, entry, indicator, preview);
    return { section, input };
  }

  _syncImageActions(actionsEl, entry, indicator, previewEl) {
    actionsEl.innerHTML = "";
    if (!entry.image_path) return;

    const removeBtn = el("button", "journal__image-remove");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove photo";
    removeBtn.setAttribute("aria-label", "Remove memory photo");
    removeBtn.addEventListener("click", () => {
      this._removeImage(
        entry,
        indicator,
        previewEl,
        actionsEl,
        actionsEl.closest(".journal__image")
      );
    });
    actionsEl.append(removeBtn);
  }

  async _renderImagePreview(previewEl, entry) {
    previewEl.innerHTML = "";
    if (!entry.image_path) {
      const empty = el("div", "journal__image-empty");
      empty.textContent = "No image attached.";
      previewEl.append(empty);
      return;
    }

    const img = document.createElement("img");
    img.alt = "Journal attachment";
    img.loading = "lazy";
    img.className = "journal__image-thumb";

    try {
      const { data, error } = await this.supabaseClient.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(entry.image_path, 60 * 15);
      if (error || !data?.signedUrl) throw error || new Error("Missing signed URL");
      img.src = data.signedUrl;
      previewEl.append(img);
    } catch (err) {
      const errorEl = el("div", "journal__image-empty");
      errorEl.textContent = "Image preview could not be loaded.";
      previewEl.append(errorEl);
    }
  }

  async _uploadImage(entry, file, indicator, previewEl, actionsEl, sectionEl) {
    if (!this.supabaseClient || !this.userId || !this.ownerProfile) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      this._setIndicator(indicator, "Use JPEG, PNG, WebP, or GIF.", true);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this._setIndicator(indicator, "Image must be 8 MB or less.", true);
      return;
    }

    const previousPath = entry.image_path;
    this._setIndicator(indicator, "Uploading image…");
    const ext = safeExt(file);
    const path = `${this.userId}/${this.ownerProfile.id}/${entry.entry_date}/${crypto.randomUUID()}.${ext}`;

    try {
      const { error } = await this.supabaseClient.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (error) throw error;

      entry.image_path = path;
      entry.image_mime_type = file.type;
      entry.image_size = file.size;
      this._cacheEntry(entry);
      await this._saveEntry(entry);

      if (previousPath && previousPath !== path) {
        await this.supabaseClient.storage.from(IMAGE_BUCKET).remove([previousPath]);
      }

      await this._renderImagePreview(previewEl, entry);
      this._syncImageActions(actionsEl, entry, indicator, previewEl);
      this._syncImagePresentation(entry, sectionEl);
      this._setIndicator(indicator, "Photo saved");
    } catch (err) {
      console.error("[Journal] Image upload failed:", err);
      this._setIndicator(
        indicator,
        "Image upload failed. Confirm the journal-images bucket is configured.",
        true
      );
    }
  }

  async _removeImage(entry, indicator, previewEl, actionsEl, sectionEl) {
    if (!entry.image_path || !this.supabaseClient) return;

    const previous = {
      image_path: entry.image_path,
      image_mime_type: entry.image_mime_type,
      image_size: entry.image_size,
    };
    const path = previous.image_path;
    this._setIndicator(indicator, "Removing image…");

    try {
      entry.image_path = null;
      entry.image_mime_type = null;
      entry.image_size = null;
      this._cacheEntry(entry);
      await this._saveEntry(entry);
      const { error: removeError } = await this.supabaseClient.storage
        .from(IMAGE_BUCKET)
        .remove([path]);
      if (removeError) {
        console.warn("[Journal] Removed photo from entry but storage cleanup failed:", removeError);
      }
      await this._renderImagePreview(previewEl, entry);
      this._syncImageActions(actionsEl, entry, indicator, previewEl);
      this._syncImagePresentation(entry, sectionEl);
      this._setIndicator(indicator, "Photo removed");
    } catch (err) {
      Object.assign(entry, previous);
      this._cacheEntry(entry);
      console.error("[Journal] Image remove failed:", err);
      this._setIndicator(indicator, "Could not remove image.", true);
    }
  }

  _syncImagePresentation(entry, sectionEl) {
    if (sectionEl) sectionEl.hidden = !entry.image_path;
    const photoTool = this.mountEl.querySelector("[data-journal-photo-action]");
    if (!photoTool) return;
    const title = photoTool.querySelector("strong");
    const helper = photoTool.querySelector("small");
    if (title) title.textContent = entry.image_path ? "Replace photo" : "Add memory photo";
    if (helper) {
      helper.textContent = entry.image_path
        ? "One photo attached"
        : "Keep one image from the day";
    }
    photoTool.setAttribute(
      "aria-label",
      entry.image_path ? "Replace memory photo" : "Add memory photo"
    );
  }

  _getEntry(profileId, ymd, actualSineday) {
    const key = entryKey(profileId, ymd);
    const cached = this.entryCache.get(key);
    if (cached) return cached;
    const entry = {
      user_id: this.userId,
      profile_id: profileId,
      entry_date: ymd,
      actual_sineday: actualSineday,
      felt_sineday: null,
      content: "",
      image_path: null,
      image_mime_type: null,
      image_size: null,
    };
    this.entryCache.set(key, entry);
    return entry;
  }

  _cacheEntry(entry) {
    this.entryCache.set(entryKey(entry.profile_id, entry.entry_date), entry);
  }

  async _loadEntry(profileId, ymd) {
    if (!this.supabaseClient) return;
    const key = entryKey(profileId, ymd);
    if (
      this.saveTimers.has(key) ||
      this._saveInFlight.has(key) ||
      this._saveQueued.has(key)
    ) {
      return;
    }
    try {
      const { data, error } = await this.supabaseClient
        .from("journal_entries")
        .select(
          "id, user_id, profile_id, entry_date, actual_sineday, felt_sineday, content, image_path, image_mime_type, image_size, created_at, updated_at"
        )
        .eq("profile_id", profileId)
        .eq("entry_date", ymd)
        .maybeSingle();

      if (error) throw error;
      if (data) this._cacheEntry(data);
    } catch (err) {
      console.error("[Journal] Load entry failed:", err);
    }
  }

  _queueSave(entry, indicator) {
    const key = entryKey(entry.profile_id, entry.entry_date);
    this._setIndicator(indicator, "Saving…");
    if (this.saveTimers.has(key)) clearTimeout(this.saveTimers.get(key));
    const timerId = setTimeout(() => {
      this.saveTimers.delete(key);
      this._flushSave(entry, indicator);
    }, SAVE_DEBOUNCE_MS);
    this.saveTimers.set(key, timerId);
  }

  async _flushSave(entry, indicator) {
    const key = entryKey(entry.profile_id, entry.entry_date);
    if (this.saveTimers.has(key)) {
      clearTimeout(this.saveTimers.get(key));
      this.saveTimers.delete(key);
    }
    if (!entryHasPersistableContent(entry)) {
      this._setIndicator(indicator, "");
      indicator.classList.remove("is-visible");
      return;
    }
    this._setIndicator(indicator, "Saving…");
    try {
      await this._saveEntry(entry);
      this._setIndicator(indicator, "Saved");
    } catch (err) {
      console.error("[Journal] Save failed:", err);
      this._setIndicator(indicator, "Could not save.", true);
    }
  }

  _flushCurrentEntrySync() {
    if (!this.ownerProfile?.id || !this.currentYmd) return;
    const key = entryKey(this.ownerProfile.id, this.currentYmd);
    if (this.saveTimers.has(key)) {
      clearTimeout(this.saveTimers.get(key));
      this.saveTimers.delete(key);
    }
    const entry = this.entryCache.get(key);
    if (entry && entryHasPersistableContent(entry)) {
      this._saveEntry(entry).catch(() => {});
    }
  }

  async _flushCurrentEntry() {
    if (!this.ownerProfile?.id || !this.currentYmd) return;
    const key = entryKey(this.ownerProfile.id, this.currentYmd);
    if (this.saveTimers.has(key)) {
      clearTimeout(this.saveTimers.get(key));
      this.saveTimers.delete(key);
    }
    const entry = this.entryCache.get(key);
    if (!entry || !entryHasPersistableContent(entry)) return;
    await this._saveEntry(entry);
  }

  async _saveEntry(entry) {
    if (!this.supabaseClient || !this.userId || !this.ownerProfile) return;

    const actual = calculateSineDayForYmd(this.ownerProfile.birthdate, entry.entry_date);
    entry.actual_sineday = actual?.day || entry.actual_sineday || 1;

    if (!entryHasPersistableContent(entry)) return;

    const key = entryKey(entry.profile_id, entry.entry_date);
    if (this._saveInFlight.has(key)) {
      this._saveQueued.add(key);
      try {
        await this._saveInFlight.get(key);
      } catch (error) {
        this._saveQueued.delete(key);
        throw error;
      }
      if (this._saveQueued.delete(key)) {
        return this._saveEntry(entry);
      }
      return;
    }

    const payload = {
      user_id: this.userId,
      profile_id: entry.profile_id,
      entry_date: entry.entry_date,
      actual_sineday: entry.actual_sineday,
      felt_sineday: entry.felt_sineday,
      content: entry.content || "",
      image_path: entry.image_path || null,
      image_mime_type: entry.image_mime_type || null,
      image_size: entry.image_size || null,
      updated_at: new Date().toISOString(),
    };

    const savePromise = (async () => {
      const { data, error } = await this.supabaseClient
        .from("journal_entries")
        .upsert(payload, { onConflict: "profile_id,entry_date" })
        .select(
          "id, user_id, profile_id, entry_date, actual_sineday, felt_sineday, content, image_path, image_mime_type, image_size, created_at, updated_at"
        )
        .single();
      if (error) throw error;
      if (data) {
        const hasNewerPending =
          this._saveQueued.has(key) || this.saveTimers.has(key);
        if (hasNewerPending) {
          entry.id = data.id;
          entry.created_at = data.created_at;
          this._cacheEntry(entry);
        } else {
          this._cacheEntry(data);
        }
        this.onEntrySaved?.(data);
      }
    })();

    this._saveInFlight.set(key, savePromise);
    try {
      await savePromise;
    } finally {
      this._saveInFlight.delete(key);
    }
  }

  _setIndicator(indicatorEl, text, isError = false) {
    if (!indicatorEl) return;
    indicatorEl.textContent = text;
    if (!text) {
      indicatorEl.classList.remove("is-visible", "is-error");
      return;
    }
    indicatorEl.classList.add("is-visible");
    indicatorEl.classList.toggle("is-error", !!isError);
    const isSaving = /saving|uploading|removing/i.test(text);
    const isSaved = !isError && /saved|removed/i.test(text);
    indicatorEl.dataset.state = isError ? "error" : isSaving ? "saving" : isSaved ? "saved" : "info";
    if (isSaved) {
      setTimeout(() => indicatorEl.classList.remove("is-visible"), 1800);
    }
  }
}
