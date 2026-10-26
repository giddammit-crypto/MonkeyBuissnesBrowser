import type { NewTabBackground } from './types';

/** Closed local choices only: legacy names and untrusted URLs never become CSS. */
export function normalizeNewTabBackground(value: unknown): NewTabBackground {
  if (value === 'plain' || value === 'cyberpink' || value === 'cyberpink-fuji' || value === 'cyber-butterfly' || value === 'tokyo-night' || value === 'celestial-palace') return value;
  return 'portrait';
}
