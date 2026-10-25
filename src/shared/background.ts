import type { NewTabBackground } from './types';

/** Closed local choices only: legacy names and untrusted URLs never become CSS. */
export function normalizeNewTabBackground(value: unknown): NewTabBackground {
  return value === 'plain' ? 'plain' : 'portrait';
}
