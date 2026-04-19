// js/duck-carousel.js
//
// Horizontal Duck Carousel — side-scroll rail with centered active profile.
// Replaces the old 3D ring with a production-safer sideways carousel.
// The sphere remains as a rotating ambient backdrop only.
//
// Public API:
//   const carousel = new DuckCarousel(containerEl, opts)
//   carousel.setProfiles(profiles)
//   carousel.reload(profiles)
//   carousel.destroy()

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "../shared/origin-wave.js";
import { calculateSineDayForTimezone } from "./sineday-engine.js";

export class DuckCarousel {
  constructor(wrapEl, opts = {}) {
    this.wrapEl = wrapEl;
    this.anchorDate = opts.anchorDate || ORIGIN_ANCHOR_DATE;

    this.rootEl = null;
    this.sceneEl = null;
    this.sphereBackEl = null;
    this.viewportEl = null;
    this.trackEl = null;
    this.emptyEl = null;
    this.prevBtn = null;
    this.nextBtn = null;

    this.profiles = [];
    this.cards = [];
    this.currentIndex = 0;

    this.cardWidth = 240;
    this.cardGap = 24;
    this.baseTranslate = 0;
    this.dragOffset = 0;

    this._drag = {
      active: false,
      pointerId: null,
      startX: 0,
      lastX: 0,
      totalDx: 0
    };

    this._buildDOM();
    this._initPointer();
    this._initNav();
    this._initClickToCenter();

    this._ro = new ResizeObserver(() => {
      this._layout();
      this._applyPosition(false);
    });
    this._ro.observe(this.sceneEl);
  }

  _buildDOM() {
    const header = this.wrapEl.querySelector(".duck-carousel-header");
    this.wrapEl.innerHTML = "";
    if (header) this.wrapEl.appendChild(header);

    this.rootEl = _el("div", "duck-ring");
    this.rootEl.setAttribute("role", "region");
    this.rootEl.setAttribute("aria-label", "Origin ducks carousel");

    this.sceneEl = _el("div", "duck-ring__scene");

    this.sphereBackEl = _el("div", "duck-ring__sphere duck-ring__sphere--back");
    this.sphereBackEl.setAttribute("aria-hidden", "true");
    const sphereImg = document.createElement("img");
    sphereImg.src = "/assets/sineday-sphere.png";
    sphereImg.alt = "";
    sphereImg.decoding = "async";
    sphereImg.loading = "eager";
    this.sphereBackEl.appendChild(sphereImg);

    this.viewportEl = _el("div", "duck-ring__viewport");
    this.trackEl = _el("div", "duck-ring__track");
    this.trackEl.setAttribute("aria-live", "polite");
    this.viewportEl.appendChild(this.trackEl);

    this.emptyEl = _el("div", "duck-ring__empty");
    this.emptyEl.textContent = "Add a profile to see your first Origin Duck 🦆";

    this.sceneEl.appendChild(this.sphereBackEl);
    this.sceneEl.appendChild(this.viewportEl);
    this.sceneEl.appendChild(this.emptyEl);

    this.rootEl.appendChild(this.sceneEl);

    this.prevBtn = _el("button", "duck-ring__nav duck-ring__nav--prev");
    this.prevBtn.type = "button";
    this.prevBtn.setAttribute("aria-label", "Previous profile");
    this.prevBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>`;

    this.nextBtn = _el("button", "duck-ring__nav duck-ring__nav--next");
    this.nextBtn.type = "button";
    this.nextBtn.setAttribute("aria-label", "Next profile");
    this.nextBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;

    this.rootEl.appendChild(this.prevBtn);
    this.rootEl.appendChild(this.nextBtn);

    this.wrapEl.appendChild(this.rootEl);
  }

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
    energy.innerHTML = energyUrl
      ? `<img src="/${energyUrl}" alt="" />`
      : `<span aria-hidden="true">&nbsp;</span>`;

    const origin = _el("div", "duck-stack__origin");
    origin.innerHTML = originUrl
      ? `<img src="/${originUrl}" alt="" />`
      : `<span aria-hidden="true">&nbsp;</span>`;

    const energyMeta = _el("div", "duck-stack__meta duck-stack__meta--energy");
    energyMeta.textContent = `Today's Duck${energyDay ? ` • ${energyDay}` : ""}`;

    const energyLine = _el("div", "duck-stack__subline");
    energyLine.textContent = energyDescription;

    const originMeta = _el("div", "duck-stack__meta duck-stack__meta--origin");
    originMeta.textContent = `Origin Duck ${originDay ?? "?"}`;

    const label = _el("div", "duck-stack__label");
    label.textContent = name;

    card.append(
      energy,
      energyMeta,
      energyLine,
      origin,
      originMeta,
      label
    );

    return { el: card, profile };
  }

  _layout() {
    const sceneW = this.sceneEl.clientWidth || 400;

    if (sceneW <= 420) {
      this.cardWidth = 230;
      this.cardGap = 16;
    } else if (sceneW <= 640) {
      this.cardWidth = 246;
      this.cardGap = 20;
    } else {
      this.cardWidth = 270;
      this.cardGap = 26;
    }

    this.rootEl.style.setProperty("--duck-card-width", `${this.cardWidth}px`);
    this.rootEl.style.setProperty("--duck-card-gap", `${this.cardGap}px`);
    this.cards.forEach((card) => {
      card.el.style.width = `${this.cardWidth}px`;
      card.el.style.flexBasis = `${this.cardWidth}px`;
    });

    this.baseTranslate = this._translateForIndex(this.currentIndex);
  }

  _translateForIndex(index) {
    const sceneW = this.sceneEl.clientWidth || 400;
    const pitch = this.cardWidth + this.cardGap;
    return (sceneW / 2) - (this.cardWidth / 2) - (index * pitch);
  }

  _applyPosition(animate = true) {
    if (!this.cards.length) return;

    this.baseTranslate = this._translateForIndex(this.currentIndex);

    this.trackEl.style.transition = animate
      ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)"
      : "none";

    this.trackEl.style.transform = `translate3d(${this.baseTranslate + this.dragOffset}px, 0, 0)`;
    this._updateCardStates();
    this._updateNavState();
  }

  _updateCardStates() {
    this.cards.forEach((card, i) => {
      const delta = i - this.currentIndex;
      const abs = Math.abs(delta);

      card.el.classList.toggle("is-active", i === this.currentIndex);
      card.el.classList.toggle("is-near", abs === 1);
      card.el.classList.toggle("is-far", abs >= 2);
      card.el.tabIndex = i === this.currentIndex ? 0 : -1;
    });
  }

  _updateNavState() {
    const n = this.cards.length;
    const multi = n > 1;

    this.prevBtn.style.display = multi ? "" : "none";
    this.nextBtn.style.display = multi ? "" : "none";

    this.prevBtn.disabled = !multi || this.currentIndex <= 0;
    this.nextBtn.disabled = !multi || this.currentIndex >= n - 1;
  }

  _goToIndex(index, animate = true) {
    if (!this.cards.length) return;
    const clamped = Math.max(0, Math.min(index, this.cards.length - 1));
    this.currentIndex = clamped;
    this.dragOffset = 0;
    this._applyPosition(animate);
  }

  _initPointer() {
    const prefersReduced = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onDown = (e) => {
      if (this.cards.length <= 1) return;

      this._drag.active = true;
      this._drag.pointerId = e.pointerId;
      this._drag.startX = e.clientX;
      this._drag.lastX = e.clientX;
      this._drag.totalDx = 0;
      this.dragOffset = 0;

      this.trackEl.style.transition = "none";
      this.sceneEl.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      if (!this._drag.active) return;

      const dx = e.clientX - this._drag.startX;
      this._drag.lastX = e.clientX;
      this._drag.totalDx = dx;

      let effectiveDx = dx;
      const atStart = this.currentIndex === 0 && dx > 0;
      const atEnd = this.currentIndex === this.cards.length - 1 && dx < 0;
      if (atStart || atEnd) effectiveDx *= 0.35;

      this.dragOffset = effectiveDx;
      this.trackEl.style.transform = `translate3d(${this.baseTranslate + this.dragOffset}px, 0, 0)`;
    };

    const onUp = () => {
      if (!this._drag.active) return;

      this._drag.active = false;

      const dx = this._drag.totalDx;
      const threshold = Math.min(96, this.cardWidth * 0.18);

      if (Math.abs(dx) > threshold) {
        if (dx < 0) this.currentIndex = Math.min(this.cards.length - 1, this.currentIndex + 1);
        if (dx > 0) this.currentIndex = Math.max(0, this.currentIndex - 1);
      }

      this.dragOffset = 0;
      this._applyPosition(!prefersReduced());
    };

    this.sceneEl.addEventListener("pointerdown", onDown);
    this.sceneEl.addEventListener("pointermove", onMove);
    this.sceneEl.addEventListener("pointerup", onUp);
    this.sceneEl.addEventListener("pointercancel", onUp);
    this.sceneEl.addEventListener("lostpointercapture", onUp);

    this.sceneEl.style.touchAction = "pan-y";
  }

  _initClickToCenter() {
    this.trackEl.addEventListener("click", (e) => {
      if (this._drag.active || Math.abs(this._drag.totalDx) > 6) return;
      const btn = e.target.closest(".duck-stack");
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (!Number.isFinite(idx)) return;
      this._goToIndex(idx, true);
    });
  }

  _initNav() {
    this.prevBtn.addEventListener("click", () => {
      this._goToIndex(this.currentIndex - 1, true);
    });

    this.nextBtn.addEventListener("click", () => {
      this._goToIndex(this.currentIndex + 1, true);
    });
  }

  setProfiles(profiles) {
    this.profiles = profiles || [];
    this.cards = [];
    this.trackEl.innerHTML = "";

    const hasProfiles = this.profiles.length > 0;
    this.emptyEl.style.display = hasProfiles ? "none" : "flex";
    this.viewportEl.style.display = hasProfiles ? "" : "none";
    this.sphereBackEl.style.display = hasProfiles ? "" : "none";

    if (!hasProfiles) {
      this.prevBtn.style.display = "none";
      this.nextBtn.style.display = "none";
      return;
    }

    this.currentIndex = Math.max(0, Math.min(this.currentIndex, this.profiles.length - 1));

    for (const [i, p] of this.profiles.entries()) {
      const card = this._buildCard(p);
      card.el.dataset.index = String(i);
      this.cards.push(card);
      this.trackEl.appendChild(card.el);
    }

    this._layout();
    this._applyPosition(false);
  }

  reload(profiles) {
    this.setProfiles(profiles);
  }

  destroy() {
    this._ro?.disconnect();
    this.wrapEl.innerHTML = "";
  }
}

function _el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

export default DuckCarousel;
