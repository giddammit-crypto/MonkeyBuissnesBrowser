import { describe, expect, it } from 'vitest';
import { FilterEngine } from '../../src/services/adblock/FilterEngine';

describe('FilterEngine', () => {
  it('blocks known advertising and tracking subresources', () => {
    const engine = new FilterEngine();
    expect(engine.shouldBlock('https://ads.example.test/tracking/pixel.gif', 'image')).toBe(true);
    expect(engine.shouldBlock('https://example.com/article', 'mainFrame')).toBe(false);
    expect(engine.stats().blockedTotal).toBe(1);
  });

  it('allows disabling the engine', () => {
    const engine = new FilterEngine();
    engine.setEnabled(false);
    expect(engine.shouldBlock('https://doubleclick.net/ads.js', 'script')).toBe(false);
  });
});
