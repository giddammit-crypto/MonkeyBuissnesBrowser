import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import type { BrowserStores } from '../persistence/BrowserStores';
import type { PasswordStore } from '../persistence/PasswordStore';
import type {
  BookmarkEntry,
  HistoryEntry,
  ImportBrowser,
  ImportDataKind,
  ImportProfile,
  ImportReport,
} from '../../shared/types';

export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  expirationDate?: number;
  secure: boolean;
  httpOnly: boolean;
}

type CookieSink = (cookies: ImportedCookie[]) => Promise<number>;
type Row = Record<string, unknown>;

const browserLabels: Record<ImportBrowser, string> = {
  chrome: 'Google Chrome',
  yandex: 'Яндекс Браузер',
  firefox: 'Firefox',
};

const dataKinds: ImportDataKind[] = ['history', 'bookmarks', 'cookies', 'passwords'];

function emptyCounts(): Record<ImportDataKind, number> {
  return { history: 0, bookmarks: 0, cookies: 0, passwords: 0 };
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function chromiumTime(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric / 1000 + Date.UTC(1601, 0, 1)) : Date.now();
}

function unixMicros(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric / 1000) : Date.now();
}

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function profileId(browser: ImportBrowser, profilePath: string): string {
  return crypto.createHash('sha256').update(`${browser}:${profilePath}`).digest('hex').slice(0, 20);
}

function safeReadJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export class BrowserDataImporter {
  private readonly profiles = new Map<string, ImportProfile>();

  constructor(
    private readonly stores: BrowserStores,
    private readonly passwords: PasswordStore,
    private readonly setCookies: CookieSink,
  ) {}

  discoverProfiles(): ImportProfile[] {
    this.profiles.clear();
    for (const root of this.chromiumRoots('chrome')) this.addChromiumProfiles('chrome', root);
    for (const root of this.chromiumRoots('yandex')) this.addChromiumProfiles('yandex', root);
    for (const root of this.firefoxRoots()) this.addFirefoxProfiles(root);
    return [...this.profiles.values()].sort((left, right) => `${left.browserLabel} ${left.profileName}`.localeCompare(`${right.browserLabel} ${right.profileName}`, 'ru'));
  }

  async import(profileId: string, requestedKinds: ImportDataKind[]): Promise<ImportReport> {
    const profile = this.findProfile(profileId);
    const report: ImportReport = {
      browser: profile.browser,
      profileName: profile.profileName,
      imported: emptyCounts(),
      skipped: emptyCounts(),
      warnings: [],
      errors: [],
    };
    const kinds = dataKinds.filter((kind) => requestedKinds.includes(kind));

    for (const kind of kinds) {
      try {
        if (!profile.available.includes(kind)) {
          report.warnings.push(`${this.label(kind)} недоступны в профиле «${profile.profileName}».`);
          continue;
        }
        if (kind === 'history') report.imported.history = await this.importHistory(profile);
        if (kind === 'bookmarks') report.imported.bookmarks = await this.importBookmarks(profile);
        if (kind === 'cookies') {
          const result = await this.importCookies(profile);
          report.imported.cookies = result.imported;
          report.skipped.cookies = result.skipped;
          report.warnings.push(...result.warnings);
        }
        if (kind === 'passwords') {
          const result = await this.importPasswords(profile);
          report.imported.passwords = result.imported;
          report.skipped.passwords = result.skipped;
          report.warnings.push(...result.warnings);
        }
      } catch (error) {
        report.errors.push(`${this.label(kind)}: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
      }
    }
    return report;
  }

  private findProfile(id: string): ImportProfile {
    if (this.profiles.size === 0) this.discoverProfiles();
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('Профиль браузера не найден. Обновите список профилей.');
    return profile;
  }

  private addChromiumProfiles(browser: Extract<ImportBrowser, 'chrome' | 'yandex'>, root: string): void {
    if (!fs.existsSync(root)) return;
    const candidates = [root, ...this.directories(root)];
    for (const profilePath of candidates) {
      const available: ImportDataKind[] = [];
      if (fs.existsSync(path.join(profilePath, 'History'))) available.push('history');
      if (fs.existsSync(path.join(profilePath, 'Bookmarks'))) available.push('bookmarks');
      if (fs.existsSync(path.join(profilePath, 'Cookies'))) available.push('cookies');
      if (fs.existsSync(path.join(profilePath, 'Login Data'))) available.push('passwords');
      if (available.length === 0) continue;
      const profileName = path.basename(profilePath) === path.basename(root) ? 'Основной профиль' : path.basename(profilePath);
      this.addProfile({ id: profileId(browser, profilePath), browser, browserLabel: browserLabels[browser], profileName, path: profilePath, available });
    }
  }

  private addFirefoxProfiles(root: string): void {
    if (!fs.existsSync(root)) return;
    for (const profilePath of this.directories(root)) {
      const available: ImportDataKind[] = [];
      if (fs.existsSync(path.join(profilePath, 'places.sqlite'))) available.push('history', 'bookmarks');
      if (fs.existsSync(path.join(profilePath, 'cookies.sqlite'))) available.push('cookies');
      if (fs.existsSync(path.join(profilePath, 'logins.json')) && fs.existsSync(path.join(profilePath, 'key4.db'))) available.push('passwords');
      if (available.length === 0) continue;
      this.addProfile({ id: profileId('firefox', profilePath), browser: 'firefox', browserLabel: browserLabels.firefox, profileName: path.basename(profilePath), path: profilePath, available: [...new Set(available)] });
    }
  }

  private addProfile(profile: ImportProfile): void {
    if (!this.profiles.has(profile.id)) this.profiles.set(profile.id, profile);
  }

  private directories(root: string): string[] {
    try {
      return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
    } catch {
      return [];
    }
  }

  private chromiumRoots(browser: Extract<ImportBrowser, 'chrome' | 'yandex'>): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
      return browser === 'chrome'
        ? [path.join(localAppData, 'Google', 'Chrome', 'User Data')]
        : [path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data')];
    }
    if (process.platform === 'darwin') {
      const appSupport = path.join(home, 'Library', 'Application Support');
      return browser === 'chrome'
        ? [path.join(appSupport, 'Google', 'Chrome')]
        : [path.join(appSupport, 'Yandex', 'YandexBrowser')];
    }
    const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    return browser === 'chrome'
      ? [path.join(config, 'google-chrome'), path.join(config, 'chromium')]
      : [path.join(config, 'yandex-browser'), path.join(config, 'Yandex', 'YandexBrowser')];
  }


  private firefoxRoots(): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') return [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles')];
    if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')];
    return [path.join(home, '.mozilla', 'firefox'), path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'mozilla', 'firefox')];
  }

  private async importHistory(profile: ImportProfile): Promise<number> {
    const rows = profile.browser === 'firefox'
      ? await this.querySqlite(path.join(profile.path, 'places.sqlite'), "SELECT url, COALESCE(title, url) AS title, last_visit_date FROM moz_places WHERE url LIKE 'http://%' OR url LIKE 'https://%' ORDER BY last_visit_date DESC LIMIT 1000")
      : await this.querySqlite(path.join(profile.path, 'History'), "SELECT url, COALESCE(title, url) AS title, last_visit_time FROM urls WHERE url LIKE 'http://%' OR url LIKE 'https://%' ORDER BY last_visit_time DESC LIMIT 1000");
    const imported: HistoryEntry[] = rows.map((row) => ({ id: crypto.randomUUID(), url: String(row.url), title: String(row.title || row.url), visitedAt: profile.browser === 'firefox' ? unixMicros(row.last_visit_date) : chromiumTime(row.last_visit_time) })).filter((item) => isHttpUrl(item.url));
    const existing = this.stores.history.get();
    const merged = uniqueByUrl([...imported, ...existing]).sort((left, right) => right.visitedAt - left.visitedAt).slice(0, 500);
    this.stores.history.set(merged);
    return imported.length;
  }

  private async importBookmarks(profile: ImportProfile): Promise<number> {
    const imported = profile.browser === 'firefox' ? await this.firefoxBookmarks(profile) : this.chromiumBookmarks(profile);
    const existing = this.stores.bookmarks.get();
    const merged = uniqueByUrl([...imported, ...existing]).slice(0, 500);
    this.stores.bookmarks.set(merged);
    return imported.length;
  }

  private chromiumBookmarks(profile: ImportProfile): BookmarkEntry[] {
    const document = safeReadJson(path.join(profile.path, 'Bookmarks')) as { roots?: Record<string, { children?: unknown[] }> } | null;
    const result: BookmarkEntry[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const item = node as { type?: string; url?: string; name?: string; date_added?: string; children?: unknown[] };
      if (item.type === 'url' && item.url && isHttpUrl(item.url)) result.push({ id: crypto.randomUUID(), url: item.url, title: item.name || item.url, createdAt: chromiumTime(item.date_added) });
      for (const child of item.children ?? []) visit(child);
    };
    for (const root of Object.values(document?.roots ?? {})) visit(root);
    return result.slice(0, 1000);
  }

  private async firefoxBookmarks(profile: ImportProfile): Promise<BookmarkEntry[]> {
    const rows = await this.querySqlite(path.join(profile.path, 'places.sqlite'), "SELECT p.url, COALESCE(b.title, p.title, p.url) AS title, b.dateAdded AS created_at FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND (p.url LIKE 'http://%' OR p.url LIKE 'https://%') ORDER BY b.dateAdded DESC LIMIT 1000");
    return rows.map((row) => ({ id: crypto.randomUUID(), url: String(row.url), title: String(row.title || row.url), createdAt: unixMicros(row.created_at) }));
  }

  private async importCookies(profile: ImportProfile): Promise<{ imported: number; skipped: number; warnings: string[] }> {
    const warnings: string[] = [];
    const cookies: ImportedCookie[] = [];
    if (profile.browser === 'firefox') {
      const rows = await this.querySqlite(path.join(profile.path, 'cookies.sqlite'), "SELECT host, name, value, path, expiry, isSecure, isHttpOnly FROM moz_cookies WHERE value IS NOT NULL AND value != '' LIMIT 2000");
      for (const row of rows) {
        const host = String(row.host);
        if (!host) continue;
        cookies.push({ url: `${Boolean(row.isSecure) ? 'https' : 'http'}://${host.replace(/^\./, '')}${String(row.path || '/')}`, name: String(row.name), value: String(row.value), domain: host, path: String(row.path || '/'), expirationDate: Number(row.expiry) > 0 ? Number(row.expiry) : undefined, secure: Boolean(row.isSecure), httpOnly: Boolean(row.isHttpOnly) });
      }
    } else {
      const rows = await this.querySqlite(path.join(profile.path, 'Cookies'), "SELECT host_key AS host, name, value, hex(encrypted_value) AS encrypted_hex, path, expires_utc, is_secure, is_httponly FROM cookies LIMIT 2000");
      const key = this.chromiumStorageKey(profile.browser);
      for (const row of rows) {
        let value = String(row.value || '');
        if (!value && row.encrypted_hex && key) value = this.decryptChromiumValue(String(row.encrypted_hex), key) ?? '';
        if (!value) continue;
        const host = String(row.host);
        cookies.push({ url: `${Boolean(row.is_secure) ? 'https' : 'http'}://${host.replace(/^\./, '')}${String(row.path || '/')}`, name: String(row.name), value, domain: host, path: String(row.path || '/'), expirationDate: Number(row.expires_utc) > 0 ? chromiumTime(row.expires_utc) / 1000 : undefined, secure: Boolean(row.is_secure), httpOnly: Boolean(row.is_httponly) });
      }
      if (!key) warnings.push('Зашифрованные cookies Chromium не импортированы: не удалось получить ключ системного хранилища.');
    }
    const imported = await this.setCookies(cookies);
    return { imported, skipped: Math.max(0, cookies.length - imported), warnings };
  }

  private async importPasswords(profile: ImportProfile): Promise<{ imported: number; skipped: number; warnings: string[] }> {
    if (!this.passwords.canPersistSecurely()) return { imported: 0, skipped: 1, warnings: ['Пароли не сохранены: в системе недоступно защищённое хранилище Electron.'] };
    if (profile.browser === 'firefox') return { imported: 0, skipped: 1, warnings: ['Пароли Firefox защищены NSS-ключом профиля и пока импортируются только через официальный экспорт CSV.'] };
    const rows = await this.querySqlite(path.join(profile.path, 'Login Data'), "SELECT origin_url, username_value, hex(password_value) AS password_hex FROM logins WHERE origin_url LIKE 'http://%' OR origin_url LIKE 'https://%' LIMIT 1000");
    const key = this.chromiumStorageKey(profile.browser);
    if (!key) return { imported: 0, skipped: rows.length, warnings: ['Пароли Chromium не импортированы: не удалось получить ключ системного хранилища.'] };
    const records = rows.map((row) => ({ origin: String(row.origin_url), username: String(row.username_value || ''), password: this.decryptChromiumValue(String(row.password_hex || ''), key) ?? '', browser: profile.browser })).filter((item) => item.username && item.password);
    const imported = this.passwords.addMany(records);
    return { imported, skipped: Math.max(0, rows.length - imported), warnings: imported < rows.length ? ['Часть паролей пропущена: они пустые, дублируются или используют неподдерживаемое шифрование.'] : [] };
  }

  private querySqlite(databasePath: string, query: string): Promise<Row[]> {
    return new Promise((resolve, reject) => {
      execFile('sqlite3', ['-readonly', '-json', databasePath, query], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
          reject(new Error(`не удалось прочитать SQLite-профиль (${error.message || 'sqlite3 недоступен'})`));
          return;
        }
        if (!stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as unknown;
          resolve(Array.isArray(parsed) ? parsed as Row[] : []);
        } catch (parseError) {
          reject(new Error(`не удалось разобрать SQLite-профиль (${parseError instanceof Error ? parseError.message : 'некорректный JSON'})`));
        }
      });
    });
  }

  private chromiumStorageKey(browser: Extract<ImportBrowser, 'chrome' | 'yandex'>): Buffer | undefined {
    if (process.platform === 'darwin') {
      const services = browser === 'chrome' ? ['Chrome Safe Storage', 'Chromium Safe Storage'] : ['Yandex Safe Storage'];
      for (const service of services) {
        try {
          const secret = execFileSync('security', ['find-generic-password', '-w', '-s', service], { encoding: 'utf8', timeout: 3000 }).trim();
          if (secret) return crypto.pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1');
        } catch {
          // Try the next keychain label.
        }
      }
      return undefined;
    }
    if (process.platform !== 'linux') return undefined;
    const attributeCandidates = browser === 'chrome' ? ['chrome', 'chromium'] : ['yandex', 'yandex_browser', 'Yandex Browser'];
    for (const application of attributeCandidates) {
      try {
        const secret = execFileSync('secret-tool', ['lookup', 'application', application], { encoding: 'utf8', timeout: 3000 }).trim();
        if (secret) return crypto.pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1');
      } catch {
        // Try the next keyring attribute.
      }
    }
    const candidates = browser === 'chrome'
      ? [['Chrome Safe Storage', 'Chrome'], ['Chromium Safe Storage', 'Chromium']]
      : [['Yandex Safe Storage', 'Yandex'], ['Yandex Safe Storage', 'Yandex Browser']];
    for (const [service, user] of candidates) {
      try {
        const secret = execFileSync('secret-tool', ['lookup', 'service', service, 'user', user], { encoding: 'utf8', timeout: 3000 }).trim();
        if (secret) return crypto.pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1');
      } catch {
        // Try the next keyring label.
      }
    }
    return undefined;
  }

  private decryptChromiumValue(hexValue: string, key: Buffer): string | undefined {
    try {
      const encrypted = Buffer.from(hexValue, 'hex');
      if (encrypted.length < 4) return undefined;
      const version = encrypted.subarray(0, 3).toString('ascii');
      if (version !== 'v10' && version !== 'v11') return undefined;
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
      return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString('utf8').replace(/\0+$/g, '');
    } catch {
      return undefined;
    }
  }

  private label(kind: ImportDataKind): string {
    return { history: 'История', bookmarks: 'Закладки', cookies: 'Cookies', passwords: 'Пароли' }[kind];
  }
}
