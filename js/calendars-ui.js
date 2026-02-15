import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { calculateSineDayForYmd } from "./sineday-engine.js";

const MS_PER_DAY = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdFromParts(y, mIndex, d) {
  return `${y}-${pad2(mIndex + 1)}-${pad2(d)}`;
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay(); // 0..6 (Sun..Sat)
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function monthMatrixUTC(year, monthIndex, weekStart) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const firstDow = first.getUTCDay();
  const lead = (firstDow - weekStart + 7) % 7;

  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - lead + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ inMonth: false, ymd: null, d: null });
    } else {
      cells.push({
        inMonth: true,
        ymd: ymdFromParts(year, monthIndex, dayNum),
        d: dayNum
      });
    }
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class CalendarsUI {
  constructor(mountEl, opts = {}) {
    this.mountEl = mountEl;
    this.locale = opts.locale || "en-US";
    this.weekStart = opts.weekStart ?? 0; // 0 Sun / 1 Mon
    this.profiles = opts.profiles || [];

    const now = new Date();
    this.year = now.getFullYear();
    this.monthIndex = now.getMonth();

    this.view = "month"; // 'month' | 'week'
    this.profileFilter = "all";

    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
    this.weekStartDateUTC = startOfWeekUTC(todayUTC, this.weekStart);

    this._build();
    this.render();
  }

  destroy() {
    this.mountEl.innerHTML = "";
  }

  setProfiles(profiles) {
    this.profiles = Array.isArray(profiles) ? profiles : [];
    this._syncProfileSelect();
    this.render();
  }

  setSettings({ locale, weekStart }) {
    if (locale) this.locale = locale;
    if (weekStart === 0 || weekStart === 1) this.weekStart = weekStart;
    // Keep week anchored to correct start day after changes
    this.weekStartDateUTC = startOfWeekUTC(this.weekStartDateUTC, this.weekStart);
    this.render();
  }

  _build() {
    this.root = el("div", "sdcal");

    // Toolbar
    const bar = el("div", "sdcal__bar");

    // View toggle
    this.btnMonth = el("button", "sdcal__tab is-active");
    this.btnMonth.type = "button";
    this.btnMonth.textContent = "Month";
    this.btnMonth.addEventListener("click", () => {
      this.view = "month";
      this.btnMonth.classList.add("is-active");
      this.btnWeek.classList.remove("is-active");
      this.render();
    });

    this.btnWeek = el("button", "sdcal__tab");
    this.btnWeek.type = "button";
    this.btnWeek.textContent = "Week";
    this.btnWeek.addEventListener("click", () => {
      this.view = "week";
      this.btnWeek.classList.add("is-active");
      this.btnMonth.classList.remove("is-active");
      this.render();
    });

    const tabs = el("div", "sdcal__tabs");
    tabs.append(this.btnMonth, this.btnWeek);

    // Profile filter
    const filterWrap = el("div", "sdcal__filter");
    const filterLabel = el("label", "sdcal__label");
    filterLabel.textContent = "Profiles";
    filterLabel.setAttribute("for", "sdcal-profile");

    this.profileSelect = el("select", "sdcal__select");
    this.profileSelect.id = "sdcal-profile";
    this.profileSelect.addEventListener("change", () => {
      this.profileFilter = this.profileSelect.value;
      this.render();
    });

    filterWrap.append(filterLabel, this.profileSelect);

    // Nav
    const nav = el("div", "sdcal__nav");

    this.btnPrev = el("button", "sdcal__navbtn");
    this.btnPrev.type = "button";
    this.btnPrev.textContent = "←";
    this.btnPrev.setAttribute("aria-label", "Previous");

    this.btnNext = el("button", "sdcal__navbtn");
    this.btnNext.type = "button";
    this.btnNext.textContent = "→";
    this.btnNext.setAttribute("aria-label", "Next");

    this.title = el("div", "sdcal__title");

    nav.append(this.btnPrev, this.title, this.btnNext);

    // Actions
    const actions = el("div", "sdcal__actions");
    this.btnPrint = el("button", "sdcal__action");
    this.btnPrint.type = "button";
    this.btnPrint.textContent = "Print / Save PDF";
    this.btnPrint.addEventListener("click", () => this.print());

    actions.append(this.btnPrint);

    // Assemble bar
    bar.append(tabs, filterWrap, nav, actions);

    // Content area
    this.content = el("div", "sdcal__content");

    this.root.append(bar, this.content);
    this.mountEl.innerHTML = "";
    this.mountEl.append(this.root);

    // Wire nav behavior
    this.btnPrev.addEventListener("click", () => {
      if (this.view === "month") {
        this.monthIndex--;
        if (this.monthIndex < 0) {
          this.monthIndex = 11;
          this.year--;
        }
      } else {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, -7);
      }
      this.render();
    });

    this.btnNext.addEventListener("click", () => {
      if (this.view === "month") {
        this.monthIndex++;
        if (this.monthIndex > 11) {
          this.monthIndex = 0;
          this.year++;
        }
      } else {
        this.weekStartDateUTC = addDaysUTC(this.weekStartDateUTC, 7);
      }
      this.render();
    });

    this._syncProfileSelect();
  }

  _syncProfileSelect() {
    const sel = this.profileSelect;
    if (!sel) return;

    const prev = sel.value || "all";
    sel.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "All profiles";
    sel.append(optAll);

    for (const p of this.profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.display_name || "Unnamed";
      sel.append(opt);
    }

    // restore selection if still valid
    const stillExists =
      prev === "all" || this.profiles.some((p) => p.id === prev);
    sel.value = stillExists ? prev : "all";
    this.profileFilter = sel.value;
  }

  _activeProfiles() {
    if (this.profileFilter === "all") return this.profiles;
    return this.profiles.filter((p) => p.id === this.profileFilter);
  }

  _fmtMonthTitle() {
    const dtf = new Intl.DateTimeFormat(this.locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    });
    const d = new Date(Date.UTC(this.year, this.monthIndex, 1, 12));
    return dtf.format(d);
  }

  _weekdayLabels() {
    const dtf = new Intl.DateTimeFormat(this.locale, {
      weekday: "short",
      timeZone: "UTC"
    });

    // Use a known Sunday as base
    const baseSun = new Date(Date.UTC(2023, 0, 1, 12)); // Jan 1, 2023 was Sunday
    const labels = [];
    for (let i = 0; i < 7; i++) {
      const d = addDaysUTC(baseSun, i);
      labels.push(dtf.format(d));
    }
    // reorder based on weekStart
    return labels.slice(this.weekStart).concat(labels.slice(0, this.weekStart));
  }

  render() {
    // Update title
    if (this.view === "month") {
      this.title.textContent = this._fmtMonthTitle();
    } else {
      const end = addDaysUTC(this.weekStartDateUTC, 6);
      const dtf = new Intl.DateTimeFormat(this.locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
      });
      this.title.textContent = `${dtf.format(this.weekStartDateUTC)} – ${dtf.format(end)}`;
    }

    // Render view
    this.content.innerHTML = "";
    if (this.profiles.length === 0) {
      const empty = el("div", "sdcal__empty");
      empty.textContent = "Add at least one profile to generate calendars.";
      this.content.append(empty);
      return;
    }

    if (this.view === "month") {
      this.content.append(this._renderMonth());
    } else {
      this.content.append(this._renderWeek());
    }
  }

  _renderMonth() {
    const wrap = el("div", "sdcal__month");

    // weekday header
    const head = el("div", "sdcal__weekdays");
    for (const w of this._weekdayLabels()) {
      const h = el("div", "sdcal__weekday");
      h.textContent = w;
      head.append(h);
    }
    wrap.append(head);

    const weeks = monthMatrixUTC(this.year, this.monthIndex, this.weekStart);
    const grid = el("div", "sdcal__grid");

    for (const week of weeks) {
      for (const cell of week) {
        const dayCell = el("div", "sdcal__cell");
        dayCell.classList.toggle("is-out", !cell.inMonth);

        if (!cell.inMonth) {
          grid.append(dayCell);
          continue;
        }

        const top = el("div", "sdcal__celltop");
        const num = el("div", "sdcal__num");
        num.textContent = String(cell.d);
        top.append(num);

        const ducks = this._renderDucksForDate(cell.ymd);
        dayCell.append(top, ducks);

        grid.append(dayCell);
      }
    }

    wrap.append(grid);
    return wrap;
  }

  _renderWeek() {
    const wrap = el("div", "sdcal__week");

    const dtf = new Intl.DateTimeFormat(this.locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });

    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDaysUTC(this.weekStartDateUTC, i));

    for (const d of days) {
      const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

      const row = el("div", "sdcal__dayrow");

      const header = el("div", "sdcal__dayhead");
      header.textContent = dtf.format(d);

      const ducks = this._renderDucksForDate(ymd, { bigger: true });

      const notes = el("div", "sdcal__notes");
      notes.setAttribute("aria-label", "Notes area");
      notes.innerHTML = `<div class="sdcal__lines" aria-hidden="true"></div>`;

      row.append(header, ducks, notes);
      wrap.append(row);
    }

    return wrap;
  }

  _renderDucksForDate(targetYmd, opts = {}) {
    const bigger = !!opts.bigger;
    const list = el("div", bigger ? "sdcal__ducks sdcal__ducks--big" : "sdcal__ducks");

    const active = this._activeProfiles();
    const maxIcons = this.profileFilter === "all" ? 4 : 1;

    let count = 0;
    for (const p of active) {
      const r = calculateSineDayForYmd(p.birthdate, targetYmd);
      if (!r) continue;

      count++;
      if (this.profileFilter === "all" && count > maxIcons) continue;

      const img = document.createElement("img");
      img.className = "sdcal__duck";
      img.loading = "lazy";
      img.src = duckUrlFromSinedayNumber(r.day);
      img.alt = `${p.display_name || "Profile"} — Day ${r.day}`;
      img.title = `${p.display_name || "Profile"} — Day ${r.day}`;
      list.append(img);
    }

    if (this.profileFilter === "all" && count > maxIcons) {
      const more = el("div", "sdcal__more");
      more.textContent = `+${count - maxIcons}`;
      more.title = "More profiles on this date (filter to a single profile to view cleanly)";
      list.append(more);
    }

    return list;
  }

  print() {
    // Print only calendar area (CSS handles the rest)
    document.body.classList.add("print-calendar");
    // allow layout to settle
    requestAnimationFrame(() => {
      window.print();
      // cleanup after print (Safari safe)
      setTimeout(() => document.body.classList.remove("print-calendar"), 300);
    });
  }
}
