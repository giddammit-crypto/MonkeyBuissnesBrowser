import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BrowserDataImporter } from '../../src/main/import/BrowserDataImporter';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';

function createChromiumFixture(root: string): string {
  const profile = path.join(root, 'Default');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Example', url: 'https://example.test/' }] } } }));
  execFileSync('sqlite3', [path.join(profile, 'History'), 'CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER); INSERT INTO urls VALUES (\'https://example.test/\', \'Example\', 13300000000000000);']);
  fs.writeFileSync(path.join(profile, 'Cookies'), '');
  fs.writeFileSync(path.join(profile, 'Login Data'), '');
  return profile;
}

describe('BrowserDataImporter', () => {
  it('discovers Chrome profiles and imports history and bookmarks locally', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monkey-import-'));
    const config = path.join(directory, 'config');
    createChromiumFixture(path.join(config, 'google-chrome'));

    const home = process.env.HOME;
    const xdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    try {
      const stores = new BrowserStores(path.join(directory, 'data'));
      const importer = new BrowserDataImporter(stores, { canPersistSecurely: () => false, addMany: () => 0, summaries: () => [] }, async () => 0);
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
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
      if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = xdg;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
