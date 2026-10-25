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
  database.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER); INSERT INTO cookies VALUES ('.example.test', 'test', 'value', X'', '/', 13300000000000000, 1, 1)");
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
