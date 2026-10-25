import path from 'node:path';
import type { BrowserSettings, BookmarkEntry, DownloadEntry, HistoryEntry, TabSnapshot, WorkspaceEntry } from '../../shared/types';
import { isSafeWebUrl } from '../../shared/omnibox';
import { JsonStore } from './JsonStore';
import { normalizeCookieExceptions } from '../../shared/sitePolicy';

const defaultSettings: BrowserSettings = {
  theme: 'system',
  sidebarCollapsed: false,
  searchEngine: 'https://yandex.ru/search/?text=',
  newTabBackground: 'mountain-lake',
  sleepAfterMinutes: 15,
  adBlockEnabled: true,
  blockThirdPartyCookies: true,
  googleSignInCompatibility: true,
  restoreSession: true,
};

const defaultWorkspaces: WorkspaceEntry[] = [
  { id: 'personal', name: 'Личное', color: '#784C40', tabIds: [] },
];

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Blob exports are valid download records, but remain forbidden for tab navigation. */
function isSupportedDownloadSource(rawUrl: string): boolean {
  if (isSafeWebUrl(rawUrl)) return true;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'blob:' && isSafeWebUrl(url.pathname);
  } catch {
    return false;
  }
}

function normalizeSettings(value: unknown): BrowserSettings {
  const raw = object(value);
  return {
    theme: ['light', 'dark', 'system'].includes(text(raw.theme)) ? raw.theme as BrowserSettings['theme'] : defaultSettings.theme,
    sidebarCollapsed: typeof raw.sidebarCollapsed === 'boolean' ? raw.sidebarCollapsed : defaultSettings.sidebarCollapsed,
    searchEngine: typeof raw.searchEngine === 'string' && raw.searchEngine.length <= 2000 && isSafeWebUrl(raw.searchEngine) ? raw.searchEngine : defaultSettings.searchEngine,
    newTabBackground: text(raw.newTabBackground, defaultSettings.newTabBackground).slice(0, 120),
    sleepAfterMinutes: [0, 5, 15, 30, 60].includes(Number(raw.sleepAfterMinutes)) && typeof raw.sleepAfterMinutes === 'number' ? raw.sleepAfterMinutes as BrowserSettings['sleepAfterMinutes'] : defaultSettings.sleepAfterMinutes,
    adBlockEnabled: typeof raw.adBlockEnabled === 'boolean' ? raw.adBlockEnabled : true,
    blockThirdPartyCookies: typeof raw.blockThirdPartyCookies === 'boolean' ? raw.blockThirdPartyCookies : true,
    googleSignInCompatibility: typeof raw.googleSignInCompatibility === 'boolean' ? raw.googleSignInCompatibility : true,
    thirdPartyCookieExceptions: normalizeCookieExceptions(raw.thirdPartyCookieExceptions),
    restoreSession: typeof raw.restoreSession === 'boolean' ? raw.restoreSession : true,
  };
}

function normalizeEntries<T>(value: unknown, valid: (entry: JsonObject) => boolean, limit = 500): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === 'object' && valid(entry)).slice(0, limit) as T[];
}

export interface StoredSessionTab {
  url: string;
  title?: string;
  workspaceId: string;
  isPinned?: boolean;
  isMuted?: boolean;
}

export interface StoredSession {
  tabs: StoredSessionTab[];
  activeIndex: number;
}

function normalizeSession(value: unknown): StoredSession {
  const raw = object(value);
  const tabs = normalizeEntries<JsonObject>(raw.tabs, (entry) => entry.isPrivate !== true && (entry.url === 'browser://newtab' || isSafeWebUrl(text(entry.url))), 100);
  const original = Array.isArray(raw.tabs) ? raw.tabs : [];
  const active = finite(raw.activeIndex) ? original[Math.trunc(raw.activeIndex)] : undefined;
  return {
    tabs: tabs.map((tab) => ({ url: text(tab.url), title: text(tab.title).slice(0, 1000), workspaceId: text(tab.workspaceId, 'personal'), isPinned: tab.isPinned === true, isMuted: tab.isMuted === true })),
    activeIndex: Math.max(0, tabs.indexOf(active as JsonObject)),
  };
}

/** Session persistence is an allowlist: private tabs and runtime fields never reach disk. */
export function buildStoredSession(tabs: TabSnapshot[], activeTabId: string): StoredSession {
  const regularTabs = tabs.filter((tab) => !tab.isPrivate && (tab.url === 'browser://newtab' || isSafeWebUrl(tab.url))).slice(0, 100);
  return {
    tabs: regularTabs.map((tab) => ({ url: tab.url, title: tab.title, workspaceId: tab.workspaceId, isPinned: tab.isPinned, isMuted: tab.isMuted })),
    activeIndex: Math.max(0, regularTabs.findIndex((tab) => tab.id === activeTabId)),
  };
}

export class BrowserStores {
  readonly history: JsonStore<HistoryEntry[]>;
  readonly bookmarks: JsonStore<BookmarkEntry[]>;
  readonly settings: JsonStore<BrowserSettings>;
  readonly workspaces: JsonStore<WorkspaceEntry[]>;
  readonly downloads: JsonStore<DownloadEntry[]>;
  readonly session: JsonStore<StoredSession>;

  constructor(userDataPath: string) {
    const dataPath = path.join(userDataPath, 'browser-data');
    const validPage = (entry: JsonObject) => typeof entry.id === 'string' && typeof entry.title === 'string' && isSafeWebUrl(text(entry.url));
    this.history = new JsonStore(path.join(dataPath, 'history.json'), [], (raw) => normalizeEntries(raw, (entry) => validPage(entry) && finite(entry.visitedAt)));
    this.bookmarks = new JsonStore(path.join(dataPath, 'bookmarks.json'), [], (raw) => normalizeEntries(raw, (entry) => validPage(entry) && finite(entry.createdAt)));
    this.settings = new JsonStore(path.join(dataPath, 'settings.json'), defaultSettings, normalizeSettings);
    this.workspaces = new JsonStore(path.join(dataPath, 'workspaces.json'), defaultWorkspaces, (raw) => {
      const entries = normalizeEntries<JsonObject>(raw, (entry) => typeof entry.id === 'string' && typeof entry.name === 'string' && /^#[a-f\d]{6}$/i.test(text(entry.color)), 100);
      return entries.length ? entries.map((entry) => ({ id: text(entry.id), name: text(entry.name).slice(0, 40), color: text(entry.color), tabIds: [] })) : structuredClone(defaultWorkspaces);
    });
    this.downloads = new JsonStore(path.join(dataPath, 'downloads.json'), [], (raw) => normalizeEntries<JsonObject>(raw, (entry) => entry.isPrivate !== true && typeof entry.id === 'string' && typeof entry.filename === 'string' && isSupportedDownloadSource(text(entry.url)) && ['queued', 'progressing', 'completed', 'cancelled', 'interrupted'].includes(text(entry.state)), 100).map((entry) => ({
      id: text(entry.id), url: text(entry.url), filename: text(entry.filename),
      path: typeof entry.path === 'string' ? entry.path : undefined,
      kind: ['image', 'video', 'audio'].includes(text(entry.kind)) ? entry.kind as DownloadEntry['kind'] : 'file',
      state: entry.state as DownloadEntry['state'],
      receivedBytes: finite(entry.receivedBytes) ? Math.max(0, entry.receivedBytes) : 0,
      totalBytes: finite(entry.totalBytes) ? Math.max(0, entry.totalBytes) : 0,
      startedAt: finite(entry.startedAt) ? entry.startedAt : Date.now(),
      finishedAt: finite(entry.finishedAt) ? entry.finishedAt : undefined,
      mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : undefined,
      thumbnail: typeof entry.thumbnail === 'string' && entry.thumbnail.startsWith('data:image/') ? entry.thumbnail : undefined,
      error: typeof entry.error === 'string' ? entry.error : undefined,
      isPaused: entry.isPaused === true,
    })));
    this.session = new JsonStore(path.join(dataPath, 'session.json'), { tabs: [], activeIndex: 0 }, normalizeSession);
  }

  addHistory(entry: Omit<HistoryEntry, 'id' | 'visitedAt'>): HistoryEntry {
    const next: HistoryEntry = { ...entry, id: crypto.randomUUID(), visitedAt: Date.now() };
    this.history.update((items) => [next, ...items.filter((item) => item.url !== next.url)].slice(0, 500));
    return next;
  }

  updateHistoryTitle(url: string, title: string): boolean {
    if (typeof url !== 'string' || typeof title !== 'string' || !isSafeWebUrl(url)) return false;
    const entries = this.history.get();
    const normalizedTitle = title.trim().slice(0, 1000) || url;
    // A delayed document title must not recreate a visit after history was
    // cleared or an individual entry was removed by the user.
    if (!entries.some(entry => entry.url === url && entry.title !== normalizedTitle)) return false;
    this.history.set(entries.map(entry => entry.url === url ? { ...entry, title: normalizedTitle } : entry));
    return true;
  }

  toggleBookmark(entry: Omit<BookmarkEntry, 'id' | 'createdAt'>): BookmarkEntry | null {
    let canonical = entry.url;
    try { canonical = new URL(entry.url).href; } catch { /* saveBookmark supplies validation. */ }
    const existing = this.bookmarks.get().find((item) => new URL(item.url).href === canonical);
    if (existing) {
      this.bookmarks.set(this.bookmarks.get().filter((item) => item.id !== existing.id));
      return null;
    }
    return this.saveBookmark(entry);
  }

  saveBookmark(input: { id?: string; title: string; url: string }): BookmarkEntry {
    if (!input || typeof input.url !== 'string' || input.url.length > 8192 || typeof input.title !== 'string') throw new Error('Укажите название и адрес закладки.');
    let parsed: URL;
    try { parsed = new URL(input.url.trim()); } catch { throw new Error('Укажите полный HTTP(S)-адрес страницы.'); }
    if (!isSafeWebUrl(parsed.href) || parsed.username || parsed.password) throw new Error('Закладка должна содержать HTTP(S)-адрес без логина и пароля.');
    const items = this.bookmarks.get();
    const existing = input.id === undefined ? undefined : items.find(item => item.id === input.id);
    if (input.id !== undefined && !existing) throw new Error('Закладка уже удалена.');
    const duplicate = items.find(item => new URL(item.url).href === parsed.href && item.id !== existing?.id);
    if (duplicate) throw new Error('Этот адрес уже есть в закладках.');
    if (!existing && items.length >= 500) throw new Error('Достигнут лимит 500 закладок. Удалите ненужные записи.');
    const next: BookmarkEntry = { id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? Date.now(), url: parsed.href, title: input.title.trim().slice(0, 1000) || parsed.hostname };
    this.bookmarks.set(existing ? items.map(item => item.id === next.id ? next : item) : [next, ...items]);
    return next;
  }
}
