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

  it('blocks YouTube ad break and ad server requests when exceptions list is empty', () => {
    const engine = new FilterEngine();
    expect(engine.shouldBlock('https://www.youtube.com/youtubei/v1/player/ad_break', 'xhr')).toBe(true);
    expect(engine.shouldBlock('https://www.youtube.com/pagead/parallel_ad_break?ad_break_id=123', 'xhr')).toBe(true);
    expect(engine.shouldBlock('https://ad.youtube.com/pagead/ad_unit', 'script')).toBe(true);
    expect(engine.shouldBlock('https://www.youtube.com/api/stats/qoe?adformat=1_2_3', 'xhr')).toBe(true);
    // Regular video playback request should NOT be blocked
    expect(engine.shouldBlock('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'mainFrame')).toBe(false);
  });
  it('does not treat query values or fragments as requested advertising paths', () => {
    const engine = new FilterEngine();
    for (const type of ['image', 'script', 'stylesheet', 'font']) {
      expect(engine.shouldBlock('https://www.youtube.com/s/desktop/icons.svg?next=/ads/', type)).toBe(false);
      expect(engine.shouldBlock('https://www.youtube.com/s/player/base.js?next=https://ads.test/pagead/file', type)).toBe(false);
      expect(engine.shouldBlock('https://www.youtube.com/s/desktop/icons.svg#pixel.gif', type)).toBe(false);
    }
    expect(engine.stats().blockedTotal).toBe(0);
    expect(engine.shouldBlock('https://doubleclick.net/icons.svg?next=/safe/', 'image')).toBe(true);
    expect(engine.shouldBlock('https://example.test/ads/banner.svg?safe=1', 'image')).toBe(true);
  });

  it('matches explicit query rules only on their requested endpoint and parameter', () => {
    const engine = new FilterEngine();
    expect(engine.shouldBlock('https://www.youtube.com/api/stats/qoe?event=1&adformat=video', 'xhr')).toBe(true);
    expect(engine.shouldBlock('https://www.youtube.com/api/stats/qoe?event=1&next=adformat=video', 'xhr')).toBe(false);
    expect(engine.shouldBlock('https://www.youtube.com/api/stats/qoe?event=1', 'xhr')).toBe(false);
    expect(engine.shouldBlock('https://www.youtube.com/s/icon.svg?next=/api/stats/qoe?adformat=video', 'image')).toBe(false);
  });

});

