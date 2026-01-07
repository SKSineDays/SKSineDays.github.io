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
      infoBtn: document.getElementById('info-btn'),
      dayImageCard: document.getElementById('day-image-card'),
      dayImage: document.getElementById('dayImage'),
      emailCard: document.getElementById('email-card'),
      emailInput: document.getElementById('email-input'),
      emailConsent: document.getElementById('email-consent'),
      signupStatus: document.getElementById('signup-status'),
      subscribeBtn: document.getElementById('subscribe-btn')
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

    // Show input and email card on first visit
    this.showInput();
    this.showEmailCard();
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Calculate button
    if (this.elements.calculateBtn) {
      this.elements.calculateBtn.addEventListener('click', () => this.handleCalculate());
    }

    // Subscribe button
    if (this.elements.subscribeBtn) {
      this.elements.subscribeBtn.addEventListener('click', () => this.handleSubscribe());
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
   * Calculate day of year from a date (1-366)
   */
  calculateDayOfYear(dateString) {
    const date = new Date(dateString);
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  /**
   * Handle subscribe button click
   */
  async handleSubscribe() {
    const emailValue = this.elements.emailInput?.value?.trim();
    const consentChecked = this.elements.emailConsent?.checked;
    const birthdateValue = this.elements.birthdateInput?.value;

    // Clear previous status
    if (this.elements.signupStatus) {
      this.elements.signupStatus.textContent = '';
    }

    // Validate email
    if (!emailValue) {
      if (this.elements.signupStatus) {
        this.elements.signupStatus.textContent = 'Please enter your email address';
        this.elements.signupStatus.style.color = '#FF6B6B';
      }
      return;
    }

    // Check consent
    if (!consentChecked) {
      if (this.elements.signupStatus) {
        this.elements.signupStatus.textContent = 'Check the box to subscribe';
        this.elements.signupStatus.style.color = '#FF6B6B';
      }
      return;
    }

    // Prepare signup data
    const signupData = {
      email: emailValue,
      consent: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
      source: 'homepage'
    };

    // Add birth_day_of_year and sineday_index if we have a birthdate
    if (birthdateValue) {
      signupData.birth_day_of_year = this.calculateDayOfYear(birthdateValue);
    }

    if (this.currentDay) {
      signupData.sineday_index = this.currentDay.day - 1; // Convert from 1-18 to 0-17
    }

    // Show loading state
    if (this.elements.signupStatus) {
      this.elements.signupStatus.textContent = 'Signing up...';
      this.elements.signupStatus.style.color = '#7AA7FF';
    }

    try {
      // Call API
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(signupData)
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        // Success
        if (this.elements.signupStatus) {
          this.elements.signupStatus.textContent = '✓ Successfully subscribed!';
          this.elements.signupStatus.style.color = '#4CAF50';
        }

        // Disable button and inputs after successful signup
        if (this.elements.subscribeBtn) {
          this.elements.subscribeBtn.disabled = true;
          this.elements.subscribeBtn.textContent = 'Subscribed';
        }
        if (this.elements.emailInput) {
          this.elements.emailInput.disabled = true;
        }
        if (this.elements.emailConsent) {
          this.elements.emailConsent.disabled = true;
        }
      } else {
        // API returned error
        if (this.elements.signupStatus) {
          this.elements.signupStatus.textContent = `Error: ${data.error || 'Failed to subscribe'}`;
          this.elements.signupStatus.style.color = '#FF6B6B';
        }
      }
    } catch (error) {
      // Network or other error
      console.error('Signup error:', error);
      if (this.elements.signupStatus) {
        this.elements.signupStatus.textContent = 'Network error. Please try again.';
        this.elements.signupStatus.style.color = '#FF6B6B';
      }
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

    // Update day image card
    if (this.elements.dayImage) {
      this.elements.dayImage.src = result.imageUrl;
      
      // Add error handler for failed image loads
      this.elements.dayImage.onerror = () => {
        console.warn(`Failed to load day image for day ${result.day}`);
        this.elements.dayImage.style.display = 'none';
      };

      // Show image when successfully loaded
      this.elements.dayImage.onload = () => {
        this.elements.dayImage.style.display = 'block';
      };
    }

    // Show day image card
    this.showDayImageCard();

    // Update background image
    this.updateBackgroundImage(result.imageUrl);

    // Show result card with animation
    this.showResultCard();

    // Hide input
    this.hideInput();

    // Move email card to bottom (results shown state)
    if (this.elements.emailCard) {
      this.elements.emailCard.classList.add('results-shown');
    }
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
   * Show day image card with animation
   */
  showDayImageCard() {
    if (!this.elements.dayImageCard) return;

    this.elements.dayImageCard.classList.add('visible');
  }

  /**
   * Hide day image card
   */
  hideDayImageCard() {
    if (!this.elements.dayImageCard) return;

    this.elements.dayImageCard.classList.remove('visible');
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
   * Show email card
   */
  showEmailCard() {
    if (!this.elements.emailCard) return;
    this.elements.emailCard.classList.add('visible');
  }

  /**
   * Hide email card
   */
  hideEmailCard() {
    if (!this.elements.emailCard) return;
    this.elements.emailCard.classList.remove('visible');
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
    const deltaX = touchX - this.touchStartX;
    const deltaY = Math.abs(this.touchStartY - touchY);

    // Check if this is a horizontal swipe (not vertical)
    if (deltaX > 10 && deltaY < 50) {
      this.isDragging = true;

      // Apply visual feedback during swipe with improved easing
      if (deltaX > 0 && deltaX < 250) {
        const opacity = Math.max(0.3, 1 - (deltaX / 200));
        const translateX = deltaX;
        const scale = Math.max(0.95, 1 - (deltaX / 500));

        this.elements.resultCard.style.transform = `translateX(${translateX}px) scale(${scale})`;
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

    const deltaX = (e.changedTouches[0]?.clientX || this.touchStartX) - this.touchStartX;

    // If swiped right more than 60px, clear and show input (improved sensitivity)
    if (deltaX > 60) {
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

    // Hide day image card
    this.hideDayImageCard();

    // Clear the current day state
    this.currentDay = null;

    // Clear the birthdate input field
    if (this.elements.birthdateInput) {
      this.elements.birthdateInput.value = '';
    }

    // Clear and re-enable email signup fields
    if (this.elements.emailInput) {
      this.elements.emailInput.value = '';
      this.elements.emailInput.disabled = false;
    }
    if (this.elements.emailConsent) {
      this.elements.emailConsent.checked = false;
      this.elements.emailConsent.disabled = false;
    }
    if (this.elements.subscribeBtn) {
      this.elements.subscribeBtn.disabled = false;
      this.elements.subscribeBtn.textContent = 'Subscribe';
    }
    if (this.elements.signupStatus) {
      this.elements.signupStatus.textContent = '';
    }

    // Clear background image
    this.clearBackgroundImage();

    // Show input container and email card
    this.showInput();
    this.showEmailCard();

    // Move email card back to initial position (near input)
    if (this.elements.emailCard) {
      this.elements.emailCard.classList.remove('results-shown');
    }

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
