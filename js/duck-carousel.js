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
    this._initHoverTilt();
    this._initNav();
    this._initClickToCenter();

    this._ro = new ResizeObserver(() => this._layoutRing());
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
    this.tiltEl = _el("div", "duck-ring__tilt");
    this.ringEl = _el("div", "duck-ring__ring");
    this.ringEl.setAttribute("aria-live", "polite");
    this.tiltEl.appendChild(this.ringEl);

    const sheenEl = _el("div", "duck-ring__sheen");
    const vignetteEl = _el("div", "duck-ring__vignette");
    this.tiltEl.appendChild(sheenEl);
    this.tiltEl.appendChild(vignetteEl);

    this.sceneEl.appendChild(this.tiltEl);

    this.emptyEl = _el("div", "duck-ring__empty");
    this.emptyEl.textContent = "Add a profile to see your first Origin Duck 🦆";
    this.tiltEl.appendChild(this.emptyEl);

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

  _setTiltFromPointer(x, y, strength = 1) {
    const rect = this.sceneEl.getBoundingClientRect();
    const nx = (x - rect.left) / rect.width;
    const ny = (y - rect.top) / rect.height;

    const dx = (nx - 0.5) * 2;
    const dy = (ny - 0.5) * 2;

    const maxTilt = 7 * strength;
    const tiltY = dx * maxTilt;
    const tiltX = -dy * (maxTilt * 0.8);

    this.sceneEl.style.setProperty("--tiltX", `${tiltX.toFixed(2)}deg`);
    this.sceneEl.style.setProperty("--tiltY", `${tiltY.toFixed(2)}deg`);
    this.sceneEl.style.setProperty("--mx", `${(nx * 100).toFixed(1)}%`);
    this.sceneEl.style.setProperty("--my", `${(ny * 100).toFixed(1)}%`);
  }

  _resetTilt() {
    this.sceneEl.style.setProperty("--tiltX", "0deg");
    this.sceneEl.style.setProperty("--tiltY", "0deg");
    this.sceneEl.style.setProperty("--mx", "50%");
    this.sceneEl.style.setProperty("--my", "50%");
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

  /* ── Pointer drag + inertia ── */

  _initPointer() {
    let lastX = 0;
    let lastT = 0;
    let dragging = false;
    let dragTotal = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const x = e.clientX;
      const t = performance.now();
      const dx = x - lastX;
      const dt = Math.max(1, t - lastT);

      dragTotal += Math.abs(dx);

      this.rotation += dx * 0.25;
      this.velocity = (dx / dt) * 18;
      this._applyRotation();

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) this._setTiltFromPointer(e.clientX, e.clientY, 1.15);

      lastX = x;
      lastT = t;
    };

    const onRelease = () => {
      this._didDragRecently = dragTotal > 6;
      setTimeout(() => { this._didDragRecently = false; }, 120);
    };

    this.sceneEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragTotal = 0;
      this.sceneEl.classList.add("is-dragging");
      this.sceneEl.setPointerCapture(e.pointerId);
      lastX = e.clientX;
      lastT = performance.now();
      this._stopInertia();

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) this._setTiltFromPointer(e.clientX, e.clientY, 1.1);
    });

    this.sceneEl.addEventListener("pointermove", onMove);

    this.sceneEl.addEventListener("pointerup", () => {
      dragging = false;
      this.sceneEl.classList.remove("is-dragging");
      onRelease();
      this._startInertia();

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) setTimeout(() => this._resetTilt(), 120);
    });

    this.sceneEl.addEventListener("pointerleave", () => {
      if (dragging) {
        dragging = false;
        this.sceneEl.classList.remove("is-dragging");
        onRelease();
        this._startInertia();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduce) setTimeout(() => this._resetTilt(), 120);
      }
    });
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

  _goToIndex(idx, snap) {
    if (!this.cards.length || idx < 0 || idx >= this.cards.length) return;
    this._stopInertia();
    this.velocity = 0;
    const step = 360 / this.cards.length;
    this.rotation = -idx * step;
    this._applyRotation();
  }

  /* ── Hover tilt (mouse) ── */

  _initHoverTilt() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = null;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        this._setTiltFromPointer(e.clientX, e.clientY, 1);
      });
    };

    this.sceneEl.addEventListener("mousemove", onMove);
    this.sceneEl.addEventListener("mouseleave", () => this._resetTilt());
  }

  _startInertia() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const tick = () => {
      this.velocity *= 0.94;
      if (Math.abs(this.velocity) < 0.01) {
        this.raf = null;
        return;
      }
      this.rotation += this.velocity;
      this._applyRotation();
      this.raf = requestAnimationFrame(tick);
    };
    if (!this.raf) this.raf = requestAnimationFrame(tick);
  }

  _stopInertia() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /* ── Nav arrows ── */

  _initNav() {
    const step = () => (this.cards.length ? 360 / this.cards.length : 90);
    this.prevBtn.addEventListener("click", () => {
      this._stopInertia();
      this.velocity = 0;
      this.rotation += step();
      this._applyRotation();
    });
    this.nextBtn.addEventListener("click", () => {
      this._stopInertia();
      this.velocity = 0;
      this.rotation -= step();
      this._applyRotation();
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
  }

  /* ── Reload ── */

  reload(profiles) {
    this.setProfiles(profiles);
  }

  /* ── Cleanup ── */

  destroy() {
    this._stopInertia();
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
