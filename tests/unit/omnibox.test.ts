import { describe, expect, it } from 'vitest';
import { isSafeWebUrl, parseOmniboxInput } from '../../src/shared/omnibox';

describe('parseOmniboxInput', () => {
  it('accepts explicit http and https URLs', () => {
    expect(parseOmniboxInput('https://example.com/docs')).toEqual({ kind: 'url', url: 'https://example.com/docs' });
    expect(parseOmniboxInput('http://localhost:4173/')).toEqual({ kind: 'url', url: 'http://localhost:4173/' });
  });

  it('normalizes host-like input', () => {
    expect(parseOmniboxInput('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
  });

  it('turns plain text into a search URL', () => {
    expect(parseOmniboxInput('quiet mountain routes', 'https://search.test/?q=')).toEqual({
      kind: 'search',
      url: 'https://search.test/?q=quiet%20mountain%20routes',
    });
  });

  it('uses Yandex when no custom search engine is supplied', () => {
    expect(parseOmniboxInput('quiet mountain routes')).toEqual({
      kind: 'search',
      url: 'https://yandex.ru/search/?text=quiet%20mountain%20routes',
    });
  });

  it('rejects dangerous schemes and empty input', () => {
    expect(parseOmniboxInput('javascript:alert(1)').kind).toBe('invalid');
    expect(parseOmniboxInput('   ').kind).toBe('invalid');
    expect(isSafeWebUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeWebUrl('https://example.com')).toBe(true);
    expect(isSafeWebUrl('https://user:secret@example.com')).toBe(false);
  });
});


describe('omnibox host parsing regressions', () => {
  it('accepts localhost with ports before interpreting a URI scheme', () => {
    expect(parseOmniboxInput('localhost:4174/path')).toEqual({ kind: 'url', url: 'http://localhost:4174/path' });
  });
  it('accepts international domains and URL queries/fragments', () => {
    expect(parseOmniboxInput('пример.рф?q=тест#part')).toEqual({ kind: 'url', url: 'https://xn--e1afmkfd.xn--p1ai/?q=%D1%82%D0%B5%D1%81%D1%82#part' });
    expect(parseOmniboxInput('example.org?x=1#part')).toEqual({ kind: 'url', url: 'https://example.org/?x=1#part' });
  });
  it('rejects unsupported explicit protocols while allowing punctuation in searches', () => {
    for (const input of ['ftp://example.org/file', 'javascript:alert(1)', 'custom://example.org']) expect(parseOmniboxInput(input).kind).toBe('invalid');
    expect(parseOmniboxInput('how: why', 'https://search.test/?q=')).toEqual({ kind: 'search', url: 'https://search.test/?q=how%3A%20why' });
    expect(parseOmniboxInput('https://user:secret@example.com').kind).toBe('invalid');
  });
});

describe('getOmniboxSuggestions', () => {
  it('returns empty array for blank query', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    expect(getOmniboxSuggestions('')).toEqual([]);
    expect(getOmniboxSuggestions('   ')).toEqual([]);
  });

  it('matches popular sites for russian and english queries', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const vkSug = getOmniboxSuggestions('вк');
    expect(vkSug.some((s) => s.domain === 'vk.com')).toBe(true);

    const pinSug = getOmniboxSuggestions('pin');
    expect(pinSug.some((s) => s.domain === 'pinterest.com')).toBe(true);

    const ytSug = getOmniboxSuggestions('you');
    expect(ytSug.some((s) => s.domain === 'youtube.com')).toBe(true);
  });

  it('includes web search fallback as last item', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const results = getOmniboxSuggestions('cats and dogs');
    const last = results[results.length - 1];
    expect(last.kind).toBe('search');
    expect(last.url).toContain('cats%20and%20dogs');
  });

  it('keeps suggestion targets safe and respects a one-item limit', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const result = getOmniboxSuggestions('cats', { searchEngineUrl: 'javascript:alert(1)', maxResults: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('search');
    expect(result[0].url).toBe('https://yandex.ru/search/?text=cats');
    expect(getOmniboxSuggestions('cats', { maxResults: 0 })).toHaveLength(1);
  });

  it('suggests matching open tabs with highest priority (Switch to Tab)', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const tabs = [
      { id: 'tab-1', title: 'GitHub: Let’s build from here', url: 'https://github.com', favicon: 'https://github.com/favicon.ico' },
      { id: 'tab-2', title: 'Habr: сообщество IT', url: 'https://habr.com', isAudible: true },
      { id: 'tab-3', title: 'Work Dashboard', url: 'https://corp.internal/dash' },
    ];

    const results = getOmniboxSuggestions('git', { tabs, currentTabId: 'tab-2' });
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first.kind).toBe('tab');
    expect(first.tabId).toBe('tab-1');
    expect(first.title).toBe('GitHub: Let’s build from here');
    expect(first.badge).toBe('Вкладка');
    expect(first.favicon).toBe('https://github.com/favicon.ico');
  });

  it('supports % prefix for dedicated open tab search mode', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const tabs = [
      { id: 't1', title: 'React Documentation', url: 'https://react.dev' },
      { id: 't2', title: 'Vite Guide', url: 'https://vitejs.dev' },
      { id: 't3', title: 'Electron Docs', url: 'https://www.electronjs.org' },
    ];

    // "%" with empty query returns all open tabs
    const allTabs = getOmniboxSuggestions('%', { tabs });
    expect(allTabs.every((s) => s.kind === 'tab')).toBe(true);
    expect(allTabs.length).toBe(3);

    // "%vite" filters to vite tab
    const filtered = getOmniboxSuggestions('%vite', { tabs });
    expect(filtered.length).toBe(1);
    expect(filtered[0].tabId).toBe('t2');
  });

  it('penalizes current tab in suggestions so other open tabs take precedence', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const tabs = [
      { id: 'cur', title: 'VK News', url: 'https://vk.com/feed' },
      { id: 'other', title: 'VK Music', url: 'https://vk.com/audio' },
    ];

    const results = getOmniboxSuggestions('vk.com', { tabs, currentTabId: 'cur' });
    const tabSuggestions = results.filter((s) => s.kind === 'tab');
    expect(tabSuggestions[0].tabId).toBe('other');
  });
});

describe('Omnibox open tabs search and ranking', () => {
  const mockTabs = [
    { id: 'tab-gh', title: 'GitHub - Repositories', url: 'https://github.com/vint/browser' },
    { id: 'tab-gl', title: 'GitLab - Projects', url: 'https://gitlab.com' },
    { id: 'tab-docs', title: 'Vitest Documentation & Guide', url: 'https://vitest.dev/guide' },
    { id: 'tab-habr', title: 'Хабр — Сообщество IT-специалистов', url: 'https://habr.com/ru/feed' },
    { id: 'tab-ya', title: 'Яндекс Поиск', url: 'https://ya.ru' },
  ];

  it('searches open tabs using the Chromium "%" prefix', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');

    // Typing "%" alone lists all open tabs up to maxResults
    const allTabs = getOmniboxSuggestions('%', { tabs: mockTabs });
    expect(allTabs.length).toBe(5);
    expect(allTabs.every((s) => s.kind === 'tab')).toBe(true);
    expect(allTabs.every((s) => s.badge === 'Вкладка')).toBe(true);

    // Typing "%" with trailing space lists all tabs
    const allTabsWithSpace = getOmniboxSuggestions('%  ', { tabs: mockTabs });
    expect(allTabsWithSpace.length).toBe(5);

    // Typing "% git" or "%git" filters open tabs specifically
    const gitTabs = getOmniboxSuggestions('% git', { tabs: mockTabs });
    expect(gitTabs).toHaveLength(2); // GitHub and GitLab
    expect(gitTabs[0].tabId).toBe('tab-gh');
    expect(gitTabs[1].tabId).toBe('tab-gl');

    // Tab search mode strictly excludes popular sites, bookmarks, and history
    const popularOnlyQuery = getOmniboxSuggestions('% vk', {
      tabs: mockTabs,
      history: [{ id: 'h1', title: 'VK News', url: 'https://vk.com/feed', visitedAt: 12345 }],
      bookmarks: [{ id: 'b1', title: 'VK Page', url: 'https://vk.com', createdAt: 12345 }],
    });
    // No open tab has "vk", so nothing should be returned in "%" tab-search mode
    expect(popularOnlyQuery).toEqual([]);
  });

  it('supports Cyrillic search queries in open tabs with "%"', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const cyr = getOmniboxSuggestions('% хабр', { tabs: mockTabs });
    expect(cyr).toHaveLength(1);
    expect(cyr[0].tabId).toBe('tab-habr');
    expect(cyr[0].title).toContain('Хабр');
    expect(cyr[0].badge).toBe('Вкладка');
  });

  it('formats tab suggestions with type "tab", tabId, domain, and "Вкладка" badge', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const suggestions = getOmniboxSuggestions('% vitest', { tabs: mockTabs });
    expect(suggestions).toHaveLength(1);
    const item = suggestions[0];
    expect(item).toMatchObject({
      id: 'tab-tab-docs',
      kind: 'tab',
      tabId: 'tab-docs',
      title: 'Vitest Documentation & Guide',
      url: 'https://vitest.dev/guide',
      domain: 'vitest.dev',
      badge: 'Вкладка',
    });
  });

  it('ranks open tabs at the top above popular sites, bookmarks, history, and search in normal mode', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    const results = getOmniboxSuggestions('github', {
      tabs: mockTabs,
      bookmarks: [{ id: 'b-gh', title: 'Old GitHub Bookmark', url: 'https://github.com/old', createdAt: 1 }],
      history: [{ id: 'h-gh', title: 'GitHub History', url: 'https://github.com/history', visitedAt: 1 }],
    });

    // 1st suggestion must be the open tab!
    expect(results[0].kind).toBe('tab');
    expect(results[0].tabId).toBe('tab-gh');
    expect(results[0].badge).toBe('Вкладка');

    // Followed by bookmarks / history / popular sites, and search at the bottom
    const lastItem = results[results.length - 1];
    expect(lastItem.kind).toBe('search');
    expect(lastItem.badge).toBe('Поиск');
  });

  it('deduplicates open tabs with popular sites when URLs match', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    // ya.ru is in popular sites AND in open tabs
    const results = getOmniboxSuggestions('ya.ru', { tabs: mockTabs });
    const yaMatches = results.filter((s) => s.domain === 'ya.ru');
    // Open tab should supersede popular site entry
    expect(yaMatches.length).toBe(1);
    expect(yaMatches[0].kind).toBe('tab');
    expect(yaMatches[0].tabId).toBe('tab-ya');
    expect(yaMatches[0].badge).toBe('Вкладка');
  });

  it('handles empty tab array or missing tabs options gracefully', async () => {
    const { getOmniboxSuggestions } = await import('../../src/shared/omniboxSuggestions');
    expect(getOmniboxSuggestions('% github', { tabs: [] })).toEqual([]);
    expect(getOmniboxSuggestions('% github', {})).toEqual([]);
    expect(getOmniboxSuggestions('%')).toEqual([]);
  });
});

describe('omnibox edge cases (2026-11-05 audit)', () => {
  it('asks for a query instead of searching for nothing after "?"', () => {
    expect(parseOmniboxInput('?')).toEqual({ kind: 'invalid', reason: 'Введите поисковый запрос после «?».' });
    expect(parseOmniboxInput('?   ').kind).toBe('invalid');
    expect(parseOmniboxInput('? погода')).toEqual({
      kind: 'search', url: 'https://yandex.ru/search/?text=%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0',
    });
  });

  it('navigates fully qualified hostnames with a trailing dot', () => {
    expect(parseOmniboxInput('example.com.')).toEqual({ kind: 'url', url: 'https://example.com./' });
    expect(parseOmniboxInput('example.com./docs')).toEqual({ kind: 'url', url: 'https://example.com./docs' });
  });

  it('keeps search keywords and internal pages working', () => {
    expect(parseOmniboxInput('g weather').url).toBe('https://www.google.com/search?q=weather');
    expect(parseOmniboxInput('browser://newtab')).toEqual({ kind: 'url', url: 'browser://newtab' });
    expect(parseOmniboxInput('chrome://newtab')).toEqual({ kind: 'url', url: 'browser://newtab' });
    expect(parseOmniboxInput('about:blank')).toEqual({ kind: 'url', url: 'about:blank' });
  });
});
