const TIMINGS = Object.freeze({
  WAVE_DRAW_START: 0,
  WAVE_DRAW_END: 1600,
  DUCK_REVEAL_START: 600,
  DUCK_REVEAL_END: 1900,
  HELLO_START: 1600,
  WAVE_COPY_START: 4100,
  MOVEMENT_START: 6800,
  ALIGNMENT_START: 9500,
  NOT_TOP_START: 12100,
  WITHIN_START: 14800,
  PERSPECTIVE_START: 17600,
  MEETING_START: 20500,
  AWARENESS_START: 23400,
  COMPANION_START: 26300,
  RIDE_START: 2800,
  RIDE_END: 27600,
  COMPLETE_AT: 29400
});

const PLAY_THRESHOLD = 0.72;
const RESET_THRESHOLD = 0.25;
const VIEWBOX_HEIGHT = 180;
const WAVE_WIDTH = 600;
const WAVE_CENTER_Y = 114;
const WAVE_AMPLITUDE = 40;
const WAVE_SAMPLES = 64;
const TWO_PI = Math.PI * 2;
// Locked to the current production crest-to-trough rate (π*3 over 12s).
const WAVE_PHASE_SPEED = (Math.PI * 3) / 12000;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

export class SineDuckIntroAnimation {
  constructor(root) {
    this.root = root || null;
    this.isReady = false;
    this.isRunning = false;
    this.isComplete = false;
    this.isStatic = false;
    this.isArmed = true;
    this.focusProgress = 0;
    this.frameId = 0;
    this.startTime = 0;
    this.phase = '';
    this.waveCssAmplitude = 0;

    this.stage = this.root?.querySelector('[data-sineduck-stage]') || null;
    this.waveGlow = this.root?.querySelector('[data-sineduck-wave-glow]') || null;
    this.waveMain = this.root?.querySelector('[data-sineduck-wave-main]') || null;
    this.wavePaths = [this.waveGlow, this.waveMain].filter(Boolean);
    this.motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.prefersReducedMotion = this.motionQuery?.matches ?? false;

    this.handleMotionChange = this.handleMotionChange.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.renderTimeline = this.renderTimeline.bind(this);

    if (!this.root || !this.stage || this.wavePaths.length !== 2) return;

    try {
      this.renderWave(0);
      this.waveLengths = this.wavePaths.map((path) => path.getTotalLength());
      if (this.waveLengths.some((length) => !Number.isFinite(length) || length <= 0)) return;

      this.wavePaths.forEach((path, index) => {
        path.style.strokeDasharray = String(this.waveLengths[index]);
      });

      this.measureStage();
      window.addEventListener('resize', this.handleResize, { passive: true });
      if (typeof this.motionQuery?.addEventListener === 'function') {
        this.motionQuery.addEventListener('change', this.handleMotionChange);
      } else if (typeof this.motionQuery?.addListener === 'function') {
        this.motionQuery.addListener(this.handleMotionChange);
      }

      this.isReady = true;
      this.root.classList.add('is-sineduck-enhanced');

      if (this.prefersReducedMotion) {
        this.showStatic();
      } else {
        this.reset();
      }
    } catch {
      this.destroy();
    }
  }

  setFocusProgress(progress) {
    if (!this.isReady) return;

    this.focusProgress = clamp01(Number(progress) || 0);

    if (this.prefersReducedMotion) {
      if (!this.isStatic) this.showStatic();
      return;
    }

    if (this.focusProgress <= RESET_THRESHOLD && !this.isArmed) {
      this.reset();
      return;
    }

    if (this.focusProgress >= PLAY_THRESHOLD && this.isArmed) {
      this.play();
    }
  }

  play() {
    if (!this.isReady || this.prefersReducedMotion || this.isRunning || !this.isArmed) return;

    this.cancelFrame();
    this.isArmed = false;
    this.isComplete = false;
    this.isStatic = false;
    this.root.classList.remove('is-sineduck-static');
    this.setInitialVisualState();
    this.setPhase('arrival');
    this.measureStage();

    this.isRunning = true;
    this.startTime = performance.now();
    this.renderTimeline(this.startTime);
  }

  reset() {
    if (!this.isReady) return;

    this.cancelFrame();
    this.focusProgress = 0;
    this.isArmed = true;
    this.isComplete = false;
    this.isStatic = false;
    this.root.classList.remove('is-sineduck-static');
    this.setInitialVisualState();
    this.setPhase('idle');
  }

  showStatic() {
    if (!this.isReady) return;

    this.cancelFrame();
    this.isArmed = false;
    this.isComplete = true;
    this.isStatic = true;
    this.root.classList.add('is-sineduck-static');
    this.renderWave(0);
    this.setWaveDrawProgress(1);
    this.setDuckVisuals(1, 1, 0, 0);
    this.setPhase('complete');
  }

  destroy() {
    this.cancelFrame();

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
    }
    if (typeof this.motionQuery?.removeEventListener === 'function') {
      this.motionQuery.removeEventListener('change', this.handleMotionChange);
    } else if (typeof this.motionQuery?.removeListener === 'function') {
      this.motionQuery.removeListener(this.handleMotionChange);
    }

    this.wavePaths?.forEach((path) => {
      path.style.removeProperty('stroke-dasharray');
      path.style.removeProperty('stroke-dashoffset');
    });
    this.root?.style.removeProperty('--sineduck-duck-opacity');
    this.root?.style.removeProperty('--sineduck-duck-scale');
    this.root?.style.removeProperty('--sineduck-duck-arrive-y');
    this.root?.style.removeProperty('--sineduck-ride-y');
    this.root?.classList.remove('is-sineduck-enhanced', 'is-sineduck-static');
    if (this.root?.dataset.sineduckPhase) {
      delete this.root.dataset.sineduckPhase;
    }

    this.isReady = false;
  }

  buildSinePath(phase) {
    const points = [];

    for (let index = 0; index <= WAVE_SAMPLES; index += 1) {
      const x = (index / WAVE_SAMPLES) * WAVE_WIDTH;
      const angle = ((x / WAVE_WIDTH) - 0.5) * TWO_PI + phase;
      const y = WAVE_CENTER_Y - WAVE_AMPLITUDE * Math.sin(angle);
      points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    return points.join(' ');
  }

  renderTimeline(now) {
    if (!this.isRunning) return;

    try {
      const elapsed = Math.max(0, now - this.startTime);

      if (elapsed >= TIMINGS.COMPLETE_AT) {
        this.complete();
        return;
      }

      const waveDrawProgress = easeOutCubic(clamp01(
        (elapsed - TIMINGS.WAVE_DRAW_START)
          / (TIMINGS.WAVE_DRAW_END - TIMINGS.WAVE_DRAW_START)
      ));
      const duckRevealProgress = easeOutCubic(clamp01(
        (elapsed - TIMINGS.DUCK_REVEAL_START)
          / (TIMINGS.DUCK_REVEAL_END - TIMINGS.DUCK_REVEAL_START)
      ));
      const { wavePhase, duckOffset } = this.resolveRideMotion(elapsed);

      this.renderWave(wavePhase);
      this.setWaveDrawProgress(waveDrawProgress);
      this.setDuckVisuals(
        duckRevealProgress,
        lerp(0.88, 1, duckRevealProgress),
        lerp(10, 0, duckRevealProgress),
        duckOffset
      );
      this.setPhase(this.getPhaseForElapsed(elapsed));

      this.frameId = requestAnimationFrame(this.renderTimeline);
    } catch {
      this.showStatic();
    }
  }

  resolveRideMotion(elapsed) {
    if (elapsed < TIMINGS.RIDE_START) {
      return { wavePhase: 0, duckOffset: 0 };
    }

    const rideElapsed = elapsed - TIMINGS.RIDE_START;
    const rideDuration = TIMINGS.RIDE_END - TIMINGS.RIDE_START;

    if (elapsed < TIMINGS.RIDE_END) {
      const wavePhase = rideElapsed * WAVE_PHASE_SPEED;
      return {
        wavePhase,
        duckOffset: -this.waveCssAmplitude * Math.sin(wavePhase)
      };
    }

    const endPhase = rideDuration * WAVE_PHASE_SPEED;
    const restPhase = Math.round(endPhase / TWO_PI) * TWO_PI;
    const settleProgress = easeOutCubic(clamp01(
      (elapsed - TIMINGS.RIDE_END) / (TIMINGS.COMPLETE_AT - TIMINGS.RIDE_END)
    ));
    const wavePhase = lerp(endPhase, restPhase, settleProgress);

    return {
      wavePhase,
      duckOffset: -this.waveCssAmplitude * Math.sin(wavePhase)
    };
  }

  getPhaseForElapsed(elapsed) {
    if (elapsed >= TIMINGS.COMPANION_START) return 'companion';
    if (elapsed >= TIMINGS.AWARENESS_START) return 'awareness';
    if (elapsed >= TIMINGS.MEETING_START) return 'meeting';
    if (elapsed >= TIMINGS.PERSPECTIVE_START) return 'perspective';
    if (elapsed >= TIMINGS.WITHIN_START) return 'within';
    if (elapsed >= TIMINGS.NOT_TOP_START) return 'not-top';
    if (elapsed >= TIMINGS.ALIGNMENT_START) return 'alignment';
    if (elapsed >= TIMINGS.MOVEMENT_START) return 'movement';
    if (elapsed >= TIMINGS.WAVE_COPY_START) return 'wave';
    if (elapsed >= TIMINGS.HELLO_START) return 'hello';
    return 'arrival';
  }

  renderWave(phase) {
    const pathData = this.buildSinePath(phase);
    this.wavePaths.forEach((path) => path.setAttribute('d', pathData));
  }

  setWaveDrawProgress(progress) {
    this.wavePaths.forEach((path, index) => {
      path.style.strokeDashoffset = String(this.waveLengths[index] * (1 - clamp01(progress)));
    });
  }

  setDuckVisuals(opacity, scale, arrivalOffset, rideOffset) {
    this.root.style.setProperty('--sineduck-duck-opacity', opacity.toFixed(3));
    this.root.style.setProperty('--sineduck-duck-scale', scale.toFixed(3));
    this.root.style.setProperty('--sineduck-duck-arrive-y', `${arrivalOffset.toFixed(2)}px`);
    this.root.style.setProperty('--sineduck-ride-y', `${rideOffset.toFixed(2)}px`);
  }

  setInitialVisualState() {
    this.renderWave(0);
    this.setWaveDrawProgress(0);
    this.setDuckVisuals(0, 0.88, 10, 0);
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.root.dataset.sineduckPhase = phase;
  }

  complete() {
    this.cancelFrame();
    this.isComplete = true;
    this.renderWave(0);
    this.setWaveDrawProgress(1);
    this.setDuckVisuals(1, 1, 0, 0);
    this.setPhase('complete');
  }

  cancelFrame() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
    this.isRunning = false;
  }

  measureStage() {
    const stageHeight = this.stage?.clientHeight || 0;
    this.waveCssAmplitude = (stageHeight * WAVE_AMPLITUDE) / VIEWBOX_HEIGHT;
  }

  handleResize() {
    this.measureStage();
    if (this.isComplete || this.isStatic) {
      this.renderWave(0);
      this.setDuckVisuals(1, 1, 0, 0);
    }
  }

  handleMotionChange(event) {
    this.prefersReducedMotion = event.matches;

    if (this.prefersReducedMotion) {
      this.showStatic();
      return;
    }

    const progress = this.focusProgress;
    this.reset();
    this.setFocusProgress(progress);
  }
}

export default SineDuckIntroAnimation;
