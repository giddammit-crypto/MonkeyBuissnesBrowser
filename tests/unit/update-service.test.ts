import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isNewerVersion,
  pickRecommendedAsset,
  UpdateService,
  formatGitHubError,
  getGitHubToken,
  clearCachedGitHubToken,
  GITHUB_REPO,
} from '../../src/main/services/UpdateService';
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

  describe('in-app update asset selection (inAppUpdate = true)', () => {
    const assetsWithArchive: UpdateAssetInfo[] = [
      { name: 'soulm8te-0.9.1-linux-amd64.deb', downloadUrl: 'https://example.com/soulm8te.deb', size: 1000000, contentType: 'application/x-debian-package' },
      { name: 'soulm8te-0.9.1-x86_64.AppImage', downloadUrl: 'https://example.com/soulm8te.AppImage', size: 1200000, contentType: 'application/x-executable' },
      { name: 'soulm8te-0.9.1-linux-x64.tar.gz', downloadUrl: 'https://example.com/soulm8te.tar.gz', size: 950000, contentType: 'application/gzip' },
      { name: 'soulm8te-setup-0.9.1.exe', downloadUrl: 'https://example.com/soulm8te.exe', size: 900000, contentType: 'application/x-msdos-program' },
    ];

    it('prioritizes archive (.tar.gz) over deb and AppImage for installed browser on linux', () => {
      const picked = pickRecommendedAsset(assetsWithArchive, 'linux', 'x64', true);
      expect(picked).toBeDefined();
      expect(picked?.name).toBe('soulm8te-0.9.1-linux-x64.tar.gz');
    });

    it('prioritizes AppImage over deb for installed browser when archive is not present', () => {
      // assets list only has .deb and .AppImage for Linux
      const picked = pickRecommendedAsset(assets, 'linux', 'x64', true);
      expect(picked).toBeDefined();
      expect(picked?.name).toBe('soulm8te-0.9.1-x86_64.AppImage');
    });

    it('falls back to deb only when neither archive nor AppImage is present for inAppUpdate', () => {
      const onlyDebAssets: UpdateAssetInfo[] = [
        { name: 'soulm8te-0.9.1-linux-amd64.deb', downloadUrl: 'https://example.com/soulm8te.deb', size: 1000000, contentType: 'application/x-debian-package' },
      ];
      const picked = pickRecommendedAsset(onlyDebAssets, 'linux', 'x64', true);
      expect(picked).toBeDefined();
      expect(picked?.name).toBe('soulm8te-0.9.1-linux-amd64.deb');
    });

    it('preserves backward compatibility when 4th argument is omitted', () => {
      const picked = pickRecommendedAsset(assetsWithArchive, 'linux', 'x64');
      expect(picked?.name).toBe('soulm8te-0.9.1-linux-amd64.deb');
    });

    it('matches arm64 architecture correctly for linux archives when inAppUpdate is true', () => {
      const multiArchAssets: UpdateAssetInfo[] = [
        { name: 'soulm8te-1.0.2-linux-x64.tar.gz', downloadUrl: 'https://example.com/soulm8te-x64.tar.gz', size: 950000, contentType: 'application/gzip' },
        { name: 'soulm8te-1.0.2-linux-arm64.tar.gz', downloadUrl: 'https://example.com/soulm8te-arm64.tar.gz', size: 920000, contentType: 'application/gzip' },
        { name: 'soulm8te-1.0.2-linux-amd64.deb', downloadUrl: 'https://example.com/soulm8te.deb', size: 1000000, contentType: 'application/x-debian-package' },
      ];
      const picked = pickRecommendedAsset(multiArchAssets, 'linux', 'arm64', true);
      expect(picked).toBeDefined();
      expect(picked?.name).toBe('soulm8te-1.0.2-linux-arm64.tar.gz');
    });

    it('rejects arm64 archive on x64 even if arm64 is listed first in assets', () => {
      const reversedAssets: UpdateAssetInfo[] = [
        { name: 'soulm8te-1.0.2-linux-arm64.tar.gz', downloadUrl: 'https://example.com/soulm8te-arm64.tar.gz', size: 920000, contentType: 'application/gzip' },
        { name: 'soulm8te-1.0.2-linux-x64.tar.gz', downloadUrl: 'https://example.com/soulm8te-x64.tar.gz', size: 950000, contentType: 'application/gzip' },
      ];
      const picked = pickRecommendedAsset(reversedAssets, 'linux', 'x64', true);
      expect(picked).toBeDefined();
      expect(picked?.name).toBe('soulm8te-1.0.2-linux-x64.tar.gz');
    });

    it('supports alternate archive formats like .tar.xz and .tgz', () => {
      const xzAssets: UpdateAssetInfo[] = [
        { name: 'soulm8te-1.0.2-linux-x86_64.tar.xz', downloadUrl: 'https://example.com/soulm8te.tar.xz', size: 850000, contentType: 'application/x-xz' },
        { name: 'soulm8te-1.0.2-linux-amd64.deb', downloadUrl: 'https://example.com/soulm8te.deb', size: 1000000, contentType: 'application/x-debian-package' },
      ];
      const picked = pickRecommendedAsset(xzAssets, 'linux', 'x64', true);
      expect(picked?.name).toBe('soulm8te-1.0.2-linux-x86_64.tar.xz');
    });
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

  it('rejects untrusted update hosts before starting a download', async () => {
    await expect(service.downloadUpdate('https://updates.example.invalid/browser.AppImage', 'browser.AppImage'))
      .resolves.toMatchObject({ success: false });
  });

  it('rejects path traversal in update filenames', async () => {
    await expect(service.downloadUpdate('https://github.com/giddammit-crypto/MonkeyBuissnesBrowser/releases/download/v1/browser.AppImage', '../browser.AppImage'))
      .resolves.toMatchObject({ success: false });
  });

  it('provides resilient fallback error result with htmlUrl on update check error', async () => {
    // Mock fetchLatestRelease to reject
    vi.spyOn(service as any, 'fetchLatestRelease').mockRejectedValueOnce(
      new Error(formatGitHubError(503, 'Service Unavailable'))
    );

    const result = await service.checkForUpdates();
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toContain('503');
    expect(result.error).toContain('Сервер GitHub временно перегружен или недоступен');
    expect(result.htmlUrl).toBe(`https://github.com/${GITHUB_REPO}/releases`);
  });
});

describe('formatGitHubError', () => {
  it('formats HTTP 503 into actionable Russian guidance', () => {
    const msg = formatGitHubError(503, 'Service Unavailable');
    expect(msg).toContain('503');
    expect(msg).toContain('временно перегружен или недоступен');
    expect(msg).toContain('Попробуйте повторить попытку через пару минут');
  });

  it('formats HTTP 504 Gateway Timeout', () => {
    const msg = formatGitHubError(504, 'Gateway Timeout');
    expect(msg).toContain('504');
    expect(msg).toContain('Gateway Timeout');
  });

  it('formats HTTP 502 Bad Gateway', () => {
    const msg = formatGitHubError(502, 'Bad Gateway');
    expect(msg).toContain('502');
  });

  it('formats HTTP 429 rate limit errors', () => {
    const msg = formatGitHubError(429, 'Too Many Requests');
    expect(msg).toContain('429');
    expect(msg).toContain('лимит запросов');
  });

  it('formats HTTP 404 not found errors', () => {
    const msg = formatGitHubError(404, 'Not Found');
    expect(msg).toContain('404');
    expect(msg).toContain('не найдены');
  });

  it('formats HTTP 403 forbidden errors', () => {
    const msg = formatGitHubError(403, 'Forbidden');
    expect(msg).toContain('403');
    expect(msg).toContain('ограничен');
  });

  it('formats default status code', () => {
    const msg = formatGitHubError(500, 'Internal Server Error');
    expect(msg).toContain('500');
    expect(msg).toContain('Internal Server Error');
  });
});

describe('getGitHubToken', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearCachedGitHubToken();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearCachedGitHubToken();
  });

  it('reads GITHUB_TOKEN from process.env', () => {
    process.env.GITHUB_TOKEN = 'test_token_12345';
    delete process.env.GH_TOKEN;
    delete process.env.VINT_GITHUB_TOKEN;
    clearCachedGitHubToken();

    expect(getGitHubToken()).toBe('test_token_12345');
  });

  it('reads GH_TOKEN from process.env when GITHUB_TOKEN is missing', () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = 'gh_token_98765';
    delete process.env.VINT_GITHUB_TOKEN;
    clearCachedGitHubToken();

    expect(getGitHubToken()).toBe('gh_token_98765');
  });

  it('caches the token between calls until clearCachedGitHubToken is called', () => {
    process.env.GITHUB_TOKEN = 'initial_token';
    clearCachedGitHubToken();
    expect(getGitHubToken()).toBe('initial_token');

    // Change env without clearing cache
    process.env.GITHUB_TOKEN = 'changed_token';
    expect(getGitHubToken()).toBe('initial_token');

    // Clear cache
    clearCachedGitHubToken();
    expect(getGitHubToken()).toBe('changed_token');
  });
});
