import type { NavigationIntent } from './types';

const SEARCH_URL = 'https://yandex.ru/search/?text=';

export const SEARCH_ENGINES: Record<string, string> = {
  g: 'https://www.google.com/search?q=',
  google: 'https://www.google.com/search?q=',
  y: 'https://yandex.ru/search/?text=',
  ya: 'https://yandex.ru/search/?text=',
  yandex: 'https://yandex.ru/search/?text=',
  d: 'https://duckduckgo.com/?q=',
  ddg: 'https://duckduckgo.com/?q=',
};

export function parseOmniboxInput(rawInput: string, searchUrl = SEARCH_URL): NavigationIntent {
  const input = rawInput.trim();
  if (!input) return { kind: 'invalid', reason: 'Введите адрес или поисковый запрос.' };

  // Support internal browser schemes
  if (/^(browser|chrome|about):/i.test(input)) {
    const lower = input.toLowerCase();
    if (lower === 'browser://newtab' || lower === 'chrome://newtab' || lower === 'about:blank') {
      return { kind: 'url', url: lower === 'chrome://newtab' ? 'browser://newtab' : input };
    }
  }

  // Force search prefix '?'
  if (input.startsWith('?') && input.length > 1) {
    const query = input.slice(1).trim();
    const safeSearchUrl = isSafeWebUrl(searchUrl) ? searchUrl : SEARCH_URL;
    return { kind: 'search', url: `${safeSearchUrl}${encodeURIComponent(query)}` };
  }

  // Search engine keyword prefixes: "g query", "y query", "ddg query"
  const keywordMatch = input.match(/^([a-z]{1,6})\s+(.+)$/i);
  if (keywordMatch) {
    const enginePrefix = keywordMatch[1].toLowerCase();
    const query = keywordMatch[2].trim();
    if (SEARCH_ENGINES[enginePrefix]) {
      return { kind: 'search', url: `${SEARCH_ENGINES[enginePrefix]}${encodeURIComponent(query)}` };
    }
  }

  // Address literals and local hostnames must be recognized before URL()
  // interprets their port as a custom scheme. Local devices often serve HTTP.
  if (/^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:.]+\]|[\p{L}\p{N}-]+\.(?:local|localhost))(?::\d+)?(?:[/?#][^\s]*)?$/iu.test(input)) {
    try {
      const candidate = new URL(`https://${input}`);
      const host = candidate.hostname.toLowerCase();
      const octets = host.split('.').map(Number);
      const local = host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')
        || host === '[::1]' || /^\[(?:fc|fd|fe[89ab])/i.test(host)
        || (octets.length === 4 && (octets[0] === 127 || octets[0] === 10
          || (octets[0] === 192 && octets[1] === 168)
          || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
          || (octets[0] === 169 && octets[1] === 254)));
      if (local) candidate.protocol = 'http:';
      return { kind: 'url', url: candidate.href };
    }
    catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  if (/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d+)?(?:[/?#][^\s]*)?$/u.test(input)) {
    try { return { kind: 'url', url: new URL(`https://${input}`).href }; }
    catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  if (/^(?:https?|javascript|data|file|vbscript|ftp):/i.test(input) || /^[a-z][a-z\d+.-]*:\S/i.test(input)) {
    try {
      const explicit = new URL(input);
       if (explicit.protocol === 'http:' || explicit.protocol === 'https:') {
         if (!isSafeWebUrl(explicit.href)) return { kind: 'invalid', reason: 'Адрес с учётными данными не поддерживается.' };
         return { kind: 'url', url: explicit.href };
       }
      return { kind: 'invalid', reason: `Схема ${explicit.protocol} не поддерживается.` };
    } catch { return { kind: 'invalid', reason: 'Некорректный адрес.' }; }
  }
  const safeSearchUrl = isSafeWebUrl(searchUrl) ? searchUrl : SEARCH_URL;
  return { kind: 'search', url: `${safeSearchUrl}${encodeURIComponent(input)}` };
}

export function isSafeWebUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
