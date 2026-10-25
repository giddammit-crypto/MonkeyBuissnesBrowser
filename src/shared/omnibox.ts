import type { NavigationIntent } from './types';

const SEARCH_URL = 'https://yandex.ru/search/?text=';

export function parseOmniboxInput(rawInput: string, searchUrl = SEARCH_URL): NavigationIntent {
  const input = rawInput.trim();
  if (!input) return { kind: 'invalid', reason: 'Введите адрес или поисковый запрос.' };

  // Detect host:port before URL(), which interprets localhost:4174 as a scheme.
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
    try { return { kind: 'url', url: new URL(`http://${input}`).href }; }
    catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  if (/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d+)?(?:[/?#][^\s]*)?$/u.test(input)) {
    try { return { kind: 'url', url: new URL(`https://${input}`).href }; }
    catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  if (/^(?:https?|javascript|data|file|vbscript|ftp):/i.test(input) || /^[a-z][a-z\d+.-]*:\S/i.test(input)) {
    try {
      const explicit = new URL(input);
      if (explicit.protocol === 'http:' || explicit.protocol === 'https:') return { kind: 'url', url: explicit.href };
      return { kind: 'invalid', reason: `Схема ${explicit.protocol} не поддерживается.` };
    } catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  const safeSearchUrl = isSafeWebUrl(searchUrl) ? searchUrl : SEARCH_URL;
  return { kind: 'search', url: `${safeSearchUrl}${encodeURIComponent(input)}` };
}

export function isSafeWebUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
