/**
 * SineDuck Assets Module
 * Maps SineDay numbers (1-18) to corresponding duck images
 */

// Array of duck image URLs (SineDuck1@3x.png through SineDuck18@3x.png)
export const DUCK_URLS = [
  "assets/sineducks/SineDuck1@3x.png",
  "assets/sineducks/SineDuck2@3x.png",
  "assets/sineducks/SineDuck3@3x.png",
  "assets/sineducks/SineDuck4@3x.png",
  "assets/sineducks/SineDuck5@3x.png",
  "assets/sineducks/SineDuck6@3x.png",
  "assets/sineducks/SineDuck7@3x.png",
  "assets/sineducks/SineDuck8@3x.png",
  "assets/sineducks/SineDuck9@3x.png",
  "assets/sineducks/SineDuck10@3x.png",
  "assets/sineducks/SineDuck11@3x.png",
  "assets/sineducks/SineDuck12@3x.png",
  "assets/sineducks/SineDuck13@3x.png",
  "assets/sineducks/SineDuck14@3x.png",
  "assets/sineducks/SineDuck15@3x.png",
  "assets/sineducks/SineDuck16@3x.png",
  "assets/sineducks/SineDuck17@3x.png",
  "assets/sineducks/SineDuck18@3x.png"
];

/**
 * Get duck URL for a given SineDay number
 * @param {number} n - SineDay number (1-18)
 * @returns {string} URL path to the corresponding duck image
 */
export function duckUrlFromSinedayNumber(n) {
  // n is 1..18, array is 0-indexed
  // Use modulo to ensure safe wrapping
  return DUCK_URLS[(n - 1 + 18) % 18];
}

/** The original vector artwork, for sharp foreground rendering at any size. */
export function duckSvgUrlFromSinedayNumber(n) {
  return duckUrlFromSinedayNumber(n).replace('@3x.png', '.svg');
}

/** Preserve each background's principal natural detail beneath the foreground. */
export function duckPlacementOnDayArtwork(n) {
  return [1, 2, 4, 10, 11, 12, 15, 17, 18].includes(n) ? 'top' : 'bottom';
}
