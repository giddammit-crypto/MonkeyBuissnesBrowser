import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const dialogs = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));
vi.mock('electron', () => ({ dialog: dialogs }));
import { buildBookmarksHtml, exportBookmarksHtml, writeBookmarksHtml } from '../../src/main/services/BookmarkExportService';
import { parseBookmarksHtml } from '../../src/main/import/ImportParsers';
import type { BookmarkEntry } from '../../src/shared/types';
const roots: string[] = [];
const bookmark = (overrides: Partial<BookmarkEntry> = {}): BookmarkEntry => ({ id: '1', url: 'https://example.test/?a=1&b=2', title: 'Книги & чтение', createdAt: 1700000000000, ...overrides });
afterEach(async () => { vi.restoreAllMocks(); dialogs.showSaveDialog.mockReset(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmark-export-')); roots.push(root); return root; }
describe('portable bookmark HTML export', () => {
  it('escapes title and attribute markup and round-trips ordinary Unicode bookmarks', () => {
    const result = buildBookmarksHtml([bookmark(), bookmark({ title: '<img src=x onerror="bad"> & \'quoted\'', url: 'https://example.test/?x=" onclick="bad&y=1' })]);
    expect(result.count).toBe(2);
    expect(result.html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(result.html).toContain('a=1&amp;b=2');
    expect(result.html).toContain('&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; &#39;quoted&#39;');
    expect(result.html).not.toContain('<img');
    expect(parseBookmarksHtml(result.html).records[0]).toMatchObject({ url: 'https://example.test/?a=1&b=2', title: 'Книги & чтение', createdAt: 1700000000000 });
  });
  it('exports HTTP(S) bookmarks only and omits embedded credentials and extra profile fields', () => {
    const entries = ['javascript:alert(1)', 'file:///home/secret', 'data:text/html,bad', 'https://user:secret@example.test/', 'invalid', 'https://safe.test/', 'http://safe.test/'].map(url => bookmark({ url, favicon: 'secret-profile-data' }));
    const result = buildBookmarksHtml(entries);
    expect(result.count).toBe(2);
    expect(result.html).not.toMatch(/secret|javascript:|file:\/\/|data:text/);
  });
  it('supports empty exports and rejects more than 5000 entries rather than silently losing bookmarks', () => {
    expect(buildBookmarksHtml([]).count).toBe(0);
    expect(buildBookmarksHtml(Array.from({ length: 5000 }, () => bookmark())).count).toBe(5000);
    expect(() => buildBookmarksHtml(Array.from({ length: 5001 }, () => bookmark()))).toThrow('5000');
  });
  it('writes the selected export atomically and leaves no temporary file', async () => {
    const root = await directory(); const target = path.join(root, 'bookmarks.html');
    await fs.writeFile(target, 'old');
    await writeBookmarksHtml(target, buildBookmarksHtml([bookmark()]).html);
    expect(await fs.readFile(target, 'utf8')).toContain('NETSCAPE-Bookmark-file-1');
    expect(await fs.readdir(root)).toEqual(['bookmarks.html']);
  });
  it('preserves the old file and cleans up temporary data if replacing fails', async () => {
    const root = await directory(); const target = path.join(root, 'bookmarks.html');
    await fs.writeFile(target, 'old');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Cannot replace'));
    await expect(writeBookmarksHtml(target, 'new')).rejects.toThrow('Cannot replace');
    expect(await fs.readFile(target, 'utf8')).toBe('old');
    expect(await fs.readdir(root)).toEqual(['bookmarks.html']);
  });
  it('canceling the native Save dialog creates no export', async () => {
    dialogs.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await exportBookmarksHtml({} as any, [bookmark()])).toEqual({ saved: false, count: 0 });
  });
  it('returns actual saved count and selected destination after the native dialog', async () => {
    const target = path.join(await directory(), 'chosen.html');
    dialogs.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    expect(await exportBookmarksHtml({} as any, [bookmark(), bookmark({ url: 'javascript:bad' })])).toEqual({ saved: true, count: 1, path: target });
    expect(await fs.readFile(target, 'utf8')).toContain('Книги &amp; чтение');
  });
});
