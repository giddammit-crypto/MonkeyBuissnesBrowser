import { describe, expect, it } from 'vitest';
import { FilterEngine } from '../../src/services/adblock/FilterEngine';

describe('FilterEngine', () => {
  it('blocks known advertising and tracking subresources', () => {
    const engine = new FilterEngine();
    expect(engine.shouldBlock('https://ads.example.test/tracking/pixel.gif', 'image')).toBe(true);
    expect(engine.shouldBlock('https://example.com/article', 'mainFrame')).toBe(false);
    expect(engine.stats().blockedTotal).toBe(1);
  });

  it('blocks iframe subFrame ads and regional Russian/global ad networks', () => {
    const engine = new FilterEngine();
    expect(engine.shouldBlock('https://an.yandex.ru/count/123', 'subFrame')).toBe(true);
    expect(engine.shouldBlock('https://ads.vk.com/partner.js', 'script')).toBe(true);
    expect(engine.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script')).toBe(true);
    expect(engine.shouldBlock('https://criteo.net/tag.js', 'script')).toBe(true);
    // Main frame navigation should never be cancelled
    expect(engine.shouldBlock('https://yandex.ru/', 'mainFrame')).toBe(false);
  });
});

