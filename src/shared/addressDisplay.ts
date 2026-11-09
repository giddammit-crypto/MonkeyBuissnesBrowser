/**
 * Address-bar display formatting (Chrome parity).
 *
 * While the address bar is not focused the scheme and a lone root slash are
 * hidden, because `https://` on every page is noise. The full URL is restored
 * as soon as the field is focused, and copy/navigation always use the real
 * value — this helper is display only.
 */
const HIDEABLE_SCHEME = /^(https?):\/\//i;

export function formatOmniboxAddress(url: string | undefined | null): string {
  const value = (url ?? '').trim();
  if (!value) return '';
  const match = HIDEABLE_SCHEME.exec(value);
  if (!match) return value; // browser://, about:, data:, file: stay verbatim
  const hostAndPath = value.slice(match[0].length);
  // Hide only the root slash: `example.com/` -> `example.com`, keep
  // `example.com/docs/` untouched.
  if (hostAndPath.endsWith('/') && !hostAndPath.slice(0, -1).includes('/')) {
    return hostAndPath.slice(0, -1);
  }
  return hostAndPath;
}
