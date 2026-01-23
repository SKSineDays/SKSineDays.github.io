// js/duck-pond.js
import { duckUrlFromSinedayNumber } from "./sineducks.js";
import { getOriginTypeForDob, ORIGIN_ANCHOR_DATE } from "./origin-wave.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export class DuckPond {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   * @param {HTMLElement} [opts.stageEl] - container that controls size
   * @param {HTMLElement} [opts.emptyEl] - overlay text when empty
   * @param {HTMLElement} [opts.statusEl] - aria-live status line
   * @param {string} [opts.anchorDate] - YYYY-MM-DD
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    this.stageEl = opts.stageEl || canvas.parentElement;
    this.emptyEl = opts.emptyEl || null;
    this.statusEl = opts.statusEl || null;
    this.anchorDate = opts.anchorDate || ORIGIN_ANCHOR_DATE;

    this.ducks = new Map(); // id -> duck
    this.imageCache = new Map(); // url -> Image

    this.running = false;
    this.rafId = null;

    this.lastT = 0;
    this.w = 600;
    this.h = 320;
    this.dpr = window.devicePixelRatio || 1;

    this.pointer = {
      active: false,
      id: null,
      duckId: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      lastX: 0,
      lastY: 0,
      lastT: 0
    };

    this.reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    // Bind
    this._tick = this._tick.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    // Sizing
    this.resizeObserver = new ResizeObserver(() => this.resize());
    if (this.stageEl) this.resizeObserver.observe(this.stageEl);
    window.addEventListener("resize", () => this.resize(), { passive: true });
    this.resize();

    // Input
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this._onPointerDown);
    this.canvas.addEventListener("pointermove", this._onPointerMove);
    this.canvas.addEventListener("pointerup", this._onPointerUp);
    this.canvas.addEventListener("pointercancel", this._onPointerUp);
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointercancel", this._onPointerUp);
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  resize() {
    const rect = this.stageEl?.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect?.width || this.canvas.clientWidth || 600));
    const h = Math.max(120, Math.floor(rect?.height || this.canvas.clientHeight || 320));

    this.w = w;
    this.h = h;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _getImage(url) {
    if (this.imageCache.has(url)) return this.imageCache.get(url);

    const img = new Image();
    img.decoding = "async";
    img.loading = "lazy";
    img.src = url;
    this.imageCache.set(url, img);
    return img;
  }

  _spawnDuckFromProfile(profile) {
    const origin = getOriginTypeForDob(profile.birthdate, this.anchorDate) ?? 1;
    const url = duckUrlFromSinedayNumber(origin);
    const img = this._getImage(url);

    // Size scales gently with count but remains consistent
    const baseR = 44;
    const r = clamp(baseR, 34, 52);

    // If stage is hidden (width 0), use fallback
    const W = this.w || 600;
    const H = this.h || 320;

    const x = W * 0.5 + (Math.random() - 0.5) * (W * 0.35);
    const y = H * 0.5 + (Math.random() - 0.5) * (H * 0.25);

    return {
      id: profile.id,
      name: profile.display_name || "Profile",
      birthdate: profile.birthdate,
      originDay: origin,
      img,
      r,
      x: clamp(x, r, W - r),
      y: clamp(y, r, H - r),
      vx: (Math.random() - 0.5) * 160,
      vy: (Math.random() - 0.5) * 120,
      seedA: Math.random() * Math.PI * 2,
      seedB: Math.random() * Math.PI * 2
    };
  }

  /**
   * Update ducks to match profiles (add/remove only; preserves positions when possible).
   * @param {Array<{id:string, display_name:string, birthdate:string}>} profiles
   */
  setProfiles(profiles) {
    const nextIds = new Set((profiles || []).map(p => p.id));

    // Remove missing
    for (const id of this.ducks.keys()) {
      if (!nextIds.has(id)) this.ducks.delete(id);
    }

    // Add new
    for (const p of profiles || []) {
      if (!this.ducks.has(p.id)) {
        this.ducks.set(p.id, this._spawnDuckFromProfile(p));
      }
    }

    const empty = this.ducks.size === 0;
    if (this.stageEl) this.stageEl.dataset.empty = empty ? "true" : "false";
    if (this.emptyEl) this.emptyEl.style.display = empty ? "grid" : "none";

    if (empty) {
      this.setStatus("Add a profile to spawn your first duck.");
      this.stop();
      this._render(); // clears canvas
      return;
    }

    this.setStatus("Drag and throw the ducks. They collide and float.");
    if (!this.reduceMotion) this.start();
    else this._renderStaticGrid();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  _pickDuck(px, py) {
    // Pick topmost by nearest center in radius
    let picked = null;
    let best = Infinity;

    for (const duck of this.ducks.values()) {
      const d = dist2(px, py, duck.x, duck.y);
      if (d <= duck.r * duck.r && d < best) {
        best = d;
        picked = duck;
      }
    }
    return picked;
  }

  _canvasPointFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top)
    };
  }

  _onPointerDown(e) {
    if (this.reduceMotion) return;

    const { x, y } = this._canvasPointFromEvent(e);
    const duck = this._pickDuck(x, y);
    if (!duck) return;

    this.pointer.active = true;
    this.pointer.id = e.pointerId;
    this.pointer.duckId = duck.id;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.lastX = x;
    this.pointer.lastY = y;
    this.pointer.vx = 0;
    this.pointer.vy = 0;
    this.pointer.lastT = performance.now();

    // Grab: stop its motion immediately
    duck.vx = 0;
    duck.vy = 0;

    this.canvas.setPointerCapture(e.pointerId);
    this.setStatus(`${duck.name}: Origin Day ${duck.originDay} (drag & throw)`);
  }

  _onPointerMove(e) {
    if (!this.pointer.active || e.pointerId !== this.pointer.id) return;

    const { x, y } = this._canvasPointFromEvent(e);
    const now = performance.now();
    const dt = Math.max(0.001, (now - this.pointer.lastT) / 1000);

    const dx = x - this.pointer.lastX;
    const dy = y - this.pointer.lastY;

    // Smoothed velocity estimate (px/s)
    const instVx = dx / dt;
    const instVy = dy / dt;
    this.pointer.vx = this.pointer.vx * 0.7 + instVx * 0.3;
    this.pointer.vy = this.pointer.vy * 0.7 + instVy * 0.3;

    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.lastX = x;
    this.pointer.lastY = y;
    this.pointer.lastT = now;

    const duck = this.ducks.get(this.pointer.duckId);
    if (duck) {
      duck.x = clamp(x, duck.r, this.w - duck.r);
      duck.y = clamp(y, duck.r, this.h - duck.r);
    }
  }

  _onPointerUp(e) {
    if (!this.pointer.active || e.pointerId !== this.pointer.id) return;

    const duck = this.ducks.get(this.pointer.duckId);
    if (duck) {
      // Throw impulse
      duck.vx = clamp(this.pointer.vx, -1200, 1200);
      duck.vy = clamp(this.pointer.vy, -1200, 1200);
      this.setStatus(`${duck.name} launched 🚀`);
    }

    this.pointer.active = false;
    this.pointer.id = null;
    this.pointer.duckId = null;
  }

  _physicsStep(dt, t) {
    const WALL_E = 0.86;
    const COLL_E = 0.90;
    const DRAG = 0.992;

    const ducksArr = Array.from(this.ducks.values());

    // Gentle "space drift" (smooth)
    for (const d of ducksArr) {
      if (this.pointer.active && this.pointer.duckId === d.id) continue;

      const ax = Math.sin(t * 0.001 + d.seedA) * 18;
      const ay = Math.cos(t * 0.001 + d.seedB) * 14;

      d.vx += ax * dt;
      d.vy += ay * dt;

      d.vx *= DRAG;
      d.vy *= DRAG;

      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Walls
      if (d.x < d.r) { d.x = d.r; d.vx = Math.abs(d.vx) * WALL_E; }
      if (d.x > this.w - d.r) { d.x = this.w - d.r; d.vx = -Math.abs(d.vx) * WALL_E; }
      if (d.y < d.r) { d.y = d.r; d.vy = Math.abs(d.vy) * WALL_E; }
      if (d.y > this.h - d.r) { d.y = this.h - d.r; d.vy = -Math.abs(d.vy) * WALL_E; }
    }

    // Collisions (circle-circle)
    for (let i = 0; i < ducksArr.length; i++) {
      for (let j = i + 1; j < ducksArr.length; j++) {
        const a = ducksArr[i];
        const b = ducksArr[j];

        // If grabbed, let it push others but don't get pushed back too hard
        const aGrabbed = this.pointer.active && this.pointer.duckId === a.id;
        const bGrabbed = this.pointer.active && this.pointer.duckId === b.id;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;

        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          // Separate
          const pushA = bGrabbed ? 1.0 : 0.5;
          const pushB = aGrabbed ? 1.0 : 0.5;

          a.x -= nx * overlap * pushA;
          a.y -= ny * overlap * pushA;
          b.x += nx * overlap * pushB;
          b.y += ny * overlap * pushB;

          // Relative velocity along normal
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          // If separating, skip impulse
          if (velAlongNormal > 0) continue;

          // Equal mass impulse
          const impulse = -(1 + COLL_E) * velAlongNormal / 2;

          if (!aGrabbed) {
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
          }
          if (!bGrabbed) {
            b.vx += impulse * nx;
            b.vy += impulse * ny;
          }
        }
      }
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // Subtle "space glass" backdrop
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();

    // Ducks
    for (const d of this.ducks.values()) {
      // Only draw if image is loaded
      if (!d.img.complete || d.img.naturalWidth === 0) continue;
      
      const size = d.r * 2;
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.drawImage(d.img, d.x - d.r, d.y - d.r, size, size);
      ctx.restore();
    }
  }

  _renderStaticGrid() {
    // Reduced-motion fallback: draw a tidy static layout
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const ducksArr = Array.from(this.ducks.values()).filter(d => d.img.complete && d.img.naturalWidth > 0);
    if (ducksArr.length === 0) return;

    const cols = Math.min(5, Math.max(1, ducksArr.length));
    const pad = 18;
    const cellW = (this.w - pad * 2) / cols;
    const rows = Math.ceil(ducksArr.length / cols);
    const cellH = (this.h - pad * 2) / Math.max(1, rows);

    ducksArr.forEach((d, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = pad + c * cellW + cellW / 2;
      const y = pad + r * cellH + cellH / 2;
      const size = Math.min(cellW, cellH) * 0.62;
      ctx.drawImage(d.img, x - size / 2, y - size / 2, size, size);
    });

    this.setStatus("Reduced motion is enabled — showing a static duck layout.");
  }

  _tick(t) {
    if (!this.running) return;

    const dt = Math.min(0.033, Math.max(0.001, (t - this.lastT) / 1000));
    this.lastT = t;

    this._physicsStep(dt, t);
    this._render();

    this.rafId = requestAnimationFrame(this._tick);
  }
}
