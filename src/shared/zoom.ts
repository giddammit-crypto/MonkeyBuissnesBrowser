export const CHROME_ZOOM_LEVELS = [
  0.25, 0.33, 0.50, 0.67, 0.75, 0.80, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 5.00
];

const MIN_ZOOM = CHROME_ZOOM_LEVELS[0];
const MAX_ZOOM = CHROME_ZOOM_LEVELS[CHROME_ZOOM_LEVELS.length - 1];

export function getNextZoomFactor(currentFactor: number, action: 'zoom-in' | 'zoom-out' | 'zoom-reset'): number {
  if (action === 'zoom-reset') return 1.00;
  // A stored factor can be missing, NaN or set by a site to an extreme value.
  // Clamping keeps Ctrl +/- predictable instead of jumping to 500 %.
  const usable = Number.isFinite(currentFactor) && currentFactor > 0 ? currentFactor : 1.0;
  const currentRounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(usable * 100) / 100));
  if (action === 'zoom-in') {
    const next = CHROME_ZOOM_LEVELS.find((z) => z > currentRounded + 0.005);
    return next ?? CHROME_ZOOM_LEVELS[CHROME_ZOOM_LEVELS.length - 1];
  } else {
    for (let i = CHROME_ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (CHROME_ZOOM_LEVELS[i] < currentRounded - 0.005) {
        return CHROME_ZOOM_LEVELS[i];
      }
    }
    return CHROME_ZOOM_LEVELS[0];
  }
}
