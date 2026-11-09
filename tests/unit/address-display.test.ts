import { describe, expect, it } from 'vitest';
import { formatOmniboxAddress } from '../../src/shared/addressDisplay';

describe('formatOmniboxAddress', () => {
  it('hides the scheme while the address bar is not focused', () => {
    expect(formatOmniboxAddress('https://example.com/')).toBe('example.com');
    expect(formatOmniboxAddress('http://localhost:4173/')).toBe('localhost:4173');
    expect(formatOmniboxAddress('HTTPS://Example.COM/Path')).toBe('Example.COM/Path');
  });

  it('keeps paths, queries, fragments and trailing slashes that matter', () => {
    expect(formatOmniboxAddress('https://example.com/docs/')).toBe('example.com/docs/');
    expect(formatOmniboxAddress('https://example.com/?q=1#top')).toBe('example.com/?q=1#top');
    expect(formatOmniboxAddress('https://example.com/search?q=a/b')).toBe('example.com/search?q=a/b');
  });

  it('leaves internal and non-web addresses untouched', () => {
    expect(formatOmniboxAddress('browser://newtab')).toBe('browser://newtab');
    expect(formatOmniboxAddress('about:blank')).toBe('about:blank');
    expect(formatOmniboxAddress('file:///home/user/notes.txt')).toBe('file:///home/user/notes.txt');
    expect(formatOmniboxAddress('')).toBe('');
    expect(formatOmniboxAddress(undefined)).toBe('');
  });
});
