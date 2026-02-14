// js/duck-carousel.js
//
// 3D Duck Ring — Origin Duck (circle) + Energy Duck (square) stacked cards
// in a full 3D ring with drag/inertia spin and perspective.
//
// Public API:
//   const carousel = new DuckCarousel(containerEl, opts)
//   carousel.setProfiles(profiles)
//   carousel.reload(profiles)
//   carousel.destroy()

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "./origin-wave.js";
import { calculateSineDayForTimezone, getDayData } from "./sineday-engine.js";

/* ────────────────────────────
   DuckCarousel (3D Ring)
   ──────────────────────────── */

export class DuckCarousel {
  /**
   * @param {HTMLElement} wrapEl  - the .duck-carousel-wrap container
   * @param {Object}      opts
   * @param {string}     [opts.anchorDate]
   */
  constructor(wrapEl, opts = {}) {
    this.wrapEl = wrapEl;
    this.anchorDate = opts.anchorDate || ORIGIN_ANCHOR_DATE;
    this.profiles = [];
    this.cards = []; // { el, index }
    this.rotation = 0;
    this.velocity = 0;
    this.radius = 280;
    this.raf = null;

    this._buildDOM();
    this._initPointer();
    this._initNav();
    this._initClickToCenter();

    this._ro = new ResizeObserver(() => {
      this._layoutRing();
      this._snapToNearest(false);
    });
    this._ro.observe(this.sceneEl);
  }

  /* ── DOM skeleton ── */

  _buildDOM() {
    // Preserve header if present
    const header = this.wrapEl.querySelector(".duck-carousel-header");
    this.wrapEl.innerHTML = "";

    if (header) this.wrapEl.appendChild(header);

    this.rootEl = _el("div", "duck-ring");
    this.rootEl.setAttribute("role", "region");
    this.rootEl.setAttribute("aria-label", "Origin ducks 3D carousel");

    this.sceneEl = _el("div", "duck-ring__scene");
    this.ringEl = _el("div", "duck-ring__ring");
    this.ringEl.setAttribute("aria-live", "polite");
    this.sceneEl.appendChild(this.ringEl);

    this.emptyEl = _el("div", "duck-ring__empty");
    this.emptyEl.textContent = "Add a profile to see your first Origin Duck 🦆";
    this.sceneEl.appendChild(this.emptyEl);

    this.rootEl.appendChild(this.sceneEl);

    this.prevBtn = _el("button", "duck-ring__nav duck-ring__nav--prev");
    this.prevBtn.setAttribute("aria-label", "Previous");
    this.prevBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>`;

    this.nextBtn = _el("button", "duck-ring__nav duck-ring__nav--next");
    this.nextBtn.setAttribute("aria-label", "Next");
    this.nextBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;

    this.rootEl.appendChild(this.prevBtn);
    this.rootEl.appendChild(this.nextBtn);

    this.wrapEl.appendChild(this.rootEl);
  }

  /* ── Card build (energy square + origin circle stacked) ── */

  _buildCard(profile) {
    const name = profile.display_name || "Unnamed";
    const originDay = getOriginTypeForDob(profile.birthdate, this.anchorDate);
    const originUrl = originDay ? duckUrlFromSinedayNumber(originDay) : null;

    const tz = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const energyResult = calculateSineDayForTimezone(profile.birthdate, tz);
    const energyDay = energyResult?.day ?? null;
    const energyDescription = energyResult?.description || "";
    const energyUrl = energyDay ? duckUrlFromSinedayNumber(energyDay) : null;

    const card = _el("button", "duck-stack");
    card.type = "button";
    card.setAttribute(
      "aria-label",
      `${name}: Origin Day ${originDay ?? "?"}, Today Day ${energyDay ?? "?"}`
    );

    const energy = _el("div", "duck-stack__energy");
    if (energyUrl) {
      energy.innerHTML = `<img src="/${energyUrl}" alt="" />`;
    } else {
      energy.innerHTML = `<span aria-hidden="true">&nbsp;</span>`;
    }

    const origin = _el("div", "duck-stack__origin");
    if (originUrl) {
      origin.innerHTML = `<img src="/${originUrl}" alt="" />`;
    } else {
      origin.innerHTML = `<span aria-hidden="true">&nbsp;</span>`;
    }

    // Today's Duck header
    const energyMeta = _el("div", "duck-stack__meta duck-stack__meta--energy");
    energyMeta.textContent = `Today's Duck${energyDay ? ` • ${energyDay}` : ""}`;

    // Daily poetic line (like index page)
    const energyLine = _el("div", "duck-stack__subline");
    energyLine.textContent = energyDescription;

    // Origin header
    const originMeta = _el("div", "duck-stack__meta duck-stack__meta--origin");
    originMeta.textContent = `Origin Duck ${originDay ?? "?"}`;

    const label = _el("div", "duck-stack__label");
    label.textContent = name;

    // Order
    card.append(
      energy,
      energyMeta,
      energyLine,
      origin,
      originMeta,
      label
    );
    return { el: card };
  }

  /* ── 3D Ring layout ── */

  _layoutRing() {
    const n = this.cards.length;
    if (n === 0) return;

    const step = 360 / n;
    const sceneW = this.sceneEl.clientWidth || 400;
    this.radius = Math.max(220, Math.min(520, sceneW * 0.38));

    this.ringEl.style.setProperty("--radius", `${this.radius}px`);
    this.cards.forEach((c, i) => {
      const angle = i * step;
      c.el.style.transform = `rotateY(${angle}deg) translateZ(${this.radius}px)`;
      c.el.dataset.index = String(i);
    });

    this._applyRotation();
  }

  _applyRotation() {
    this.ringEl.style.transform = `translateZ(${-this.radius}px) rotateY(${this.rotation}deg)`;
    this._updateFrontCard();
  }

  _stepDeg() {
    return this.cards.length ? 360 / this.cards.length : 90;
  }

  _nearestIndex() {
    const n = this.cards.length;
    if (!n) return 0;
    const step = this._stepDeg();
    let idx = Math.round((-this.rotation) / step);
    idx = ((idx % n) + n) % n;
    return idx;
  }

  _normalizeAngle(deg) {
    let a = ((deg + 180) % 360) - 180;
    if (a < -180) a += 360;
    return a;
  }

  _updateFrontCard() {
    const n = this.cards.length;
    if (n === 0) return;

    const step = 360 / n;
    // Normalize rotation to 0..360
    const r = ((this.rotation % 360) + 360) % 360;
    // Each card i is at angle i*step; "front" is the one whose angle is closest to 0 (or 360)
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const cardAngle = (i * step + r) % 360;
      const dist = Math.min(cardAngle, 360 - cardAngle);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    this.cards.forEach((c, i) => {
      c.el.classList.toggle("is-front", i === bestIdx);
    });
  }

  /* ── Pointer drag + snap-on-release ── */

  _initPointer() {
    let dragging = false;
    let lastX = 0;
    let dragTotal = 0;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      dragTotal = 0;

      this.sceneEl.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      if (!dragging) return;

      const x = e.clientX;
      const dx = x - lastX;
      lastX = x;

      dragTotal += Math.abs(dx);

      // Smooth continuous rotation while dragging
      this.rotation += dx * 0.25;
      this._applyRotation();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;

      this._didDragRecently = dragTotal > 6;
      setTimeout(() => { this._didDragRecently = false; }, 120);

      // Always snap to nearest duck index so we never "rest" on blank space
      this._snapToNearest(!reduce);
    };

    this.sceneEl.addEventListener("pointerdown", onDown);
    this.sceneEl.addEventListener("pointermove", onMove);
    this.sceneEl.addEventListener("pointerup", onUp);
    this.sceneEl.addEventListener("pointercancel", onUp);

    // Prevent touch scrolling from fighting the carousel drag
    this.sceneEl.style.touchAction = "pan-y";
  }

  _initClickToCenter() {
    this._didDragRecently = false;
    this.ringEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".duck-stack");
      if (!btn) return;

      if (this._didDragRecently) return;

      const idx = Number(btn.dataset.index);
      if (!Number.isFinite(idx)) return;

      this._goToIndex(idx, true);
    });
  }

  _goToIndex(index, animate = true) {
    const n = this.cards.length;
    if (!n || index < 0 || index >= n) return;

    const step = this._stepDeg();
    const targetBase = -index * step;
    const delta = this._normalizeAngle(targetBase - this.rotation);
    const target = this.rotation + delta;

    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.rotation = target;
      this._applyRotation();
      return;
    }

    const start = this.rotation;
    const change = target - start;
    const dur = 260;
    const t0 = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      this.rotation = start + change * easeOutCubic(t);
      this._applyRotation();
      if (t < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  _snapToNearest(animate = true) {
    if (!this.cards.length) return;
    this._goToIndex(this._nearestIndex(), animate);
  }

  /* ── Nav arrows ── */

  _initNav() {
    this.prevBtn.addEventListener("click", () => {
      const n = this.cards.length || 1;
      const i = this._nearestIndex();
      this._goToIndex((i - 1 + n) % n, true);
    });

    this.nextBtn.addEventListener("click", () => {
      const n = this.cards.length || 1;
      const i = this._nearestIndex();
      this._goToIndex((i + 1) % n, true);
    });
  }

  /* ── Profile sync ── */

  setProfiles(profiles) {
    this.profiles = profiles || [];
    this.cards = [];

    // Clear ring
    const children = Array.from(this.ringEl.children).filter(
      (c) => !c.classList.contains("duck-ring__empty")
    );
    children.forEach((c) => c.remove());
    this.emptyEl.style.display = this.profiles.length === 0 ? "block" : "none";

    if (this.profiles.length === 0) {
      this.prevBtn.style.display = "none";
      this.nextBtn.style.display = "none";
      return;
    }

    this.prevBtn.style.display = "";
    this.nextBtn.style.display = "";

    for (const p of this.profiles) {
      const card = this._buildCard(p);
      this.cards.push(card);
      this.ringEl.appendChild(card.el);
    }

    this._layoutRing();
    this._snapToNearest(false);
  }

  /* ── Reload ── */

  reload(profiles) {
    this.setProfiles(profiles);
  }

  /* ── Cleanup ── */

  destroy() {
    this._ro?.disconnect();
    this.wrapEl.innerHTML = "";
  }
}

/* ── Helpers ── */

function _el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

export default DuckCarousel;
