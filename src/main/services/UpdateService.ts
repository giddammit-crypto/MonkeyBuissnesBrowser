import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { app, shell } from 'electron';
import type { UpdateAssetInfo, UpdateCheckResult, UpdateDownloadProgress } from '../../shared/types';

export const GITHUB_REPO = 'giddammit-crypto/MonkeyBuissnesBrowser';
export const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

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
 */
export function pickRecommendedAsset(assets: UpdateAssetInfo[], platform: NodeJS.Platform = process.platform, arch: string = process.arch): UpdateAssetInfo | undefined {
  if (!assets || assets.length === 0) return undefined;

  const isAmd64 = arch === 'x64' || arch === 'amd64';
  const isArm64 = arch === 'arm64';

  if (platform === 'linux') {
    // 1. First priority: Debian package (.deb) matching architecture
    const debMatch = assets.find((a) => {
      const lower = a.name.toLowerCase();
      if (!lower.endsWith('.deb')) return false;
      if (isAmd64) return lower.includes('amd64') || lower.includes('x86_64') || !lower.includes('arm');
      if (isArm64) return lower.includes('arm64') || lower.includes('aarch64');
      return true;
    });
    if (debMatch) return debMatch;

    // 2. Second priority: AppImage
    const appImageMatch = assets.find((a) => {
      const lower = a.name.toLowerCase();
      if (!lower.endsWith('.appimage')) return false;
      if (isAmd64) return lower.includes('x86_64') || lower.includes('amd64') || !lower.includes('arm');
      if (isArm64) return lower.includes('arm64');
      return true;
    });
    if (appImageMatch) return appImageMatch;

    // 3. Fallback: any .deb or .AppImage or .tar.gz
    return assets.find((a) => /\.(deb|appimage|tar\.gz)$/i.test(a.name)) || assets[0];
  }

  if (platform === 'win32') {
    const exeMatch = assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
    if (exeMatch) return exeMatch;
    return assets.find((a) => /\.(msi|zip)$/i.test(a.name)) || assets[0];
  }

  if (platform === 'darwin') {
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
    const currentVersion = app?.getVersion ? app.getVersion() : '0.9.5';
    try {
      const releaseData = await this.fetchLatestRelease();
      const tagName = releaseData.tag_name || '';
      const hasUpdate = isNewerVersion(tagName, currentVersion);

      const assets: UpdateAssetInfo[] = (releaseData.assets || []).map((a: any) => ({
        name: a.name || 'release-asset',
        downloadUrl: a.browser_download_url || a.url,
        size: typeof a.size === 'number' ? a.size : 0,
        contentType: a.content_type || 'application/octet-stream',
      }));

      const recommendedAsset = pickRecommendedAsset(assets);

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
      };
      this.lastCheck = fallbackResult;
      return fallbackResult;
    }
  }

  private async fetchLatestRelease(): Promise<any> {
    try {
      return await this.httpGetJson(GITHUB_API_URL);
    } catch (err) {
      // If /releases/latest returns 404 (e.g. no release tagged latest), try first item from /releases
      const list = await this.httpGetJson(GITHUB_RELEASES_URL);
      if (Array.isArray(list) && list.length > 0) {
        return list[0];
      }
      throw err;
    }
  }

  private httpGetJson(urlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const currentVersion = app?.getVersion ? app.getVersion() : '0.9.5';
      const options = {
        headers: {
          'User-Agent': `soulm8te-browser/${currentVersion}`,
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 15000,
      };

      const req = https.get(urlStr, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpGetJson(res.headers.location).then(resolve, reject);
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`GitHub API вернул статус ${res.statusCode} (${res.statusMessage || 'Error'})`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Некорректный JSON в ответе GitHub API'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Время ожидания ответа GitHub API истекло'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  async downloadUpdate(assetUrl?: string, customFilename?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
    let url = assetUrl;
    let filename = customFilename;

    if (!url) {
      const asset = this.lastCheck?.recommendedAsset || this.lastCheck?.assets?.[0];
      if (!asset) {
        return { success: false, error: 'Файл для обновления не найден' };
      }
      url = asset.downloadUrl;
      if (!filename) filename = asset.name;
    }

    if (!filename) {
      try {
        filename = path.basename(new URL(url).pathname);
      } catch {
        filename = 'soulm8te-update';
      }
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
      });
    });
  }

  private streamDownload(urlStr: string, destPath: string, maxRedirects: number, callback: (err: Error | null, path: string) => void): void {
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

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const currentVersion = app?.getVersion ? app.getVersion() : '0.9.5';

    const req = client.get(urlStr, {
      headers: {
        'User-Agent': `soulm8te-browser/${currentVersion}`,
        'Accept': 'application/octet-stream',
      },
    }, (res) => {
      // Redirect handling
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        this.streamDownload(nextUrl, destPath, maxRedirects - 1, callback);
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

      this.activeDownloadAbort = () => {
        req.destroy();
        fileStream.close();
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
      };

      res.on('data', (chunk) => {
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
