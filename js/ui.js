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

    // Touch gesture state
    this.touchStartY = 0;
    this.touchStartX = 0;
    this.isDragging = false;

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

    // Swipe gesture on result card
    if (this.elements.resultCard) {
      this.elements.resultCard.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
      this.elements.resultCard.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
      this.elements.resultCard.addEventListener('touchend', (e) => this.handleTouchEnd(e));

      // Fallback: click to show input (for desktop/accessibility)
      this.elements.resultCard.addEventListener('click', () => {
        if (this.isCardVisible && !this.isDragging) {
          this.resetToInput();
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

    // Update duck image with error handling
    if (this.elements.todayDuck) {
      const duckUrl = duckUrlFromSinedayNumber(result.day);
      this.elements.todayDuck.src = duckUrl;

      // Add error handler for failed image loads
      this.elements.todayDuck.onerror = () => {
        console.warn(`Failed to load duck image for day ${result.day}`);
        // Hide image if it fails to load
        this.elements.todayDuck.style.display = 'none';
      };

      // Show image when successfully loaded
      this.elements.todayDuck.onload = () => {
        this.elements.todayDuck.style.display = 'block';
      };
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
   * Show error message with better visual feedback
   */
  showError(message) {
    // Add visual feedback to the input field
    if (this.elements.birthdateInput) {
      this.elements.birthdateInput.style.borderColor = '#FF6B6B';
      this.elements.birthdateInput.style.animation = 'shake 0.3s ease';

      // Reset border color after 2 seconds
      setTimeout(() => {
        this.elements.birthdateInput.style.borderColor = '';
        this.elements.birthdateInput.style.animation = '';
      }, 2000);
    }

    // Show error in result card
    if (this.elements.resultCard) {
      this.elements.dayDescription.textContent = message;
      this.elements.dayPhase.textContent = 'PLEASE CHECK YOUR INPUT';
      this.elements.dayNumber.textContent = '⚠️';

      // Hide duck image for errors
      if (this.elements.todayDuck) {
        this.elements.todayDuck.style.display = 'none';
      }

      this.showResultCard();

      // Auto-hide error after 3 seconds
      setTimeout(() => {
        this.hideResultCard();
      }, 3000);
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
   * Clear background image with fade out
   */
  clearBackgroundImage() {
    if (!this.elements.backgroundImage) return;

    const layers = this.elements.backgroundImage.querySelectorAll('.background-image-layer');
    layers.forEach(layer => {
      layer.style.opacity = '0';
      setTimeout(() => layer.remove(), 800);
    });
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
   * Handle touch start for swipe gesture
   */
  handleTouchStart(e) {
    if (!this.isCardVisible) return;

    this.touchStartY = e.touches[0].clientY;
    this.touchStartX = e.touches[0].clientX;
    this.isDragging = false;
  }

  /**
   * Handle touch move for swipe gesture
   */
  handleTouchMove(e) {
    if (!this.isCardVisible) return;

    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    const deltaY = this.touchStartY - touchY;
    const deltaX = Math.abs(this.touchStartX - touchX);

    // Check if this is a vertical swipe (not horizontal)
    if (deltaY > 10 && deltaX < 50) {
      this.isDragging = true;

      // Apply visual feedback during swipe with improved easing
      if (deltaY > 0 && deltaY < 250) {
        const opacity = Math.max(0.3, 1 - (deltaY / 200));
        const translateY = deltaY;
        const scale = Math.max(0.95, 1 - (deltaY / 500));

        this.elements.resultCard.style.transform = `translateY(-${translateY}px) scale(${scale})`;
        this.elements.resultCard.style.opacity = opacity;
        this.elements.resultCard.style.transition = 'none';

        // Prevent scroll during swipe
        e.preventDefault();
      }
    }
  }

  /**
   * Handle touch end for swipe gesture
   */
  handleTouchEnd(e) {
    if (!this.isCardVisible) return;

    const deltaY = this.touchStartY - (e.changedTouches[0]?.clientY || this.touchStartY);

    // If swiped up more than 60px, clear and show input (improved sensitivity)
    if (deltaY > 60) {
      this.resetToInput();
    } else {
      // Reset card position if swipe wasn't enough
      this.elements.resultCard.style.transition = '';
      this.elements.resultCard.style.transform = '';
      this.elements.resultCard.style.opacity = '';
    }

    // Small delay before allowing click again
    setTimeout(() => {
      this.isDragging = false;
    }, 300);
  }

  /**
   * Reset to input screen (clear result and show birthday input)
   */
  resetToInput() {
    // Reset card styles
    if (this.elements.resultCard) {
      this.elements.resultCard.style.transform = '';
      this.elements.resultCard.style.opacity = '';
    }

    // Hide result card
    this.hideResultCard();

    // Clear the current day state
    this.currentDay = null;

    // Clear the birthdate input field
    if (this.elements.birthdateInput) {
      this.elements.birthdateInput.value = '';
    }

    // Clear background image
    this.clearBackgroundImage();

    // Show input container
    this.showInput();

    // Focus on input field after a short delay (for better UX)
    setTimeout(() => {
      if (this.elements.birthdateInput) {
        this.elements.birthdateInput.focus();
      }
    }, 400);

    // Reset wave marker to center
    if (this.waveRenderer) {
      this.waveRenderer.setMarkerPosition(0.5, true);
    }
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
