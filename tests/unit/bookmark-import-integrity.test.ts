import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserDataImporter } from '../../src/main/import/BrowserDataImporter';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(bookmarkFiles: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-import-integrity-')); roots.push(root);
  const source = path.join(root, 'profile'); fs.mkdirSync(source);
  for (const [filename, contents] of Object.entries(bookmarkFiles)) fs.writeFileSync(path.join(source, filename), contents);
  const stores = new BrowserStores(path.join(root, 'target'));
  stores.saveBookmark({ title: 'Keep existing', url: 'https://existing.test/' });
  const importer = new BrowserDataImporter(stores, {} as never, async () => 0);
  (importer as any).profiles.set('fixture', { id: 'fixture', browser: 'chrome', browserLabel: 'Chrome', profileName: 'Test', path: source, available: ['bookmarks'] });
  return { root, source, stores, importer };
}
describe('Chromium bookmarks import integrity', () => {
  it.each(['not JSON', '{"roots":null}', '{"roots":[]}', '{"unrecognized":true}'])('reports failed import instead of silent zero success for %s', async contents => {
    const { source, stores, importer } = fixture({ Bookmarks: contents });
    const before = structuredClone(stores.bookmarks.get());
    const report = await importer.import('fixture', ['bookmarks']);
    expect(report.imported.bookmarks).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('повреждены или недоступны');
    expect(stores.bookmarks.get()).toEqual(before);
    expect(fs.readFileSync(path.join(source, 'Bookmarks'), 'utf8')).toBe(contents);
  });
  it('reports partial import if one source is damaged while importing the readable account bookmarks', async () => {
    const valid = JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Account bookmark', url: 'https://account.test/' }] } } });
    const { source, stores, importer } = fixture({ Bookmarks: 'broken', AccountBookmarks: valid });
    const report = await importer.import('fixture', ['bookmarks']);
    expect(report.imported.bookmarks).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContainEqual(expect.stringContaining('Не прочитаны файлы закладок: Bookmarks'));
    expect(stores.bookmarks.get().map(entry => entry.url)).toEqual(['https://existing.test/', 'https://account.test/']);
    expect(fs.readFileSync(path.join(source, 'AccountBookmarks'), 'utf8')).toBe(valid);
    expect(fs.readFileSync(path.join(source, 'Bookmarks'), 'utf8')).toBe('broken');
  });
  it('accepts a valid but empty bookmark document without a corruption warning', async () => {
    const { stores, importer } = fixture({ Bookmarks: '{"roots":{"bookmark_bar":{"children":[]}}}' });
    const report = await importer.import('fixture', ['bookmarks']);
    expect(report.imported.bookmarks).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(stores.bookmarks.get()).toHaveLength(1);
  });
});
