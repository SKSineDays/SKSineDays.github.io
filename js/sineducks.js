/** Official production SineDuck marks. All numbered identity surfaces share this mapping. */
export const DUCK_URLS = Array.from({ length: 18 }, (_, index) =>
  `assets/sineducks/SineDuckFinale${index + 1}.svg`
);

export function duckUrlFromSinedayNumber(n) {
  return DUCK_URLS[((n - 1) % 18 + 18) % 18];
}

export function duckSvgUrlFromSinedayNumber(n) {
  return duckUrlFromSinedayNumber(n);
}

/** Exact 1920 × 1080 raster derivatives for email and PNG-only PDF renderers. */
export function duckPngUrlFromSinedayNumber(n) {
  const day = ((n - 1) % 18 + 18) % 18 + 1;
  return `assets/email/20260923/sineducks/SineDuckFinale${day}.png`;
}

/** Placement used by the art-direction collection's nature/mark preview. */
export function duckPlacementOnDayArtwork(n) {
  return [1, 2, 4, 10, 11, 12, 15, 17, 18].includes(n) ? 'top' : 'bottom';
}
