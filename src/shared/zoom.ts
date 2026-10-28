export const CHROME_ZOOM_LEVELS = [
  0.25, 0.33, 0.50, 0.67, 0.75, 0.80, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 5.00
];

export function getNextZoomFactor(currentFactor: number, action: 'zoom-in' | 'zoom-out' | 'zoom-reset'): number {
  if (action === 'zoom-reset') return 1.00;
  const currentRounded = Math.round((currentFactor || 1.0) * 100) / 100;
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
