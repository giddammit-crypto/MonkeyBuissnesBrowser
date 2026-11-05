import { describe, expect, it } from 'vitest';
import { parseOmniboxInput } from '../../src/shared/omnibox';
import { getOmniboxSuggestions } from '../../src/shared/omniboxSuggestions';
import { cleanTrackingLink } from '../../src/shared/cleanLink';

describe('omnibox navigation parity', () => {
  it.each(['g русские книги', 'ddg browser', '? title:library'])('keeps clicked search fallback identical to Enter for %s', input => {
    const intent = parseOmniboxInput(input);
    expect(intent.kind).toBe('search');
    expect(getOmniboxSuggestions(input).at(-1)?.url).toBe('url' in intent ? intent.url : undefined);
  });
  it('keeps case-sensitive and slash-sensitive page addresses distinct', () => {
    const urls = ['https://EXAMPLE.org/docs/A', 'https://example.org/docs/a', 'https://example.org/docs/a/'];
    const results = getOmniboxSuggestions('%', { tabs: urls.map((url, i) => ({ id: String(i), url })) });
    expect(results).toHaveLength(3);
  });
  it('deduplicates equivalent root URLs and default ports', () => {
    expect(getOmniboxSuggestions('%', { tabs: [{ id: 'a', url: 'https://EXAMPLE.org:443' }, { id: 'b', url: 'https://example.org/' }] })).toHaveLength(1);
  });
  it.each(['192.168.1.1:8080/admin', '10.0.0.1', '172.16.0.2', '[::1]:4173/', 'printer.local'])('opens local device %s over HTTP', input => {
    expect(parseOmniboxInput(input)).toMatchObject({ kind: 'url', url: expect.stringMatching(/^http:\/\//) });
  });
  it('keeps explicit HTTPS, public IP HTTPS and unsupported schemes intact', () => {
    expect(parseOmniboxInput('https://192.168.1.1')).toMatchObject({ url: 'https://192.168.1.1/' });
    expect(parseOmniboxInput('[2001:db8::1]:443/')).toMatchObject({ url: 'https://[2001:db8::1]/' });
    expect(parseOmniboxInput('javascript:123').kind).toBe('invalid');
    expect(parseOmniboxInput('192.168.999.1').kind).toBe('invalid');
  });
});

describe('copy tracking-free link', () => {
  it('removes recognized campaigns including duplicates while retaining functional query and fragment', () => {
    expect(cleanTrackingLink('https://example.org/Article?id=172&utm_source=vk&utm_source=tg&UTM_medium=post&gclid=abc&ref=book#chapter'))
      .toBe('https://example.org/Article?id=172&ref=book#chapter');
  });
  it('does not re-encode a signed URL that contains no recognized tracking keys', () => {
    const url = 'https://example.org/file?signature=a%20b&token=x%2fy#A';
    expect(cleanTrackingLink(url)).toBe(url);
  });
  it('rejects non-web URLs and embedded credentials', () => {
    for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:password@example.org']) expect(cleanTrackingLink(url)).toBeUndefined();
  });
});
