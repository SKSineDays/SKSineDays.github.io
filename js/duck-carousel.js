// js/duck-carousel.js
//
// Origin Duck Carousel — replaces the interactive duck-pond canvas game
// with a card carousel showing each profile's origin duck image and a
// mini sine-wave visualization of their current SineDay.
//
// Public API (same shape as DuckPond for easy swap in dashboard.js):
//   const carousel = new DuckCarousel(containerEl, opts)
//   carousel.setProfiles(profiles)   — sync cards to profile array
//   carousel.reload(profiles)        — hard refresh
//   carousel.destroy()               — cleanup

import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "./origin-wave.js";
import { calculateSineDay, getDayData } from "./sineday-engine.js";

/* ────────────────────────────
   Mini-wave renderer
   ──────────────────────────── */

class MiniWave {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, markerPos = 0.5) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = window.devicePixelRatio || 1;
    this.markerPos = markerPos;
    this.t = 0;
    this.raf = null;
    this.prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);

    if (!this.prefersReducedMotion) this.start();
    else this._draw(0);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.prefersReducedMotion) this._draw(this.t);
  }

  start() {
    if (this.raf) return;
    const loop = (ts) => {
      this.t = ts;
      this._draw(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _yAt(x, phase) {
    const freq = 1.5;
    const amp = this.h * 0.3;
    return this.h / 2 + Math.sin((x / this.w) * Math.PI * 2 * freq + phase) * amp;
  }

  _draw(ts) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    const phase = this.prefersReducedMotion ? 0 : ts * 0.0003;
    const accent = "#7AA7FF";

    // Echo wave
    ctx.beginPath();
    ctx.strokeStyle = "rgba(122,167,255,0.15)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 2) {
      const y = this._yAt(x, phase + 0.4);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Main wave
    ctx.beginPath();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    for (let x = 0; x <= w; x += 2) {
      const y = this._yAt(x, phase);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Marker dot
    const mx = this.markerPos * w;
    const my = this._yAt(mx, phase);
    const r = 4;

    // Glow
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r + 4);
    grad.addColorStop(0, "rgba(122,167,255,0.35)");
    grad.addColorStop(1, "rgba(122,167,255,0)");
    ctx.beginPath();
    ctx.arc(mx, my, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  destroy() {
    this.stop();
    this._ro?.disconnect();
  }
}

/* ────────────────────────────
   DuckCarousel
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
    this.cards = [];       // { el, miniWave }
    this.page = 0;
    this.perPage = 1;

    // Build skeleton DOM
    this._buildDOM();
    this._calcPerPage();

    // Resize observer for per-page recalc
    this._ro = new ResizeObserver(() => {
      this._calcPerPage();
      this._goTo(Math.min(this.page, this._maxPage()), false);
    });
    this._ro.observe(this.wrapEl);
  }

  /* ── DOM skeleton ── */

  _buildDOM() {
    this.wrapEl.innerHTML = "";

    // Carousel root
    this.rootEl = _el("div", "duck-carousel");

    // Viewport
    this.viewportEl = _el("div", "duck-carousel__viewport");
    this.trackEl = _el("div", "duck-carousel__track");
    this.viewportEl.appendChild(this.trackEl);
    this.rootEl.appendChild(this.viewportEl);

    // Empty state
    this.emptyEl = _el("div", "duck-carousel__empty");
    this.emptyEl.textContent = "Add a profile to see your first Origin Duck 🦆";
    this.viewportEl.appendChild(this.emptyEl);

    // Nav buttons
    this.prevBtn = _el("button", "duck-carousel__nav duck-carousel__nav--prev");
    this.prevBtn.setAttribute("aria-label", "Previous");
    this.prevBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>`;

    this.nextBtn = _el("button", "duck-carousel__nav duck-carousel__nav--next");
    this.nextBtn.setAttribute("aria-label", "Next");
    this.nextBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;

    this.rootEl.appendChild(this.prevBtn);
    this.rootEl.appendChild(this.nextBtn);

    // Dots
    this.dotsEl = _el("div", "duck-carousel__dots");
    this.rootEl.appendChild(this.dotsEl);

    // Attach
    this.wrapEl.appendChild(this.rootEl);

    // Events
    this.prevBtn.addEventListener("click", () => this._goTo(this.page - 1));
    this.nextBtn.addEventListener("click", () => this._goTo(this.page + 1));

    // Swipe support
    this._initTouch();
  }

  /* ── Touch / swipe ── */

  _initTouch() {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let swiping = false;

    this.viewportEl.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiping = false;
      dx = 0;
    }, { passive: true });

    this.viewportEl.addEventListener("touchmove", (e) => {
      dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) + 8) swiping = true;
    }, { passive: true });

    this.viewportEl.addEventListener("touchend", () => {
      if (!swiping) return;
      const threshold = 50;
      if (dx < -threshold) this._goTo(this.page + 1);
      else if (dx > threshold) this._goTo(this.page - 1);
    }, { passive: true });
  }

  /* ── Per-page calc ── */

  _calcPerPage() {
    const w = this.wrapEl.offsetWidth || 400;
    if (w >= 960) this.perPage = 3;
    else if (w >= 640) this.perPage = 2;
    else this.perPage = 1;
  }

  _maxPage() {
    return Math.max(0, Math.ceil(this.cards.length / this.perPage) - 1);
  }

  /* ── Navigation ── */

  _goTo(idx, animate = true) {
    const max = this._maxPage();
    this.page = Math.max(0, Math.min(idx, max));

    const shift = -(this.page * this.perPage * (100 / this.cards.length || 100));
    this.trackEl.style.transition = animate
      ? "transform 0.45s cubic-bezier(0.25,0.8,0.25,1)"
      : "none";
    this.trackEl.style.transform = `translateX(${shift}%)`;

    this.prevBtn.disabled = this.page <= 0;
    this.nextBtn.disabled = this.page >= max;

    this._renderDots();
  }

  _renderDots() {
    const total = this._maxPage() + 1;
    this.dotsEl.innerHTML = "";
    if (total <= 1) return;
    for (let i = 0; i < total; i++) {
      const dot = _el("button", "duck-carousel__dot");
      if (i === this.page) dot.classList.add("is-active");
      dot.setAttribute("aria-label", `Page ${i + 1}`);
      dot.addEventListener("click", () => this._goTo(i));
      this.dotsEl.appendChild(dot);
    }
  }

  /* ── Profile → Card sync ── */

  setProfiles(profiles) {
    this.profiles = profiles || [];

    // Destroy old mini-waves
    for (const c of this.cards) c.miniWave?.destroy();
    this.cards = [];
    this.trackEl.innerHTML = "";

    if (this.profiles.length === 0) {
      this.emptyEl.style.display = "block";
      this.prevBtn.style.display = "none";
      this.nextBtn.style.display = "none";
      this.dotsEl.innerHTML = "";
      return;
    }

    this.emptyEl.style.display = "none";
    this.prevBtn.style.display = "";
    this.nextBtn.style.display = "";

    for (const p of this.profiles) {
      const card = this._buildCard(p);
      this.cards.push(card);
      this.trackEl.appendChild(card.el);
    }

    // Track width: each card is (100 / perPage)% of viewport, total = cards * that
    this._applyTrackWidth();
    this._goTo(0, false);
  }

  _applyTrackWidth() {
    // Make each card fill 1/perPage of the viewport
    const cardPct = 100 / this.perPage;
    for (const c of this.cards) {
      c.el.style.flex = `0 0 ${cardPct}%`;
      c.el.style.maxWidth = `${cardPct}%`;
    }
  }

  _buildCard(profile) {
    const el = _el("div", "duck-card");

    // Origin day from DOB
    const originDay = getOriginTypeForDob(profile.birthdate, this.anchorDate);
    const duckUrl = originDay ? duckUrlFromSinedayNumber(originDay) : null;
    const originData = originDay ? getDayData(originDay) : null;

    // Current SineDay (today) from their birthdate
    const sineResult = calculateSineDay(profile.birthdate);
    const currentDay = sineResult?.day || null;
    const currentData = currentDay ? getDayData(currentDay) : null;
    const wavePos = sineResult?.position ?? 0.5;

    // Image
    const imgWrap = _el("div", "duck-card__img-wrap");
    if (duckUrl) {
      const img = document.createElement("img");
      img.src = "/" + duckUrl;
      img.alt = `SineDuck Day ${originDay}`;
      img.className = "duck-card__img";
      img.width = 96;
      img.height = 96;
      img.loading = "lazy";
      imgWrap.appendChild(img);
    }
    el.appendChild(imgWrap);

    // Name
    const nameEl = _el("div", "duck-card__name");
    nameEl.textContent = profile.display_name || "Unnamed";
    el.appendChild(nameEl);

    // Origin label
    if (originDay && originData) {
      const originEl = _el("div", "duck-card__origin");
      originEl.textContent = `Origin Day ${originDay}`;
      el.appendChild(originEl);

      const phaseEl = _el("div", "duck-card__phase");
      phaseEl.textContent = originData.phase;
      el.appendChild(phaseEl);
    }

    // Mini wave canvas
    const waveCanvas = document.createElement("canvas");
    waveCanvas.className = "duck-card__wave";
    el.appendChild(waveCanvas);
    const miniWave = new MiniWave(waveCanvas, wavePos);

    // Current day badge
    if (currentDay && currentData) {
      const badge = _el("div", "duck-card__day-badge");
      badge.textContent = `Today: Day ${currentDay}`;
      el.appendChild(badge);

      const desc = _el("div", "duck-card__description");
      desc.textContent = currentData.description;
      el.appendChild(desc);
    }

    return { el, miniWave };
  }

  /* ── Reload (mirrors DuckPond API) ── */

  reload(profiles) {
    this.setProfiles(profiles);
  }

  /* ── Cleanup ── */

  destroy() {
    for (const c of this.cards) c.miniWave?.destroy();
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
