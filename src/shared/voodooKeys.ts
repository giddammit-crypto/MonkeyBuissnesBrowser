/** Normalize pasted key lists without inventing a fallback credential. */
export function normalizeVoodooKeys(value: unknown): string[] {
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const keys = entries.filter((entry): entry is string => typeof entry === 'string')
    .flatMap((entry) => entry.replace(/\bBearer[ \t]+/gi, '').split(/[\s,;]+/))
    .map((entry) => entry.trim()).filter((entry) => entry.length >= 10 && entry.length <= 4096);
  return [...new Set(keys)].slice(0, 100);
}
