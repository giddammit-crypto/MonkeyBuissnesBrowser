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

  it('allows ad requests when initiating page URL is added to exceptions', () => {
    const engine = new FilterEngine();
    engine.setExceptions(['youtube.com', 'habr.com']);
    expect(engine.getExceptions()).toEqual(['youtube.com', 'habr.com']);

    // Normally blocked ad
    expect(engine.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script')).toBe(true);

    // On YouTube (initiating page in exceptions) -> NOT blocked
    expect(engine.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script', 'https://www.youtube.com/watch?v=123')).toBe(false);
    expect(engine.shouldBlock('https://googleadservices.com/pagead/conversion.js', 'script', 'https://youtube.com/feed/subscriptions')).toBe(false);

    // On Habr (initiating page in exceptions) -> NOT blocked
    expect(engine.shouldBlock('https://an.yandex.ru/count/123', 'script', 'https://habr.com/ru/articles/12345/')).toBe(false);

    // On other site (not in exceptions) -> STILL blocked
    expect(engine.shouldBlock('https://an.yandex.ru/count/123', 'script', 'https://news.example.com/')).toBe(true);
  });
});

