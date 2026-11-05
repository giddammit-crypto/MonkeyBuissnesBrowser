import type { BookmarkEntry, HistoryEntry } from './types';
import { isSafeWebUrl, parseOmniboxInput } from './omnibox';

export type SuggestionKind = 'tab' | 'popular' | 'bookmark' | 'history' | 'search';

export interface OmniboxSuggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  url: string;
  domain: string;
  badge: string;
  tabId?: string;
  favicon?: string;
  isAudible?: boolean;
  isMuted?: boolean;
}

export interface OmniboxTabItem {
  id: string;
  title?: string;
  url: string;
  favicon?: string;
  isAudible?: boolean;
  isMuted?: boolean;
}

interface PopularSiteDef {
  title: string;
  domain: string;
  url: string;
  aliases: string[];
}

export const POPULAR_SITES: PopularSiteDef[] = [
  { title: 'ВКонтакте', domain: 'vk.com', url: 'https://vk.com', aliases: ['vk', 'вк', 'вконтакте', 'vkontakte'] },
  { title: 'VK Музыка', domain: 'vk.com/audio', url: 'https://vk.com/audio', aliases: ['музыка', 'музыкавк', 'vkmusic', 'vk music'] },
  { title: 'VK Видео', domain: 'vkvideo.ru', url: 'https://vkvideo.ru', aliases: ['vkvideo', 'вквидео', 'вк видео'] },
  { title: 'YouTube', domain: 'youtube.com', url: 'https://youtube.com', aliases: ['yt', 'ют', 'ютуб', 'ютубе', 'youtube', 'video'] },
  { title: 'Яндекс', domain: 'ya.ru', url: 'https://ya.ru', aliases: ['ya', 'я', 'яндекс', 'yandex'] },
  { title: 'Google', domain: 'google.com', url: 'https://google.com', aliases: ['g', 'гугл', 'google', 'поиск'] },
  { title: 'Pinterest', domain: 'pinterest.com', url: 'https://pinterest.com', aliases: ['pin', 'пин', 'пинтерест', 'pinterest'] },
  { title: 'Telegram Web', domain: 'web.telegram.org', url: 'https://web.telegram.org', aliases: ['tg', 'тг', 'телега', 'телеграм', 'telegram'] },
  { title: 'Mail.ru', domain: 'mail.ru', url: 'https://mail.ru', aliases: ['mail', 'мейл', 'майл', 'почта'] },
  { title: 'Дзен', domain: 'dzen.ru', url: 'https://dzen.ru', aliases: ['dzen', 'дзен'] },
  { title: 'Кинопоиск', domain: 'kinopoisk.ru', url: 'https://kinopoisk.ru', aliases: ['kino', 'кино', 'кинопоиск', 'kinopoisk', 'фильмы'] },
  { title: 'Хабр', domain: 'habr.com', url: 'https://habr.com', aliases: ['habr', 'хабр', 'geektimes'] },
  { title: 'Ozon', domain: 'ozon.ru', url: 'https://ozon.ru', aliases: ['ozon', 'озон'] },
  { title: 'Wildberries', domain: 'wildberries.ru', url: 'https://wildberries.ru', aliases: ['wb', 'вб', 'вайлдберриз', 'вайлдбериз', 'wildberries'] },
  { title: 'Авито', domain: 'avito.ru', url: 'https://avito.ru', aliases: ['avito', 'авито', 'объявления'] },
  { title: 'Госуслуги', domain: 'gosuslugi.ru', url: 'https://gosuslugi.ru', aliases: ['gos', 'гос', 'госуслуги', 'gosuslugi'] },
  { title: 'Rutube', domain: 'rutube.ru', url: 'https://rutube.ru', aliases: ['rutube', 'рутуб', 'видео'] },
  { title: 'Википедия', domain: 'ru.wikipedia.org', url: 'https://ru.wikipedia.org', aliases: ['wiki', 'вики', 'википедия', 'wikipedia'] },
  { title: 'GitHub', domain: 'github.com', url: 'https://github.com', aliases: ['gh', 'гит', 'гитхаб', 'github'] },
  { title: 'Twitch', domain: 'twitch.tv', url: 'https://twitch.tv', aliases: ['twitch', 'твич', 'стрим'] },
  { title: 'Reddit', domain: 'reddit.com', url: 'https://reddit.com', aliases: ['reddit', 'реддит'] },
  { title: 'Discord', domain: 'discord.com', url: 'https://discord.com', aliases: ['ds', 'дс', 'дискорд', 'discord'] },
  { title: 'Иви', domain: 'ivi.ru', url: 'https://ivi.ru', aliases: ['ivi', 'иви', 'кино'] },
  { title: 'Т-Банк', domain: 'tbank.ru', url: 'https://tbank.ru', aliases: ['tinkoff', 'тинькофф', 'tbank', 'тбанк'] },
  { title: 'СберБанк', domain: 'sberbank.ru', url: 'https://sberbank.ru', aliases: ['sber', 'сбер', 'сбербанк', 'sberbank'] },
  { title: 'Steam', domain: 'store.steampowered.com', url: 'https://store.steampowered.com', aliases: ['steam', 'стим', 'игры'] },
  { title: 'Пикабу', domain: 'pikabu.ru', url: 'https://pikabu.ru', aliases: ['pikabu', 'пикабу'] },
  { title: 'РИА Новости', domain: 'ria.ru', url: 'https://ria.ru', aliases: ['ria', 'риа', 'новости'] },
  { title: 'РБК', domain: 'rbc.ru', url: 'https://rbc.ru', aliases: ['rbc', 'рбк', 'новости'] },
];

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// URL paths and query values are case-sensitive. Only URL's own host/default
// port normalization is safe for deduplication.
function suggestionIdentity(url: string): string {
  try { return new URL(url).href; } catch { return url; }
}

export function getOmniboxSuggestions(
  rawInput: string,
  options?: {
    tabs?: OmniboxTabItem[];
    currentTabId?: string;
    history?: HistoryEntry[];
    bookmarks?: BookmarkEntry[];
    searchEngineUrl?: string;
    maxResults?: number;
  }
): OmniboxSuggestion[] {
  const rawTrimmed = rawInput.trim();
  if (!rawTrimmed) return [];

  // Keep the contract bounded even when a caller passes an invalid limit. A
  // usable omnibox always retains one search fallback at minimum.
  const requestedMaxResults = options?.maxResults ?? 7;
  const maxResults = Number.isFinite(requestedMaxResults)
    ? Math.max(1, Math.floor(requestedMaxResults))
    : 7;

  // Check for Chromium tab-search prefix: '%'
  const isTabSearchPrefix = rawTrimmed.startsWith('%');
  const query = isTabSearchPrefix ? rawTrimmed.slice(1).trim() : rawTrimmed;

  // In non-tab mode, query cannot be empty because rawTrimmed was checked.
  // In tab mode ('%'), query can be empty, which lists all open tabs.
  const qLower = query.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '');
  const configuredSearchBase = options?.searchEngineUrl || 'https://yandex.ru/search/?text=';
  // Suggestions are rendered as navigation targets. Do not let a malformed or
  // javascript: search-engine setting turn a suggestion into script execution.
  const searchBase = isSafeWebUrl(configuredSearchBase) ? configuredSearchBase : 'https://yandex.ru/search/?text=';
  const intent = parseOmniboxInput(query || rawTrimmed, searchBase);
  const searchUrl = intent.kind === 'search' ? intent.url : `${searchBase}${encodeURIComponent(query || rawTrimmed)}`;
  const searchDomain = extractDomain(searchUrl);

  const seenUrls = new Set<string>();
  const suggestions: OmniboxSuggestion[] = [];

  // 1. Match Open Tabs (highest ranking priority)
  if (options?.tabs && options.tabs.length > 0) {
    const scoredTabs: Array<{ tab: OmniboxTabItem; score: number }> = [];

    for (const tab of options.tabs) {
      if (!tab.url) continue;
      const tabTitle = (tab.title || '').toLowerCase();
      const tabUrl = tab.url.toLowerCase();
      const tabDomain = extractDomain(tab.url).toLowerCase();

      let score = 0;
      if (isTabSearchPrefix && !qLower) {
        score = 100;
      } else if (qLower) {
        if (tabDomain === qLower) {
          score = 120;
        } else if (tabDomain.startsWith(qLower)) {
          score = 110;
        } else if (tabTitle.startsWith(qLower)) {
          score = 105;
        } else if (tabDomain.includes(qLower)) {
          score = 95;
        } else if (tabTitle.includes(qLower)) {
          score = 90;
        } else if (tabUrl.includes(qLower)) {
          score = 85;
        }
      }

      if (score > 0) {
        if (options?.currentTabId && tab.id === options.currentTabId) {
          score = Math.max(1, score - 35);
        }
        scoredTabs.push({ tab, score });
      }
    }

    scoredTabs.sort((a, b) => b.score - a.score);

    const tabLimit = isTabSearchPrefix ? maxResults : maxResults - 1;
    for (const { tab } of scoredTabs) {
      if (suggestions.length >= tabLimit) break;
      const norm = suggestionIdentity(tab.url);
      if (!seenUrls.has(norm)) {
        seenUrls.add(norm);
        suggestions.push({
          id: `tab-${tab.id}`,
          kind: 'tab',
          title: tab.title || extractDomain(tab.url),
          url: tab.url,
          domain: extractDomain(tab.url),
          badge: 'Вкладка',
          tabId: tab.id,
          favicon: tab.favicon,
          isAudible: tab.isAudible,
          isMuted: tab.isMuted,
        });
      }
    }
  }

  // If user explicitly entered tab search mode via '%', return only tab suggestions
  if (isTabSearchPrefix) {
    return suggestions.slice(0, maxResults);
  }

  // 2. Match popular sites
  const scoredSites: Array<{ site: PopularSiteDef; score: number }> = [];
  for (const site of POPULAR_SITES) {
    const domain = site.domain.toLowerCase();
    const title = site.title.toLowerCase();
    let score = 0;

    if (domain === qLower) {
      score = 100;
    } else if (domain.startsWith(qLower)) {
      score = 80;
    } else if (title.startsWith(qLower)) {
      score = 75;
    } else if (site.aliases.some((a) => a === qLower)) {
      score = 90;
    } else if (site.aliases.some((a) => a.startsWith(qLower))) {
      score = 70;
    } else if (domain.includes(qLower)) {
      score = 50;
    } else if (title.includes(qLower)) {
      score = 40;
    } else if (site.aliases.some((a) => a.includes(qLower))) {
      score = 30;
    }

    if (score > 0) {
      scoredSites.push({ site, score });
    }
  }

  scoredSites.sort((a, b) => b.score - a.score);

  for (const { site } of scoredSites) {
    if (suggestions.length >= maxResults - 1) break;
    const norm = suggestionIdentity(site.url);
    if (!seenUrls.has(norm)) {
      seenUrls.add(norm);
      suggestions.push({
        id: `popular-${site.domain}`,
        kind: 'popular',
        title: site.title,
        url: site.url,
        domain: site.domain,
        badge: 'Сайт',
      });
    }
  }

  // 2. Match Bookmarks
  if (options?.bookmarks && suggestions.length < maxResults - 1) {
    for (const b of options.bookmarks) {
      if (suggestions.length >= maxResults - 1) break;
      const bTitle = (b.title || '').toLowerCase();
      const bUrl = (b.url || '').toLowerCase();
      if (bTitle.includes(qLower) || bUrl.includes(qLower)) {
        const norm = suggestionIdentity(b.url);
        if (!seenUrls.has(norm)) {
          seenUrls.add(norm);
          suggestions.push({
            id: `bookmark-${b.id || b.url}`,
            kind: 'bookmark',
            title: b.title || extractDomain(b.url),
            url: b.url,
            domain: extractDomain(b.url),
            badge: 'Закладка',
          });
        }
      }
    }
  }

  // 3. Match History
  if (options?.history && suggestions.length < maxResults - 1) {
    for (const h of options.history) {
      if (suggestions.length >= maxResults - 1) break;
      const hTitle = (h.title || '').toLowerCase();
      const hUrl = (h.url || '').toLowerCase();
      if (hTitle.includes(qLower) || hUrl.includes(qLower)) {
        const norm = suggestionIdentity(h.url);
        if (!seenUrls.has(norm)) {
          seenUrls.add(norm);
          suggestions.push({
            id: `history-${h.id || h.url}`,
            kind: 'history',
            title: h.title || extractDomain(h.url),
            url: h.url,
            domain: extractDomain(h.url),
            badge: 'История',
          });
        }
      }
    }
  }

  // 4. Always include search suggestion. With maxResults=1 this is the only
  // result; otherwise it remains the final fallback as before.
  if (suggestions.length >= maxResults) return suggestions.slice(0, maxResults);
  suggestions.push({
    id: `search-${query}`,
    kind: 'search',
    title: `Искать «${query}» в поиске`,
    url: searchUrl,
    domain: searchDomain,
    badge: 'Поиск',
  });

  return suggestions.slice(0, maxResults);
}
