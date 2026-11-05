import { isSafeWebUrl } from './omnibox';

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', '_openstat', 'mc_cid', 'mc_eid', 'igshid']);

/** Remove only recognized campaign parameters; preserve functional query/hash. */
export function cleanTrackingLink(raw: string): string | undefined {
  if (!isSafeWebUrl(raw)) return undefined;
  const url = new URL(raw);
  const keys = [...url.searchParams.keys()].filter(key => key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase()));
  if (!keys.length) return raw;
  for (const key of keys) url.searchParams.delete(key);
  return url.href;
}
