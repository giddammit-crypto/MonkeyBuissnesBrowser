import path from 'node:path';
import type {
  BookmarkEntry,
  BrowsecCountry,
  BrowsecSmartRule,
  BrowsecState,
  BrowserSettings,
  DownloadEntry,
  GoogleAccount,
  HistoryEntry,
  TabSnapshot,
  WorkspaceEntry,
} from '../../shared/types';
import { isSafeWebUrl } from '../../shared/omnibox';
import { JsonStore } from './JsonStore';
import { normalizeCookieExceptions, normalizeSiteExceptions } from '../../shared/sitePolicy';
import { normalizeNewTabBackground } from '../../shared/background';

const defaultSettings: BrowserSettings = {
  theme: 'system',
  sidebarCollapsed: false,
  searchEngine: 'https://yandex.ru/search/?text=',
  newTabBackground: 'portrait',
  sleepAfterMinutes: 15,
  adBlockEnabled: true,
  adBlockExceptions: [],
  blockThirdPartyCookies: true,
  googleSignInCompatibility: true,
  restoreSession: true,
};

const defaultWorkspaces: WorkspaceEntry[] = [
  { id: 'personal', name: 'Личное', color: '#784C40', tabIds: [] },
];

export const defaultBrowsecCountries: BrowsecCountry[] = [
  { code: 'nl', name: 'Нидерланды', nameEn: 'Netherlands', flag: '🇳🇱', ping: 22, serverHost: 'nl.browsec.com' },
  { code: 'us', name: 'США', nameEn: 'United States', flag: '🇺🇸', ping: 85, serverHost: 'us.browsec.com' },
  { code: 'gb', name: 'Великобритания', nameEn: 'United Kingdom', flag: '🇬🇧', ping: 35, serverHost: 'uk.browsec.com' },
  { code: 'sg', name: 'Сингапур', nameEn: 'Singapore', flag: '🇸🇬', ping: 160, serverHost: 'sg.browsec.com' },
  { code: 'de', name: 'Германия', nameEn: 'Germany', flag: '🇩🇪', ping: 28, serverHost: 'de.browsec.com' },
  { code: 'fr', name: 'Франция', nameEn: 'France', flag: '🇫🇷', ping: 32, serverHost: 'fr.browsec.com' },
  { code: 'ca', name: 'Канада', nameEn: 'Canada', flag: '🇨🇦', ping: 95, serverHost: 'ca.browsec.com' },
  { code: 'jp', name: 'Япония', nameEn: 'Japan', flag: '🇯🇵', ping: 140, serverHost: 'jp.browsec.com' },
  { code: 'au', name: 'Австралия', nameEn: 'Australia', flag: '🇦🇺', ping: 210, serverHost: 'au.browsec.com' },
  { code: 'ch', name: 'Швейцария', nameEn: 'Switzerland', flag: '🇨🇭', ping: 34, serverHost: 'ch.browsec.com' },
  { code: 'se', name: 'Швеция', nameEn: 'Sweden', flag: '🇸🇪', ping: 38, serverHost: 'se.browsec.com' },
  { code: 'pl', name: 'Польша', nameEn: 'Poland', flag: '🇵🇱', ping: 30, serverHost: 'pl.browsec.com' },
  { code: 'it', name: 'Италия', nameEn: 'Italy', flag: '🇮🇹', ping: 42, serverHost: 'it.browsec.com' },
  { code: 'es', name: 'Испания', nameEn: 'Spain', flag: '🇪🇸', ping: 45, serverHost: 'es.browsec.com' },
  { code: 'at', name: 'Австрия', nameEn: 'Austria', flag: '🇦🇹', ping: 33, serverHost: 'at.browsec.com' },
  { code: 'be', name: 'Бельгия', nameEn: 'Belgium', flag: '🇧🇪', ping: 31, serverHost: 'be.browsec.com' },
  { code: 'br', name: 'Бразилия', nameEn: 'Brazil', flag: '🇧🇷', ping: 190, serverHost: 'br.browsec.com' },
  { code: 'bg', name: 'Болгария', nameEn: 'Bulgaria', flag: '🇧🇬', ping: 48, serverHost: 'bg.browsec.com' },
  { code: 'cz', name: 'Чехия', nameEn: 'Czech Republic', flag: '🇨🇿', ping: 36, serverHost: 'cz.browsec.com' },
  { code: 'dk', name: 'Дания', nameEn: 'Denmark', flag: '🇩🇰', ping: 39, serverHost: 'dk.browsec.com' },
  { code: 'ee', name: 'Эстония', nameEn: 'Estonia', flag: '🇪🇪', ping: 41, serverHost: 'ee.browsec.com' },
  { code: 'fi', name: 'Финляндия', nameEn: 'Finland', flag: '🇫🇮', ping: 43, serverHost: 'fi.browsec.com' },
  { code: 'hk', name: 'Гонконг', nameEn: 'Hong Kong', flag: '🇭🇰', ping: 170, serverHost: 'hk.browsec.com' },
  { code: 'hu', name: 'Венгрия', nameEn: 'Hungary', flag: '🇭🇺', ping: 40, serverHost: 'hu.browsec.com' },
  { code: 'is', name: 'Исландия', nameEn: 'Iceland', flag: '🇮🇸', ping: 65, serverHost: 'is.browsec.com' },
  { code: 'in', name: 'Индия', nameEn: 'India', flag: '🇮🇳', ping: 135, serverHost: 'in.browsec.com' },
  { code: 'ie', name: 'Ирландия', nameEn: 'Ireland', flag: '🇮🇪', ping: 44, serverHost: 'ie.browsec.com' },
  { code: 'il', name: 'Израиль', nameEn: 'Israel', flag: '🇮🇱', ping: 72, serverHost: 'il.browsec.com' },
  { code: 'lv', name: 'Латвия', nameEn: 'Latvia', flag: '🇱🇻', ping: 42, serverHost: 'lv.browsec.com' },
  { code: 'lt', name: 'Литва', nameEn: 'Lithuania', flag: '🇱🇹', ping: 40, serverHost: 'lt.browsec.com' },
  { code: 'lu', name: 'Люксембург', nameEn: 'Luxembourg', flag: '🇱🇺', ping: 33, serverHost: 'lu.browsec.com' },
  { code: 'mx', name: 'Мексика', nameEn: 'Mexico', flag: '🇲🇽', ping: 120, serverHost: 'mx.browsec.com' },
  { code: 'md', name: 'Молдова', nameEn: 'Moldova', flag: '🇲🇩', ping: 52, serverHost: 'md.browsec.com' },
  { code: 'nz', name: 'Новая Зеландия', nameEn: 'New Zealand', flag: '🇳🇿', ping: 230, serverHost: 'nz.browsec.com' },
  { code: 'no', name: 'Норвегия', nameEn: 'Norway', flag: '🇳🇴', ping: 45, serverHost: 'no.browsec.com' },
  { code: 'ro', name: 'Румыния', nameEn: 'Romania', flag: '🇷🇴', ping: 49, serverHost: 'ro.browsec.com' },
  { code: 'rs', name: 'Сербия', nameEn: 'Serbia', flag: '🇷🇸', ping: 51, serverHost: 'rs.browsec.com' },
  { code: 'sk', name: 'Словакия', nameEn: 'Slovakia', flag: '🇸🇰', ping: 38, serverHost: 'sk.browsec.com' },
  { code: 'za', name: 'ЮАР', nameEn: 'South Africa', flag: '🇿🇦', ping: 185, serverHost: 'za.browsec.com' },
  { code: 'kr', name: 'Южная Корея', nameEn: 'South Korea', flag: '🇰🇷', ping: 155, serverHost: 'kr.browsec.com' },
  { code: 'tr', name: 'Турция', nameEn: 'Turkey', flag: '🇹🇷', ping: 60, serverHost: 'tr.browsec.com' },
  { code: 'ua', name: 'Украина', nameEn: 'Ukraine', flag: '🇺🇦', ping: 46, serverHost: 'ua.browsec.com' },
  { code: 'ae', name: 'ОАЭ', nameEn: 'UAE', flag: '🇦🇪', ping: 98, serverHost: 'ae.browsec.com' },
  { code: 'ar', name: 'Аргентина', nameEn: 'Argentina', flag: '🇦🇷', ping: 215, serverHost: 'ar.browsec.com' },
];

export const defaultBrowsecSmartRules: BrowsecSmartRule[] = [
  { id: 'rule-youtube', domain: 'youtube.com', country: 'us', countryCode: 'us', enabled: true },
  { id: 'rule-rutracker', domain: 'rutracker.org', country: 'nl', countryCode: 'nl', enabled: true },
  { id: 'rule-x', domain: 'x.com', country: 'nl', countryCode: 'nl', enabled: true },
  { id: 'rule-instagram', domain: 'instagram.com', country: 'de', countryCode: 'de', enabled: true },
];

export const defaultBrowsecState: BrowsecState = {
  enabled: false,
  country: 'nl',
  selectedCountry: 'nl',
  smartSettingsEnabled: true,
  smartRules: defaultBrowsecSmartRules,
  webrtcProtection: true,
  webrtcLeakProtection: true,
};

function normalizeBrowsecState(value: unknown): BrowsecState {
  const raw = object(value);
  const rawCountry = typeof raw.country === 'string' ? raw.country : typeof raw.selectedCountry === 'string' ? raw.selectedCountry : 'nl';
  const countryCode = defaultBrowsecCountries.some((c) => c.code === rawCountry) ? rawCountry : 'nl';
  const rules = Array.isArray(raw.smartRules)
    ? raw.smartRules.filter((r) => r && typeof r === 'object' && typeof (r as JsonObject).domain === 'string').map((r) => {
        const obj = r as JsonObject;
        const ruleCountry = typeof obj.country === 'string' ? obj.country : typeof obj.countryCode === 'string' ? obj.countryCode : 'nl';
        return {
          id: typeof obj.id === 'string' && obj.id ? obj.id : crypto.randomUUID(),
          domain: text(obj.domain).trim().toLowerCase().slice(0, 255),
          country: ruleCountry,
          countryCode: ruleCountry,
          enabled: obj.enabled !== false,
        };
      }).filter((r) => Boolean(r.domain))
    : defaultBrowsecSmartRules;

  const webrtc = typeof raw.webrtcProtection === 'boolean' ? raw.webrtcProtection : typeof raw.webrtcLeakProtection === 'boolean' ? raw.webrtcLeakProtection : true;

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    country: countryCode,
    selectedCountry: countryCode,
    smartSettingsEnabled: typeof raw.smartSettingsEnabled === 'boolean' ? raw.smartSettingsEnabled : true,
    smartRules: rules.slice(0, 200),
    webrtcProtection: webrtc,
    webrtcLeakProtection: webrtc,
  };
}

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
    newTabBackground: normalizeNewTabBackground(raw.newTabBackground),
    appearancePreset: ['detroit', 'cyberpink', 'cyberpink-fuji', 'cyber-butterfly', 'tokyo-night', 'celestial-palace'].includes(text(raw.appearancePreset)) ? raw.appearancePreset as BrowserSettings['appearancePreset'] : 'classic',
    accentColor: ['blue', 'teal', 'violet', 'rose', 'pink', 'white', 'milk', 'graphite'].includes(text(raw.accentColor)) ? raw.accentColor as BrowserSettings['accentColor'] : 'blue',
    wallpaperDim: finite(raw.wallpaperDim) ? Math.max(0, Math.min(75, Math.round(raw.wallpaperDim))) : 0,
    sleepAfterMinutes: [0, 5, 15, 30, 60].includes(Number(raw.sleepAfterMinutes)) && typeof raw.sleepAfterMinutes === 'number' ? raw.sleepAfterMinutes as BrowserSettings['sleepAfterMinutes'] : defaultSettings.sleepAfterMinutes,
    adBlockEnabled: typeof raw.adBlockEnabled === 'boolean' ? raw.adBlockEnabled : true,
    adBlockExceptions: normalizeSiteExceptions(raw.adBlockExceptions),
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
  const validTab = (entry: JsonObject) => entry.isPrivate !== true && (entry.url === 'browser://newtab' || isSafeWebUrl(text(entry.url)));
  const tabs = normalizeEntries<JsonObject>(raw.tabs, validTab, 100);
  const original = Array.isArray(raw.tabs) ? raw.tabs : [];
  const active = finite(raw.activeIndex) && Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 ? original[raw.activeIndex] : undefined;
  // Keep the same bounded first-tabs policy, but never silently discard the
  // selected valid ordinary tab when it falls beyond the storage budget.
  if (active && typeof active === 'object' && !Array.isArray(active) && validTab(active as JsonObject) && !tabs.includes(active as JsonObject)) {
    if (tabs.length === 100) tabs.pop();
    tabs.push(active as JsonObject);
  }
  return {
    tabs: tabs.map((tab) => ({ url: text(tab.url), title: text(tab.title).slice(0, 1000), workspaceId: text(tab.workspaceId, 'personal'), isPinned: tab.isPinned === true, isMuted: tab.isMuted === true })),
    activeIndex: Math.max(0, tabs.indexOf(active as JsonObject)),
  };
}

/** Session persistence is an allowlist: private tabs and runtime fields never reach disk. */
export function buildStoredSession(tabs: TabSnapshot[], activeTabId: string): StoredSession {
  const eligible = tabs.filter((tab) => !tab.isPrivate && (tab.url === 'browser://newtab' || isSafeWebUrl(tab.url)));
  const active = eligible.find((tab) => tab.id === activeTabId);
  const regularTabs = eligible.slice(0, 100);
  if (active && !regularTabs.includes(active)) {
    if (regularTabs.length === 100) regularTabs.pop();
    regularTabs.push(active);
  }
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
  readonly browsec: JsonStore<BrowsecState>;
  readonly googleAccounts: JsonStore<{ accounts: GoogleAccount[]; activeId?: string }>;

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
    this.browsec = new JsonStore(path.join(dataPath, 'browsec-settings.json'), defaultBrowsecState, normalizeBrowsecState);
    this.googleAccounts = new JsonStore(path.join(dataPath, 'google-accounts.json'), { accounts: [] }, (raw) => {
      if (!raw || typeof raw !== 'object') return { accounts: [] };
      const obj = raw as Record<string, unknown>;
      const activeId = typeof obj.activeId === 'string' ? obj.activeId : undefined;
      const accounts: GoogleAccount[] = Array.isArray(obj.accounts)
        ? obj.accounts
            .filter((a): a is Record<string, unknown> & { email: string } => Boolean(a && typeof a === 'object' && typeof (a as { email?: unknown }).email === 'string'))
            .map((a) => ({
              id: String(a.id || a.email),
              email: a.email,
              name: String(a.name || a.email.split('@')[0]),
              avatar: typeof a.avatar === 'string' ? a.avatar : undefined,
              isActive: a.id === activeId || a.email === activeId || Boolean(a.isActive),
              addedAt: typeof a.addedAt === 'number' ? a.addedAt : Date.now(),
            }))
            .slice(0, 20)
        : [];
      return { accounts, activeId: activeId || accounts[0]?.id };
    });
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

  saveBookmark(input: { id?: string; title: string; url: string; favicon?: string }): BookmarkEntry {
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
    const next: BookmarkEntry = { id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? Date.now(), url: parsed.href, title: input.title.trim().slice(0, 1000) || parsed.hostname, favicon: input.favicon || existing?.favicon };
    this.bookmarks.set(existing ? items.map(item => item.id === next.id ? next : item) : [next, ...items]);
    return next;
  }
}
