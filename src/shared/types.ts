export type TabLifecycle = 'active' | 'background' | 'hibernated' | 'crashed';

export interface TabSnapshot {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isMuted: boolean;
  isAudible?: boolean;
  isPinned: boolean;
  isPrivate: boolean;
  isInternal: boolean;
  zoomFactor?: number;
  lifecycle: TabLifecycle;
  workspaceId: string;
  canDownloadMedia?: boolean;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  favicon?: string;
}

export interface DownloadEntry {
  id: string;
  url: string;
  filename: string;
  path?: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  mimeType?: string;
  isPrivate?: boolean;
  isPaused?: boolean;
  isLive?: boolean;
  canResume?: boolean;
  thumbnail?: string;
  state: 'queued' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  color: string;
  tabIds: string[];
}

export type NewTabBackground = 'portrait' | 'plain' | 'cyberpink' | 'cyberpink-fuji' | 'cyber-butterfly' | 'tokyo-night' | 'celestial-palace';

export interface BrowserSettings {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  searchEngine: string;
  newTabBackground: NewTabBackground;
  appearancePreset?: 'classic' | 'detroit' | 'cyberpink' | 'cyberpink-fuji' | 'cyber-butterfly' | 'tokyo-night' | 'celestial-palace';
  accentColor?: 'blue' | 'teal' | 'violet' | 'rose' | 'pink';
  wallpaperDim?: number;
  sleepAfterMinutes: 5 | 15 | 30 | 60 | 0;
  adBlockEnabled?: boolean;
  blockThirdPartyCookies?: boolean;
  googleSignInCompatibility?: boolean;
  restoreSession?: boolean;
  thirdPartyCookieExceptions?: string[];
}

export type ImportBrowser = 'chrome' | 'yandex' | 'firefox' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'file';
export type ImportFileKind = 'bookmarks' | 'passwords';
export interface ImportFileReport {
  kind: ImportFileKind;
  imported: number;
  skipped: number;
  warnings: string[];
  errors: string[];
}
export type ImportDataKind = 'history' | 'bookmarks' | 'cookies' | 'passwords';

export interface ImportProfile {
  id: string;
  browser: ImportBrowser;
  browserLabel: string;
  profileName: string;
  path: string;
  available: ImportDataKind[];
}

export interface ImportReport {
  browser: ImportBrowser;
  profileName: string;
  imported: Record<ImportDataKind, number>;
  skipped: Record<ImportDataKind, number>;
  warnings: string[];
  errors: string[];
}

export interface ImportedPasswordSummary {
  id: string;
  origin: string;
  username: string;
  browser: ImportBrowser;
  importedAt: number;
}

export type VpnConnectionState = 'not-configured' | 'configured' | 'error';

export interface VpnSnapshot {
  configured: boolean;
  profileName?: string;
  mode: 'system';
  state: VpnConnectionState;
  endpoint?: string;
  addresses: string[];
  dns: string[];
  peerCount: number;
  savedSecurely: boolean;
  storageBackend?: string;
  lastValidatedAt?: number;
  errors: string[];
}

export interface BrowsecServer {
  host: string;
  port: number;
}

export interface BrowsecCountry {
  code: string;
  name: string;
  nameEn: string;
  flag: string;
  ping: number;
  serverHost: string;
  servers?: BrowsecServer[];
  timezoneOffset?: number;
}

export interface BrowsecSmartRule {
  id?: string;
  domain: string;
  country: string; // country code like 'nl', 'us', etc. or 'direct'
  countryCode?: string; // alias for compatibility
  enabled: boolean;
}

export interface BrowsecState {
  enabled: boolean;
  country: string;
  selectedCountry?: string; // alias for compatibility
  smartSettingsEnabled: boolean;
  smartRules: BrowsecSmartRule[];
  webrtcProtection?: boolean;
  webrtcLeakProtection?: boolean; // alias for compatibility
  countries?: BrowsecCountry[];
}

export type BrowsecSnapshot = BrowsecState;

export interface GoogleAccount {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  addedAt: number;
}

export interface BrowserSnapshot {
  tabs: TabSnapshot[];
  activeTabId: string;
  privacy: { privateTabCount: number; proxy: string };
  history: HistoryEntry[];
  bookmarks: BookmarkEntry[];
  downloads: DownloadEntry[];
  workspaces: WorkspaceEntry[];
  settings: BrowserSettings;
  vpn: VpnSnapshot;
  browsec: BrowsecState;
  googleAccounts?: GoogleAccount[];
  activeGoogleAccount?: GoogleAccount | null;
  adBlock: {
    enabled: boolean;
    blockedTotal: number;
    blockedByHost: Record<string, number>;
  };
  performance: {
    sampledAt: number;
    availableMemory: number;
    processCount: number;
    totalWorkingSet: number;
  } | null;
}

export type NavigationIntent =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string }
  | { kind: 'invalid'; reason: string };
