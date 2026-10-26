import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { BrowserStores } from '../persistence/BrowserStores';
import type { PasswordStore } from '../persistence/PasswordStore';
import type { BookmarkEntry, HistoryEntry, ImportBrowser, ImportDataKind, ImportFileKind, ImportFileReport, ImportProfile, ImportReport } from '../../shared/types';
import { decryptChromiumValue, deriveChromiumKey, type ChromiumKeys } from './ChromiumCrypto';
import { parseBookmarksHtml, parsePasswordsCsv } from './ImportParsers';

export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  /** Omitted for host-only cookies; passing a domain broadens cookie scope. */
  domain?: string;
  path: string;
  expirationDate?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

type CookieSink = (cookies: ImportedCookie[]) => Promise<number>;
type Row = Record<string, unknown>;
type ChromiumBrowser = Exclude<ImportBrowser, 'firefox' | 'file'>;
interface ImportResult { imported: number; skipped: number; warnings: string[] }
const browserLabels: Record<ImportBrowser, string> = { chrome: 'Google Chrome', yandex: 'Яндекс Браузер', firefox: 'Firefox', edge: 'Microsoft Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', file: 'Файл экспорта' };
const chromiumBrowsers: ChromiumBrowser[] = ['chrome', 'yandex', 'edge', 'brave', 'opera', 'vivaldi'];
const dataKinds: ImportDataKind[] = ['history', 'bookmarks', 'cookies', 'passwords'];
const MAX_ROWS = 10_000;
const emptyCounts = (): Record<ImportDataKind, number> => ({ history: 0, bookmarks: 0, cookies: 0, passwords: 0 });
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const flag = (value: unknown): boolean => value === true || Number(value) === 1;
function webUrl(value: unknown): URL | undefined { try { const url = new URL(text(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return undefined; } }
function chromiumTime(value: unknown): number { const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric / 1000 + Date.UTC(1601, 0, 1)) : Date.now(); }
function unixMicros(value: unknown): number { const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric / 1000) : Date.now(); }
function profileId(browser: ImportBrowser, profilePath: string): string { return crypto.createHash('sha256').update(`${browser}:${profilePath}`).digest('hex').slice(0, 20); }
function safeReadJson(filePath: string): Record<string, unknown> | undefined { try { if (fs.statSync(filePath).size > 20 * 1024 * 1024) return; const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8')); return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined; } catch { return; } }
function rows(database: DatabaseSync, query: string): Row[] { const statement = database.prepare(query); statement.setReadBigInts(true); return statement.all().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))); }
function columns(database: DatabaseSync, table: string): Set<string> { return new Set(rows(database, `PRAGMA table_info("${table}")`).map((row) => text(row.name))); }
function optionalColumn(available: Set<string>, name: string, fallback: string): string { return available.has(name) ? `"${name}"` : `${fallback} AS "${name}"`; }

function readSnapshot<T>(databasePath: string, read: (database: DatabaseSync) => T): T {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec('PRAGMA busy_timeout = 1000; PRAGMA query_only = ON; BEGIN DEFERRED');
    const result = read(database);
    database.exec('COMMIT');
    return result;
  } catch {
    try { database?.close(); } catch {}
    database = undefined;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-import-'));
    const tempPath = path.join(tempDir, path.basename(databasePath));
    let tempDb: DatabaseSync | undefined;
    try {
      fs.copyFileSync(databasePath, tempPath);
      for (const ext of ['-wal', '-shm', '-journal']) {
        const extra = `${databasePath}${ext}`;
        if (fs.existsSync(extra)) {
          try { fs.copyFileSync(extra, `${tempPath}${ext}`); } catch {}
        }
      }
      tempDb = new DatabaseSync(tempPath, { readOnly: true });
      tempDb.exec('PRAGMA busy_timeout = 2000; PRAGMA query_only = ON; BEGIN DEFERRED');
      const result = read(tempDb);
      tempDb.exec('COMMIT');
      return result;
    } catch {
      throw new Error('Не удалось прочитать SQLite-профиль. Закройте исходный браузер и повторите импорт; исходные файлы не изменены.');
    } finally {
      try { tempDb?.close(); } catch {}
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  } finally {
    try { database?.close(); } catch {}
  }
}

export class BrowserDataImporter {
  private readonly profiles = new Map<string, ImportProfile>();
  constructor(private readonly stores: BrowserStores, private readonly passwords: PasswordStore, private readonly setCookies: CookieSink) {}

  discoverProfiles(): ImportProfile[] {
    this.profiles.clear();
    for (const browser of chromiumBrowsers) for (const root of this.chromiumRoots(browser)) this.addChromiumProfiles(browser, root);
    for (const root of this.firefoxRoots()) this.addFirefoxProfiles(root);
    return [...this.profiles.values()].sort((left, right) => `${left.browserLabel} ${left.profileName}`.localeCompare(`${right.browserLabel} ${right.profileName}`, 'ru'));
  }

  async import(id: string, requestedKinds: ImportDataKind[]): Promise<ImportReport> {
    const profile = this.findProfile(id);
    const report: ImportReport = { browser: profile.browser, profileName: profile.profileName, imported: emptyCounts(), skipped: emptyCounts(), warnings: [], errors: [] };
    if (!Array.isArray(requestedKinds)) throw new Error('Выберите данные для импорта.');
    const keyCache = new Map<ChromiumBrowser, Promise<ChromiumKeys>>();
    const keys = (browser: ChromiumBrowser, versions: Set<string>) => {
      let cached = keyCache.get(browser);
      if (!cached) { cached = this.chromiumStorageKeys(browser, versions); keyCache.set(browser, cached); }
      return cached;
    };
    // Resolve keys once with both versions if cookies and passwords are selected.
    // Supplying a superset does not grant access; the OS keyring still authorizes retrieval.
    const getKeys = (browser: ChromiumBrowser, versions: Set<string>) => keys(browser, new Set([...versions, ...(requestedKinds.includes('cookies') && requestedKinds.includes('passwords') ? ['v10', 'v11'] : [])]));
    for (const kind of dataKinds.filter((entry) => requestedKinds.includes(entry))) {
      try {
        if (!profile.available.includes(kind)) { report.warnings.push(`${this.label(kind)} недоступны в профиле «${profile.profileName}».`); continue; }
        const result = kind === 'history' ? this.importHistory(profile) : kind === 'bookmarks' ? this.importBookmarks(profile) : kind === 'cookies' ? await this.importCookies(profile, getKeys) : await this.importPasswords(profile, getKeys);
        report.imported[kind] = result.imported;
        report.skipped[kind] = result.skipped;
        report.warnings.push(...result.warnings);
      } catch (error) { report.errors.push(`${this.label(kind)}: ${error instanceof Error ? error.message : 'Импорт не выполнен.'}`); }
    }
    report.warnings = [...new Set(report.warnings)];
    return report;
  }

  async importFile(filePath: string, kind: ImportFileKind): Promise<ImportFileReport> {
    const report: ImportFileReport = { kind, imported: 0, skipped: 0, warnings: [], errors: [] };
    try {
      if (!['bookmarks', 'passwords'].includes(kind)) throw new Error('Неподдерживаемый тип импорта.');
      if (kind === 'passwords' && !this.passwords.canPersistSecurely()) throw new Error('Пароли не прочитаны: защищённое системное хранилище недоступно. Настройте keyring и повторите импорт.');
      const file = await fs.promises.open(filePath, 'r');
      let source: string;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Выберите обычный файл размером не больше 20 МБ.');
        const buffer = await file.readFile();
        source = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.subarray(2).toString('utf16le') : new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } finally { await file.close(); }
      if (kind === 'bookmarks') {
        const parsed = parseBookmarksHtml(source);
        const result = this.mergeBookmarks(parsed.records, parsed.total);
        report.imported = result.imported; report.skipped = result.skipped; report.warnings.push(...parsed.warnings, ...result.warnings);
      } else {
        const parsed = parsePasswordsCsv(source);
        report.imported = this.passwords.addMany(parsed.records.map((record) => ({ ...record, browser: 'file' })));
        report.skipped = Math.max(0, parsed.total - report.imported);
        report.warnings.push(...parsed.warnings, 'CSV содержит незашифрованные пароли. Исходный файл не изменён и не скопирован приложением; после импорта удалите его, если он больше не нужен.');
        if (report.skipped) report.warnings.push('Дубли существующих паролей не заменены; некорректные строки пропущены.');
      }
    } catch (error) { report.errors.push(error instanceof Error ? error.message : 'Не удалось импортировать файл.'); }
    report.warnings = [...new Set(report.warnings)];
    return report;
  }

  private findProfile(id: string): ImportProfile { if (!this.profiles.size) this.discoverProfiles(); const profile = this.profiles.get(id); if (!profile) throw new Error('Профиль браузера не найден. Обновите список профилей.'); return profile; }
  private directories(root: string): string[] { try { return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)); } catch { return []; } }
  private chromiumCookiePath(profilePath: string): string { const modern = path.join(profilePath, 'Network', 'Cookies'); return fs.existsSync(modern) ? modern : path.join(profilePath, 'Cookies'); }
  private addChromiumProfiles(browser: ChromiumBrowser, root: string): void {
    if (!fs.existsSync(root)) return;
    const state = safeReadJson(path.join(root, 'Local State')) as { profile?: { info_cache?: Record<string, { name?: string }> } } | undefined;
    for (const profilePath of [root, ...this.directories(root)]) {
      const available: ImportDataKind[] = [];
      if (fs.existsSync(path.join(profilePath, 'History'))) available.push('history');
      if (fs.existsSync(path.join(profilePath, 'Bookmarks')) || fs.existsSync(path.join(profilePath, 'AccountBookmarks'))) available.push('bookmarks');
      if (fs.existsSync(this.chromiumCookiePath(profilePath))) available.push('cookies');
      if (fs.existsSync(path.join(profilePath, 'Login Data')) || fs.existsSync(path.join(profilePath, 'Login Data For Account')) || fs.existsSync(path.join(profilePath, 'Ya Passman Data'))) available.push('passwords');
      if (!available.length) continue;
      const preferences = safeReadJson(path.join(profilePath, 'Preferences')) as { profile?: { name?: string } } | undefined;
      const name = text(state?.profile?.info_cache?.[path.basename(profilePath)]?.name) || text(preferences?.profile?.name) || (profilePath === root ? 'Основной профиль' : path.basename(profilePath));
      this.profiles.set(profileId(browser, profilePath), { id: profileId(browser, profilePath), browser, browserLabel: browserLabels[browser], profileName: name.slice(0, 100), path: profilePath, available });
    }
  }
  private addFirefoxProfiles(root: string): void {
    for (const profilePath of this.directories(root)) {
      const available: ImportDataKind[] = [];
      if (fs.existsSync(path.join(profilePath, 'places.sqlite'))) available.push('history', 'bookmarks');
      if (fs.existsSync(path.join(profilePath, 'cookies.sqlite'))) available.push('cookies');
      if (fs.existsSync(path.join(profilePath, 'logins.json'))) available.push('passwords');
      if (available.length) this.profiles.set(profileId('firefox', profilePath), { id: profileId('firefox', profilePath), browser: 'firefox', browserLabel: browserLabels.firefox, profileName: path.basename(profilePath), path: profilePath, available });
    }
  }
  private chromiumRoots(browser: ChromiumBrowser): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
      const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
      const roots: Record<ChromiumBrowser, string[]> = { chrome: [path.join(local, 'Google', 'Chrome', 'User Data')], yandex: [path.join(local, 'Yandex', 'YandexBrowser', 'User Data')], edge: [path.join(local, 'Microsoft', 'Edge', 'User Data')], brave: [path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')], vivaldi: [path.join(local, 'Vivaldi', 'User Data')], opera: [path.join(roaming, 'Opera Software', 'Opera Stable'), path.join(roaming, 'Opera Software', 'Opera GX Stable')] };
      return roots[browser];
    }
    if (process.platform === 'darwin') {
      const support = path.join(home, 'Library', 'Application Support');
      const roots: Record<ChromiumBrowser, string[]> = { chrome: ['Google/Chrome', 'Chromium'], yandex: ['Yandex/YandexBrowser'], edge: ['Microsoft Edge'], brave: ['BraveSoftware/Brave-Browser'], vivaldi: ['Vivaldi'], opera: ['com.operasoftware.Opera', 'com.operasoftware.OperaGX'] };
      return roots[browser].map((root) => path.join(support, root));
    }
    const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    const isCustomConfig = Boolean(process.env.XDG_CONFIG_HOME);
    const roots: Record<ChromiumBrowser, string[]> = {
      chrome: [
        path.join(config, 'google-chrome'),
        path.join(config, 'google-chrome-beta'),
        path.join(config, 'google-chrome-unstable'),
        path.join(config, 'chromium'),
        ...(isCustomConfig ? [] : [
          path.join(home, 'snap', 'chromium', 'common', 'chromium'),
          path.join(home, 'snap', 'chromium', 'current', '.config', 'chromium'),
          path.join(home, '.var', 'app', 'com.google.Chrome', 'config', 'google-chrome'),
          path.join(home, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium'),
        ]),
      ],
      yandex: [
        path.join(config, 'yandex-browser'),
        path.join(config, 'yandex-browser-beta'),
        path.join(config, 'Yandex', 'YandexBrowser'),
      ],
      edge: [
        path.join(config, 'microsoft-edge'),
        path.join(config, 'microsoft-edge-beta'),
        path.join(config, 'microsoft-edge-dev'),
      ],
      brave: [
        path.join(config, 'BraveSoftware', 'Brave-Browser'),
        ...(isCustomConfig ? [] : [
          path.join(home, 'snap', 'brave', 'current', '.config', 'BraveSoftware', 'Brave-Browser'),
          path.join(home, '.var', 'app', 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser'),
        ]),
      ],
      vivaldi: [
        path.join(config, 'vivaldi'),
        path.join(config, 'vivaldi-snapshot'),
      ],
      opera: [
        path.join(config, 'opera'),
        path.join(config, 'opera-beta'),
        path.join(config, 'opera-developer'),
        path.join(config, 'opera-gx'),
        ...(isCustomConfig ? [] : [
          path.join(home, 'snap', 'opera', 'current', '.config', 'opera'),
        ]),
      ],
    };
    return roots[browser];
  }
  private firefoxRoots(): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') return [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles')];
    if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')];
    const isCustomConfig = Boolean(process.env.XDG_CONFIG_HOME);
    return [
      path.join(home, '.mozilla', 'firefox'),
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'mozilla', 'firefox'),
      ...(isCustomConfig ? [] : [path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox')]),
    ];
  }

  private importHistory(profile: ImportProfile): ImportResult {
    const source = readSnapshot(path.join(profile.path, profile.browser === 'firefox' ? 'places.sqlite' : 'History'), (database) => profile.browser === 'firefox'
      ? rows(database, `SELECT url, COALESCE(title, url) AS title, last_visit_date FROM moz_places ORDER BY last_visit_date DESC LIMIT ${MAX_ROWS}`)
      : rows(database, `SELECT url, COALESCE(title, url) AS title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ${MAX_ROWS}`));
    const entries: HistoryEntry[] = source.filter((row) => webUrl(row.url)).map((row) => ({ id: crypto.randomUUID(), url: webUrl(row.url)!.href, title: text(row.title) || text(row.url), visitedAt: profile.browser === 'firefox' ? unixMicros(row.last_visit_date) : chromiumTime(row.last_visit_time) }));
    const existing = this.stores.history.get();
    const seen = new Set(existing.map((entry) => entry.url));
    const added = entries.filter((entry) => { if (seen.has(entry.url)) return false; seen.add(entry.url); return true; });
    const merged = [...existing, ...added].sort((left, right) => right.visitedAt - left.visitedAt).slice(0, 500);
    const kept = new Set(merged.map((entry) => entry.id));
    const imported = added.filter((entry) => kept.has(entry.id)).length;
    if (imported) this.stores.history.set(merged);
    const warnings = source.length > imported ? ['Повторяющиеся или некорректные адреса и история сверх лимита 500 записей пропущены.'] : [];
    if (source.length >= MAX_ROWS) warnings.push(`История ограничена ${MAX_ROWS} последними записями; хранится максимум 500 адресов.`);
    return { imported, skipped: source.length - imported, warnings };
  }
  private importBookmarks(profile: ImportProfile): ImportResult {
    if (profile.browser === 'firefox') {
      const source = readSnapshot(path.join(profile.path, 'places.sqlite'), (database) => rows(database, `SELECT p.url, COALESCE(b.title, p.title, p.url) AS title, b.dateAdded AS created_at FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT ${MAX_ROWS}`));
      return this.mergeBookmarks(source.filter((row) => webUrl(row.url)).map((row) => ({ id: crypto.randomUUID(), url: webUrl(row.url)!.href, title: text(row.title) || text(row.url), createdAt: unixMicros(row.created_at) })), source.length);
    }
    const bookmarkFiles = ['Bookmarks', 'AccountBookmarks'].filter((name) => fs.existsSync(path.join(profile.path, name)));
    if (!bookmarkFiles.length) throw new Error('Файл закладок повреждён или недоступен.');
    const source: BookmarkEntry[] = [];
    let total = 0;
    for (const file of bookmarkFiles) {
      const document = safeReadJson(path.join(profile.path, file)) as { roots?: Record<string, unknown> } | undefined;
      if (!document?.roots || typeof document.roots !== 'object') continue;
      let visited = 0;
      const pending: unknown[] = Object.values(document.roots);
      while (pending.length) {
        if (++visited > 50_000) break;
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        const item = node as Record<string, unknown>;
        if (Array.isArray(item.children)) pending.push(...item.children.slice(0, 20_000));
        if (item.type !== 'url') continue;
        total += 1;
        if (total > 20_000) break;
        const url = webUrl(item.url);
        if (url) source.push({ id: crypto.randomUUID(), url: url.href, title: text(item.name) || url.href, createdAt: chromiumTime(item.date_added) });
      }
    }
    return this.mergeBookmarks(source, total);
  }
  private mergeBookmarks(source: BookmarkEntry[], total: number): ImportResult {
    const existing = this.stores.bookmarks.get();
    const seen = new Set(existing.map((entry) => entry.url));
    const added = source.filter((entry) => { if (seen.has(entry.url)) return false; seen.add(entry.url); return true; }).slice(0, Math.max(0, 500 - existing.length));
    if (added.length) this.stores.bookmarks.set([...existing, ...added]);
    return { imported: added.length, skipped: Math.max(0, total - added.length), warnings: total > added.length ? ['Дубли, некорректные адреса и записи сверх лимита 500 закладок пропущены; существующие закладки сохранены.'] : [] };
  }

  private async importCookies(profile: ImportProfile, getKeys: (browser: ChromiumBrowser, versions: Set<string>) => Promise<ChromiumKeys>): Promise<ImportResult> {
    const firefox = profile.browser === 'firefox';
    const dataset = readSnapshot(path.join(profile.path, firefox ? 'cookies.sqlite' : path.relative(profile.path, this.chromiumCookiePath(profile.path))), (database) => {
      const table = firefox ? 'moz_cookies' : 'cookies';
      const available = columns(database, table);
      if (!available.size) throw new Error('Cookie schema missing');
      const extra = firefox
        ? [optionalColumn(available, 'originAttributes', "''"), optionalColumn(available, 'sameSite', '-1'), optionalColumn(available, 'isPartitionedAttributeSet', '0')]
        : [optionalColumn(available, 'samesite', '-1'), optionalColumn(available, 'has_expires', '-1'), optionalColumn(available, 'top_frame_site_key', "''"), optionalColumn(available, 'is_partitioned', '0')];
      const selection = firefox ? 'host, name, value, path, expiry, isSecure, isHttpOnly' : 'host_key AS host, name, value, hex(encrypted_value) AS encrypted_hex, path, expires_utc, is_secure, is_httponly';
      let version = 0;
      if (!firefox && rows(database, "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").length) version = Number(rows(database, "SELECT value FROM meta WHERE key='version'")[0]?.value) || 0;
      return { source: rows(database, `SELECT ${selection}, ${extra.join(', ')} FROM ${table} LIMIT ${MAX_ROWS}`), version };
    });
    const source = dataset.source;
    const versions = new Set(source.filter((row) => !row.value && row.encrypted_hex).map((row) => Buffer.from(text(row.encrypted_hex), 'hex').subarray(0, 3).toString('ascii')));
    const keys = firefox ? {} : await getKeys(profile.browser as ChromiumBrowser, versions);
    const cookies: ImportedCookie[] = [];
    const seen = new Set<string>();
    const reasons = new Map<string, number>();
    const skip = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    for (const row of source) {
      if (text(row.originAttributes) || text(row.top_frame_site_key) || flag(row.is_partitioned) || flag(row.isPartitionedAttributeSet)) { skip('Контейнерные и partitioned cookies не переносятся в общий профиль'); continue; }
      const host = text(row.host);
      const hostname = host.replace(/^\./, '');
      if (!hostname || /[\s/:?#@\\]/.test(hostname) || host.startsWith('..')) { skip('Некорректные домены'); continue; }
      const secure = flag(firefox ? row.isSecure : row.is_secure);
      const httpOnly = flag(firefox ? row.isHttpOnly : row.is_httponly);
      const cookiePath = text(row.path, '/') || '/';
      const name = text(row.name);
      if (!cookiePath.startsWith('/') || /[\r\n\0;]/.test(cookiePath) || /[\s\x00-\x1f\x7f;,=]/.test(name)) { skip('Некорректные имена или пути'); continue; }
      const sameSiteNumber = Number(firefox ? row.sameSite : row.samesite);
      const sameSite: ImportedCookie['sameSite'] = sameSiteNumber === 0 ? 'no_restriction' : sameSiteNumber === 1 ? 'lax' : sameSiteNumber === 2 ? 'strict' : 'unspecified';
      if (sameSite === 'no_restriction' && !secure || name.startsWith('__Secure-') && !secure || (name.startsWith('__Http-') || name.startsWith('__Host-Http-')) && (!secure || !httpOnly) || name.startsWith('__Host-') && (!secure || cookiePath !== '/' || host.startsWith('.'))) { skip('Cookies с несовместимыми Secure/SameSite/prefix атрибутами'); continue; }
      const persistent = firefox ? Number(row.expiry) > 0 : Number(row.has_expires) >= 0 ? flag(row.has_expires) : Number(row.expires_utc) > 0;
      const expirationDate = persistent ? firefox ? Number(row.expiry) : chromiumTime(row.expires_utc) / 1000 : undefined;
      if (expirationDate !== undefined && (!Number.isFinite(expirationDate) || expirationDate <= Date.now() / 1000)) { skip('Истёкшие cookies'); continue; }
      let value: string | undefined = text(row.value);
      if (!firefox && !value && text(row.encrypted_hex)) value = decryptChromiumValue(text(row.encrypted_hex), keys, { host, schemaVersion: dataset.version });
      if (value === undefined) { skip('Не расшифрованы cookies: ключ keyring недоступен, host digest не совпал или формат шифрования не поддерживается'); continue; }
      if (/[\x00-\x1f\x7f;]/.test(value)) { skip('Некорректные значения cookies'); continue; }
      const identity = `${host}\0${cookiePath}\0${name}`;
      if (seen.has(identity)) { skip('Повторяющиеся cookies'); continue; }
      seen.add(identity);
      const url = `${secure ? 'https' : 'http'}://${hostname}${cookiePath}`;
      if (!webUrl(url)) { skip('Некорректные домены'); continue; }
      cookies.push({ url, name, value, ...(host.startsWith('.') ? { domain: host } : {}), path: cookiePath, expirationDate, secure, httpOnly, sameSite });
    }
    const imported = await this.setCookies(cookies);
    const warnings = [...reasons].map(([reason, count]) => `${reason}: ${count}.`);
    if (imported < cookies.length) warnings.push(`Не изменены дубли или отклонены браузером cookies: ${cookies.length - imported}.`);
    if (versions.has('v20') || process.platform === 'win32' && versions.size) warnings.push('Windows DPAPI/App-Bound шифрование не обходится. Для защищённых cookies требуется новый вход на сайте; CSV переносит только пароли.');
    if (source.length >= MAX_ROWS) warnings.push(`Импорт cookies ограничен ${MAX_ROWS} записями.`);
    return { imported, skipped: Math.max(0, source.length - imported), warnings };
  }

  private async importPasswords(profile: ImportProfile, getKeys: (browser: ChromiumBrowser, versions: Set<string>) => Promise<ChromiumKeys>): Promise<ImportResult> {
    if (profile.browser === 'firefox') {
      const document = safeReadJson(path.join(profile.path, 'logins.json'));
      const total = Array.isArray(document?.logins) ? document.logins.length : 0;
      return { imported: 0, skipped: total, warnings: ['Пароли Firefox защищены NSS. Используйте официальный экспорт паролей Firefox в CSV и кнопку импорта CSV; NSS-защита не обходится.'] };
    }
    const loginFiles = ['Login Data', 'Login Data For Account', 'Ya Passman Data'].filter((name) => fs.existsSync(path.join(profile.path, name)));
    const source: Row[] = [];
    for (const file of loginFiles) {
      try {
        const fileRows = readSnapshot(path.join(profile.path, file), (database) => rows(database, `SELECT origin_url, username_value, hex(password_value) AS password_hex FROM logins LIMIT ${MAX_ROWS}`));
        source.push(...fileRows);
      } catch {}
    }
    if (!this.passwords.canPersistSecurely()) return { imported: 0, skipped: source.length, warnings: ['Пароли не сохранены: защищённое системное хранилище Electron недоступно.'] };
    const keys = await getKeys(profile.browser as ChromiumBrowser, new Set(source.map((row) => Buffer.from(text(row.password_hex), 'hex').subarray(0, 3).toString('ascii'))));
    const records = source.map((row) => ({ origin: webUrl(row.origin_url)?.origin ?? '', username: text(row.username_value), password: decryptChromiumValue(text(row.password_hex), keys), browser: profile.browser })).filter((record): record is typeof record & { password: string } => Boolean(record.origin && record.password));
    const imported = this.passwords.addMany(records);
    const warnings = imported < source.length ? ['Дубли, пустые записи и пароли с недоступным ключом или неподдерживаемым шифрованием пропущены. Существующие пароли не заменены.'] : [];
    if (process.platform === 'win32') warnings.push('Windows DPAPI/App-Bound шифрование не обходится. Используйте официальный экспорт паролей в CSV и импорт CSV.');
    return { imported, skipped: Math.max(0, source.length - imported), warnings };
  }

  private async chromiumStorageKeys(browser: ChromiumBrowser, versions: Set<string>): Promise<ChromiumKeys> {
    const keys: ChromiumKeys = {};
    if (process.platform === 'linux' && versions.has('v10')) keys.v10 = deriveChromiumKey('peanuts', 'linux');
    if (process.platform !== 'linux' && process.platform !== 'darwin' || !versions.has(process.platform === 'darwin' ? 'v10' : 'v11')) return keys;
    const labels: Record<ChromiumBrowser, string[]> = {
      chrome: ['Chrome', 'Chromium', 'Google Chrome'],
      yandex: ['Yandex', 'Chromium', 'Chrome'],
      edge: ['Microsoft Edge', 'Microsoft Edge Safe Storage'],
      brave: ['Brave', 'Brave Browser'],
      vivaldi: ['Vivaldi'],
      opera: ['Opera', 'Opera Safe Storage'],
    };
    const applications: Record<ChromiumBrowser, string[]> = {
      chrome: ['chromium', 'chrome', 'google-chrome'],
      yandex: ['yandex', 'yandex_browser', 'yandex-browser', 'chromium', 'chrome'],
      edge: ['microsoft-edge', 'edge'],
      brave: ['brave', 'brave-browser'],
      vivaldi: ['vivaldi'],
      opera: ['opera'],
    };
    if (process.platform === 'darwin') {
      for (const label of labels[browser]) {
        const secret = await this.keyringSecret('security', ['find-generic-password', '-w', '-s', label.endsWith('Safe Storage') ? label : `${label} Safe Storage`]);
        if (secret) { keys.v10 = deriveChromiumKey(secret, 'darwin'); break; }
      }
    } else {
      const candidates: Buffer[] = [];
      const attempts = [
        ...applications[browser].map((application) => ['lookup', 'application', application]),
        ...labels[browser].map((label) => ['lookup', 'service', label.endsWith('Safe Storage') ? label : `${label} Safe Storage`, 'user', label]),
      ];
      for (const args of attempts) {
        const secret = await this.keyringSecret('secret-tool', args);
        if (secret) {
          const derived = deriveChromiumKey(secret, 'linux');
          if (!keys.v11) keys.v11 = derived;
          candidates.push(derived);
        }
      }
      // Fallback search across all schema passwords
      const dump = await this.keyringSecret('secret-tool', ['search', '--all', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2']);
      if (dump) {
        for (const match of dump.matchAll(/secret\s*=\s*(.+)/g)) {
          const secret = match[1]?.trim();
          if (secret) {
            const derived = deriveChromiumKey(secret, 'linux');
            if (!keys.v11) keys.v11 = derived;
            candidates.push(derived);
          }
        }
      }
      if (candidates.length) keys.v11Candidates = candidates;
    }
    return keys;
  }
  private keyringSecret(command: string, args: string[]): Promise<string | undefined> {
    return new Promise((resolve) => execFile(command, args, { encoding: 'utf8', timeout: 1500, maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout.replace(/[\r\n]+$/, '') || undefined)));
  }
  private label(kind: ImportDataKind): string { return { history: 'История', bookmarks: 'Закладки', cookies: 'Cookies', passwords: 'Пароли' }[kind]; }
}
