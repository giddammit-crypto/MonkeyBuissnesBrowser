import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadEntry, TabSnapshot } from '../../src/shared/types';
import { BrowserStores, buildStoredSession } from '../../src/main/persistence/BrowserStores';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('BrowserStores', () => {
  it('updates a late document title without creating another visit or changing visit metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-history-title-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    const first = stores.addHistory({ url: 'https://example.test/first', title: 'Loading' });
    const second = stores.addHistory({ url: 'https://example.test/second', title: 'Second' });
    expect(stores.updateHistoryTitle(first.url, 'Actual document title')).toBe(true);
    expect(stores.history.get()).toEqual([second, { ...first, title: 'Actual document title' }]);
    expect(new BrowserStores(directory).history.get()).toEqual(stores.history.get());
    expect(stores.updateHistoryTitle(first.url, 'Actual document title')).toBe(false);
  });

  it('does not recreate removed or cleared history entries when a late title arrives', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-history-removed-title-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    const removed = stores.addHistory({ url: 'https://example.test/removed', title: 'Removed' });
    const kept = stores.addHistory({ url: 'https://example.test/kept', title: 'Kept' });
    stores.history.set([kept]);
    expect(stores.updateHistoryTitle(removed.url, 'Late title')).toBe(false);
    expect(stores.history.get()).toEqual([kept]);
    stores.history.set([]);
    expect(stores.updateHistoryTitle(kept.url, 'After clear')).toBe(false);
    expect(stores.history.get()).toEqual([]);
    expect(stores.updateHistoryTitle('javascript:alert(1)', 'Unsafe')).toBe(false);
  });

  it('persists history and bookmarks across store instances', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-'));
    temporaryDirectories.push(directory);
    const first = new BrowserStores(directory);
    first.addHistory({ url: 'https://example.com', title: 'Example' });
    first.toggleBookmark({ url: 'https://example.com', title: 'Example' });

    const second = new BrowserStores(directory);
    expect(second.history.get()[0].url).toBe('https://example.com');
    expect(second.bookmarks.get()[0].title).toBe('Example');
  });

  it('deduplicates history by URL and toggles bookmarks', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    stores.addHistory({ url: 'https://example.com', title: 'First' });
    stores.addHistory({ url: 'https://example.com', title: 'Second' });
    expect(stores.history.get()).toHaveLength(1);
    expect(stores.history.get()[0].title).toBe('Second');

    stores.toggleBookmark({ url: 'https://example.com', title: 'Example' });
    expect(stores.toggleBookmark({ url: 'https://example.com', title: 'Example' })).toBeNull();
    expect(stores.bookmarks.get()).toHaveLength(0);
  });

  it("uses Yandex by default and preserves a user's selected search engine", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    expect(stores.settings.get().searchEngine).toBe('https://yandex.ru/search/?text=');

    stores.settings.set({ ...stores.settings.get(), searchEngine: 'https://www.google.com/search?q=' });
    const migrated = new BrowserStores(directory);
    expect(migrated.settings.get().searchEngine).toBe('https://www.google.com/search?q=');
  });

  it('persists download entries for the Downloads panel', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-'));
    temporaryDirectories.push(directory);
    const first = new BrowserStores(directory);
    first.downloads.set([{
      id: 'download-1',
      url: 'https://example.com/photo.jpg',
      filename: 'photo.jpg',
      kind: 'image',
      state: 'completed',
      receivedBytes: 120,
      totalBytes: 120,
      startedAt: 100,
      finishedAt: 200,
    }]);

    const second = new BrowserStores(directory);
    expect(second.downloads.get()[0]).toMatchObject({ filename: 'photo.jpg', kind: 'image', state: 'completed' });
  });

  it('migrates Google/YouTube compatibility on and preserves an explicit opt-out', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-login-settings-'));
    temporaryDirectories.push(directory);
    const first = new BrowserStores(directory);
    expect(first.settings.get().googleSignInCompatibility).toBe(true);
    first.settings.set({ ...first.settings.get(), googleSignInCompatibility: false });
    expect(new BrowserStores(directory).settings.get().googleSignInCompatibility).toBe(false);
  });

  it('edits bookmarks without changing identity or losing them after restart', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-bookmark-manager-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    const saved = stores.saveBookmark({title:' Original ',url:'https://example.test'});
    const edited = stores.saveBookmark({id:saved.id,title:'Changed',url:'https://example.test/new'});
    expect(edited).toMatchObject({id:saved.id,createdAt:saved.createdAt,title:'Changed',url:'https://example.test/new'});
    expect(new BrowserStores(directory).bookmarks.get()).toEqual([edited]);
    expect(()=>stores.saveBookmark({title:'Duplicate',url:edited.url})).toThrow('уже есть');
    expect(()=>stores.saveBookmark({id:'missing',title:'Stale',url:'https://new.test'})).toThrow('уже удалена');
    expect(stores.bookmarks.get()).toEqual([edited]);
  });

  it('rejects unsafe bookmark URLs and credentials while keeping existing records', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-bookmark-urls-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    const saved=stores.saveBookmark({title:'Safe',url:'https://safe.test/'});
    for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:secret@host.test','not a url']) {
      expect(()=>stores.saveBookmark({id:saved.id,title:'Bad',url})).toThrow();
    }
    expect(stores.bookmarks.get()).toEqual([saved]);
  });
});


describe('defensive browser persistence', () => {
  function directory(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-stores-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'browser-data'));
    return root;
  }

  it('merges missing settings while rejecting invalid types and unsafe URLs', () => {
    const root = directory();
    fs.writeFileSync(path.join(root, 'browser-data/settings.json'), JSON.stringify({ theme: 'dark', searchEngine: 'javascript:alert(1)', sleepAfterMinutes: '5', restoreSession: false }));
    const stores = new BrowserStores(root);
    expect(stores.settings.get()).toMatchObject({ theme: 'dark', searchEngine: 'https://yandex.ru/search/?text=', sleepAfterMinutes: 15, restoreSession: false, adBlockEnabled: true, sidebarCollapsed: false });
  });

  it('recovers from null objects and corrupted collection entries without crashing', () => {
    const root = directory();
    fs.writeFileSync(path.join(root, 'browser-data/settings.json'), 'null');
    fs.writeFileSync(path.join(root, 'browser-data/history.json'), JSON.stringify([null, { url: 'https://example.test', title: null }, { id: 'safe', title: 'Valid', url: 'https://example.test/', visitedAt: 10 }]));
    fs.writeFileSync(path.join(root, 'browser-data/workspaces.json'), '{}');
    fs.writeFileSync(path.join(root, 'browser-data/bookmarks.json'), '{broken');
    const stores = new BrowserStores(root);
    expect(stores.settings.get().theme).toBe('system');
    expect(stores.history.get()).toHaveLength(1);
    expect(stores.bookmarks.get()).toEqual([]);
    expect(stores.workspaces.get()[0].id).toBe('personal');
  });

  it('excludes private tabs, unsafe schemes, and runtime fields from session files', () => {
    const root = directory();
    const tab = (id: string, url: string, isPrivate = false) => ({ id, url, title: id, workspaceId: 'personal', isPrivate, isPinned: false, isMuted: false, favicon: 'https://secret.test/favicon' } as TabSnapshot);
    const tabs = [tab('private-secret', 'https://secret.test/', true), tab('normal', 'https://example.test/'), tab('blocked', 'file:///etc/passwd'), tab('selected', 'browser://newtab')];
    const stores = new BrowserStores(root);
    stores.session.set(buildStoredSession(tabs, 'selected'));
    const saved = fs.readFileSync(path.join(root, 'browser-data/session.json'), 'utf8');
    expect(saved).not.toContain('secret');
    expect(saved).not.toContain('favicon');
    expect(saved).not.toContain('file:');
    const restored = new BrowserStores(root).session.get();
    expect(restored.tabs).toHaveLength(2);
    expect(restored.activeIndex).toBe(1);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(root, 'browser-data/session.json')).mode & 0o777).toBe(0o600);
  });

  it('keeps normal blob exports after restart without allowing unsafe sources or private exports', () => {
    const root = directory();
    const stores = new BrowserStores(root);
    const record = (id: string, url: string, isPrivate = false) => ({ id, url, filename: `${id}.csv`, path: `/saved/${id}.csv`, state: 'completed', kind: 'file', receivedBytes: 12, totalBytes: 12, startedAt: 100, isPrivate } as DownloadEntry);
    stores.downloads.set([
      record('normal-export', 'blob:https://example.test/valid-export'),
      record('local-export', 'blob:http://localhost:4174/valid-export'),
      record('private-export', 'blob:https://secret.test/private-export', true),
      record('unsafe-file', 'blob:file:///etc/passwd'),
      record('unsafe-script', 'javascript:alert(1)'),
    ]);
    const restored = new BrowserStores(root).downloads.get();
    expect(restored.map((entry) => entry.id)).toEqual(['normal-export', 'local-export']);
    expect(restored[0]).toMatchObject({ path: '/saved/normal-export.csv', state: 'completed' });
    expect(fs.readFileSync(path.join(root, 'browser-data/downloads.json'), 'utf8')).not.toContain('secret.test');
    expect(buildStoredSession([{ id: 'blob-tab', url: restored[0].url, isPrivate: false } as TabSnapshot], 'blob-tab').tabs).toEqual([]);
  });

  it('defensively prevents private download records from being persisted', () => {
    const root = directory();
    const stores = new BrowserStores(root);
    stores.downloads.set([{ id: 'private', filename: 'secret', url: 'https://secret.test/', isPrivate: true, state: 'completed' } as never]);
    expect(new BrowserStores(root).downloads.get()).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'browser-data/downloads.json'), 'utf8')).not.toContain('secret');
  });
});

// Restoring a bounded session must not replace the page the user actually left
// selected, even when private/invalid records precede it in an old session file.
describe('bounded session active-tab retention', () => {
  const ordinary = (index: number): TabSnapshot => ({
    id: `ordinary-${index}`, url: `https://example.test/${index}`, title: `Ordinary ${index}`,
    workspaceId: 'personal', isPrivate: false, isPinned: index === 130, isMuted: false,
    isInternal: false, isLoading: false, canGoBack: false, canGoForward: false, lifecycle: 'background',
  });
  function root(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-session-budget-'));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, 'browser-data'));
    return directory;
  }

  it('keeps the first 99 eligible tabs plus an active ordinary tab beyond the 100-tab budget', () => {
    const tabs = Array.from({ length: 140 }, (_, index) => ordinary(index));
    const privateTab = { ...ordinary(999), id: 'private', url: 'https://secret.test/', isPrivate: true };
    const invalidTab = { ...ordinary(998), id: 'invalid', url: 'file:///private/local-file' };
    const source = [privateTab, ...tabs.slice(0, 50), invalidTab, ...tabs.slice(50)];
    const stored = buildStoredSession(source, tabs[130].id);
    expect(stored.tabs.map(tab => tab.url)).toEqual([...tabs.slice(0, 99).map(tab => tab.url), tabs[130].url]);
    expect(stored.activeIndex).toBe(99);
    expect(stored.tabs[stored.activeIndex]).toMatchObject({ url: tabs[130].url, title: 'Ordinary 130', isPinned: true });
    const stores = new BrowserStores(root());
    stores.session.set(stored);
    expect(stores.session.get()).toEqual(stored);
    const newTab = { ...ordinary(999), id: 'selected-newtab', url: 'browser://newtab', isInternal: true };
    const withNewTab = buildStoredSession([...tabs, newTab], newTab.id);
    expect(withNewTab.tabs).toHaveLength(100);
    expect(withNewTab.tabs[withNewTab.activeIndex].url).toBe('browser://newtab');
  });

  it('retains a valid active raw session entry beyond the budget while filtering private and unsafe records', () => {
    const tabs = Array.from({ length: 140 }, (_, index) => ordinary(index));
    const source = [
      { ...ordinary(998), isPrivate: true, url: 'https://secret.test/' },
      { ...ordinary(999), url: 'javascript:alert(1)' },
      ...tabs,
    ];
    const directory = root();
    fs.writeFileSync(path.join(directory, 'browser-data/session.json'), JSON.stringify({ tabs: source, activeIndex: source.indexOf(tabs[130]) }));
    const restored = new BrowserStores(directory).session.get();
    expect(restored.tabs.map(tab => tab.url)).toEqual([...tabs.slice(0, 99).map(tab => tab.url), tabs[130].url]);
    expect(restored.activeIndex).toBe(99);
    expect(restored.tabs[restored.activeIndex].title).toBe('Ordinary 130');
    expect(JSON.stringify(restored)).not.toContain('secret.test');
    expect(JSON.stringify(restored)).not.toContain('javascript:');
  });

  it.each([-1, 99999, 0.5, null, '130'])('uses the first eligible tab for invalid saved active index %s', (activeIndex) => {
    const directory = root();
    const tabs = Array.from({ length: 140 }, (_, index) => ordinary(index));
    fs.writeFileSync(path.join(directory, 'browser-data/session.json'), JSON.stringify({ tabs, activeIndex }));
    const restored = new BrowserStores(directory).session.get();
    expect(restored.tabs).toHaveLength(100);
    expect(restored.activeIndex).toBe(0);
    expect(restored.tabs[0].url).toBe(tabs[0].url);
  });

  it.each([0, 1])('does not promote private/unsafe selected entry %s into the restored session', (activeIndex) => {
    const directory = root();
    const tabs = [
      { ...ordinary(998), isPrivate: true, url: 'https://secret.test/' },
      { ...ordinary(999), url: 'file:///private/local-file' },
      ...Array.from({ length: 140 }, (_, index) => ordinary(index)),
    ];
    fs.writeFileSync(path.join(directory, 'browser-data/session.json'), JSON.stringify({ tabs, activeIndex }));
    const restored = new BrowserStores(directory).session.get();
    expect(restored.tabs).toHaveLength(100);
    expect(restored.activeIndex).toBe(0);
    expect(restored.tabs[0].url).toBe('https://example.test/0');
    expect(JSON.stringify(restored)).not.toContain('secret.test');
    expect(JSON.stringify(restored)).not.toContain('file:');
    const saved = buildStoredSession(tabs, tabs[activeIndex].id);
    expect(saved.activeIndex).toBe(0);
    expect(saved.tabs[0].url).toBe('https://example.test/0');
  });
});
