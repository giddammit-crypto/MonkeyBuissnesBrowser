import type { NavigationIntent } from './types';

const SEARCH_URL = 'https://yandex.ru/search/?text=';
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:']);

export function parseOmniboxInput(rawInput: string, searchUrl = SEARCH_URL): NavigationIntent {
  const input = rawInput.trim();
  if (!input) return { kind: 'invalid', reason: 'Введите адрес или поисковый запрос.' };

  try {
    const explicit = new URL(input);
    if (BLOCKED_SCHEMES.has(explicit.protocol)) {
      return { kind: 'invalid', reason: 'Эта схема URL запрещена в адресной строке.' };
    }
    if (explicit.protocol === 'http:' || explicit.protocol === 'https:') {
      return { kind: 'url', url: explicit.toString() };
    }
    return { kind: 'invalid', reason: `Схема ${explicit.protocol} не поддерживается.` };
  } catch {
    // A host-like input without a scheme is still a URL candidate.
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(input)) {
    return { kind: 'url', url: `http://${input}` };
  }

  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/.*)?$/i.test(input)) {
    return { kind: 'url', url: `https://${input}` };
  }

  return { kind: 'search', url: `${searchUrl}${encodeURIComponent(input)}` };
}

export function isSafeWebUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
