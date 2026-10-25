import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('BrowserStores', () => {
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

  it('uses Yandex as the default search engine and migrates the old Google default', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-'));
    temporaryDirectories.push(directory);
    const stores = new BrowserStores(directory);
    expect(stores.settings.get().searchEngine).toBe('https://yandex.ru/search/?text=');

    stores.settings.set({ ...stores.settings.get(), searchEngine: 'https://www.google.com/search?q=' });
    const migrated = new BrowserStores(directory);
    expect(migrated.settings.get().searchEngine).toBe('https://yandex.ru/search/?text=');
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
});
