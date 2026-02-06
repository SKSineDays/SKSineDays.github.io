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
   * @param {HTMLElement} [opts.scoreEl] - score display element
   * @param {string} [opts.anchorDate] - YYYY-MM-DD
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    this.stageEl = opts.stageEl || canvas.parentElement;
    this.emptyEl = opts.emptyEl || null;
    this.statusEl = opts.statusEl || null;
    this.scoreEl = opts.scoreEl || null;
    this.anchorDate = opts.anchorDate || ORIGIN_ANCHOR_DATE;

    this.ducks = new Map(); // id -> duck
    this.imageCache = new Map(); // url -> Image
    this._loadToken = 0; // token to cancel stale preloads

    this.running = false;
    this.rafId = null;

    this.lastT = 0;
    this.w = 600;
    this.h = 320;
    this.dpr = window.devicePixelRatio || 1;

    // Stars, ripples, and double-tap tracking
    this.stars = [];
    this.starCount = 0;
    this.ripples = [];           // for burst feedback rings
    this.lastTap = { t: 0, id: null }; // double-tap tracking

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

    // Fullscreen state
    this.isFullscreen = false;
    this.fullscreenBtn = null;

    // Performance monitoring
    this.fps = 60;
    this.fpsHistory = [];
    this.lastFpsCheck = performance.now();
    this.particlesDisabled = false;

    // Gradient animation
    this.gradientTime = 0;

    // Score and orb state
    this.score = 0;
    this.scoreSmooth = 0; // optional smoothing if you want
    this.orb = {
      active: false,
      x: 0, y: 0,
      vx: 0, vy: 0,
      r: 16,
      hitCooldown: 0
    };

    // Bind
    this._tick = this._tick.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._toggleFullscreen = this._toggleFullscreen.bind(this);
    this._onFullscreenChange = this._onFullscreenChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

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

    // Fullscreen setup
    this._initFullscreen();
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointercancel", this._onPointerUp);
    
    // Cleanup fullscreen
    if (this.fullscreenBtn) {
      this.fullscreenBtn.removeEventListener("click", this._toggleFullscreen);
    }
    document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", this._onFullscreenChange);
    document.removeEventListener("mozfullscreenchange", this._onFullscreenChange);
    document.removeEventListener("MSFullscreenChange", this._onFullscreenChange);
    document.removeEventListener("keydown", this._onKeyDown);
  }

  _initFullscreen() {
    // Find fullscreen button
    this.fullscreenBtn = document.getElementById("duck-pond-fullscreen-btn");
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener("click", this._toggleFullscreen);
    }

    // Listen for fullscreen changes
    document.addEventListener("fullscreenchange", this._onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", this._onFullscreenChange);
    document.addEventListener("mozfullscreenchange", this._onFullscreenChange);
    document.addEventListener("MSFullscreenChange", this._onFullscreenChange);

    // ESC key to exit fullscreen
    document.addEventListener("keydown", this._onKeyDown);
  }

  _onKeyDown(e) {
    if (e.key === "Escape" && this.isFullscreen) {
      this._exitFullscreen();
    }
  }

  _toggleFullscreen() {
    if (this.isFullscreen) {
      this._exitFullscreen();
    } else {
      this._enterFullscreen();
    }
  }

  _enterFullscreen() {
    const elem = this.stageEl || document.documentElement;
    
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.mozRequestFullScreen) {
      elem.mozRequestFullScreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  }

  _exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  _onFullscreenChange() {
    const isFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );

    this.isFullscreen = isFullscreen;
    
    if (this.stageEl) {
      this.stageEl.dataset.fullscreen = isFullscreen ? "true" : "false";
    }

    // Hide/show other UI elements
    const header = document.querySelector(".duck-pond-header");
    const status = document.querySelector(".duck-pond-status");
    const subtitle = document.querySelector(".duck-pond-subtitle");
    
    if (isFullscreen) {
      if (header) header.style.display = "none";
      if (status) status.style.display = "none";
      if (subtitle) subtitle.style.display = "none";
      document.body.style.overflow = "hidden";
    } else {
      if (header) header.style.display = "";
      if (status) status.style.display = "";
      if (subtitle) subtitle.style.display = "";
      document.body.style.overflow = "";
    }

    // Resize canvas when fullscreen changes
    setTimeout(() => this.resize(), 100);
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  resize() {
    // In fullscreen, use viewport dimensions
    let w, h;
    if (this.isFullscreen) {
      w = window.innerWidth;
      h = window.innerHeight;
    } else {
      const rect = this.stageEl?.getBoundingClientRect();
      w = Math.max(280, Math.floor(rect?.width || this.canvas.clientWidth || 600));
      h = Math.max(120, Math.floor(rect?.height || this.canvas.clientHeight || 320));
    }

    this.w = w;
    this.h = h;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Reseed stars on resize (with updated count for fullscreen)
    this._seedStars();
    
    // Keep orb in bounds on resize
    this._ensureOrb();
  }

  _getImage(url) {
    if (this.imageCache.has(url)) return this.imageCache.get(url);

    const img = new Image();
    img.decoding = "async";
    // IMPORTANT: "lazy" can delay canvas sprites; use eager.
    img.loading = "eager";
    img.fetchPriority = "high";
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
      seedB: Math.random() * Math.PI * 2,
      pinned: false,
      pulseSeed: Math.random() * Math.PI * 2
    };
  }

  /**
   * Preload duck images with cancellation token support
   * @param {number} token - cancellation token
   */
  async _preloadDuckImages(token) {
    const ducks = Array.from(this.ducks.values());
    const waitOne = (img) =>
      new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) return resolve();
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });

    // Wait for all duck images (and decode when supported)
    await Promise.all(
      ducks.map(async (d) => {
        const img = d.img;
        await waitOne(img);
        if (token !== this._loadToken) return;
        if (img.decode) {
          try { await img.decode(); } catch {}
        }
      })
    );
  }

  /**
   * Hard reload: clear cache, rebuild images, re-sync profiles
   * @param {Array<{id:string, display_name:string, birthdate:string}>} profiles
   */
  reload(profiles) {
    // Hard reload: clear cache, rebuild images, re-sync profiles
    this.imageCache.clear();

    // Rebuild each duck's image ref so it fetches again (forces reload)
    for (const d of this.ducks.values()) {
      const url = duckUrlFromSinedayNumber(d.originDay);
      d.img = this._getImage(url);
    }

    // Sync profiles (adds/removes ducks, triggers preload, etc.)
    this.setProfiles(profiles);
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
      this.score = 0;
      this.orb.active = false;
      if (this.scoreEl) this.scoreEl.textContent = "0";
      this.setStatus("Add a profile to spawn your first duck.");
      this.stop();
      this._render(); // clears canvas
      return;
    } else {
      this._ensureOrb();
    }

    const token = ++this._loadToken;

    this.setStatus("Loading ducks…");

    this._preloadDuckImages(token).then(() => {
      if (token !== this._loadToken) return;

      this.setStatus("Drag and throw the ducks. They collide and float.");
      if (!this.reduceMotion) this.start();
      else this._renderStaticGrid();

      // force a render right after load
      this._render();
    });

    // Render immediately with placeholders
    this._render();
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

  _seedStars() {
    // Increased density - more particles
    const baseDensity = this.isFullscreen ? 8000 : 12000; // More particles in fullscreen
    const target = Math.floor((this.w * this.h) / baseDensity);
    this.starCount = clamp(target, 80, 250); // Increased from 35-120 to 80-250

    this.stars = Array.from({ length: this.starCount }).map(() => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r: 0.6 + Math.random() * 1.6,
      a: 0.05 + Math.random() * 0.15, // Subtle alpha (0.05-0.20)
      tw: 0.6 + Math.random() * 1.8,
      ph: Math.random() * Math.PI * 2,
      // Slow drift properties
      vx: (Math.random() - 0.5) * 8, // Very slow horizontal drift
      vy: (Math.random() - 0.5) * 6, // Very slow vertical drift
      driftSeed: Math.random() * Math.PI * 2 // For parallax effect
    }));
  }

  _drawStars(t) {
    if (this.particlesDisabled || this.reduceMotion) return;

    const ctx = this.ctx;
    ctx.save();
    
    // Update particle positions with slow drift
    const dt = 0.016; // ~60fps delta
    const driftSpeed = this.isFullscreen ? 0.3 : 0.5; // Slower in fullscreen
    
    for (const s of this.stars) {
      // Very slow drift with subtle parallax variation
      const parallax = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.0003 + s.driftSeed));
      s.x += s.vx * dt * driftSpeed * parallax;
      s.y += s.vy * dt * driftSpeed * parallax;

      // Wrap around edges
      if (s.x < 0) s.x += this.w;
      if (s.x > this.w) s.x -= this.w;
      if (s.y < 0) s.y += this.h;
      if (s.y > this.h) s.y -= this.h;

      // Twinkle effect
      const twinkle = 0.65 + 0.35 * Math.sin(t * 0.0015 * s.tw + s.ph);
      const alpha = s.a * twinkle;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
    }
    ctx.restore();
  }

  _ensureOrb() {
    if (!this.orb) return;
    if (!this.orb.active) {
      // spawn when first duck exists
      if (this.ducks.size > 0) {
        this.orb.active = true;
        this.orb.x = this.w * 0.72;
        this.orb.y = this.h * 0.45;
        this.orb.vx = 0;
        this.orb.vy = 0;
        this.orb.hitCooldown = 0;
      }
    } else {
      // clamp into bounds
      const r = this.orb.r;
      this.orb.x = clamp(this.orb.x, r, this.w - r);
      this.orb.y = clamp(this.orb.y, r, this.h - r);
    }
  }

  _orbStep(dt) {
    if (!this.orb?.active) return;

    const o = this.orb;

    // Cooldown after a "touch" so score dips but no fail
    o.hitCooldown = Math.max(0, o.hitCooldown - dt);

    let fx = 0, fy = 0;

    const ducksArr = Array.from(this.ducks.values());

    // Avoid each duck, stronger if it's moving fast or is held
    for (const d of ducksArr) {
      const dx = o.x - d.x;
      const dy = o.y - d.y;
      const dist = Math.hypot(dx, dy) || 0.0001;

      const speed = Math.hypot(d.vx, d.vy);
      const movingBoost = clamp(speed / 700, 0, 1); // thrown ducks push harder

      const isHeld = this.pointer.active && this.pointer.duckId === d.id;

      // Base avoid radius
      let avoidR = 140 + d.r + o.r;
      // Vast avoidance from held duck
      if (isHeld) avoidR = 340 + d.r + o.r;

      // If duck is moving fast, expand avoidance
      avoidR += movingBoost * 120;

      if (dist < avoidR) {
        const nx = dx / dist;
        const ny = dy / dist;

        // smooth repulsion strength
        let s = (avoidR - dist) / avoidR;

        // Held duck = stronger (reduced from 4.5)
        if (isHeld) s *= 3.2;

        // Fast moving ducks add punch (reduced from 1.5)
        s *= (1.0 + 1.0 * movingBoost);

        // Accumulate force (reduced from 900)
        fx += nx * (650 * s);
        fy += ny * (650 * s);
      }

      // "Touch" detection (no fail): orb got tagged
      const touchDist = d.r + o.r;
      if (dist < touchDist) {
        o.hitCooldown = 0.6;
        // small pop away
        const nx = dx / dist;
        const ny = dy / dist;
        o.vx += nx * 220;
        o.vy += ny * 220;
      }
    }

    // Gentle "home spring" to center
    const centerX = this.w * 0.5;
    const centerY = this.h * 0.5;
    const dxToCenter = centerX - o.x;
    const dyToCenter = centerY - o.y;
    const distToCenter = Math.hypot(dxToCenter, dyToCenter);
    
    if (distToCenter > 0.1) {
      // Spring force increases with distance from center
      const springStrength = clamp(distToCenter / Math.max(this.w, this.h), 0, 1) * 180;
      fx += (dxToCenter / distToCenter) * springStrength;
      fy += (dyToCenter / distToCenter) * springStrength;
    }

    // Add a tiny wander so it never dead-stops
    fx += (Math.sin(performance.now() * 0.0012) * 22);
    fy += (Math.cos(performance.now() * 0.0010) * 18);

    // Integrate
    o.vx += fx * dt;
    o.vy += fy * dt;

    // Drag
    o.vx *= 0.985;
    o.vy *= 0.985;

    // Cap speed so it feels ASMR not frantic
    const vmax = this.isFullscreen ? 520 : 620;
    const v = Math.hypot(o.vx, o.vy);
    if (v > vmax) {
      o.vx = (o.vx / v) * vmax;
      o.vy = (o.vy / v) * vmax;
    }

    o.x += o.vx * dt;
    o.y += o.vy * dt;

    // Walls (reduced bounce energy)
    const r = o.r;
    const E = 0.75; // Reduced from 0.92 to cap edge-bounce energy
    if (o.x < r) { o.x = r; o.vx = Math.abs(o.vx) * E; }
    if (o.x > this.w - r) { o.x = this.w - r; o.vx = -Math.abs(o.vx) * E; }
    if (o.y < r) { o.y = r; o.vy = Math.abs(o.vy) * E; }
    if (o.y > this.h - r) { o.y = this.h - r; o.vy = -Math.abs(o.vy) * E; }
  }

  _scoreStep(dt) {
    if (!this.orb?.active) return;

    const o = this.orb;
    const ducksArr = Array.from(this.ducks.values());
    if (ducksArr.length === 0) return;

    // pressure = closest duck proximity + bonus if held duck is close
    let nearest = Infinity;
    let heldBonus = 0;

    for (const d of ducksArr) {
      const dist = Math.hypot(o.x - d.x, o.y - d.y);
      nearest = Math.min(nearest, dist);

      const isHeld = this.pointer.active && this.pointer.duckId === d.id;
      if (isHeld) {
        // strong bonus when you're actively herding it
        const nearHeld = clamp(1 - (dist / 360), 0, 1);
        heldBonus = Math.max(heldBonus, nearHeld);
      }
    }

    // base rate
    let rate = 1.2;

    // orb is near ducks => higher rate (you're "controlling")
    const pressure = clamp(1 - (nearest / 220), 0, 1);
    rate += pressure * 6.0;

    // held duck near => big points
    rate += heldBonus * 10.0;

    // if orb got tagged recently, reduce rate (no fail)
    if (o.hitCooldown > 0) rate *= 0.25;

    this.score += rate * dt;

    if (this.scoreEl) {
      this.scoreEl.textContent = String(Math.floor(this.score));
    }
  }

  _drawOrb() {
    if (!this.orb?.active) return;
    const ctx = this.ctx;
    const o = this.orb;

    ctx.save();

    // soft glow
    ctx.shadowColor = "rgba(255, 60, 60, 0.35)";
    ctx.shadowBlur = 18;

    // outer ring
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 80, 80, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // core
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 60, 60, 0.88)";
    ctx.fill();

    // if recently tagged, show a subtle dim pulse
    if (o.hitCooldown > 0) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r + 10 * (o.hitCooldown / 0.6), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  _burst(x, y) {
    const radius = Math.min(this.w, this.h) * 0.34;
    const strength = 900; // tweak power

    for (const d of this.ducks.values()) {
      if (d.pinned) continue;

      const dx = d.x - x;
      const dy = d.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0.001 || dist > radius) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      const falloff = 1 - dist / radius;
      const impulse = strength * falloff;

      d.vx += nx * impulse;
      d.vy += ny * impulse;
    }

    // ripple feedback
    this.ripples.push({ x, y, t0: performance.now() });
    this.setStatus("Burst ✨");
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
    
    if (!duck) {
      this._burst(x, y);
      return;
    }

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
    const now = performance.now();
    
    if (duck) {
      const isDouble = (now - this.lastTap.t) < 280 && this.lastTap.id === duck.id;
      this.lastTap = { t: now, id: duck.id };

      if (isDouble) {
        duck.pinned = !duck.pinned;
        duck.vx = 0;
        duck.vy = 0;
        this.setStatus(duck.pinned ? `${duck.name} pinned 📍` : `${duck.name} unpinned`);
      } else {
        // normal throw impulse (your existing throw)
        duck.vx = clamp(this.pointer.vx, -1200, 1200);
        duck.vy = clamp(this.pointer.vy, -1200, 1200);
        this.setStatus(`${duck.name} launched 🚀`);
      }
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
      // Skip physics for pinned ducks
      if (d.pinned) {
        d.vx = 0;
        d.vy = 0;
        continue;
      }

      if (this.pointer.active && this.pointer.duckId === d.id) continue;

      // Slower motion in fullscreen (0.85x speed)
      const motionScale = this.isFullscreen ? 0.85 : 1.0;
      const ax = Math.sin(t * 0.001 + d.seedA) * 18 * motionScale;
      const ay = Math.cos(t * 0.001 + d.seedB) * 14 * motionScale;

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

    // Orb avoidance physics and scoring
    this._orbStep(dt);
    this._scoreStep(dt);
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // Breathing gradient backdrop (60-90 second cycle)
    const t = performance.now();
    this.gradientTime = t * 0.0005; // Slow cycle (~60 seconds for full rotation)
    
    // Hue shift: deep blue → indigo → soft teal → back
    // Using sin wave to smoothly cycle through colors
    const hueShift = Math.sin(this.gradientTime) * 0.5 + 0.5; // 0 to 1
    
    // Create radial gradient with subtle color shift
    const centerX = this.w * 0.5;
    const centerY = this.h * 0.5;
    const maxRadius = Math.hypot(this.w, this.h) * 0.7;
    
    // Color stops: deep blue (0) → indigo (0.33) → teal (0.66) → deep blue (1)
    const hue1 = 220 + hueShift * 40; // 220-260 (blue to indigo)
    const hue2 = 200 + hueShift * 30; // 200-230 (indigo to teal)
    const sat1 = 45 + hueShift * 15; // 45-60
    const sat2 = 35 + hueShift * 20; // 35-55
    const light1 = 8 + hueShift * 4; // 8-12
    const light2 = 12 + hueShift * 6; // 12-18
    
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    gradient.addColorStop(0, `hsla(${hue1}, ${sat1}%, ${light1}%, 0.15)`);
    gradient.addColorStop(0.5, `hsla(${hue2}, ${sat2}%, ${light2}%, 0.08)`);
    gradient.addColorStop(1, `hsla(220, 40%, 6%, 0.25)`);
    
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();

    // Subtle overlay for depth
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();

    // Stars behind ducks
    this._drawStars(t);

    // Draw orb before ducks (so ducks appear on top)
    this._drawOrb();

    // Burst ripples (cheap visual feedback)
    const now = performance.now();
    this.ripples = this.ripples.filter(r => now - r.t0 < 700);
    for (const r of this.ripples) {
      const age = (now - r.t0) / 700; // 0..1
      const rad = 12 + age * 140;

      ctx.save();
      ctx.globalAlpha = (1 - age) * 0.18;
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Ducks with badges, halos, glows, and beat pulse
    for (const d of this.ducks.values()) {
      const loaded = d.img.complete && d.img.naturalWidth > 0;

      const t = performance.now();
      const beat = d.pinned ? 1 : (1 + 0.045 * Math.sin(t * 0.004 + d.pulseSeed));
      const size = (d.r * 2) * beat;

      // White badge behind duck (always)
      ctx.save();
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.92)";

      // add glow for floating ducks
      if (!d.pinned) {
        ctx.shadowColor = "rgba(255,255,255,0.20)";
        ctx.shadowBlur = 16;
      } else {
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(255,255,255,0.10)";
      }

      ctx.fill();
      ctx.restore();

      if (!loaded) {
        // placeholder label while loading
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "rgba(5,6,10,0.85)";
        ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`Day ${d.originDay}`, d.x, d.y);
        ctx.restore();
        continue;
      }

      // Pinned halo ring
      if (d.pinned) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 1.22, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "rgba(255,255,255,0.55)";
        ctx.shadowBlur = 20;
        ctx.stroke();
        ctx.restore();
      }

      // Duck image (beat sizing)
      ctx.save();
      if (!d.pinned) {
        ctx.shadowColor = "rgba(255,255,255,0.18)";
        ctx.shadowBlur = 14;
      }
      ctx.globalAlpha = 0.98;
      ctx.drawImage(d.img, d.x - size / 2, d.y - size / 2, size, size);
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

    // FPS monitoring and performance guardrails
    this._updateFPS(t);
    this._checkPerformance();

    this._physicsStep(dt, t);
    this._render();

    this.rafId = requestAnimationFrame(this._tick);
  }

  _updateFPS(t) {
    const elapsed = t - this.lastFpsCheck;
    if (elapsed >= 1000) {
      // Calculate FPS from frame count
      const frameCount = this.fpsHistory.length;
      this.fps = frameCount > 0 ? frameCount : 60;
      this.fpsHistory = [];
      this.lastFpsCheck = t;
    } else {
      this.fpsHistory.push(t);
    }
  }

  _checkPerformance() {
    // Auto-disable particles if FPS drops below 45 for sustained period
    if (this.fps < 45 && !this.particlesDisabled) {
      // Check if consistently low (sample last few checks)
      // For simplicity, disable immediately if below threshold
      this.particlesDisabled = true;
      console.log("Particles disabled due to low FPS");
    } else if (this.fps >= 50 && this.particlesDisabled) {
      // Re-enable if FPS recovers
      this.particlesDisabled = false;
      console.log("Particles re-enabled");
    }
  }
}
