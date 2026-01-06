/**
 * SineDay Engine - Core calculation and data module
 *
 * This module handles all SineDay calculations and maintains day data.
 * The SineDay system maps a person's age to an 18-day cycle representing
 * different energy phases throughout life.
 */

/**
 * Day data containing phase information, descriptions, and metadata
 * Each day has:
 * - day: Number (1-18)
 * - phase: Short label for the wave position
 * - description: One-line tone/energy description
 * - imageUrl: Local path to day image
 */
export const DAY_DATA = [
  {
    day: 1,
    phase: "RISING • INITIATION",
    description: "Fresh beginnings call you forward",
    imageUrl: "Day1.jpeg"
  },
  {
    day: 2,
    phase: "ASCENDING • MOMENTUM",
    description: "Energy builds as you push forward",
    imageUrl: "Day2.jpeg"
  },
  {
    day: 3,
    phase: "ASCENDING • CREATIVITY",
    description: "Imagination flows and ideas spark",
    imageUrl: "Day3.jpeg"
  },
  {
    day: 4,
    phase: "ASCENDING • CONNECTION",
    description: "Social energy draws you outward",
    imageUrl: "Day4.jpeg"
  },
  {
    day: 5,
    phase: "ASCENDING • PRODUCTIVITY",
    description: "Focus sharpens, tasks find completion",
    imageUrl: "Day5.jpeg"
  },
  {
    day: 6,
    phase: "PEAK • BALANCE",
    description: "Harmony emerges in all you do",
    imageUrl: "Day6.jpeg"
  },
  {
    day: 7,
    phase: "PEAK • INSIGHT",
    description: "Clarity arrives, intuition guides",
    imageUrl: "Day7.jpeg"
  },
  {
    day: 8,
    phase: "PEAK • CHALLENGE",
    description: "Strength tested, resolve fortified",
    imageUrl: "Day8.jpeg"
  },
  {
    day: 9,
    phase: "CREST • TRANSITION",
    description: "The wave turns, reflection begins",
    imageUrl: "Day9.jpeg"
  },
  {
    day: 10,
    phase: "DESCENDING • REFLECTION",
    description: "Looking inward reveals growth",
    imageUrl: "Day10.jpeg"
  },
  {
    day: 11,
    phase: "DESCENDING • INTEGRATION",
    description: "Rest allows wisdom to settle",
    imageUrl: "Day11.jpeg"
  },
  {
    day: 12,
    phase: "DESCENDING • RECALIBRATION",
    description: "Adjust your course with care",
    imageUrl: "Day12.jpeg"
  },
  {
    day: 13,
    phase: "DESCENDING • RELEASE",
    description: "Let go what no longer serves",
    imageUrl: "Day13.jpeg"
  },
  {
    day: 14,
    phase: "TROUGH • INNER WORK",
    description: "Dive deep into self-discovery",
    imageUrl: "Day14.jpeg"
  },
  {
    day: 15,
    phase: "TROUGH • HEALING",
    description: "Gentle care restores vitality",
    imageUrl: "Day15.jpeg"
  },
  {
    day: 16,
    phase: "TROUGH • PREPARATION",
    description: "Gather strength for the rise ahead",
    imageUrl: "Day16.jpeg"
  },
  {
    day: 17,
    phase: "EMERGING • FOUNDATION",
    description: "Lay groundwork for new action",
    imageUrl: "Day17.jpeg"
  },
  {
    day: 18,
    phase: "EMERGING • CULMINATION",
    description: "Cycle completes, renewal awaits",
    imageUrl: "Day18.jpeg"
  }
];

/**
 * Validation result structure
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the input is valid
 * @property {string} error - Error message if invalid
 */

/**
 * SineDay result structure
 * @typedef {Object} SineDayResult
 * @property {number} day - The SineDay number (1-18)
 * @property {string} phase - Phase label
 * @property {string} description - Day description
 * @property {string} imageUrl - Path to day image
 * @property {number} position - Wave position (0-1, for visualization)
 * @property {number} daysLived - Total days since birth
 */

/**
 * Validates a birthdate input
 *
 * @param {string|Date} birthdateInput - The birthdate to validate
 * @returns {ValidationResult} Validation result with error message if invalid
 */
export function validateBirthdate(birthdateInput) {
  if (!birthdateInput) {
    return { valid: false, error: "Please enter your birthdate to continue" };
  }

  const birthdate = new Date(birthdateInput);

  // Check for invalid date
  if (isNaN(birthdate.getTime())) {
    return { valid: false, error: "Invalid date format - please select a valid date" };
  }

  const today = new Date();

  // Check for future date
  if (birthdate > today) {
    return { valid: false, error: "Birthdate cannot be in the future - please check the year" };
  }

  // Check for unreasonably old date (150 years)
  const maxAge = new Date();
  maxAge.setFullYear(maxAge.getFullYear() - 150);
  if (birthdate < maxAge) {
    return { valid: false, error: "Please enter a birthdate within the last 150 years" };
  }

  return { valid: true };
}

/**
 * Calculates the number of days between two dates
 *
 * @param {Date} startDate - Start date (birthdate)
 * @param {Date} endDate - End date (usually today)
 * @returns {number} Number of days elapsed
 */
export function calculateDaysBetween(startDate, endDate) {
  const differenceInTime = endDate.getTime() - startDate.getTime();
  return Math.floor(differenceInTime / (1000 * 3600 * 24));
}

/**
 * Maps days lived to a SineDay number (1-18)
 *
 * @param {number} daysLived - Total days since birth
 * @returns {number} SineDay number (1-18)
 */
export function mapToSineDay(daysLived) {
  const cyclePosition = (daysLived / 18) % 1;
  let sineDayNumber = Math.round(cyclePosition * 18);

  // Handle edge case: 0 should map to 18
  return sineDayNumber === 0 ? 18 : sineDayNumber;
}

/**
 * Calculates the precise position on the sine wave (0 to 1)
 * Used for visualization - 0 is start of cycle, 1 is end
 *
 * @param {number} daysLived - Total days since birth
 * @returns {number} Position on wave (0-1)
 */
export function calculateWavePosition(daysLived) {
  return (daysLived / 18) % 1;
}

/**
 * Gets day data for a specific SineDay number
 *
 * @param {number} dayNumber - SineDay number (1-18)
 * @returns {Object|null} Day data object or null if not found
 */
export function getDayData(dayNumber) {
  return DAY_DATA.find(d => d.day === dayNumber) || null;
}

/**
 * Main calculation function - computes SineDay from birthdate
 *
 * @param {string|Date} birthdateInput - User's birthdate
 * @returns {SineDayResult|{error: string}} SineDay result or error object
 */
export function calculateSineDay(birthdateInput) {
  // Validate input
  const validation = validateBirthdate(birthdateInput);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const birthdate = new Date(birthdateInput);
  const today = new Date();

  // Calculate days lived
  const daysLived = calculateDaysBetween(birthdate, today);

  // Map to SineDay number
  const sineDayNumber = mapToSineDay(daysLived);

  // Get day data
  const dayData = getDayData(sineDayNumber);

  if (!dayData) {
    return { error: "Unable to calculate SineDay" };
  }

  // Calculate precise wave position for visualization
  const wavePosition = calculateWavePosition(daysLived);

  return {
    day: sineDayNumber,
    phase: dayData.phase,
    description: dayData.description,
    imageUrl: dayData.imageUrl,
    position: wavePosition,
    daysLived: daysLived
  };
}

/**
 * SineDayEngine - Main export object for legacy compatibility
 */
export const SineDayEngine = {
  calculateSineDay,
  validateBirthdate,
  getDayData,
  calculateWavePosition,
  DAY_DATA
};

export default SineDayEngine;
