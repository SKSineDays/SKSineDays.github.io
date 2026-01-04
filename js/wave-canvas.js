/**
 * Wave Canvas - Animated sine wave visualization
 *
 * Renders a smooth, animated sine wave with:
 * - Main wave line with glow
 * - Harmonic echo waves
 * - Animated marker showing current position
 * - Breathing/pulsing animation
 * - Respects prefers-reduced-motion
 */

export class WaveCanvas {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Configuration
    this.config = {
      accentColor: options.accentColor || '#7AA7FF',
      amplitude: options.amplitude || 0.25, // Relative to canvas height
      frequency: options.frequency || 1.5, // Number of waves across width
      breathingSpeed: options.breathingSpeed || 0.0008, // Amplitude breathing
      driftSpeed: options.driftSpeed || 0.0003, // Horizontal phase drift
      markerRadius: options.markerRadius || 6,
      lineWidth: options.lineWidth || 2.5,
      echoCount: options.echoCount || 2,
      ...options
    };

    // Animation state
    this.animationTime = 0;
    this.animationFrame = null;
    this.markerPosition = 0.5; // Default center (0-1)
    this.targetMarkerPosition = 0.5;
    this.markerAnimationProgress = 1; // 0-1, 1 = complete
    this.markerAnimationDuration = 800; // ms
    this.markerAnimationStart = 0;

    // DPR for sharp rendering
    this.dpr = window.devicePixelRatio || 1;

    // Motion preference
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Bind methods
    this.animate = this.animate.bind(this);
    this.handleResize = this.handleResize.bind(this);

    // Initialize
    this.resize();
    window.addEventListener('resize', this.handleResize);

    // Start animation if motion allowed
    if (!this.prefersReducedMotion) {
      this.start();
    } else {
      // Render static wave
      this.renderFrame(0);
    }
  }

  /**
   * Handle window resize
   */
  handleResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.resize(), 150);
  }

  /**
   * Resize canvas to match display size with DPR scaling
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;

    this.ctx.scale(this.dpr, this.dpr);

    this.width = rect.width;
    this.height = rect.height;

    // Re-render
    if (this.prefersReducedMotion) {
      this.renderFrame(this.animationTime);
    }
  }

  /**
   * Calculate y-position on sine wave at given x
   */
  calculateWaveY(x, phase, amplitudeMultiplier = 1) {
    const centerY = this.height / 2;
    const amplitude = this.height * this.config.amplitude * amplitudeMultiplier;
    const frequency = this.config.frequency;

    const xNormalized = (x / this.width) * Math.PI * 2 * frequency;
    const y = centerY + Math.sin(xNormalized + phase) * amplitude;

    return y;
  }

  /**
   * Draw a single wave line
   */
  drawWave(phase, opacity = 1, lineWidth = null) {
    const ctx = this.ctx;
    const width = this.width;

    // Breathing amplitude effect
    const breathingOffset = Math.sin(this.animationTime * this.config.breathingSpeed) * 0.15;
    const amplitudeMultiplier = 1 + breathingOffset;

    ctx.beginPath();
    ctx.strokeStyle = `${this.config.accentColor}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = lineWidth || this.config.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw smooth wave
    for (let x = 0; x <= width; x += 2) {
      const y = this.calculateWaveY(x, phase, amplitudeMultiplier);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Add glow for main wave
    if (opacity > 0.8) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = this.config.accentColor;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  /**
   * Draw marker at current position
   */
  drawMarker() {
    const ctx = this.ctx;

    // Animate marker position
    let currentPos = this.markerPosition;

    if (this.markerAnimationProgress < 1) {
      // Ease-out interpolation
      const t = this.markerAnimationProgress;
      const eased = 1 - Math.pow(1 - t, 3); // Cubic ease-out
      currentPos = this.markerPosition + (this.targetMarkerPosition - this.markerPosition) * eased;
    }

    // Calculate marker position on wave
    const x = currentPos * this.width;
    const phase = this.animationTime * this.config.driftSpeed;
    const breathingOffset = Math.sin(this.animationTime * this.config.breathingSpeed) * 0.15;
    const amplitudeMultiplier = 1 + breathingOffset;
    const y = this.calculateWaveY(x, phase, amplitudeMultiplier);

    // Pulsing scale effect
    const pulseScale = this.prefersReducedMotion
      ? 1
      : 1 + Math.sin(this.animationTime * 0.002) * 0.05;

    const radius = this.config.markerRadius * pulseScale;

    // Outer glow
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius + 4);
    gradient.addColorStop(0, `${this.config.accentColor}40`);
    gradient.addColorStop(1, `${this.config.accentColor}00`);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Main dot
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.config.accentColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.config.accentColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner highlight
    ctx.beginPath();
    ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();
  }

  /**
   * Render a single frame
   */
  renderFrame(time) {
    const ctx = this.ctx;

    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height);

    // Phase for wave animation (horizontal drift)
    const phase = this.prefersReducedMotion ? 0 : time * this.config.driftSpeed;

    // Draw echo waves (behind main wave)
    for (let i = this.config.echoCount; i > 0; i--) {
      const offset = i * 0.3;
      const opacity = 0.15 + (i * 0.05);
      this.drawWave(phase + offset, opacity, 1);
    }

    // Draw main wave
    this.drawWave(phase, 1);

    // Draw marker
    this.drawMarker();
  }

  /**
   * Animation loop
   */
  animate(time) {
    this.animationTime = time;

    // Update marker animation progress
    if (this.markerAnimationProgress < 1) {
      const elapsed = time - this.markerAnimationStart;
      this.markerAnimationProgress = Math.min(1, elapsed / this.markerAnimationDuration);
    }

    this.renderFrame(time);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  /**
   * Start animation
   */
  start() {
    if (!this.animationFrame && !this.prefersReducedMotion) {
      this.animationFrame = requestAnimationFrame(this.animate);
    }
  }

  /**
   * Stop animation
   */
  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Update marker position with animation
   * @param {number} position - New position (0-1)
   * @param {boolean} animate - Whether to animate the transition
   */
  setMarkerPosition(position, animate = true) {
    if (animate) {
      this.markerAnimationStart = this.animationTime;
      this.markerAnimationProgress = 0;
      this.targetMarkerPosition = position;
    } else {
      this.markerPosition = position;
      this.targetMarkerPosition = position;
      this.markerAnimationProgress = 1;
    }
  }

  /**
   * Update when marker animation completes
   */
  onMarkerAnimationComplete() {
    if (this.markerAnimationProgress >= 1) {
      this.markerPosition = this.targetMarkerPosition;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
  }
}

export default WaveCanvas;
