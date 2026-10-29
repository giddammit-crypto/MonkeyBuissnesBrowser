import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isNewerVersion, pickRecommendedAsset, UpdateService } from '../../src/main/services/UpdateService';
import type { UpdateAssetInfo } from '../../src/shared/types';

describe('UpdateService version comparison', () => {
  it('correctly compares semantic versions', () => {
    // Newer patches
    expect(isNewerVersion('0.9.1', '0.9.0')).toBe(true);
    expect(isNewerVersion('v0.9.1', '0.9.0')).toBe(true);
    expect(isNewerVersion('0.9.10', '0.9.9')).toBe(true);

    // Newer minors
    expect(isNewerVersion('0.10.0', '0.9.5')).toBe(true);
    expect(isNewerVersion('v1.0.0', '0.9.0')).toBe(true);

    // Same versions
    expect(isNewerVersion('0.9.0', '0.9.0')).toBe(false);
    expect(isNewerVersion('v0.9.0', '0.9.0')).toBe(false);
    expect(isNewerVersion('0.9.0', 'v0.9.0')).toBe(false);

    // Older versions
    expect(isNewerVersion('0.8.1', '0.9.0')).toBe(false);
    expect(isNewerVersion('v0.7.1', '0.9.0')).toBe(false);

    // Edge cases
    expect(isNewerVersion('', '0.9.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '')).toBe(false);
    expect(isNewerVersion('invalid', '0.9.0')).toBe(false);
  });
});

describe('UpdateService pickRecommendedAsset', () => {
  const assets: UpdateAssetInfo[] = [
    { name: 'soulm8te-0.9.1-linux-amd64.deb', downloadUrl: 'https://example.com/soulm8te.deb', size: 1000000, contentType: 'application/x-debian-package' },
    { name: 'soulm8te-0.9.1-x86_64.AppImage', downloadUrl: 'https://example.com/soulm8te.AppImage', size: 1200000, contentType: 'application/x-executable' },
    { name: 'soulm8te-setup-0.9.1.exe', downloadUrl: 'https://example.com/soulm8te.exe', size: 900000, contentType: 'application/x-msdos-program' },
    { name: 'soulm8te-0.9.1.dmg', downloadUrl: 'https://example.com/soulm8te.dmg', size: 1100000, contentType: 'application/x-apple-diskimage' },
  ];

  it('picks deb package for linux on amd64', () => {
    const picked = pickRecommendedAsset(assets, 'linux', 'x64');
    expect(picked).toBeDefined();
    expect(picked?.name).toBe('soulm8te-0.9.1-linux-amd64.deb');
  });

  it('picks AppImage for linux when deb is not available', () => {
    const nonDebAssets = assets.filter((a) => !a.name.endsWith('.deb'));
    const picked = pickRecommendedAsset(nonDebAssets, 'linux', 'x64');
    expect(picked?.name).toBe('soulm8te-0.9.1-x86_64.AppImage');
  });

  it('picks exe for windows', () => {
    const picked = pickRecommendedAsset(assets, 'win32', 'x64');
    expect(picked?.name).toBe('soulm8te-setup-0.9.1.exe');
  });

  it('picks dmg for darwin (macOS)', () => {
    const picked = pickRecommendedAsset(assets, 'darwin', 'x64');
    expect(picked?.name).toBe('soulm8te-0.9.1.dmg');
  });

  it('handles empty or undefined asset lists gracefully', () => {
    expect(pickRecommendedAsset([], 'linux', 'x64')).toBeUndefined();
  });
});

describe('UpdateService check and progress lifecycle', () => {
  let service: UpdateService;
  let emittedEvents: Array<{ type: string; data: unknown }>;

  beforeEach(() => {
    emittedEvents = [];
    service = new UpdateService((ev) => emittedEvents.push(ev));
  });

  afterEach(() => {
    service.stopAutoCheckTimer();
  });

  it('initializes with idle progress', () => {
    const progress = service.getDownloadProgress();
    expect(progress.status).toBe('idle');
    expect(progress.percent).toBe(0);
  });

  it('starts and stops auto check timer without leaking timers', () => {
    service.startAutoCheckTimer();
    expect(() => service.stopAutoCheckTimer()).not.toThrow();
  });
});
