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
    this._renderGen = 0;
    this._activeIndicator = null;
  }

  destroy() {
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

    const hero = el("section", "journal__hero");
    const heroText = el("div", "journal__hero-text");
    const eyebrow = el("p", "journal__eyebrow");
    eyebrow.textContent = isToday ? "Today’s Thoughts" : "Your Thoughts";
    const title = el("h3", "journal__title");
    title.textContent = this.getDateLabel(this.locale);
    const copy = el("p", "journal__copy");
    copy.textContent = isToday
      ? "Write what happened, what it meant, and which duck the day felt like. There is no wrong choice."
      : "Return to this day whenever you want. Capture what you lived and which duck it felt like.";
    heroText.append(eyebrow, title, copy);

    const actualWrap = el("div", "journal__actual-duck");
    if (actual?.day) {
      const img = document.createElement("img");
      img.src = duckUrlFromSinedayNumber(actual.day);
      img.alt = `Actual SineDuck Day ${actual.day}`;
      img.loading = "lazy";
      const label = el("div", "journal__actual-label");
      label.textContent = `Actual SineDay ${actual.day}`;
      const phase = el("div", "journal__actual-phase");
      phase.textContent = actual.phase || "";
      actualWrap.append(img, label, phase);
    }
    hero.append(heroText, actualWrap);

    const textarea = document.createElement("textarea");
    textarea.className = "journal__textarea";
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

    const feltSection = el("section", "journal__felt");
    const feltHeading = el("div", "journal__section-heading");
    feltHeading.textContent = "Which duck felt like the day?";
    const feltHelp = el("p", "journal__section-help");
    feltHelp.textContent =
      "Tap the duck that mirrors the day you lived. It can match the actual SineDay or be completely different.";
    const duckGrid = el("div", "journal__duck-grid");
    duckGrid.setAttribute("role", "group");
    duckGrid.setAttribute("aria-label", "Felt SineDuck selector");

    for (let day = 1; day <= 18; day++) {
      const btn = el("button", "journal__duck-choice");
      btn.type = "button";
      btn.dataset.day = String(day);
      btn.setAttribute("aria-pressed", String(entry.felt_sineday === day));
      btn.setAttribute("aria-label", `Felt SineDay ${day}`);
      if (entry.felt_sineday === day) btn.classList.add("is-selected");

      const img = document.createElement("img");
      img.src = duckUrlFromSinedayNumber(day);
      img.alt = "";
      img.loading = "lazy";
      img.setAttribute("aria-hidden", "true");
      const label = el("span", "journal__duck-choice-label");
      label.textContent = `Day ${day}`;
      btn.append(img, label);

      btn.addEventListener("click", () => {
        const current = entry.felt_sineday === day ? null : day;
        entry.felt_sineday = current;
        this._cacheEntry(entry);
        duckGrid.querySelectorAll(".journal__duck-choice").forEach((choice) => {
          const selected = Number(choice.dataset.day) === current;
          choice.classList.toggle("is-selected", selected);
          choice.setAttribute("aria-pressed", String(selected));
        });
        this._flushSave(entry, indicator);
      });

      duckGrid.append(btn);
    }
    feltSection.append(feltHeading, feltHelp, duckGrid);

    const imageSection = this._buildImageSection(entry, indicator);

    const nav = el("div", "journal__date-actions");
    const prev = el("button", "journal__date-btn");
    prev.type = "button";
    prev.textContent = "← Previous day";
    prev.addEventListener("click", () => {
      this.navigateDay(-1);
    });
    const todayBtn = el("button", "journal__date-btn journal__date-btn--primary");
    todayBtn.type = "button";
    todayBtn.textContent = "Today";
    todayBtn.disabled = isToday;
    todayBtn.setAttribute("aria-disabled", String(isToday));
    todayBtn.addEventListener("click", () => {
      this.setDate(profileToday);
    });
    const next = el("button", "journal__date-btn");
    next.type = "button";
    next.textContent = "Next day →";
    next.addEventListener("click", () => {
      this.navigateDay(1);
    });
    nav.append(prev, todayBtn, next);

    frame.append(hero, textarea, feltSection, imageSection, indicator, nav);
    this.mountEl.append(frame);
  }

  _buildImageSection(entry, indicator) {
    const section = el("section", "journal__image");
    const heading = el("div", "journal__section-heading");
    heading.textContent = "Memory image";
    const help = el("p", "journal__section-help");
    help.textContent = "Attach a handwritten journal photo or one image from the day (8 MB max).";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.className = "journal__image-input";
    input.setAttribute("aria-label", "Upload journal image");

    const preview = el("div", "journal__image-preview");
    this._renderImagePreview(preview, entry);

    const actions = el("div", "journal__image-actions");

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      await this._uploadImage(entry, file, indicator, preview, actions);
      input.value = "";
    });

    section.append(heading, help, input, preview, actions);
    this._syncImageActions(actions, entry, indicator, preview);
    return section;
  }

  _syncImageActions(actionsEl, entry, indicator, previewEl) {
    actionsEl.innerHTML = "";
    if (!entry.image_path) return;

    const removeBtn = el("button", "journal__image-remove");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove image";
    removeBtn.addEventListener("click", () => {
      this._removeImage(entry, indicator, previewEl, actionsEl);
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

  async _uploadImage(entry, file, indicator, previewEl, actionsEl) {
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
      this._setIndicator(indicator, "Image saved ✓");
    } catch (err) {
      console.error("[Journal] Image upload failed:", err);
      this._setIndicator(
        indicator,
        "Image upload failed. Confirm the journal-images bucket is configured.",
        true
      );
    }
  }

  async _removeImage(entry, indicator, previewEl, actionsEl) {
    if (!entry.image_path || !this.supabaseClient) return;

    const path = entry.image_path;
    this._setIndicator(indicator, "Removing image…");

    try {
      await this.supabaseClient.storage.from(IMAGE_BUCKET).remove([path]);
      entry.image_path = null;
      entry.image_mime_type = null;
      entry.image_size = null;
      this._cacheEntry(entry);
      await this._saveEntry(entry);
      await this._renderImagePreview(previewEl, entry);
      this._syncImageActions(actionsEl, entry, indicator, previewEl);
      this._setIndicator(indicator, "Image removed ✓");
    } catch (err) {
      console.error("[Journal] Image remove failed:", err);
      this._setIndicator(indicator, "Could not remove image.", true);
    }
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
    this._setIndicator(indicator, "Unsaved changes…");
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
      this._setIndicator(indicator, "Saved ✓");
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
      return this._saveInFlight.get(key);
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
        this._cacheEntry(data);
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
    if (!isError && text.includes("✓")) {
      setTimeout(() => indicatorEl.classList.remove("is-visible"), 1800);
    }
  }
}
