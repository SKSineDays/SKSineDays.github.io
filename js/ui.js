/**
 * UI Module - Handles all DOM interactions and user interface updates
 *
 * Coordinates between:
 * - User input
 * - SineDay calculation engine
 * - Wave canvas visualization
 * - Result card display
 * - Background image transitions
 */

import { calculateSineDay } from './sineday-engine.js';
import { WaveCanvas } from './wave-canvas.js';
import { duckUrlFromSinedayNumber } from './sineducks.js';

export class SineDayUI {
  constructor() {
    // DOM elements
    this.elements = {
      birthdateInput: document.getElementById('birthdate-input'),
      calculateBtn: document.getElementById('calculate-btn'),
      resultCard: document.getElementById('result-card'),
      dayNumber: document.getElementById('day-number'),
      todayDuck: document.getElementById('todayDuck'),
      dayPhase: document.getElementById('day-phase'),
      dayDescription: document.getElementById('day-description'),
      inputContainer: document.getElementById('input-container'),
      waveCanvas: document.getElementById('wave-canvas'),
      backgroundImage: document.getElementById('background-image'),
      shareBtn: document.getElementById('share-btn'),
      infoBtn: document.getElementById('info-btn')
    };

    // State
    this.currentDay = null;
    this.waveRenderer = null;
    this.isCardVisible = false;

    // Initialize
    this.init();
  }

  /**
   * Initialize UI components
   */
  init() {
    // Initialize wave canvas
    if (this.elements.waveCanvas) {
      this.waveRenderer = new WaveCanvas(this.elements.waveCanvas, {
        accentColor: '#7AA7FF'
      });
    }

    // Bind event listeners
    this.bindEvents();

    // Check for saved birthdate
    this.loadSavedBirthdate();

    // Show input on first visit
    this.showInput();
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Calculate button
    if (this.elements.calculateBtn) {
      this.elements.calculateBtn.addEventListener('click', () => this.handleCalculate());
    }

    // Enter key on input
    if (this.elements.birthdateInput) {
      this.elements.birthdateInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.handleCalculate();
        }
      });
    }

    // Share button
    if (this.elements.shareBtn) {
      this.elements.shareBtn.addEventListener('click', () => this.handleShare());
    }

    // Info button
    if (this.elements.infoBtn) {
      this.elements.infoBtn.addEventListener('click', () => this.handleInfo());
    }

    // Card click to re-open input
    if (this.elements.resultCard) {
      this.elements.resultCard.addEventListener('click', () => {
        if (this.isCardVisible) {
          this.showInput();
        }
      });
    }
  }

  /**
   * Handle calculate button click
   */
  handleCalculate() {
    const birthdateValue = this.elements.birthdateInput?.value;

    if (!birthdateValue) {
      this.showError('Please enter your birthdate');
      return;
    }

    // Calculate SineDay
    const result = calculateSineDay(birthdateValue);

    if (result.error) {
      this.showError(result.error);
      return;
    }

    // Save birthdate for next visit
    this.saveBirthdate(birthdateValue);

    // Update UI with result
    this.displayResult(result);
  }

  /**
   * Display SineDay result
   */
  displayResult(result) {
    this.currentDay = result;

    // Update wave marker position
    if (this.waveRenderer) {
      this.waveRenderer.setMarkerPosition(result.position, true);
    }

    // Update result card content
    if (this.elements.dayNumber) {
      this.elements.dayNumber.textContent = `SineDay ${result.day}`;
    }

    // Update duck image
    if (this.elements.todayDuck) {
      this.elements.todayDuck.src = duckUrlFromSinedayNumber(result.day);
    }

    if (this.elements.dayPhase) {
      this.elements.dayPhase.textContent = result.phase;
    }

    if (this.elements.dayDescription) {
      this.elements.dayDescription.textContent = result.description;
    }

    // Update background image
    this.updateBackgroundImage(result.imageUrl);

    // Show result card with animation
    this.showResultCard();

    // Hide input
    this.hideInput();
  }

  /**
   * Show error message
   */
  showError(message) {
    // Could implement a toast/snackbar here
    // For now, use browser alert
    if (this.elements.resultCard) {
      this.elements.dayDescription.textContent = message;
      this.elements.dayPhase.textContent = 'ERROR';
      this.elements.dayNumber.textContent = '';
      this.showResultCard();
    } else {
      alert(message);
    }
  }

  /**
   * Update background image with crossfade
   */
  updateBackgroundImage(imageUrl) {
    if (!this.elements.backgroundImage) return;

    // Create new image element
    const newImage = document.createElement('div');
    newImage.className = 'background-image-layer';
    newImage.style.backgroundImage = `url('${imageUrl}')`;
    newImage.style.opacity = '0';

    // Add to container
    this.elements.backgroundImage.appendChild(newImage);

    // Trigger fade in
    setTimeout(() => {
      newImage.style.opacity = '1';
    }, 50);

    // Remove old images after transition
    setTimeout(() => {
      const layers = this.elements.backgroundImage.querySelectorAll('.background-image-layer');
      if (layers.length > 1) {
        // Keep only the newest layer
        for (let i = 0; i < layers.length - 1; i++) {
          layers[i].remove();
        }
      }
    }, 800);
  }

  /**
   * Show result card with animation
   */
  showResultCard() {
    if (!this.elements.resultCard) return;

    this.elements.resultCard.classList.add('visible');
    this.isCardVisible = true;
  }

  /**
   * Hide result card
   */
  hideResultCard() {
    if (!this.elements.resultCard) return;

    this.elements.resultCard.classList.remove('visible');
    this.isCardVisible = false;
  }

  /**
   * Show input container
   */
  showInput() {
    if (!this.elements.inputContainer) return;
    this.elements.inputContainer.classList.add('visible');
  }

  /**
   * Hide input container
   */
  hideInput() {
    if (!this.elements.inputContainer) return;
    this.elements.inputContainer.classList.remove('visible');
  }

  /**
   * Save birthdate to localStorage
   */
  saveBirthdate(birthdate) {
    try {
      localStorage.setItem('sineday_birthdate', birthdate);
    } catch (e) {
      // LocalStorage might be disabled
      console.warn('Could not save birthdate', e);
    }
  }

  /**
   * Load saved birthdate from localStorage
   */
  loadSavedBirthdate() {
    try {
      const saved = localStorage.getItem('sineday_birthdate');
      if (saved && this.elements.birthdateInput) {
        this.elements.birthdateInput.value = saved;
        // Auto-calculate on load
        setTimeout(() => this.handleCalculate(), 500);
      }
    } catch (e) {
      // LocalStorage might be disabled
      console.warn('Could not load saved birthdate', e);
    }
  }

  /**
   * Handle share button
   */
  async handleShare() {
    if (!this.currentDay) return;

    const shareData = {
      title: 'My SineDay',
      text: `I'm on SineDay ${this.currentDay.day}: ${this.currentDay.description}`,
      url: window.location.href
    };

    // Try Web Share API
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share failed', err);
        }
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(
          `${shareData.text}\n${shareData.url}`
        );
        alert('Copied to clipboard!');
      } catch (err) {
        console.error('Could not copy', err);
      }
    }
  }

  /**
   * Handle info button
   */
  handleInfo() {
    // Could show a modal explaining SineDay
    // For now, simple alert
    alert(
      'SineDay Wave\n\n' +
      'Your personal 18-day cycle based on your birthdate.\n\n' +
      'Each day represents a different energy phase in the eternal rhythm of life.'
    );
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.waveRenderer) {
      this.waveRenderer.destroy();
    }
  }
}

// Auto-initialize when DOM is ready
let uiInstance = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    uiInstance = new SineDayUI();
  });
} else {
  uiInstance = new SineDayUI();
}

export default SineDayUI;
