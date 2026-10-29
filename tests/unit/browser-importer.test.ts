import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BrowserDataImporter } from '../../src/main/import/BrowserDataImporter';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';

function createChromiumFixture(root: string): string {
  const profile = path.join(root, 'Default');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Example', url: 'https://example.test/' }] } } }));
  const database = new DatabaseSync(path.join(profile, 'History'));
  database.exec( 'CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER); INSERT INTO urls VALUES (\'https://example.test/\', \'Example\', 13300000000000000);');
  database.close();
  fs.writeFileSync(path.join(profile, 'Cookies'), '');
  fs.writeFileSync(path.join(profile, 'Login Data'), '');
  return profile;
}

describe('BrowserDataImporter', () => {
  it('discovers Chrome profiles and imports history and bookmarks locally', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monkey-import-'));
    const config = path.join(directory, 'config');
    createChromiumFixture(path.join(config, 'google-chrome'));

    const xdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    try {
      const stores = new BrowserStores(path.join(directory, 'data'));
      const importer = new BrowserDataImporter(stores, { canPersistSecurely: () => false, addMany: () => 0, summaries: () => [] } as never, async () => 0);
      const profiles = importer.discoverProfiles();
      const chrome = profiles.find((item) => item.browser === 'chrome');
      expect(chrome?.available).toEqual(expect.arrayContaining(['history', 'bookmarks']));
      const report = await importer.import(chrome!.id, ['history', 'bookmarks']);
      expect(report.errors).toEqual([]);
      expect(report.imported.history).toBe(1);
      expect(report.imported.bookmarks).toBe(1);
      expect(stores.history.get()[0]?.url).toBe('https://example.test/');
      expect(stores.bookmarks.get()[0]?.url).toBe('https://example.test/');
    } finally {
      if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = xdg;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});


it('discovers modern Chromium Network/Cookies and imports plain cookies without external sqlite3', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-cookie-import-'));
  const config = path.join(directory, 'config');
  const profilePath = path.join(config, 'google-chrome', 'Default');
  fs.mkdirSync(path.join(profilePath, 'Network'), { recursive: true });
  const database = new DatabaseSync(path.join(profilePath, 'Network', 'Cookies'));
  const futureExpiry = BigInt(Date.now() + 30 * 86400000 - Date.UTC(1601, 0, 1)) * 1000n;
  database.exec(`CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER); INSERT INTO cookies VALUES ('.example.test', 'test', 'value', X'', '/', ${futureExpiry}, 1, 1)`);
  database.close();
  const originalConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const imported: Array<{ value: string; secure: boolean; expirationDate?: number }> = [];
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'data')), { canPersistSecurely: () => false } as never, async (cookies) => { imported.push(...cookies); return cookies.length; });
    const profile = importer.discoverProfiles().find((item) => item.browser === 'chrome');
    expect(profile?.available).toEqual(['cookies']);
    const report = await importer.import(profile!.id, ['cookies']);
    expect(report).toMatchObject({ imported: { cookies: 1 }, skipped: { cookies: 0 }, errors: [], warnings: [] });
    expect(imported[0]).toMatchObject({ value: 'value', secure: true });
    expect(imported[0].expirationDate).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(profilePath, 'Network', 'Cookies'))).toBe(true);
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('counts unreadable encrypted cookies as skipped and reports unsupported encryption', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-encrypted-import-'));
  const config = path.join(directory, 'config');
  const profilePath = path.join(config, 'google-chrome', 'Default');
  fs.mkdirSync(profilePath, { recursive: true });
  const database = new DatabaseSync(path.join(profilePath, 'Cookies'));
  database.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER); INSERT INTO cookies VALUES ('.example.test', 'test', '', X'7632300123', '/', 0, 1, 1)");
  database.close();
  const originalConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'data')), { canPersistSecurely: () => false } as never, async (cookies) => cookies.length);
    const profile = importer.discoverProfiles().find((item) => item.browser === 'chrome');
    const report = await importer.import(profile!.id, ['cookies']);
    expect(report.errors).toEqual([]);
    expect(report.imported.cookies).toBe(0);
    expect(report.skipped.cookies).toBe(1);
    expect(report.warnings.length).toBeGreaterThan(0);
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('discovers named Edge/Brave/Opera/Vivaldi profiles and reports repeat-import duplicates truthfully', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-multi-import-'));
  const config = path.join(directory, 'config');
  for (const name of ['microsoft-edge', 'BraveSoftware/Brave-Browser', 'opera', 'vivaldi']) {
    const root = path.join(config, name);
    const profile = createChromiumFixture(root);
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Рабочий профиль' } } } }));
    expect(fs.existsSync(profile)).toBe(true);
  }
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'target')), {} as never, async () => 0);
    const profiles = importer.discoverProfiles().filter((entry) => ['edge', 'brave', 'opera', 'vivaldi'].includes(entry.browser));
    expect(profiles.map((entry) => entry.browser).sort()).toEqual(['brave', 'edge', 'opera', 'vivaldi']);
    expect(profiles.every((entry) => entry.profileName === 'Рабочий профиль')).toBe(true);
    expect(await importer.import(profiles[0].id, ['history', 'bookmarks'])).toMatchObject({ imported: { history: 1, bookmarks: 1 }, skipped: { history: 0, bookmarks: 0 }, errors: [] });
    expect(await importer.import(profiles[0].id, ['history', 'bookmarks'])).toMatchObject({ imported: { history: 0, bookmarks: 0 }, skipped: { history: 1, bookmarks: 1 }, errors: [] });
  } finally {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('reads committed live WAL history without changing source database or copying profile secrets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-wal-import-'));
  const config = path.join(directory, 'config');
  const profile = path.join(config, 'google-chrome', 'Default');
  fs.mkdirSync(profile, { recursive: true });
  const databasePath = path.join(profile, 'History');
  const writer = new DatabaseSync(databasePath);
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER); INSERT INTO urls VALUES ('https://committed.test/', 'Committed WAL row', 13400000000000000)");
  const before = fs.readFileSync(databasePath);
  const wal = fs.readFileSync(`${databasePath}-wal`);
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const stores = new BrowserStores(path.join(directory, 'target'));
    const importer = new BrowserDataImporter(stores, {} as never, async () => 0);
    const profileInfo = importer.discoverProfiles().find((entry) => entry.path === profile)!;
    const report = await importer.import(profileInfo.id, ['history']);
    expect(report).toMatchObject({ imported: { history: 1 }, errors: [] });
    expect(stores.history.get()[0].url).toBe('https://committed.test/');
    expect(fs.readFileSync(databasePath)).toEqual(before);
    expect(fs.readFileSync(`${databasePath}-wal`)).toEqual(wal);
    expect(fs.readdirSync(profile).every((entry) => entry.startsWith('History'))).toBe(true);
  } finally {
    writer.close();
    if (original === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('preserves cookie host scope/SameSite and skips expired, partitioned, invalid prefix cookies', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-cookie-attrs-'));
  const config = path.join(directory, 'config');
  const profile = path.join(config, 'google-chrome', 'Default');
  fs.mkdirSync(profile, { recursive: true });
  const database = new DatabaseSync(path.join(profile, 'Cookies'));
  database.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER, top_frame_site_key TEXT)");
  const insert = database.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('example.test', '__Host-session', 'host', Buffer.alloc(0), '/', 0, 1, 1, 0, 0, '');
  insert.run('.example.test', 'domain', '', Buffer.alloc(0), '/account', 0, 1, 0, 2, 0, '');
  insert.run('.example.test', 'expired', 'old', Buffer.alloc(0), '/', 13300000000000000n, 1, 0, 1, 1, '');
  insert.run('example.test', 'partitioned', 'private-context', Buffer.alloc(0), '/', 0, 1, 0, 1, 0, 'https://top.test');
  insert.run('.example.test', '__Host-invalid', 'bad', Buffer.alloc(0), '/', 0, 1, 1, 1, 0, '');
  insert.run('example.test', '__Secure-invalid', 'bad', Buffer.alloc(0), '/', 0, 0, 1, 1, 0, '');
  database.close();
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const cookies: Array<{ domain?: string; sameSite?: string; value: string; name: string; expirationDate?: number }> = [];
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'target')), {} as never, async (records) => { cookies.push(...records); return records.length; });
    const profileInfo = importer.discoverProfiles().find((entry) => entry.path === profile)!;
    const report = await importer.import(profileInfo.id, ['cookies']);
    expect(report).toMatchObject({ imported: { cookies: 2 }, skipped: { cookies: 4 }, errors: [] });
    expect(cookies[0]).toMatchObject({ name: '__Host-session', value: 'host', sameSite: 'no_restriction' });
    expect(cookies[0]).not.toHaveProperty('domain');
    expect(cookies[0].expirationDate).toBeUndefined();
    expect(cookies[1]).toMatchObject({ domain: '.example.test', value: '', sameSite: 'strict' });
    expect(report.warnings.join(' ')).toContain('partitioned');
    expect(report.warnings.join(' ')).toContain('Истёкшие');
  } finally {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('skips Firefox containers and preserves normal host-only cookie attributes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-firefox-attrs-'));
  const config = path.join(directory, 'config');
  const profile = path.join(config, 'mozilla', 'firefox', 'abc.default-release');
  fs.mkdirSync(profile, { recursive: true });
  const database = new DatabaseSync(path.join(profile, 'cookies.sqlite'));
  database.exec("CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT); INSERT INTO moz_cookies VALUES ('example.test', 'normal', 'value', '/', 0, 1, 1, 1, ''); INSERT INTO moz_cookies VALUES ('.example.test', 'container', 'private-value', '/', 0, 1, 1, 2, '^userContextId=3')");
  database.close();
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  try {
    const cookies: unknown[] = [];
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'target')), {} as never, async (records) => { cookies.push(...records); return records.length; });
    const profileInfo = importer.discoverProfiles().find((entry) => entry.path === profile)!;
    expect(await importer.import(profileInfo.id, ['cookies'])).toMatchObject({ imported: { cookies: 1 }, skipped: { cookies: 1 }, errors: [] });
    expect(cookies[0]).toMatchObject({ name: 'normal', sameSite: 'lax' });
    expect(cookies[0]).not.toHaveProperty('domain');
  } finally {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


it.skipIf(process.platform === 'win32')('rejects a FIFO import without blocking on a writer', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-fifo-import-'));
  try {
    const fifo = path.join(directory, 'bookmarks.html');
    execFileSync('mkfifo', [fifo]);
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory, 'data')), { canPersistSecurely: () => false } as never, async () => 0);
    const result = await importer.importFile(fifo, 'bookmarks');
    expect(result.imported).toBe(0);
    expect(result.errors).toEqual([expect.stringMatching(/обычный файл/)]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
