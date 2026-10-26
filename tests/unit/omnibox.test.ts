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
});
