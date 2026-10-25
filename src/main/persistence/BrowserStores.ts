import path from 'node:path';
import type { BrowserSettings, BookmarkEntry, DownloadEntry, HistoryEntry, WorkspaceEntry } from '../../shared/types';
import { JsonStore } from './JsonStore';

const defaultSettings: BrowserSettings = {
  theme: 'system',
  sidebarCollapsed: false,
  searchEngine: 'https://yandex.ru/search/?text=',
  newTabBackground: 'mountain-lake',
  sleepAfterMinutes: 15,
};

const defaultWorkspaces: WorkspaceEntry[] = [
  { id: 'personal', name: 'Personal', color: '#e52d3f', tabIds: [] },
];

export class BrowserStores {
  readonly history: JsonStore<HistoryEntry[]>;
  readonly bookmarks: JsonStore<BookmarkEntry[]>;
  readonly settings: JsonStore<BrowserSettings>;
  readonly workspaces: JsonStore<WorkspaceEntry[]>;
  readonly downloads: JsonStore<DownloadEntry[]>;

  constructor(userDataPath: string) {
    const dataPath = path.join(userDataPath, 'browser-data');
    this.history = new JsonStore(path.join(dataPath, 'history.json'), []);
    this.bookmarks = new JsonStore(path.join(dataPath, 'bookmarks.json'), []);
    this.settings = new JsonStore(path.join(dataPath, 'settings.json'), defaultSettings);
    this.workspaces = new JsonStore(path.join(dataPath, 'workspaces.json'), defaultWorkspaces);
    this.downloads = new JsonStore(path.join(dataPath, 'downloads.json'), []);
    if (this.settings.get().searchEngine.includes('google.com')) {
      this.settings.update((current) => ({ ...current, searchEngine: defaultSettings.searchEngine }));
    }
  }

  addHistory(entry: Omit<HistoryEntry, 'id' | 'visitedAt'>): HistoryEntry {
    const next: HistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      visitedAt: Date.now(),
    };
    this.history.update((items) => [next, ...items.filter((item) => item.url !== next.url)].slice(0, 500));
    return next;
  }

  toggleBookmark(entry: Omit<BookmarkEntry, 'id' | 'createdAt'>): BookmarkEntry | null {
    const existing = this.bookmarks.get().find((item) => item.url === entry.url);
    if (existing) {
      this.bookmarks.set(this.bookmarks.get().filter((item) => item.id !== existing.id));
      return null;
    }
    const next: BookmarkEntry = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() };
    this.bookmarks.set([next, ...this.bookmarks.get()]);
    return next;
  }
}
