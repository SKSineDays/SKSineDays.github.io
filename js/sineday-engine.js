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
 * Extended day details (paragraph + bullets) used for the Day Details card.
 * Keyed by day number for fast lookup.
 */
export const DAY_DETAILS = {
  1: {
    paragraph:
      "This is the start of the wave — a clean edge, a new chapter. Small choices have outsized power today because they set direction. Pick one meaningful beginning and give it a real first step.",
    bullets: [
      "Choose one 'seed' to start (don't start five)",
      "Set a simple intention you can act on today",
      "Clear one obstacle or distraction from the path",
      "Take the smallest real step that counts"
    ]
  },
  2: {
    paragraph:
      "The wave is rising and consistency becomes your advantage. What you repeat today gains speed and traction. Keep it simple, keep it moving, and let progress compound.",
    bullets: [
      "Repeat yesterday's win and build on it",
      "Use short sprints instead of perfection",
      "Move your body to move your energy",
      "Remove friction: simplify tools, steps, and decisions"
    ]
  },
  3: {
    paragraph:
      "Creative current is strong — new angles appear and possibilities open up. It's a day for exploration and playful experimentation. Capture ideas quickly, then shape one into something tangible.",
    bullets: [
      "Brainstorm freely before you edit",
      "Try a new approach, format, or environment",
      "Capture ideas immediately (notes > memory)",
      "Turn one idea into a quick prototype"
    ]
  },
  4: {
    paragraph:
      "Connection comes easier now — conversations can unlock clarity and opportunity. Share what you're building and let relationships refine it. The right exchange today can save you weeks later.",
    bullets: [
      "Reach out: one meaningful message or call",
      "Collaborate, ask for feedback, or offer help",
      "Share your current direction in one sentence",
      "Strengthen trust: follow through on a small promise"
    ]
  },
  5: {
    paragraph:
      "This is a strong execution day — the wave supports doing and finishing. You'll feel best when you ship something real. Choose priority work, protect your time, and close loops.",
    bullets: [
      "Pick the top 1–3 outcomes and ignore the rest",
      "Batch tasks and reduce context switching",
      "Finish and deliver (completion over expansion)",
      "Clean up loose ends: replies, files, next steps"
    ]
  },
  6: {
    paragraph:
      "At the peak, you can see the whole system — what's aligned and what's pulling you off-center. It's a day to stabilize, refine, and make adjustments that create ease. Balance isn't doing less; it's choosing what fits.",
    bullets: [
      "Rebalance effort: work, health, relationships, rest",
      "Adjust priorities to match what matters now",
      "Create a rhythm you can sustain",
      "Choose clean boundaries over overcommitment"
    ]
  },
  7: {
    paragraph:
      "Insight cuts through noise today. Patterns become obvious, and the 'real issue' is easier to name. Listen closely, write it down, and let truth simplify your next move.",
    bullets: [
      "Journal for 5 minutes: 'What's actually going on?'",
      "Look for the pattern beneath the problem",
      "Decide one thing you will stop tolerating",
      "Choose the simplest next step that honors clarity"
    ]
  },
  8: {
    paragraph:
      "This is the edge of the peak — the day that builds durability. Resistance shows where you're growing. Meet the hard thing directly, and you'll come out stronger and clearer.",
    bullets: [
      "Tackle the most avoided task first",
      "Hold a boundary you've been bending",
      "Use friction as feedback, not failure",
      "Choose courage in one specific action"
    ]
  },
  9: {
    paragraph:
      "The crest is a turning point — the energy shifts from outward push to inward refinement. This is a perfect day to review, re-aim, and change course with intention. Let the wave turn without forcing it.",
    bullets: [
      "Review wins, lessons, and what changed",
      "Decide what continues and what ends",
      "Make one clean adjustment to direction",
      "Slow down enough to feel what's true"
    ]
  },
  10: {
    paragraph:
      "Reflection deepens and perspective expands. You can learn more from the past cycle now than you could while rushing through it. Notice what worked, what didn't, and why.",
    bullets: [
      "Ask: 'What did this cycle teach me?'",
      "Name one pattern to reinforce and one to retire",
      "Practice gratitude for the progress you missed",
      "Clarify what 'better' looks like next time"
    ]
  },
  11: {
    paragraph:
      "Integration is where growth becomes real. When you pause, your mind and body process what you've lived. Give yourself space — the system consolidates and strengthens here.",
    bullets: [
      "Prioritize sleep, recovery, and simplicity",
      "Organize what you've learned into one takeaway",
      "Reduce inputs: less noise, fewer demands",
      "Let your next move emerge instead of forcing it"
    ]
  },
  12: {
    paragraph:
      "This day supports fine-tuning. Small adjustments now prevent bigger corrections later. Be gentle and precise — tweak the plan so it matches reality and your energy.",
    bullets: [
      "Edit your goals to fit the season you're in",
      "Reduce scope without reducing commitment",
      "Fix one habit at the root (not the symptom)",
      "Realign schedule, tools, and expectations"
    ]
  },
  13: {
    paragraph:
      "Release clears space for the next rise. What you're holding that's outdated becomes heavier now. Letting go is not loss — it's making room for what fits.",
    bullets: [
      "Declutter one area: mind, desk, inbox, calendar",
      "Close an open loop you've been carrying",
      "Say 'no' to something misaligned",
      "Forgive, simplify, and lighten your load"
    ]
  },
  14: {
    paragraph:
      "The trough is quiet power — deeper truths surface when the outside gets quieter. This is a day for honesty, insight, and inner alignment. The work here changes everything upstream.",
    bullets: [
      "Choose solitude or a slower pace",
      "Ask: 'What am I avoiding feeling or admitting?'",
      "Do one grounding practice (walk, breath, prayer, journal)",
      "Reconnect to your core values and direction"
    ]
  },
  15: {
    paragraph:
      "Healing is active restoration. Your system responds best to softness today — nourishment, safety, and patient care. Treat recovery like progress, because it is.",
    bullets: [
      "Give your body what it's been asking for",
      "Choose gentler movement over intensity",
      "Receive support: ask, share, or rest",
      "Repair one relationship — with yourself or another"
    ]
  },
  16: {
    paragraph:
      "The next rise is forming — preparation turns intention into readiness. Quiet structure now creates momentum later. Set the stage so Day 1 feels clean and powerful.",
    bullets: [
      "Organize tools, space, and priorities",
      "Build buffers: time, food, sleep, resources",
      "Plan the first steps of the next cycle",
      "Remove one blocker before it becomes a problem"
    ]
  },
  17: {
    paragraph:
      "The wave begins to lift again. This is foundation energy — practical, steady, and forward-facing. Build the structure that will carry the next cycle: routines, systems, and commitments that hold.",
    bullets: [
      "Create or refresh one daily rhythm",
      "Outline the next project in simple steps",
      "Do the 'setup work' you usually skip",
      "Commit to consistency over intensity"
    ]
  },
  18: {
    paragraph:
      "Culmination is completion with meaning. You're closing the loop — gather what you learned, finish what matters, and mark the end with intention. Then let renewal be real, not rushed.",
    bullets: [
      "Finish one key thing and call it complete",
      "Celebrate progress (even if it's imperfect)",
      "Capture the lesson: 'Next cycle, I will…'",
      "Reset: clear space for Day 1 to feel new"
    ]
  }
};

/**
 * Gets day details for a specific SineDay number.
 */
export function getDayDetails(dayNumber) {
  return DAY_DETAILS[dayNumber] || null;
}

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
 * Returns YYYY-MM-DD for "today" in a given timezone
 *
 * @param {string} timeZone - IANA timezone (e.g. "America/Chicago")
 * @returns {string} YYYY-MM-DD
 */
function ymdInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

/**
 * Calculates SineDay for a specific timezone (today in that TZ)
 * Uses noon UTC anchors to avoid DST edge weirdness
 *
 * @param {string} birthdateInput - YYYY-MM-DD from DB
 * @param {string} timeZone - IANA timezone
 * @returns {SineDayResult|{error: string}} SineDay result or error object
 */
export function calculateSineDayForTimezone(birthdateInput, timeZone) {
  const validation = validateBirthdate(birthdateInput);
  if (!validation.valid) return { error: validation.error };

  const birthYMD = birthdateInput;
  const todayYMD = ymdInTimeZone(timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);

  const birth = new Date(`${birthYMD}T12:00:00Z`);
  const today = new Date(`${todayYMD}T12:00:00Z`);

  const daysLived = calculateDaysBetween(birth, today);
  const day = mapToSineDay(daysLived);
  const dayData = getDayData(day);

  return {
    day,
    position: calculateWavePosition(daysLived),
    phase: dayData?.phase,
    description: dayData?.description
  };
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
  calculateSineDayForTimezone,
  validateBirthdate,
  getDayData,
  getDayDetails,
  calculateWavePosition,
  DAY_DATA,
  DAY_DETAILS
};

export default SineDayEngine;
