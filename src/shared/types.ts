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
  isReaderAvailable?: boolean;
  isReaderActive?: boolean;
  hasVideoMedia?: boolean;
  isPictureInPicture?: boolean;
  lastError?: {
    errorCode?: number;
    errorDescription?: string;
    validatedURL?: string;
  };
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

export type AccentColor = 'blue' | 'teal' | 'violet' | 'rose' | 'pink' | 'white' | 'milk' | 'graphite';

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'graphite';
export type ReaderFontFamily = 'sans' | 'serif' | 'mono';

export interface ReaderSettings {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: number;
  lineHeight?: number;
  maxWidth?: number;
}

export interface ReaderArticle {
  title: string;
  byline?: string;
  excerpt?: string;
  content: string;
  textContent?: string;
  length?: number;
  siteName?: string;
  publishedTime?: string;
  readingTimeMinutes?: number;
  lang?: string;
}

export type NoteColor = 'default' | 'yellow' | 'pink' | 'blue' | 'green' | 'violet';

export interface NoteEntry {
  id: string;
  title: string;
  content: string;
  color?: NoteColor;
  url?: string;
  tabTitle?: string;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveNoteInput {
  id?: string;
  title?: string;
  content: string;
  color?: NoteColor;
  url?: string;
  tabTitle?: string;
  isPinned?: boolean;
}

export interface BrowserSettings {
  theme: 'light' | 'dark' | 'graphite' | 'system';
  sidebarCollapsed: boolean;
  searchEngine: string;
  newTabBackground: NewTabBackground;
  appearancePreset?: 'classic' | 'detroit' | 'cyberpink' | 'cyberpink-fuji' | 'cyber-butterfly' | 'tokyo-night' | 'celestial-palace';
  accentColor?: AccentColor;
  wallpaperDim?: number;
  sleepAfterMinutes: 5 | 15 | 30 | 60 | 0;
  adBlockEnabled?: boolean;
  adBlockExceptions?: string[];
  blockThirdPartyCookies?: boolean;
  googleSignInCompatibility?: boolean;
  restoreSession?: boolean;
  thirdPartyCookieExceptions?: string[];
  readerSettings?: ReaderSettings;
}

export type NotificationPermissionDecision = 'allow' | 'deny';

export interface NotificationPermissionEntry {
  origin: string;
  decision: NotificationPermissionDecision;
  updatedAt: number;
}

export type PrivacyCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface PrivacySitePermission {
  id: string;
  origin: string;
  kind: 'notifications' | 'cookies' | 'adblock';
  decision: 'allow' | 'deny' | 'exception';
  label: string;
  updatedAt?: number;
}

export interface PrivacyDashboardSnapshot {
  checkedAt: number;
  isPrivate: boolean;
  externalIp: {
    value?: string;
    family?: 'IPv4' | 'IPv6';
    status: 'ok' | 'unavailable';
    source: string;
    error?: string;
  };
  route: {
    mode: 'direct' | 'browsec' | 'proxy' | 'unknown';
    label: string;
    detail: string;
    proxyRule?: string;
    serverStatus?: VpnServerHealth;
  };
  serverHealth?: VpnServerHealth | null;
  vpnHealth?: VpnHealthStatus | null;
  dns: {
    servers: string[];
    status: 'system' | 'unavailable';
    detail: string;
  };
  blockedTrackers: {
    total: number;
    topHosts: Array<{ host: string; count: number }>;
    enabled: boolean;
  };
  sitePermissions: PrivacySitePermission[];
  leakChecks: Array<{
    id: 'external-ip' | 'dns' | 'webrtc' | 'third-party-cookies' | 'server-health';
    label: string;
    status: PrivacyCheckStatus;
    detail: string;
  }>;
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
  online?: boolean;
  latency?: number;
}

export type VpnServerStatus = 'online' | 'offline' | 'unknown';

export interface VpnServerHealth {
  countryCode: string;
  serverHost: string;
  port?: number;
  status: VpnServerStatus;
  ping: number;
  lastChecked: number;
  error?: string;
}

export interface VpnHealthStatus {
  lastChecked: number | null;
  nextScheduledCheck: number | null;
  isChecking: boolean;
  overallStatus: 'online' | 'offline' | 'degraded' | 'unknown';
  servers: Record<string, VpnServerHealth>;
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
  status?: VpnServerStatus;
  lastChecked?: number;
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
  healthStatus?: VpnHealthStatus;
  serverStatus?: VpnServerHealth;
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
  notificationPermissions: NotificationPermissionEntry[];
  vpn: VpnSnapshot;
  browsec: BrowsecState;
  googleAccounts?: GoogleAccount[];
  activeGoogleAccount?: GoogleAccount | null;
  adBlock: {
    enabled: boolean;
    blockedTotal: number;
    blockedByHost: Record<string, number>;
    exceptions?: string[];
  };
  notes?: NoteEntry[];
  readerSettings?: ReaderSettings;
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

export type TaskManagerProcessType = 'browser' | 'gpu' | 'tab' | 'utility' | 'shell' | 'zygote' | 'unknown';

export interface TaskManagerProcess {
  pid: number;
  type: TaskManagerProcessType;
  title: string;
  url?: string;
  tabId?: string;
  favicon?: string;
  cpuPercent: number;
  memoryWorkingSetMB: number;
  isKillable: boolean;
}

export interface TaskManagerSnapshot {
  sampledAt: number;
  processes: TaskManagerProcess[];
}

