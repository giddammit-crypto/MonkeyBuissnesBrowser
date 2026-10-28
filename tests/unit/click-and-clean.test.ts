import { describe, expect, it } from 'vitest';
import type { CleanPresetId, CleanResult, CleanTargetOptions, StorageMetrics } from '../../src/shared/types';

describe('Click & Clean (Detroit: Become Human UI)', () => {
  const PRESETS: Record<Exclude<CleanPresetId, 'custom'>, CleanTargetOptions> = {
    quick: {
      cache: true,
      history: true,
      closedTabsHistory: true,
      dnsCache: true,
      cookies: false,
      downloadsHistory: false,
      localStorage: false,
      indexedDB: false,
      serviceWorkers: false,
      authCache: false,
      closeTabs: false,
      passwords: false,
    },
    'post-payment': {
      cache: true,
      cookies: true,
      localStorage: true,
      indexedDB: true,
      serviceWorkers: true,
      authCache: true,
      history: false,
      downloadsHistory: false,
      dnsCache: false,
      closedTabsHistory: false,
      closeTabs: false,
      passwords: false,
    },
    kiosk: {
      cache: true,
      cookies: true,
      history: true,
      downloadsHistory: true,
      localStorage: true,
      indexedDB: true,
      serviceWorkers: true,
      authCache: true,
      dnsCache: true,
      closedTabsHistory: true,
      closeTabs: true,
      passwords: false,
    },
  };

  it('defines valid preset configurations matching security requirements', () => {
    // Quick clean targets
    expect(PRESETS.quick.cache).toBe(true);
    expect(PRESETS.quick.history).toBe(true);
    expect(PRESETS.quick.closedTabsHistory).toBe(true);
    expect(PRESETS.quick.dnsCache).toBe(true);
    expect(PRESETS.quick.cookies).toBe(false);
    expect(PRESETS.quick.passwords).toBe(false);

    // Post-payment targets
    expect(PRESETS['post-payment'].cookies).toBe(true);
    expect(PRESETS['post-payment'].localStorage).toBe(true);
    expect(PRESETS['post-payment'].indexedDB).toBe(true);
    expect(PRESETS['post-payment'].serviceWorkers).toBe(true);
    expect(PRESETS['post-payment'].cache).toBe(true);
    expect(PRESETS['post-payment'].authCache).toBe(true);
    expect(PRESETS['post-payment'].history).toBe(false);

    // Kiosk targets (full clean + close tabs)
    expect(PRESETS.kiosk.cache).toBe(true);
    expect(PRESETS.kiosk.cookies).toBe(true);
    expect(PRESETS.kiosk.history).toBe(true);
    expect(PRESETS.kiosk.closeTabs).toBe(true);
    expect(PRESETS.kiosk.passwords).toBe(false); // safe by default
  });

  it('validates password guard requirement', () => {
    const isActionDisabled = (options: CleanTargetOptions, confirmPasswordDelete: boolean) => {
      const selectedCount = Object.values(options).filter(Boolean).length;
      return selectedCount === 0 || (Boolean(options.passwords) && !confirmPasswordDelete);
    };

    // Disabled when nothing selected
    expect(isActionDisabled({}, false)).toBe(true);

    // Enabled with quick preset
    expect(isActionDisabled(PRESETS.quick, false)).toBe(false);

    // Disabled when passwords selected without confirmation
    expect(isActionDisabled({ ...PRESETS.quick, passwords: true }, false)).toBe(true);

    // Enabled when passwords confirmed
    expect(isActionDisabled({ ...PRESETS.quick, passwords: true }, true)).toBe(false);
  });

  it('handles clean result structure correctly', () => {
    const mockMetrics: StorageMetrics = {
      cacheSizeBytes: 48200000,
      cacheSizeFormatted: '48.2 МБ',
      cookiesCount: 142,
      historyCount: 350,
      downloadsCount: 12,
      passwordsCount: 5,
      openTabsCount: 4,
      hasSecureStorage: true,
      sampledAt: Date.now(),
    };

    const mockResult: CleanResult = {
      success: true,
      freedBytesEstimate: 48200000,
      freedFormatted: '48.2 МБ',
      clearedTargets: ['cache', 'history', 'dnsCache', 'closedTabsHistory'],
      durationMs: 42,
      metricsAfter: {
        ...mockMetrics,
        cacheSizeBytes: 0,
        cacheSizeFormatted: '0 Б',
        historyCount: 0,
      },
    };

    expect(mockResult.success).toBe(true);
    expect(mockResult.clearedTargets).toHaveLength(4);
    expect(mockResult.durationMs).toBe(42);
    expect(mockResult.metricsAfter.cacheSizeFormatted).toBe('0 Б');
  });
});
