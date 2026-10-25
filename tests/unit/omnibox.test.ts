import { describe, expect, it } from 'vitest';
import { isSafeWebUrl, parseOmniboxInput } from '../../src/shared/omnibox';

describe('parseOmniboxInput', () => {
  it('accepts explicit http and https URLs', () => {
    expect(parseOmniboxInput('https://example.com/docs')).toEqual({ kind: 'url', url: 'https://example.com/docs' });
    expect(parseOmniboxInput('http://localhost:4173/')).toEqual({ kind: 'url', url: 'http://localhost:4173/' });
  });

  it('normalizes host-like input', () => {
    expect(parseOmniboxInput('example.com')).toEqual({ kind: 'url', url: 'https://example.com' });
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
  });
});
