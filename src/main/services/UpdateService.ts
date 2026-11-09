import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { app, net, shell } from 'electron';
import type { UpdateAssetInfo, UpdateCheckResult, UpdateDownloadProgress } from '../../shared/types';

export const GITHUB_REPO = 'giddammit-crypto/MonkeyBuissnesBrowser';
export const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
/** GitHub release metadata is a few kilobytes; anything larger is not trusted. */
const MAX_JSON_RESPONSE = 1024 * 1024;

let cachedGitHubToken: string | null | undefined = undefined;

/**
 * Resolves a GitHub token if available in the environment or via the GitHub CLI.
 * Authenticated requests have a 5,000 req/hr rate limit and avoid 503/504 gateway throttling.
 */
export function getGitHubToken(): string | undefined {
  if (cachedGitHubToken !== undefined) {
    return cachedGitHubToken || undefined;
  }

  const envToken =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.VINT_GITHUB_TOKEN?.trim();

  if (envToken) {
    cachedGitHubToken = envToken;
    return envToken;
  }

  // No subprocess here: `getGitHubToken` runs on the update-check path and must
  // never block the main process. The GitHub CLI is consulted asynchronously by
  // `resolveGitHubToken`, and only when the API actually asks for credentials.
  cachedGitHubToken = null;
  return undefined;
}

let pendingGhToken: Promise<string | undefined> | undefined;

/**
 * Resolves a token, falling back to the GitHub CLI without blocking the event
 * loop. Called on rate-limit responses (403/429) and on the first 5xx retry.
 */
export function resolveGitHubToken(): Promise<string | undefined> {
  const envToken = getGitHubToken();
  if (envToken) return Promise.resolve(envToken);
  pendingGhToken ??= new Promise<string | undefined>((resolve) => {
    try {
      // Imported lazily so the module keeps working when the CLI is absent.
      const cp = require('node:child_process') as typeof import('node:child_process');
      cp.execFile('gh', ['auth', 'token'], { timeout: 1500, windowsHide: true }, (error, stdout) => {
        const token = !error && typeof stdout === 'string' ? stdout.trim() : '';
        if (token.length > 8) {
          cachedGitHubToken = token;
          resolve(token);
          return;
        }
        resolve(undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
  return pendingGhToken;
}

export function clearCachedGitHubToken(): void {
  cachedGitHubToken = undefined;
  pendingGhToken = undefined;
}

/**
 * Formats raw HTTP status codes from GitHub API into actionable, friendly Russian explanations.
 */
export function formatGitHubError(statusCode: number, statusText?: string): string {
  switch (statusCode) {
    case 503:
      return 'Сервер GitHub временно перегружен или недоступен (статус 503 Service Unavailable). Попробуйте повторить попытку через пару минут.';
    case 504:
      return 'Время ожидания ответа шлюза GitHub истекло (статус 504 Gateway Timeout). Проверьте интернет-соединение или повторите через минуту.';
    case 502:
      return 'Ошибка шлюза GitHub (статус 502 Bad Gateway). Сервер обновлений временно не отвечает.';
    case 429:
      return 'Превышен лимит запросов к GitHub API (статус 429 Too Many Requests). Попробуйте чуть позже.';
    case 404:
      return 'Релизы браузера soulm8te в репозитории не найдены (статус 404 Not Found).';
    case 403:
      return 'Доступ к GitHub API ограничен (статус 403 Forbidden). Возможно, превышен лимит анонимных обращений.';
    default:
      return `GitHub API вернул статус ${statusCode}${statusText ? ` (${statusText})` : ''}`;
  }
}

function isRetryableStatusCode(code?: number): boolean {
  return code === 429 || code === 502 || code === 503 || code === 504;
}

function isRetryableError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'esockettimedout' ||
    code === 'eai_again' ||
    code === 'enotfound' ||
    code === 'econnrefused' ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('502') ||
    msg.includes('429')
  );
}

const TRUSTED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

function isTrustedUpdateUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && TRUSTED_UPDATE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isSafeDownloadFilename(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' &&
    path.basename(value) === value && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeSha256(value?: string): string | undefined {
  const digest = value?.trim().replace(/^sha256:/i, '').toLowerCase();
  return digest && /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
}

/**
 * Compare two semver version strings (e.g. "v0.9.1" vs "0.9.0").
 * Returns true if remoteVersion is strictly newer than currentVersion.
 */
export function isNewerVersion(remoteVersion: string, currentVersion: string): boolean {
  if (!remoteVersion || !currentVersion) return false;

  const clean = (ver: string): number[] => {
    const stripped = ver.trim().replace(/^[vV]/, '').split(/[-+]/)[0];
    return stripped.split('.').map((part) => {
      const num = parseInt(part, 10);
      return Number.isFinite(num) ? num : 0;
    });
  };

  const remote = clean(remoteVersion);
  const current = clean(currentVersion);
  const maxLen = Math.max(remote.length, current.length, 3);

  for (let i = 0; i < maxLen; i++) {
    const r = remote[i] ?? 0;
    const c = current[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

/**
 * Pick the best matching release asset for the current OS and architecture.
 * When inAppUpdate is true (default in UpdateService.checkForUpdates), an installed browser
 * prioritizes updated file archives (.tar.gz / .zip) or portable executables (.AppImage) over .deb.
 * When inAppUpdate is false (default for pickRecommendedAsset without 4th argument),
 * backwards compatibility is preserved and .deb takes precedence for initial installations on Linux.
 */
export function pickRecommendedAsset(
  assets: UpdateAssetInfo[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  inAppUpdate: boolean = false
): UpdateAssetInfo | undefined {
  if (!assets || assets.length === 0) return undefined;

  const isAmd64 = arch === 'x64' || arch === 'amd64';
  const isArm64 = arch === 'arm64' || arch === 'aarch64';

  const matchesArch = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (isAmd64) return lower.includes('amd64') || lower.includes('x86_64') || lower.includes('x64') || !lower.includes('arm');
    if (isArm64) return lower.includes('arm64') || lower.includes('aarch64');
    return true;
  };

  if (platform === 'linux') {
    if (inAppUpdate) {
      // 1. First priority for installed browser: Archive of updated files (.tar.gz, .tgz, .tar.xz, .zip)
      const archiveMatch = assets.find((a) => {
        const lower = a.name.toLowerCase();
        if (!/\.(tar\.gz|tar\.xz|tgz|zip)$/i.test(lower)) return false;
        return matchesArch(lower);
      });
      if (archiveMatch) return archiveMatch;

      // 2. Second priority: Portable executable (.AppImage)
      const appImageMatch = assets.find((a) => {
        const lower = a.name.toLowerCase();
        if (!lower.endsWith('.appimage')) return false;
        return matchesArch(lower);
      });
      if (appImageMatch) return appImageMatch;

      // 3. Fallback: deb package only if neither archive nor AppImage exists
      const debMatch = assets.find((a) => {
        const lower = a.name.toLowerCase();
        if (!lower.endsWith('.deb')) return false;
        return matchesArch(lower);
      });
      if (debMatch) return debMatch;

      return assets.find((a) => /\.(tar\.gz|tar\.xz|tgz|zip|appimage|deb)$/i.test(a.name)) || assets[0];
    }

    // 1. First priority: Debian package (.deb) matching architecture
    const debMatch = assets.find((a) => {
      const lower = a.name.toLowerCase();
      if (!lower.endsWith('.deb')) return false;
      return matchesArch(lower);
    });
    if (debMatch) return debMatch;

    // 2. Second priority: AppImage
    const appImageMatch = assets.find((a) => {
      const lower = a.name.toLowerCase();
      if (!lower.endsWith('.appimage')) return false;
      return matchesArch(lower);
    });
    if (appImageMatch) return appImageMatch;

    // 3. Fallback: any .deb or .AppImage or .tar.gz
    return assets.find((a) => /\.(deb|appimage|tar\.gz|tar\.xz|tgz|zip)$/i.test(a.name)) || assets[0];
  }

  if (platform === 'win32') {
    if (inAppUpdate) {
      const zipMatch = assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
      if (zipMatch) return zipMatch;
    }
    const exeMatch = assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
    if (exeMatch) return exeMatch;
    return assets.find((a) => /\.(msi|zip)$/i.test(a.name)) || assets[0];
  }

  if (platform === 'darwin') {
    if (inAppUpdate) {
      const zipMatch = assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
      if (zipMatch) return zipMatch;
    }
    const dmgMatch = assets.find((a) => a.name.toLowerCase().endsWith('.dmg'));
    if (dmgMatch) return dmgMatch;
    return assets.find((a) => /\.zip$/i.test(a.name)) || assets[0];
  }

  return assets[0];
}

export class UpdateService {
  private lastCheck?: UpdateCheckResult;
  private downloadProgress: UpdateDownloadProgress = {
    status: 'idle',
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
  };
  private autoCheckTimer?: NodeJS.Timeout;
  private initialCheckTimer?: NodeJS.Timeout;
  private activeDownloadAbort?: () => void;
  private eventEmitter?: (event: { type: string; data: unknown }) => void;
  private autoCheckAllowed = () => true;

  constructor(eventEmitter?: (event: { type: string; data: unknown }) => void, autoCheckAllowed?: () => boolean) {
    this.eventEmitter = eventEmitter;
    if (autoCheckAllowed) this.autoCheckAllowed = autoCheckAllowed;
  }

  setEventEmitter(emitter: (event: { type: string; data: unknown }) => void): void {
    this.eventEmitter = emitter;
  }

  setAutoCheckAllowed(fn: () => boolean): void {
    this.autoCheckAllowed = fn;
  }

  getLastCheck(): UpdateCheckResult | undefined {
    return this.lastCheck;
  }

  getDownloadProgress(): UpdateDownloadProgress {
    return { ...this.downloadProgress };
  }

  async checkForUpdates(manual = false): Promise<UpdateCheckResult> {
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.3';
    try {
      const releaseData = await this.fetchLatestRelease();
      const tagName = releaseData.tag_name || '';
      const hasUpdate = isNewerVersion(tagName, currentVersion);

      const assets: UpdateAssetInfo[] = (releaseData.assets || []).map((a: any) => ({
        name: a.name || 'release-asset',
        downloadUrl: a.browser_download_url || a.url,
        size: typeof a.size === 'number' ? a.size : 0,
        contentType: a.content_type || 'application/octet-stream',
        ...(typeof a.digest === 'string' ? { sha256: a.digest } : {}),
      }));

      const recommendedAsset = pickRecommendedAsset(assets, process.platform, process.arch, true);

      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion: tagName.replace(/^[vV]/, '') || tagName,
        hasUpdate,
        releaseName: releaseData.name || tagName,
        releaseNotes: releaseData.body || '',
        publishedAt: releaseData.published_at,
        htmlUrl: releaseData.html_url || `https://github.com/${GITHUB_REPO}/releases`,
        assets,
        recommendedAsset,
        checkedAt: Date.now(),
      };

      this.lastCheck = result;

      if (hasUpdate) {
        this.eventEmitter?.({ type: 'update-available', data: result });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fallbackResult: UpdateCheckResult = {
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        assets: [],
        checkedAt: Date.now(),
        error: `Не удалось проверить обновления: ${errorMessage}`,
        htmlUrl: `https://github.com/${GITHUB_REPO}/releases`,
      };
      this.lastCheck = fallbackResult;
      return fallbackResult;
    }
  }

  private async fetchLatestRelease(): Promise<any> {
    try {
      return await this.httpGetJson(GITHUB_API_URL);
    } catch (err) {
      // If /releases/latest returns 404 or fails, try first item from /releases list
      try {
        const list = await this.httpGetJson(GITHUB_RELEASES_URL);
        if (Array.isArray(list) && list.length > 0) {
          return list[0];
        }
      } catch {
        // Continue to web redirect fallback
      }

      // Web HTML / Redirect fallback:
      // If GitHub API is degraded or throttled (503/504), resolve latest tag from public releases redirect
      try {
        const fallbackRelease = await this.resolveReleaseFromWebRedirect();
        if (fallbackRelease) {
          return fallbackRelease;
        }
      } catch {
        // Ignore fallback error
      }

      throw err;
    }
  }

  /**
   * Fallback: If api.github.com is degraded or rate-throttled,
   * resolve the latest release tag from the public GitHub releases redirect.
   */
  private async resolveReleaseFromWebRedirect(): Promise<any | null> {
    const webLatestUrl = `https://github.com/${GITHUB_REPO}/releases/latest`;
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.3';

    if (typeof net?.fetch === 'function') {
      try {
        const res = await net.fetch(webLatestUrl, {
          method: 'HEAD',
          redirect: 'manual',
          headers: {
            'User-Agent': `soulm8te-browser/${currentVersion}`,
          },
        });
        const loc = res.headers.get('location') || res.url;
        const tagMatch = loc && loc.match(/\/releases\/tag\/(v?[0-9][a-zA-Z0-9._+-]*)/);
        if (tagMatch) {
          return this.synthesizeReleaseFromTag(tagMatch[1]);
        }
      } catch {
        // Fall through
      }
    }

    return new Promise((resolve) => {
      try {
        const parsed = new URL(webLatestUrl);
        const req = https.request(
          {
            hostname: parsed.hostname,
            path: parsed.pathname,
            method: 'HEAD',
            headers: {
              'User-Agent': `soulm8te-browser/${currentVersion}`,
            },
            timeout: 8000,
          },
          (res) => {
            const loc = res.headers.location;
            if (loc) {
              const tagMatch = loc.match(/\/releases\/tag\/(v?[0-9][a-zA-Z0-9._+-]*)/);
              if (tagMatch) {
                resolve(this.synthesizeReleaseFromTag(tagMatch[1]));
                return;
              }
            }
            resolve(null);
          }
        );
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  private synthesizeReleaseFromTag(tagName: string): any {
    const cleanVer = tagName.replace(/^[vV]/, '');
    return {
      tag_name: tagName,
      name: `soulm8te ${cleanVer}`,
      html_url: `https://github.com/${GITHUB_REPO}/releases/tag/${tagName}`,
      published_at: new Date().toISOString(),
      body: `Релиз soulm8te ${cleanVer} опубликован на GitHub.`,
      assets: [
        {
          name: `soulm8te-${cleanVer}-linux-x64.tar.gz`,
          browser_download_url: `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/soulm8te-${cleanVer}-linux-x64.tar.gz`,
          size: 0,
          content_type: 'application/gzip',
        },
        {
          name: `soulm8te-${cleanVer}-linux-amd64.deb`,
          browser_download_url: `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/soulm8te-${cleanVer}-linux-amd64.deb`,
          size: 0,
          content_type: 'application/x-debian-package',
        },
        {
          name: `soulm8te-${cleanVer}-x86_64.AppImage`,
          browser_download_url: `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/soulm8te-${cleanVer}-x86_64.AppImage`,
          size: 0,
          content_type: 'application/x-executable',
        },
      ],
    };
  }

  private async httpGetJson(urlStr: string, retries = 2, delayMs = 1000): Promise<any> {
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.3';
    const headers: Record<string, string> = {
      'User-Agent': `soulm8te-browser/${currentVersion}`,
      'Accept': 'application/vnd.github.v3+json',
    };
    const token = getGitHubToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 1. In Electron main process: Use Chromium's net.fetch for native proxy, HTTP/2 and modern TLS
    if (typeof net?.fetch === 'function') {
      try {
        const res = await net.fetch(urlStr, {
          method: 'GET',
          headers,
        });

        // Redirect handling (3xx)
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (loc) {
            const nextUrl = new URL(loc, urlStr).toString();
            return await this.httpGetJson(nextUrl, retries, delayMs);
          }
        }

        if (res.status >= 200 && res.status < 300) {
          const text = await res.text();
          if (text.length > MAX_JSON_RESPONSE) throw new Error('Ответ GitHub API слишком большой');
          try {
            return JSON.parse(text);
          } catch {
            throw new Error('Некорректный JSON в ответе GitHub API');
          }
        }

        // Rate limiting: a token lifts the 60 req/h anonymous budget, so ask the
        // GitHub CLI for one (async) and retry once with credentials.
        if ((res.status === 403 || res.status === 429) && retries > 0 && !headers['Authorization']) {
          const token = await resolveGitHubToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            return await this.httpGetJson(urlStr, retries - 1, delayMs * 1.5);
          }
        }

        // Retry on 502, 503, 504, 429
        if (isRetryableStatusCode(res.status) && retries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          return await this.httpGetJson(urlStr, retries - 1, delayMs * 1.5);
        }

        throw new Error(formatGitHubError(res.status, res.statusText));
      } catch (err: any) {
        if (retries > 0 && isRetryableError(err)) {
          await new Promise((r) => setTimeout(r, delayMs));
          return await this.httpGetJson(urlStr, retries - 1, delayMs * 1.5);
        }
        if (err.message && (err.message.includes('GitHub') || err.message.includes('JSON'))) {
          throw err;
        }
        throw new Error(`Сетевая ошибка при обращении к GitHub: ${err.message || 'Error'}`);
      }
    }

    // 2. Fallback for Node environment / Vitest unit tests
    return new Promise((resolve, reject) => {
      const options = {
        headers,
        timeout: 15000,
      };

      const req = https.get(urlStr, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          this.httpGetJson(nextUrl, retries, delayMs).then(resolve, reject);
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          if (isRetryableStatusCode(res.statusCode) && retries > 0) {
            setTimeout(() => {
              this.httpGetJson(urlStr, retries - 1, delayMs * 1.5).then(resolve, reject);
            }, delayMs);
            return;
          }
          reject(new Error(formatGitHubError(res.statusCode, res.statusMessage)));
          return;
        }

        let body = '';
        let tooLarge = false;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (tooLarge) return;
          body += chunk;
          if (body.length > MAX_JSON_RESPONSE) {
            tooLarge = true;
            body = '';
            res.destroy();
            reject(new Error('Ответ GitHub API слишком большой'));
          }
        });
        res.on('end', () => {
          if (tooLarge) return;
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Некорректный JSON в ответе GitHub API'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        if (retries > 0) {
          setTimeout(() => {
            this.httpGetJson(urlStr, retries - 1, delayMs * 1.5).then(resolve, reject);
          }, delayMs);
        } else {
          reject(new Error(formatGitHubError(504, 'Gateway Timeout')));
        }
      });

      req.on('error', (err) => {
        if (retries > 0 && isRetryableError(err)) {
          setTimeout(() => {
            this.httpGetJson(urlStr, retries - 1, delayMs * 1.5).then(resolve, reject);
          }, delayMs);
        } else {
          reject(new Error(`Сетевая ошибка при обращении к GitHub: ${err.message}`));
        }
      });
    });
  }

  async downloadUpdate(assetUrl?: string, customFilename?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
    let url = assetUrl;
    let filename = customFilename;
    let expectedSha256: string | undefined;

    if (!url) {
      const asset = this.lastCheck?.recommendedAsset || this.lastCheck?.assets?.[0];
      if (!asset) {
        return { success: false, error: 'Файл для обновления не найден' };
      }
      url = asset.downloadUrl;
      if (!filename) filename = asset.name;
      expectedSha256 = normalizeSha256(asset.sha256);
    } else {
      expectedSha256 = normalizeSha256(this.lastCheck?.assets?.find((asset) => asset.downloadUrl === url)?.sha256);
    }

    if (!filename) {
      try {
        filename = path.basename(new URL(url).pathname);
      } catch {
        filename = 'soulm8te-update';
      }
    }

    if (!isTrustedUpdateUrl(url)) {
      return { success: false, error: 'Разрешены только защищённые загрузки из GitHub Releases' };
    }
    if (!filename || !isSafeDownloadFilename(filename)) {
      return { success: false, error: 'Некорректное имя файла обновления' };
    }

    const downloadDir = app?.getPath ? app.getPath('downloads') : path.join(process.env.HOME || '/tmp', 'Downloads');
    if (!fs.existsSync(downloadDir)) {
      try { fs.mkdirSync(downloadDir, { recursive: true }); } catch {}
    }

    const targetPath = path.join(downloadDir, filename);

    this.downloadProgress = {
      status: 'downloading',
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      savePath: targetPath,
    };
    this.emitProgress();

    return new Promise((resolve) => {
      this.streamDownload(url!, targetPath, 5, (err, savedFile) => {
        if (err) {
          this.downloadProgress = {
            status: 'error',
            percent: 0,
            transferredBytes: 0,
            totalBytes: 0,
            error: err.message,
          };
          this.emitProgress();
          resolve({ success: false, error: err.message });
          return;
        }

        // On Linux: ensure executable bit if AppImage
        if (process.platform === 'linux' && savedFile.toLowerCase().endsWith('.appimage')) {
          try {
            fs.chmodSync(savedFile, 0o755);
          } catch {}
        }

        this.downloadProgress = {
          status: 'completed',
          percent: 100,
          transferredBytes: this.downloadProgress.totalBytes || 1,
          totalBytes: this.downloadProgress.totalBytes || 1,
          savePath: savedFile,
        };
        this.emitProgress();
        resolve({ success: true, filePath: savedFile });
      }, expectedSha256);
    });
  }

  private streamDownload(urlStr: string, destPath: string, maxRedirects: number, callback: (err: Error | null, path: string) => void, expectedSha256?: string): void {
    if (maxRedirects <= 0) {
      callback(new Error('Слишком много перенаправлений при скачивании'), destPath);
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      callback(new Error('Некорректный URL для скачивания'), destPath);
      return;
    }

    if (!isTrustedUpdateUrl(parsedUrl.toString())) {
      callback(new Error('Небезопасный адрес загрузки обновления'), destPath);
      return;
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.3';

    const req = client.get(urlStr, {
      headers: {
        'User-Agent': `soulm8te-browser/${currentVersion}`,
        'Accept': 'application/octet-stream',
      },
    }, (res) => {
      // Redirect handling
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl: string;
        try {
          nextUrl = new URL(res.headers.location, urlStr).toString();
        } catch {
          res.resume();
          callback(new Error('Некорректное перенаправление при скачивании'), destPath);
          return;
        }
        if (!isTrustedUpdateUrl(nextUrl)) {
          res.resume();
          callback(new Error('Перенаправление на недоверенный адрес заблокировано'), destPath);
          return;
        }
        this.streamDownload(nextUrl, destPath, maxRedirects - 1, callback, expectedSha256);
        return;
      }

      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        callback(new Error(`Сервер вернул ошибку ${res.statusCode} при скачивании`), destPath);
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let transferred = 0;
      let lastReport = 0;

      const fileStream = fs.createWriteStream(destPath);
      const digest = expectedSha256 ? crypto.createHash('sha256') : undefined;

      this.activeDownloadAbort = () => {
        req.destroy();
        fileStream.close();
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
      };

      res.on('data', (chunk) => {
        digest?.update(chunk);
        transferred += chunk.length;
        const now = Date.now();
        if (now - lastReport > 200 || transferred === totalBytes) {
          lastReport = now;
          const percent = totalBytes > 0 ? Math.min(100, Math.round((transferred / totalBytes) * 100)) : 0;
          this.downloadProgress = {
            status: 'downloading',
            percent,
            transferredBytes: transferred,
            totalBytes,
            savePath: destPath,
          };
          this.emitProgress();
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          this.activeDownloadAbort = undefined;
          if (expectedSha256 && digest?.digest('hex') !== expectedSha256) {
            try { fs.unlinkSync(destPath); } catch {}
            callback(new Error('Контрольная сумма обновления не совпадает'), destPath);
            return;
          }
          callback(null, destPath);
        });
      });

      fileStream.on('error', (err) => {
        this.activeDownloadAbort = undefined;
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        callback(err, destPath);
      });
    });

    req.on('error', (err) => {
      this.activeDownloadAbort = undefined;
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
      callback(err, destPath);
    });
  }

  cancelDownload(): void {
    if (this.activeDownloadAbort) {
      this.activeDownloadAbort();
      this.activeDownloadAbort = undefined;
      this.downloadProgress = {
        status: 'idle',
        percent: 0,
        transferredBytes: 0,
        totalBytes: 0,
      };
      this.emitProgress();
    }
  }

  async openDownloadedUpdate(filePath: string): Promise<boolean> {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
      const downloads = app?.getPath ? app.getPath('downloads') : path.join(process.env.HOME || '/tmp', 'Downloads');
      const root = fs.realpathSync(downloads);
      const target = fs.realpathSync(filePath);
      const relative = path.relative(root, target);
      const insideDownloads = relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      if (!insideDownloads) return false;
      // On Linux/Mac/Windows, open with system default handler or show in folder
      const result = await shell.openPath(filePath);
      if (result) {
        // If openPath returned an error string, reveal it in file manager as fallback
        shell.showItemInFolder(filePath);
      }
      return true;
    } catch {
      try {
        shell.showItemInFolder(filePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  startAutoCheckTimer(): void {
    this.stopAutoCheckTimer();

    // Initial check after 15 seconds of startup
    this.initialCheckTimer = setTimeout(() => {
      if (this.autoCheckAllowed()) {
        void this.checkForUpdates(false).catch(() => undefined);
      }
    }, 15000);
    this.initialCheckTimer.unref();

    // Recurring check every 4 hours
    this.autoCheckTimer = setInterval(() => {
      if (this.autoCheckAllowed()) {
        void this.checkForUpdates(false).catch(() => undefined);
      }
    }, 4 * 60 * 60 * 1000);
    this.autoCheckTimer.unref();
  }

  stopAutoCheckTimer(): void {
    if (this.initialCheckTimer) {
      clearTimeout(this.initialCheckTimer);
      this.initialCheckTimer = undefined;
    }
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = undefined;
    }
  }

  private emitProgress(): void {
    this.eventEmitter?.({
      type: 'update-download-progress',
      data: { ...this.downloadProgress },
    });
  }
}
