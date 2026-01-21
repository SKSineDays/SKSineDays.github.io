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
import { getSupabaseClient, getAccessToken, getCurrentUser } from './supabase-client.js';

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
      subscribeBtn: document.getElementById('subscribe-btn'),
      premiumCard: document.getElementById('premium-card'),
      premiumBtn: document.getElementById('premium-btn'),
      infoModal: document.getElementById('info-modal'),
      infoModalClose: document.getElementById('info-modal-close'),
      infoModalBackdrop: document.querySelector('#info-modal .sd-modal-backdrop')
    };

    // State
    this.currentDay = null;
    this.waveRenderer = null;
    this.isCardVisible = false;

    // Touch gesture state
    this.touchStartY = 0;
    this.touchStartX = 0;
    this.isDragging = false;

    // Modal state
    this._modalOpen = false;
    this._lastFocus = null;
    this._modalFocusables = [];
    this._boundModalKeydown = null;

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
    this.showPremiumCard();
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

    // Premium button
    if (this.elements.premiumBtn) {
      this.elements.premiumBtn.addEventListener('click', () => this.handlePremium());
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

    // Info modal close controls
    if (this.elements.infoModalClose) {
      this.elements.infoModalClose.addEventListener('click', () => this.closeInfoModal());
    }

    if (this.elements.infoModalBackdrop) {
      this.elements.infoModalBackdrop.addEventListener('click', () => this.closeInfoModal());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._modalOpen) this.closeInfoModal();
    });

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
   * Handle premium button click
   */
  async handlePremium() {
    const premiumBtn = this.elements.premiumBtn;
    if (!premiumBtn) return;

    // Show loading state
    const originalText = premiumBtn.textContent;
    premiumBtn.disabled = true;
    premiumBtn.textContent = 'Loading...';

    try {
      // Check if user is authenticated
      const user = await getCurrentUser();
      
      if (!user) {
        // User not authenticated - redirect to Stripe checkout
        // But first, they need to authenticate, so we'll redirect to dashboard
        // which will handle authentication flow
        window.location.href = '/dashboard.html';
        return;
      }

      // User is authenticated - check subscription status
      const accessToken = await getAccessToken();
      if (!accessToken) {
        window.location.href = '/dashboard.html';
        return;
      }

      const client = await getSupabaseClient();
      const { data: subscription, error } = await client
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error checking subscription:', error);
        // On error, try to create checkout session anyway
      }

      // Check if user has active subscription
      const isSubscribed = subscription && subscription.status === 'active';

      if (isSubscribed) {
        // User is subscribed - navigate to dashboard
        window.location.href = '/dashboard.html';
      } else {
        // User is not subscribed - redirect to Stripe Checkout
        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();

        if (response.ok && data.ok && data.url) {
          // Redirect to Stripe Checkout
          window.location.href = data.url;
        } else {
          throw new Error(data.error || 'Failed to create checkout session');
        }
      }
    } catch (error) {
      console.error('Premium button error:', error);
      alert('Failed to start checkout. Please try again.');
      premiumBtn.disabled = false;
      premiumBtn.textContent = originalText;
    }
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

        // Redirect to sineday.app after a short delay
        setTimeout(() => {
          window.location.href = 'https://sineday.app';
        }, 2000);

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
      this.elements.todayDuck.alt = `SineDuck for SineDay ${result.day}`;

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
      this.elements.dayImage.alt = `Full image for SineDay ${result.day}`;
      
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

    // Move email card and premium card to bottom (results shown state)
    if (this.elements.emailCard) {
      this.elements.emailCard.classList.add('results-shown');
    }
    if (this.elements.premiumCard) {
      this.elements.premiumCard.classList.add('results-shown');
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

    // Remove hero-mode class to ensure day images show properly
    this.elements.backgroundImage.classList.remove('hero-mode');
    this.elements.backgroundImage.classList.remove('fade-out');

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

    // Show hero background when in input mode
    if (this.elements.backgroundImage) {
      this.elements.backgroundImage.classList.add('hero-mode');
      this.elements.backgroundImage.classList.remove('fade-out');
    }
  }

  /**
   * Hide input container
   */
  hideInput() {
    if (!this.elements.inputContainer) return;
    this.elements.inputContainer.classList.remove('visible');

    // Fade out hero background when hiding input
    if (this.elements.backgroundImage) {
      this.elements.backgroundImage.classList.add('fade-out');
    }
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
   * Show premium card
   */
  showPremiumCard() {
    if (!this.elements.premiumCard) return;
    this.elements.premiumCard.classList.add('visible');
  }

  /**
   * Hide premium card
   */
  hidePremiumCard() {
    if (!this.elements.premiumCard) return;
    this.elements.premiumCard.classList.remove('visible');
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
    this.openInfoModal();
  }

  /**
   * Get focusable elements within a container
   */
  getFocusableElements(rootEl) {
    if (!rootEl) return [];
    return Array.from(
      rootEl.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
  }

  /**
   * Set app content as inert (or aria-hidden fallback)
   */
  setAppInert(isInert) {
    const header = document.querySelector('header.top-bar');
    const main = document.querySelector('main.main-content');
    const targets = [header, main].filter(Boolean);

    targets.forEach(el => {
      // Prefer inert when available
      if ('inert' in el) {
        el.inert = isInert;
      } else {
        // Fallback: aria-hidden (not perfect, but helpful)
        el.setAttribute('aria-hidden', isInert ? 'true' : 'false');
      }
    });
  }

  /**
   * Handle keyboard events in modal (focus trap + Escape)
   */
  handleModalKeydown(e) {
    if (!this._modalOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeInfoModal();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusables = this._modalFocusables || [];
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  openInfoModal() {
    const modal = this.elements.infoModal;
    if (!modal) return;

    this._lastFocus = document.activeElement;
    this._modalOpen = true;

    document.body.classList.add('modal-open');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    this.setAppInert(true);

    const panel = modal.querySelector('.sd-modal-panel');
    this._modalFocusables = this.getFocusableElements(panel);

    document.addEventListener('keydown', this._boundModalKeydown = (e) => this.handleModalKeydown(e));

    // Focus first focusable element (close button is ideal)
    const focusTarget = this.elements.infoModalClose || this._modalFocusables[0];
    if (focusTarget) focusTarget.focus();
  }

  closeInfoModal() {
    const modal = this.elements.infoModal;
    if (!modal || !this._modalOpen) return;

    this._modalOpen = false;

    document.body.classList.remove('modal-open');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');

    this.setAppInert(false);

    if (this._boundModalKeydown) {
      document.removeEventListener('keydown', this._boundModalKeydown);
      this._boundModalKeydown = null;
    }

    // Restore focus
    if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
      this._lastFocus.focus();
    } else if (this.elements.infoBtn) {
      this.elements.infoBtn.focus();
    }
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

    // Clear background image and restore hero mode
    this.clearBackgroundImage();

    // Restore hero background
    if (this.elements.backgroundImage) {
      this.elements.backgroundImage.classList.add('hero-mode');
      this.elements.backgroundImage.classList.remove('fade-out');
    }

    // Show input container and email card
    this.showInput();
    this.showEmailCard();
    this.showPremiumCard();

    // Move email card and premium card back to initial position (near input)
    if (this.elements.emailCard) {
      this.elements.emailCard.classList.remove('results-shown');
    }
    if (this.elements.premiumCard) {
      this.elements.premiumCard.classList.remove('results-shown');
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
