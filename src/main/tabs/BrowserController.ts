import { exportBookmarksHtml } from '../services/BookmarkExportService';
import { createMediaCookieFile } from '../services/MediaCookieFile';
import { permissionRequestGuard } from '../services/PermissionRequestGuard';
import { requestedContextWindow } from '../../shared/voodooContext';
import { VoodooModelCatalog } from '../services/VoodooModelCatalog';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { VoodooFileService } from '../services/VoodooFileService';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  app,
  BaseWindow,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  WebContentsView,
} from 'electron';
import { getNextZoomFactor } from '../../shared/zoom';
import { getSplitViewBounds, normalizeSplitRatio } from '../../shared/splitView';
import { computePopupWindowBounds, isPopupWindowRequest, parseWindowFeatures, type ParsedWindowFeatures } from './popupUtils';
import type { ChromeBounds, TabAction, DownloadAction } from '../../shared/ipc';
import { FilterEngine, SessionAdBlock } from '../../services/adblock/FilterEngine';
import { MemoryManager } from '../../services/memory/MemoryManager';
import { VpnConfigStore } from '../../services/vpn/VpnConfigStore';
import { BrowsecService } from '../../services/browsec/BrowsecService';
import { LocalExtensionManager } from '../../services/extensions/LocalExtensionManager';
import { isSafeMediaUrl, isVideoPageUrl, mediaKindForMime, mediaKindForUrl, normalizeVideoUrl, videoSiteForUrl } from '../../shared/media';
import { isSafeWebUrl, parseOmniboxInput } from '../../shared/omnibox';
import { normalizeNewTabBackground } from '../../shared/background';
import { canRequestStorageAccess, getExternalPageUrl, getSiteKey, normalizeCookieExceptions, normalizePermissionOrigin, normalizeSiteExceptions, normalizeSiteKey, shouldStripThirdPartyCookies } from '../../shared/sitePolicy';
import { getClientHintHeaders, getChromeUserAgent } from '../../shared/chromiumIdentity';
import type {
  BookmarkEntry,
  BrowsecCountry,
  BrowsecState,
  BrowserSettings,
  BrowserSnapshot,
  DownloadEntry,
  HistoryEntry,
  TabSnapshot,
  VpnSnapshot,
  WorkspaceEntry,
  ImportDataKind,
  ImportFileKind,
  ImportFileReport,
  ImportProfile,
  ImportReport,
  ImportedPasswordSummary,
  GoogleAccount,
  NotificationPermissionDecision,
  PrivacyDashboardSnapshot,
  PrivacySitePermission,
  VpnHealthStatus,
  TaskManagerProcess,
  TaskManagerProcessType,
  TaskManagerSnapshot,
  ReaderArticle,
  ReaderSettings,
  NoteEntry,
  NoteColor,
  SaveNoteInput,
  VoodooChatMessage,
  VoodooChatResponse,
  VoodooKeyStatusItem,
  VoodooCheckAllKeysResult,
  TranscribeAudioResult,
  CleanTargetOptions,
  StorageMetrics,
  CleanResult,
} from '../../shared/types';
import { BrowserStores, buildStoredSession, defaultBrowsecCountries, defaultReaderSettings } from '../persistence/BrowserStores';
import { PasswordStore } from '../persistence/PasswordStore';
import { fillSavedCredential } from '../passwords/PasswordAutofill';
import { BrowserDataImporter, type ImportedCookie } from '../import/BrowserDataImporter';
import { VoodooAiService } from '../services/VoodooAiService';
import { DownloadThumbnailQueue, renderDownloadThumbnail } from '../services/DownloadThumbnailQueue';

const shellPreloadPath = path.resolve(__dirname, '../../preload/shell-preload.js');
const pagePreloadPath = path.resolve(__dirname, '../../preload/page-preload.js');

type TabRecord = TabSnapshot & {
  view?: WebContentsView;
  webContentsId?: number;
  hasDownloadableMedia?: boolean;
  capturedAudioFilename?: string;
  pipMode?: 'mini' | 'native';
};

const NEW_TAB_URL = 'browser://newtab';

function emptyNavigation(url: string): Pick<TabSnapshot, 'canGoBack' | 'canGoForward'> {
  return { canGoBack: false, canGoForward: false };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    const formatted = kb >= 100 ? Math.round(kb).toString() : kb.toFixed(1).replace(/\.0$/, '');
    return `${formatted} КБ`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    const formatted = mb >= 100 ? Math.round(mb).toString() : mb.toFixed(1).replace(/\.0$/, '');
    return `${formatted} МБ`;
  }
  const gb = mb / 1024;
  const formatted = gb >= 100 ? Math.round(gb).toString() : gb.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ГБ`;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    let total = 0;
    // Stream entries asynchronously so cache scans do not block browser input
    // or retain an entire large directory listing on the main thread.
    const directory = await fs.promises.opendir(dirPath);
    for await (const entry of directory) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) total += await getDirectorySize(fullPath);
        else if (entry.isFile()) total += (await fs.promises.stat(fullPath)).size;
      } catch { /* Cache entries may disappear during the scan. */ }
    }
    return total;
  } catch { return 0; }
}

export class BrowserController {
  readonly stores: BrowserStores;
  readonly downloads: DownloadEntry[];
  readonly tabs = new Map<string, TabRecord>();
  readonly browserSession: Electron.Session;
  readonly browsec: BrowsecService;
  readonly passwords: PasswordStore;
  readonly importer: BrowserDataImporter;
  readonly adBlock = new SessionAdBlock(new FilterEngine());
  readonly memoryManager = new MemoryManager();
  readonly vpn = new VpnConfigStore(app.getPath('userData'));
  readonly voodooService = new VoodooAiService();
  private readonly voodooModelCatalog = new VoodooModelCatalog();
  window?: BaseWindow;
  shellView?: WebContentsView;
  voodooView?: WebContentsView;
  voodooContentsId?: number;
  private voodooOpen = false;
  private voodooAbortController?: AbortController;
  private voodooDimensions = { width: 395, height: 555 };
  private voodooPosition: { x?: number; y?: number } = {};
  private voodooBubblePosition: { x?: number; y?: number } = {};
  private activeTabId = '';
  private splitView?: { primaryTabId: string; secondaryTabId: string; firstTabId: string; ratio: number };
  private activeWorkspaceId = 'personal';
  private chromeBounds: ChromeBounds = { x: 176, y: 112, width: 1200, height: 700 };
  private lastValidBounds: ChromeBounds = { x: 200, y: 144, width: 1240, height: 756 };
  private snapshotListener?: (snapshot: BrowserSnapshot) => void;
  private eventListener?: (event: { type: string; tab?: TabSnapshot; message?: string }) => void;
  private shellContentsId?: number;
  private metricsTimer?: NodeJS.Timeout;
  private memorySweepRunning = false;
  private readonly tabHandlerCleanup = new Map<number, () => void>();
  private readonly pageIpcCleanup: Array<() => void> = [];
  private thumbnailQueue?: DownloadThumbnailQueue;
  private snapshotTimer?: NodeJS.Timeout;
  private downloadPersistTimer?: NodeJS.Timeout;
  private sessionPersistTimer?: NodeJS.Timeout;
  private sessionSignature = '';
  private restoring = false;
  private disposed = false;
  private popoverOpen = false;
  private htmlFullscreenTabId?: string;
  private fullscreenBeforeVideo = false;
  private privateSession?: Electron.Session;
  private privateProxy = '';
  private privateProxyReady: Promise<void> = Promise.resolve();
  private privateAdBlock = new SessionAdBlock(new FilterEngine());
  private readonly sessionDownloadHandlers = new Map<Electron.Session, (event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => void>();
  private readonly liveDownloads = new Map<string, { item: Electron.DownloadItem; tabId?: string }>();
  private readonly ytDlpProcesses = new Map<string, { child: ChildProcess; isPaused: boolean }>();
  private readonly mediaCookieCleanup = new Map<string, () => void>();
  private closedTabs: Array<Pick<TabSnapshot, 'url' | 'workspaceId' | 'isPinned' | 'isMuted'>> = [];
  private readonly popupOpeners = new Map<string, string>();
  private readonly popupWindows = new Set<Electron.BrowserWindow>();
  private readonly popupToTab = new Map<number, string>();
  private readonly findQueries = new Map<string, string>();
  private readonly pipBounds = new Map<string, ChromeBounds>();
  private readonly capturedMediaStreams = new Map<number, { video?: string; audio?: string }>();
  private readonly notificationPermissions = new Map<string, NotificationPermissionDecision>();
  private readonly extensionsManager: LocalExtensionManager;
  private neverSaveOrigins = new Set<string>();

  constructor() {
    this.stores = new BrowserStores(app.getPath('userData'));
    const initialSettings = this.stores.settings.get();
    if (initialSettings.voodooBubblePosition) {
      this.voodooBubblePosition = { ...initialSettings.voodooBubblePosition };
    }
    nativeTheme.themeSource = initialSettings.theme === 'graphite' ? 'dark' : (initialSettings.theme || 'system');
    this.downloads = this.stores.downloads.get();
    this.normalizeDownloads();
    this.passwords = new PasswordStore(app.getPath('userData'));
    this.importer = new BrowserDataImporter(this.stores, this.passwords, (cookies) => this.setImportedCookies(cookies));
    this.browserSession = session.fromPartition('persist:northstar-default');
    const initialExceptions = this.stores.settings.get().adBlockExceptions ?? [];
    this.adBlock.engine.setExceptions(initialExceptions);
    this.privateAdBlock.engine.setExceptions(initialExceptions);
    this.extensionsManager = new LocalExtensionManager(this.browserSession, app.getPath('userData'));
    this.browsec = new BrowsecService(app.getPath('userData'));
    this.browsec.setWebContentsProvider(() => {
      const contents: Electron.WebContents[] = [];
      if (this.shellView && !this.shellView.webContents.isDestroyed()) {
        contents.push(this.shellView.webContents);
      }
      for (const tab of this.tabs.values()) {
        if (tab.view && !tab.view.webContents.isDestroyed()) {
          contents.push(tab.view.webContents);
        }
      }
      for (const popup of this.popupWindows) {
        if (!popup.isDestroyed() && !popup.webContents.isDestroyed()) {
          contents.push(popup.webContents);
        }
      }
      return contents;
    });
    this.browsec.onSnapshot((snapshot) => {
      if (this.disposed) return;
      if (this.shellView && !this.shellView.webContents.isDestroyed()) this.shellView.webContents.send('browsec:snapshot', snapshot);
      this.emitSnapshot();
    });
    void this.browsec.registerSession(this.browserSession);
    this.configureSession(this.browserSession);

    this.listenToPage('page:zoom-wheel', (event, { direction }: { direction: string }) => {
      const tab = Array.from(this.tabs.values()).find((t) => t.webContentsId === event.sender.id) || this.getActiveTab();
      if (tab && (direction === 'zoom-in' || direction === 'zoom-out')) {
        void this.tabAction(tab.id, direction);
      }
    });

    this.listenToPage('page:password-form-submitted', (event, data: { origin: string; url: string; username: string; password: string }) => {
      if (!data || !data.origin || !data.username || !data.password) return;
      if (this.neverSaveOrigins.has(data.origin)) return;
      // Найти активную вкладку
      const tab = Array.from(this.tabs.values()).find((t) => t.webContentsId === event.sender.id) || this.getActiveTab();
      if (!tab || tab.isPrivate) return; // Не сохранять пароли в режиме инкогнито!

      // Проверить, сохранен ли уже этот пароль с тем же значением
      const existing = this.passwords.findByOriginAndUser(data.origin, data.username);
      if (existing && existing.password === data.password) {
        return; // Пароль уже актуален, не беспокоим пользователя
      }

      let domain = data.origin;
      try { domain = new URL(data.origin).hostname; } catch {}

      // Отправить событие в UI shell
      this.shellView?.webContents.send('browser:event', {
        type: 'password-save-prompt',
        data: {
          id: existing?.id,
          origin: data.origin,
          domain,
          username: data.username,
          password: data.password,
          isUpdate: Boolean(existing),
        },
      });
    });
  }

  setListeners(
    snapshotListener: (snapshot: BrowserSnapshot) => void,
    eventListener: (event: { type: string; tab?: TabSnapshot; message?: string }) => void,
  ): void {
    this.snapshotListener = snapshotListener;
    this.eventListener = eventListener;
  }

  async createWindow(): Promise<void> {
    const appIconPath = path.join(app.getAppPath(), 'assets/icons/png/app-icon-512.png');
    this.window = new BaseWindow({
      width: 1440,
      height: 900,
      minWidth: 360,
      minHeight: 640,
      show: false,
      frame: false,
      backgroundColor: '#171C23',
      title: 'soulm8te',
      icon: appIconPath,
    });
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) this.window.setIcon(appIcon);

    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => {
      const isInternal = origin.startsWith('app://') || contents?.id === this.voodooContentsId || contents?.id === this.shellContentsId;
      if (['media', 'mediaKeySystem', 'speechRecognition', 'audioCapture'].includes(permission)) {
        return isInternal;
      }
      return permission === 'fullscreen' || permission === 'clipboard-sanitized-write';
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const origin = details?.requestingUrl || (contents && !contents.isDestroyed() ? contents.getURL() : '') || '';
      const isInternal = origin.startsWith('app://') || contents?.id === this.voodooContentsId || contents?.id === this.shellContentsId;
      if (['media', 'mediaKeySystem', 'speechRecognition', 'audioCapture'].includes(permission) && isInternal) {
        callback(true);
        return;
      }
      if (permission === 'fullscreen' || permission === 'clipboard-sanitized-write') {
        callback(true);
        return;
      }
      callback(false);
    });

    this.shellView = new WebContentsView({
      webPreferences: {
        preload: shellPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.shellView.setBackgroundColor('#00000000');
    this.shellContentsId = this.shellView.webContents.id;
    this.shellView.webContents.on('will-navigate', (event) => event.preventDefault());
    this.shellView.webContents.on('will-redirect', (event) => event.preventDefault());
    this.shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.shellView.webContents.on('devtools-opened', () => {
      const devContents = this.shellView?.webContents.devToolsWebContents;
      if (devContents && !devContents.isDestroyed()) {
        void devContents.insertCSS(':root { color-scheme: dark !important; } body { background-color: #1e1f29 !important; }').catch(() => undefined);
      }
    });
    this.shellView.webContents.on('devtools-closed', () => this.refreshViewBounds());
    this.installShortcuts(this.shellView.webContents);
    this.window.contentView.addChildView(this.shellView);
    this.shellView.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
    await this.shellView.webContents.loadURL('app://shell/index.html');

    this.voodooView = new WebContentsView({
      webPreferences: {
        preload: shellPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.voodooView.setBackgroundColor('#00000000');
    this.voodooContentsId = this.voodooView.webContents.id;
    this.voodooView.webContents.on('will-navigate', (event) => event.preventDefault());
    this.voodooView.webContents.on('will-redirect', (event) => event.preventDefault());
    this.voodooView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.installShortcuts(this.voodooView.webContents);
    this.window.contentView.addChildView(this.voodooView);
    this.refreshVoodooBounds();
    void this.voodooView.webContents.loadURL('app://shell/index.html?view=voodoo');

    await this.extensionsManager.restore();

    this.restoring = true;
    const savedSession = this.stores.settings.get().restoreSession !== false ? this.stores.session.get() : { tabs: [], activeIndex: 0 };
    for (const saved of savedSession.tabs) {
      if (saved.url !== NEW_TAB_URL && !isSafeWebUrl(saved.url)) continue;
      this.activeWorkspaceId = this.stores.workspaces.get().some((entry) => entry.id === saved.workspaceId) ? saved.workspaceId : 'personal';
      const restored = await this.createTab({ url: saved.url, isPrivate: false, active: false, lazy: true });
      const record = this.tabs.get(restored.id)!;
      record.title = saved.title || record.title;
      record.isPinned = Boolean(saved.isPinned);
      record.isMuted = Boolean(saved.isMuted);
      this.memoryManager.updateTab(record.id, { pinned: record.isPinned });
    }
    const restoredIds = [...this.tabs.keys()];
    if (restoredIds.length) this.activateTab(restoredIds[Math.min(savedSession.activeIndex, restoredIds.length - 1)] ?? restoredIds[0]);
    else await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
    this.restoring = false;
    this.window.on('resize', () => this.refreshViewBounds());
    this.window.on('maximize', () => this.refreshViewBounds());
    this.window.on('unmaximize', () => this.refreshViewBounds());
    this.window.on('restore', () => this.refreshViewBounds());
    this.window.on('enter-full-screen', () => {
      this.refreshViewBounds();
      this.notifyFullscreenChange(true);
      if (this.stores) this.emitSnapshot();
    });
    this.window.on('leave-full-screen', () => {
      this.refreshViewBounds();
      this.notifyFullscreenChange(false);
      if (this.stores) this.emitSnapshot();
    });
    this.window.on('closed', () => this.dispose());
    this.memoryManager.sample();
    this.metricsTimer = setInterval(() => {
      this.memoryManager.sample();
      const idleMinutes = this.stores.settings.get().sleepAfterMinutes;
      if (idleMinutes > 0) void this.hibernateIdleTabs(idleMinutes);
      this.emitSnapshot();
    }, 5000);
    this.metricsTimer.unref();
    this.window.show();
    this.emitSnapshot();

    // Verify credentials with real user requests; an eager completion per key
    // competes for provider capacity at startup. Manual bulk checks remain in Settings.
  }

  private listenToPage(channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void): void {
    const guarded = (event: Electron.IpcMainEvent, ...args: any[]) => {
      if (this.disposed || !this.isTrustedPage(event.sender.id)) return;
      listener(event, ...args);
    };
    ipcMain.on(channel, guarded);
    this.pageIpcCleanup.push(() => ipcMain.removeListener(channel, guarded));
  }

  isTrustedShell(senderId: number): boolean {
    return senderId === this.shellContentsId || (this.voodooContentsId !== undefined && senderId === this.voodooContentsId);
  }

  isTrustedPage(senderId: number): boolean {
    if ([...this.tabs.values()].some((tab) => tab.webContentsId === senderId && Boolean(tab.view) && !tab.view!.webContents.isDestroyed())) return true;
    return [...this.popupWindows].some((popup) => !popup.isDestroyed() && popup.webContents.id === senderId && !popup.webContents.isDestroyed());
  }

  getPageAdBlockPolicy(senderId: number): boolean {
    if (this.disposed || !this.isTrustedPage(senderId)) return false;
    const tab = [...this.tabs.values()].find(entry => entry.webContentsId === senderId);
    const contents = tab?.view?.webContents || [...this.popupWindows].find(popup => !popup.isDestroyed() && popup.webContents.id === senderId)?.webContents;
    if (!contents || contents.isDestroyed()) return false;
    const engine = (tab?.isPrivate || contents.session === this.privateSession) ? this.privateAdBlock.engine : this.adBlock.engine;
    return this.stores.settings.get().adBlockEnabled !== false && !engine.isException(contents.getURL());
  }

  private broadcastPageAdBlockPolicy(): void {
    for (const tab of this.tabs.values()) {
      const contents = tab.view?.webContents;
      if (contents && !contents.isDestroyed()) contents.send('page:adblock-policy', this.getPageAdBlockPolicy(contents.id));
    }
    for (const popup of this.popupWindows) {
      if (!popup.isDestroyed() && !popup.webContents.isDestroyed()) popup.webContents.send('page:adblock-policy', this.getPageAdBlockPolicy(popup.webContents.id));
    }
  }

  getSnapshot(): BrowserSnapshot {
    const storedWorkspaces = this.stores.workspaces.get();
    const tabsByWorkspace = new Map<string, string[]>();
    for (const tab of this.tabs.values()) {
      const tabIds = tabsByWorkspace.get(tab.workspaceId) ?? [];
      tabIds.push(tab.id);
      tabsByWorkspace.set(tab.workspaceId, tabIds);
    }
    const gData = this.stores.googleAccounts.get();
    const activeGoogleAccount = gData.accounts.find((a) => a.id === gData.activeId) || gData.accounts[0] || null;
    return {
      tabs: Array.from(this.tabs.values()).map((tab) => this.toSnapshot(tab)),
      activeTabId: this.activeTabId,
      splitView: this.splitView ? { secondaryTabId: this.splitView.secondaryTabId, ratio: this.splitView.ratio } : undefined,
      isFullScreen: Boolean(this.window && !this.window.isDestroyed() && this.window.isFullScreen()),
      privacy: { privateTabCount: [...this.tabs.values()].filter((tab) => tab.isPrivate).length, proxy: this.privateProxy },
      history: this.stores.history.get(),
      bookmarks: this.stores.bookmarks.get(),
      downloads: this.downloads,
      workspaces: storedWorkspaces.map((workspace) => ({ ...workspace, tabIds: tabsByWorkspace.get(workspace.id) ?? [] })),
      settings: this.stores.settings.get(),
      readerSettings: this.stores.settings.get().readerSettings || defaultReaderSettings,
      notes: this.stores.notes.get(),
      notificationPermissions: this.stores.notificationPermissions.get(),
      vpn: this.vpn.getSnapshot(),
      browsec: this.browsec.getSnapshot(),
      adBlock: this.adBlock.engine.stats(),
      googleAccounts: gData.accounts,
      activeGoogleAccount,
      performance: this.memoryManager.metrics()
        ? {
            sampledAt: this.memoryManager.metrics()!.sampledAt,
            availableMemory: this.memoryManager.metrics()!.availableMemory,
            processCount: this.memoryManager.metrics()!.processes.length,
            totalWorkingSet: this.memoryManager.metrics()!.processes.reduce((sum, process) => sum + process.workingSetSize, 0),
          }
        : null,
    };
  }

  getActiveTab(): TabRecord | undefined {
    return this.tabs.get(this.activeTabId);
  }

  async getPrivacyDashboard(tabId?: string): Promise<PrivacyDashboardSnapshot> {
    const selectedTab = tabId ? this.tabs.get(tabId) : this.tabs.get(this.activeTabId);
    const isPrivate = Boolean(selectedTab?.isPrivate);
    const targetSession = isPrivate && this.privateSession ? this.privateSession : this.browserSession;
    const settings = this.stores.settings.get();
    const browsec = this.browsec.getSnapshot();
    const adBlockStats = isPrivate ? this.privateAdBlock.engine.stats() : this.adBlock.engine.stats();
    const checkedAt = Date.now();

    let proxyRule = '';
    try {
      proxyRule = await targetSession.resolveProxy('https://api64.ipify.org');
    } catch {
      proxyRule = '';
    }

    const hasBrowsecRoute = browsec.enabled || browsec.smartRules.some((rule) => rule.enabled);
    const hasExplicitProxy = isPrivate && Boolean(this.privateProxy);
    const hasResolvedProxy = /\b(?:PROXY|HTTPS|SOCKS|SOCKS5|QUIC)\b/i.test(proxyRule);
    const routeMode: PrivacyDashboardSnapshot['route']['mode'] = hasExplicitProxy
      ? 'proxy'
      : hasBrowsecRoute || hasResolvedProxy
        ? 'browsec'
        : proxyRule
          ? 'direct'
          : 'unknown';
    const routeLabel = routeMode === 'proxy'
      ? 'Приватный прокси'
      : routeMode === 'browsec'
        ? `Browsec · ${(browsec.country || 'auto').toUpperCase()}`
        : routeMode === 'direct'
          ? 'Прямое соединение'
          : 'Маршрут не определён';
    const routeDetail = routeMode === 'proxy'
      ? 'Текущая приватная вкладка использует настроенный прокси.'
      : routeMode === 'browsec'
        ? 'Запросы проходят через маршрут Browsec или активное Smart Rule.'
        : routeMode === 'direct'
          ? 'Браузер не обнаружил активный прокси-маршрут.'
          : 'Не удалось определить состояние маршрута.';

    const externalIp = await this.fetchPrivacyExternalIp(targetSession);
    let dnsServers: string[] = [];
    try {
      dnsServers = dns.getServers().filter((server) => typeof server === 'string' && server.length > 0).slice(0, 8);
    } catch {
      dnsServers = [];
    }

    const sitePermissions: PrivacySitePermission[] = [
      ...this.stores.notificationPermissions.get().map((entry) => ({
        id: `notifications:${entry.origin}`,
        origin: entry.origin,
        kind: 'notifications' as const,
        decision: entry.decision === 'allow' ? 'allow' as const : 'deny' as const,
        label: entry.decision === 'allow' ? 'Уведомления разрешены' : 'Уведомления запрещены',
        updatedAt: entry.updatedAt,
      })),
      ...(settings.thirdPartyCookieExceptions ?? []).map((origin) => ({
        id: `cookies:${origin}`,
        origin,
        kind: 'cookies' as const,
        decision: 'allow' as const,
        label: 'Сторонние cookies разрешены',
      })),
      ...(settings.adBlockExceptions ?? []).map((origin) => ({
        id: `adblock:${origin}`,
        origin: `https://${origin}`,
        kind: 'adblock' as const,
        decision: 'exception' as const,
        label: 'Блокировка рекламы отключена',
      })),
    ].slice(0, 100);

    const routeProtected = routeMode === 'browsec' || routeMode === 'proxy';
    const serverHealth = this.browsec.getServerHealth(browsec.country);
    const vpnHealth = this.browsec.getHealthStatus();

    const leakChecks: PrivacyDashboardSnapshot['leakChecks'] = [
      {
        id: 'external-ip',
        label: 'Внешний IP',
        status: externalIp.status === 'ok' ? 'pass' : 'unknown',
        detail: externalIp.status === 'ok'
          ? `IP получен через ${externalIp.source}.`
          : 'Сервис проверки IP недоступен; попробуйте обновить проверку.',
      },
      {
        id: 'dns',
        label: 'DNS-маршрут',
        status: routeProtected ? 'pass' : dnsServers.length ? 'warn' : 'unknown',
        detail: routeProtected
          ? 'DNS-запросы выполняются в защищённом браузерном маршруте.'
          : dnsServers.length
            ? 'Используются системные DNS-серверы без активного прокси-маршрута.'
            : 'DNS-серверы определить не удалось.',
      },
      {
        id: 'webrtc',
        label: 'WebRTC leak protection',
        status: browsec.webrtcLeakProtection !== false ? 'pass' : 'warn',
        detail: browsec.webrtcLeakProtection !== false
          ? 'Непроксируемый UDP-трафик WebRTC ограничен.'
          : 'Защита WebRTC отключена в настройках Browsec.',
      },
      {
        id: 'third-party-cookies',
        label: 'Сторонние cookies',
        status: settings.blockThirdPartyCookies !== false ? 'pass' : 'warn',
        detail: settings.blockThirdPartyCookies !== false
          ? 'Сторонние cookies блокируются по умолчанию.'
          : 'Глобальная блокировка сторонних cookies отключена.',
      },
      {
        id: 'server-health',
        label: 'VPN-сервер',
        status: serverHealth.status === 'online' ? 'pass' : serverHealth.status === 'offline' ? 'fail' : 'unknown',
        detail: serverHealth.status === 'online'
          ? `Сервер ${serverHealth.serverHost} в сети (${serverHealth.ping} ms).`
          : serverHealth.status === 'offline'
            ? `Сервер ${serverHealth.serverHost} недоступен${serverHealth.error ? ` (${serverHealth.error})` : ''}.`
            : `Статус сервера ${serverHealth.serverHost} проверяется.`,
      },
    ];

    return {
      checkedAt,
      isPrivate,
      externalIp,
      route: {
        mode: routeMode,
        label: routeLabel,
        detail: routeDetail,
        proxyRule: proxyRule || undefined,
        serverStatus: serverHealth,
      },
      serverHealth,
      vpnHealth,
      dns: {
        servers: dnsServers,
        status: dnsServers.length ? 'system' : 'unavailable',
        detail: dnsServers.length ? 'Резолверы операционной системы' : 'DNS-серверы недоступны для чтения',
      },
      blockedTrackers: {
        total: adBlockStats.blockedTotal,
        topHosts: Object.entries(adBlockStats.blockedByHost)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 6)
          .map(([host, count]) => ({ host, count })),
        enabled: adBlockStats.enabled,
      },
      sitePermissions,
      leakChecks,
    };
  }

  private async fetchPrivacyExternalIp(targetSession: Electron.Session): Promise<PrivacyDashboardSnapshot['externalIp']> {
    const source = 'api64.ipify.org';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await targetSession.fetch('https://api64.ipify.org?format=json', {
        headers: { accept: 'application/json,text/plain' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      let candidate = text.trim();
      try {
        const parsed = JSON.parse(text) as { ip?: unknown };
        if (typeof parsed.ip === 'string') candidate = parsed.ip.trim();
      } catch {
        // api64.ipify may return a plain IP when a proxy strips the query.
      }
      const family = isIP(candidate);
      if (family !== 4 && family !== 6) throw new Error('Некорректный ответ сервиса IP');
      return { value: candidate, family: family === 4 ? 'IPv4' : 'IPv6', status: 'ok', source };
    } catch (error) {
      return {
        status: 'unavailable',
        source,
        error: error instanceof Error ? error.message : 'network-error',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createTab(input: { url?: string; isPrivate?: boolean; active?: boolean; lazy?: boolean } = {}): Promise<TabSnapshot> {
    const id = crypto.randomUUID();
    const isPrivate = input.isPrivate ?? this.tabs.get(this.activeTabId)?.isPrivate ?? false;
    if (isPrivate) this.ensurePrivateSession();
    const url = input.url ?? NEW_TAB_URL;
    if (url !== NEW_TAB_URL && !isSafeWebUrl(url)) throw new Error('Разрешены только HTTP и HTTPS адреса.');
    const isInternal = url === NEW_TAB_URL;
    const tab: TabRecord = {
      id,
      url,
      title: isInternal ? (isPrivate ? 'Приватная вкладка' : 'Новая вкладка') : 'Новая страница',
      isLoading: !isInternal && !input.lazy,
      ...emptyNavigation(url),
      isMuted: false,
      isAudible: false,
      isPinned: false,
      isPrivate,
      isInternal,
      lifecycle: input.lazy && !isInternal ? 'hibernated' : (input.active ?? true) ? 'active' : 'background',
      workspaceId: 'personal',
    };
    tab.workspaceId = this.activeWorkspaceId;
    this.tabs.set(id, tab);
    this.memoryManager.registerTab({
      tabId: id,
      active: false,
      pinned: false,
      audible: false,
      loading: tab.isLoading,
      downloading: false,
      lastInteractionAt: Date.now(),
      lifecycle: tab.lifecycle,
    });
    if (!isInternal && !input.lazy) this.attachWebContents(tab, url);
    if (input.active ?? true) this.activateTab(id);
    this.emitSnapshot();
    return this.toSnapshot(tab);
  }

  private getMiniPipBounds(tabId?: string): { x: number; y: number; width: number; height: number } {
    const margin = 16;
    const windowBounds = this.window?.getContentBounds() || { width: 1440, height: 900 };
    const chrome = (this.chromeBounds.width > 0 && this.chromeBounds.height > 0)
      ? this.chromeBounds
      : (this.lastValidBounds.width > 0 && this.lastValidBounds.height > 0)
        ? this.lastValidBounds
        : { x: 200, y: 144, width: Math.max(0, windowBounds.width - 200), height: Math.max(0, windowBounds.height - 144) };
    // Keep the upstream bottom-right window anchor, while scaling the player
    // to fit the available content region on compact windows.
    const right = windowBounds.width;
    const bottom = windowBounds.height;
    const availableWidth = Math.max(1, right - chrome.x - margin * 2);
    const availableHeight = Math.max(1, bottom - chrome.y - margin * 2);
    const saved = tabId ? this.pipBounds.get(tabId) : undefined;
    const miniWidth = Math.max(1, Math.floor(Math.min(saved?.width ?? 380, availableWidth, availableHeight * 380 / 214)));
    const miniHeight = Math.max(1, Math.round(miniWidth * 214 / 380));
    const minX = Math.min(Math.max(0, chrome.x), Math.max(0, right - miniWidth));
    const minY = Math.min(Math.max(0, chrome.y), Math.max(0, bottom - miniHeight));
    const x = Math.max(minX, Math.min(saved?.x ?? right - miniWidth - margin, right - miniWidth));
    const y = Math.max(minY, Math.min(saved?.y ?? bottom - miniHeight - margin, bottom - miniHeight));
    return { x: Math.round(x), y: Math.round(y), width: miniWidth, height: miniHeight };
  }

  updatePictureInPictureLayout(senderId: number, patch: { deltaX?: number; deltaY?: number; width?: number }): void {
    if (!patch || typeof patch !== 'object') return;
    const tab = [...this.tabs.values()].find(entry => entry.webContentsId === senderId);
    if (!tab?.isPictureInPicture || tab.id === this.activeTabId || !tab.view || tab.view.webContents.isDestroyed()) return;
    const bounds = this.getMiniPipBounds(tab.id);
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const next = {
      ...bounds,
      x: bounds.x + (finite(patch.deltaX) ? Math.max(-4096, Math.min(4096, patch.deltaX)) : 0),
      y: bounds.y + (finite(patch.deltaY) ? Math.max(-4096, Math.min(4096, patch.deltaY)) : 0),
      width: finite(patch.width) ? Math.max(240, Math.min(960, patch.width)) : bounds.width,
    };
    this.pipBounds.set(tab.id, next);
    const clamped = this.getMiniPipBounds(tab.id);
    this.pipBounds.set(tab.id, clamped);
    tab.view.setBounds(clamped);
  }

  private stopOtherPictureInPictureTabs(tabId: string): void {
    for (const other of this.tabs.values()) {
      if (other.id === tabId || !other.isPictureInPicture) continue;
      other.isPictureInPicture = false;
      other.pipMode = undefined;
      if (other.view && !other.view.webContents.isDestroyed()) {
        other.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: other.id });
        if (other.id !== this.activeTabId) {
          other.view.setVisible(false);
          other.view.webContents.setBackgroundThrottling(true);
        }
        void other.view.webContents.executeJavaScript('if (document.pictureInPictureElement) document.exitPictureInPicture();').catch(() => undefined);
      }
    }
  }

  setSplitView(tabId?: string): void {
    if (!tabId) {
      this.clearSplitView();
      this.refreshViewBounds();
      this.emitSnapshot();
      return;
    }
    const primary = this.tabs.get(this.activeTabId);
    const secondary = this.tabs.get(tabId);
    if (!primary || !secondary || primary === secondary || !this.canSplitTab(primary) || !this.canSplitTab(secondary)
      || primary.workspaceId !== secondary.workspaceId || this.window?.isFullScreen()) {
      throw new Error('Разделение доступно для двух обычных веб-вкладок одного пространства. Закройте режим чтения, PiP или полный экран.');
    }
    this.clearSplitView();
    this.splitView = { primaryTabId: primary.id, secondaryTabId: secondary.id, firstTabId: primary.id, ratio: 0.5 };
    if (secondary.lifecycle === 'hibernated') {
      secondary.lifecycle = 'background';
      this.attachWebContents(secondary, secondary.url);
    }
    // Both panes are being viewed, even though only one owns keyboard focus.
    this.memoryManager.updateTab(secondary.id, { active: true, lifecycle: secondary.lifecycle, lastInteractionAt: Date.now() });
    this.refreshViewBounds();
    this.emitSnapshot();
  }

  setSplitViewRatio(ratio: number): void {
    if (!this.splitView) return;
    this.splitView.ratio = normalizeSplitRatio(ratio);
    this.refreshViewBounds();
    this.emitSnapshot();
  }

  private canSplitTab(tab: TabRecord): boolean {
    return !tab.isPrivate && !tab.isInternal && !tab.isReaderActive && !tab.isPictureInPicture
      && tab.lifecycle !== 'crashed' && isSafeWebUrl(tab.url);
  }

  private clearSplitView(): void {
    const previous = this.splitView;
    this.splitView = undefined;
    if (!previous) return;
    const secondary = this.tabs.get(previous.secondaryTabId);
    if (secondary) this.memoryManager.updateTab(secondary.id, { active: secondary.id === this.activeTabId, lifecycle: secondary.lifecycle });
  }

  private validateSplitView(): void {
    if (!this.splitView) return;
    const primary = this.tabs.get(this.splitView.primaryTabId);
    const secondary = this.tabs.get(this.splitView.secondaryTabId);
    if (!primary || !secondary || primary.id !== this.activeTabId || !this.canSplitTab(primary) || !this.canSplitTab(secondary)
      || primary.workspaceId !== secondary.workspaceId || this.window?.isFullScreen()) this.clearSplitView();
  }

  activateTab(tabId: string): void {
    const next = this.tabs.get(tabId);
    if (!next) return;
    if (this.splitView && tabId !== this.splitView.primaryTabId) {
      if (tabId === this.splitView.secondaryTabId) {
        const previousPrimary = this.splitView.primaryTabId;
        this.splitView.primaryTabId = tabId;
        this.splitView.secondaryTabId = previousPrimary;
      } else this.clearSplitView();
    }
    if (this.htmlFullscreenTabId && this.htmlFullscreenTabId !== tabId) this.exitPageFullscreen();
    this.activeTabId = tabId;
    this.activeWorkspaceId = next.workspaceId;
    if (next.lifecycle === 'hibernated') {
      next.lifecycle = 'background';
      this.attachWebContents(next, next.url);
    }
    for (const tab of this.tabs.values()) {
      const active = tab.id === tabId;
      if (tab.lifecycle !== 'crashed' && tab.lifecycle !== 'hibernated') tab.lifecycle = active ? 'active' : 'background';
      this.memoryManager.updateTab(tab.id, { active: active || tab.id === this.splitView?.secondaryTabId, lifecycle: tab.lifecycle, ...(active ? { lastInteractionAt: Date.now() } : {}) });
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      if ((active || tab.id === this.splitView?.secondaryTabId) && !tab.isInternal && tab.lifecycle !== 'crashed' && !tab.isReaderActive) {
        (tab.view as any).setVisible?.(true);
        tab.view.webContents.setBackgroundThrottling(false);
        tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
        if (this.window && !this.window.contentView.children.includes(tab.view)) {
          this.window.contentView.addChildView(tab.view);
        } else if (this.window && !this.popoverOpen && this.shellView && !this.shellView.webContents.isDestroyed()) {
          const children = this.window.contentView.children;
          const tabIdx = children.indexOf(tab.view);
          const shellIdx = children.indexOf(this.shellView);
          if (tabIdx !== -1 && shellIdx !== -1 && tabIdx < shellIdx) {
            try { this.window.contentView.removeChildView(tab.view); } catch {}
            this.window.contentView.addChildView(tab.view);
          }
        }
        this.applyBounds(tab);
        if (active) tab.view.webContents.focus();
      } else {
        if (tab.isPictureInPicture && !tab.isInternal && tab.lifecycle !== 'crashed') {
          // Floating in-browser PiP mini-player over other tabs
          (tab.view as any).setVisible?.(true);
          tab.view.webContents.setBackgroundThrottling(false);
          tab.view.setBounds(this.getMiniPipBounds(tab.id));
          tab.pipMode = 'mini';
          tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: true, tabId: tab.id, title: tab.title });
        } else {
          tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
          (tab.view as any).setVisible?.(false);
          tab.view.webContents.setBackgroundThrottling(true);
          if (tab.isInternal || tab.lifecycle === 'crashed') {
            try { this.window?.contentView.removeChildView(tab.view); } catch {}
            tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
          }
        }
      }
    }
    if (next.isInternal || next.lifecycle === 'crashed' || next.isReaderActive) {
      if (this.shellView && !this.shellView.webContents.isDestroyed() && this.window) {
        const children = this.window.contentView.children;
        const shellIdx = children.indexOf(this.shellView);
        if (shellIdx !== -1 && shellIdx !== children.length - 1 && (!this.voodooView || children[children.length - 1] !== this.voodooView)) {
          try {
            this.window.contentView.removeChildView(this.shellView);
            this.window.contentView.addChildView(this.shellView);
          } catch {}
        }
        this.shellView.webContents.focus();
      }
    }
    // Float background PiP tabs on top of the active view/shell
    for (const tab of this.tabs.values()) {
      if (tab.id !== tabId && tab.isPictureInPicture && !tab.isInternal && tab.view && !tab.view.webContents.isDestroyed() && tab.lifecycle !== 'crashed' && this.window) {
        const children = this.window.contentView.children;
        const pipIdx = children.indexOf(tab.view);
        if (pipIdx !== -1 && pipIdx < children.length - 1 && (!this.voodooView || children[children.length - 1] !== this.voodooView)) {
          try { this.window.contentView.removeChildView(tab.view); } catch {}
          this.window.contentView.addChildView(tab.view);
        }
      }
    }
    this.raiseShellOverlay();
    // Ensure Voodoo floating assistant stays on top of all views
    if (this.voodooView && !this.voodooView.webContents.isDestroyed() && this.window && !this.window.isDestroyed()) {
      const children = this.window.contentView.children;
      if (children[children.length - 1] !== this.voodooView) {
        try { this.window.contentView.removeChildView(this.voodooView); } catch {}
        this.window.contentView.addChildView(this.voodooView);
      }
      this.refreshVoodooBounds();
    }
    this.emitSnapshot();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (!tab.isPrivate && (tab.url === NEW_TAB_URL || isSafeWebUrl(tab.url))) {
      this.closedTabs.push({ url: tab.url, workspaceId: tab.workspaceId, isPinned: tab.isPinned, isMuted: tab.isMuted });
      if (this.closedTabs.length > 20) this.closedTabs.shift();
    }
    this.tabs.delete(tabId);
    this.findQueries.delete(tabId);
    this.pipBounds.delete(tabId);
    const openerId = this.popupOpeners.get(tabId);
    this.popupOpeners.delete(tabId);
    for (const [popupId, openerTabId] of this.popupToTab.entries()) {
      if (openerTabId === tabId) {
        for (const popup of this.popupWindows) {
          if (popup.id === popupId && !popup.isDestroyed()) {
            popup.close();
          }
        }
      }
    }
    this.memoryManager.removeTab(tabId);
    this.detachView(tab);
    // Clearing is scoped to the whole private session: closing a popup must not
    // sign out the other private tabs. Hibernated private tabs count too.
    if (tab.isPrivate && ![...this.tabs.values()].some((entry) => entry.isPrivate)) await this.endPrivateSession();
    if (this.tabs.size === 0) await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
    else if (this.activeTabId === tabId) {
      if (openerId && this.tabs.has(openerId)) {
        this.activateTab(openerId);
      } else {
        const remaining = [...this.tabs.values()];
        const reversed = remaining.slice().reverse();
        const fallback = reversed.find((entry) => entry.workspaceId === tab.workspaceId && entry.isPrivate === tab.isPrivate)
          ?? reversed.find((entry) => entry.isPrivate === tab.isPrivate)
          ?? reversed.find((entry) => entry.workspaceId === tab.workspaceId)
          ?? reversed[0];
        if (fallback) this.activateTab(fallback.id);
      }
    }
    this.emitSnapshot();
  }

  async closePrivateTabs(): Promise<void> {
    for (const tab of [...this.tabs.values()]) if (tab.isPrivate) await this.closeTab(tab.id);
  }

  async reopenClosedTab(): Promise<void> {
    // Private sessions do not retain reopen history, and must not silently
    // reopen an ordinary-profile page through a shortcut or direct shell call.
    if (this.tabs.get(this.activeTabId)?.isPrivate) return;
    const saved = this.closedTabs.pop();
    if (!saved) return;
    this.activeWorkspaceId = saved.workspaceId;
    const reopened = await this.createTab({ url: saved.url, isPrivate: false });
    const tab = this.tabs.get(reopened.id)!;
    tab.isPinned = saved.isPinned;
    tab.isMuted = saved.isMuted;
    tab.view?.webContents.setAudioMuted(tab.isMuted);
    this.memoryManager.updateTab(tab.id, { pinned: tab.isPinned });
    this.emitSnapshot();
  }

  async tabAction(tabId: string, action: TabAction): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (action === 'mute') {
      tab.isMuted = !tab.isMuted;
      tab.view?.webContents.setAudioMuted(tab.isMuted);
    } else if (action === 'pin') {
      tab.isPinned = !tab.isPinned;
      this.memoryManager.updateTab(tab.id, { pinned: tab.isPinned });
    } else if (action === 'duplicate') {
      await this.createTab({ url: tab.url, isPrivate: tab.isPrivate });
    } else if (action === 'hibernate') {
      await this.hibernateTab(tabId);
    } else if (action === 'print' && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.print({}, (success, reason) => {
        if (!success && reason !== 'cancelled') this.eventListener?.({ type: 'navigation-error', message: reason });
      });
    } else if (['zoom-in', 'zoom-out', 'zoom-reset'].includes(action) && tab.view && !tab.view.webContents.isDestroyed()) {
      const contents = tab.view.webContents;
      const current = tab.zoomFactor ?? contents.getZoomFactor() ?? 1.0;
      const next = getNextZoomFactor(current, action as 'zoom-in' | 'zoom-out' | 'zoom-reset');
      contents.setZoomFactor(next);
      tab.zoomFactor = next;
    }
    this.emitSnapshot();
  }

  async closeRelatedTabs(tabId: string, scope: 'others' | 'right' | 'left'): Promise<void> {
    const reference = this.tabs.get(tabId);
    if (!reference || (scope !== 'others' && scope !== 'right' && scope !== 'left')) return;
    // Match the visible strip order. Bulk actions never cross workspaces or
    // normal/private boundaries, and pinned tabs remain protected.
    const ordered = [...this.tabs.values()]
      .filter((tab) => tab.workspaceId === reference.workspaceId && tab.isPrivate === reference.isPrivate)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
    const referenceIndex = ordered.findIndex((tab) => tab.id === tabId);
    const closing = ordered.filter((tab, index) => tab.id !== tabId && !tab.isPinned && (scope === 'others' || (scope === 'right' ? index > referenceIndex : index < referenceIndex)));
    if (closing.some((tab) => tab.id === this.activeTabId)) this.activateTab(reference.id);
    for (const tab of closing) await this.closeTab(tab.id);
  }

  async exportBookmarks(): Promise<{ saved: boolean; count: number; path?: string }> {
    if (!this.window || this.window.isDestroyed()) return { saved: false, count: 0 };
    return exportBookmarksHtml(this.window, this.stores.bookmarks.get(), path.join(app.getPath('documents'), 'bookmarks.html'));
  }

  showTabMenu(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || !this.window || this.window.isDestroyed() || this.disposed) return;
    const peers = [...this.tabs.values()]
      .filter((entry) => entry.workspaceId === tab.workspaceId && entry.isPrivate === tab.isPrivate)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
    const index = peers.findIndex((entry) => entry.id === tabId);
    const report = (cause: unknown) => {
      if (!this.disposed) this.eventListener?.({ type: 'navigation-error', message: cause instanceof Error ? cause.message : 'Не удалось выполнить действие с вкладкой.' });
    };
    const safely = (action: () => unknown) => () => {
      try { void Promise.resolve(action()).catch(report); } catch (cause) { report(cause); }
    };
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: tab.isPinned ? 'Открепить вкладку' : 'Закрепить вкладку', type: 'checkbox', checked: tab.isPinned, click: safely(() => this.tabAction(tabId, 'pin')) },
      { label: tab.isMuted ? 'Включить звук' : 'Отключить звук', type: 'checkbox', checked: tab.isMuted, click: safely(() => this.tabAction(tabId, 'mute')) },
      { label: 'Дублировать вкладку', enabled: tab.url === NEW_TAB_URL || isSafeWebUrl(tab.url), click: safely(() => this.tabAction(tabId, 'duplicate')) },
      { label: 'Перезагрузить вкладку', enabled: isSafeWebUrl(tab.url), click: safely(() => this.reload(tabId)) },
      { label: 'Копировать адрес страницы', enabled: isSafeWebUrl(tab.url), click: safely(() => clipboard.writeText(tab.url)) },
      { label: 'Добавить или убрать закладку', enabled: isSafeWebUrl(tab.url), click: safely(() => this.toggleBookmark(tabId)) },
      { label: 'Освободить память вкладки', enabled: tab.id !== this.activeTabId && !tab.isInternal && tab.lifecycle !== 'hibernated', click: safely(() => this.hibernateTab(tabId)) },
      { type: 'separator' },
      { label: 'Закрыть вкладку', click: safely(() => this.closeTab(tabId)) },
      { label: 'Закрыть вкладки слева', enabled: peers.some((entry, peerIndex) => peerIndex < index && !entry.isPinned), click: safely(() => this.closeRelatedTabs(tabId, 'left')) },
      { label: 'Закрыть вкладки справа', enabled: peers.some((entry, peerIndex) => peerIndex > index && !entry.isPinned), click: safely(() => this.closeRelatedTabs(tabId, 'right')) },
      { label: 'Закрыть другие вкладки', enabled: peers.some((entry) => entry.id !== tabId && !entry.isPinned), click: safely(() => this.closeRelatedTabs(tabId, 'others')) },
      { type: 'separator' },
      // Private tabs have no reopen history; this menu must not silently switch
      // a private action into the ordinary profile's previously closed pages.
      { label: 'Открыть закрытую вкладку', enabled: !tab.isPrivate && this.closedTabs.length > 0, click: safely(() => this.reopenClosedTab()) },
    ];
    try { Menu.buildFromTemplate(template).popup({ window: this.window }); } catch (cause) { report(cause); }
  }

  findInPage(tabId: string, text: string, forward = true): void {
    const contents = this.tabs.get(tabId)?.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (typeof text !== 'string' || !text.trim()) { this.stopFindInPage(tabId); return; }
    const query = text.slice(0, 1000);
    const findNext = this.findQueries.get(tabId) === query;
    this.findQueries.set(tabId, query);
    contents.findInPage(query, { forward, findNext });
  }

  stopFindInPage(tabId: string): void {
    this.findQueries.delete(tabId);
    const contents = this.tabs.get(tabId)?.view?.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage('clearSelection');
  }

  controlDownload(downloadId: string, action: DownloadAction): void {
    if (action === 'delete') {
      this.deleteDownload(downloadId, false);
      return;
    }

    const entry = this.downloads.find((item) => item.id === downloadId);
    if (!entry) return;

    // Check yt-dlp process
    const ytProc = this.ytDlpProcesses.get(downloadId);
    if (ytProc) {
      if (action === 'pause') {
        try { ytProc.child.kill('SIGSTOP'); } catch {}
        ytProc.isPaused = true;
        entry.isPaused = true;
        entry.canResume = true;
      } else if (action === 'resume') {
        try { ytProc.child.kill('SIGCONT'); } catch {}
        ytProc.isPaused = false;
        entry.isPaused = false;
      } else if (action === 'cancel') {
        try { ytProc.child.kill('SIGTERM'); } catch {}
        this.ytDlpProcesses.delete(downloadId);
      this.mediaCookieCleanup?.get(downloadId)?.();
        entry.state = 'cancelled';
        entry.isLive = false;
        entry.isPaused = false;
        entry.canResume = false;
        entry.error = 'Загрузка отменена.';
        this.persistDownloads(true);
      }
      this.emitSnapshot();
      return;
    }

    // Check Electron download item
    const download = this.liveDownloads.get(downloadId);
    if (download) {
      if (action === 'cancel') {
        download.item.cancel();
        entry.state = 'cancelled';
        entry.isLive = false;
        entry.isPaused = false;
        entry.canResume = false;
        entry.error = 'Загрузка отменена.';
        this.persistDownloads(true);
      } else if (action === 'pause') {
        download.item.pause();
        entry.isPaused = true;
        entry.canResume = true;
      } else if (action === 'resume' && (download.item.isPaused() || download.item.canResume())) {
        download.item.resume();
        entry.isPaused = false;
      }
      this.emitSnapshot();
    }
  }

  deleteDownload(downloadId: string, deleteFile = false): void {
    const ytProc = this.ytDlpProcesses.get(downloadId);
    if (ytProc) {
      try { ytProc.child.kill('SIGKILL'); } catch {}
      this.ytDlpProcesses.delete(downloadId);
      this.mediaCookieCleanup?.get(downloadId)?.();
    }
    const live = this.liveDownloads.get(downloadId);
    if (live) {
      try { live.item.cancel(); } catch {}
      this.liveDownloads.delete(downloadId);
    }
    const index = this.downloads.findIndex((item) => item.id === downloadId);
    if (index !== -1) {
      const entry = this.downloads[index];
      if (deleteFile && entry.path && fs.existsSync(entry.path)) {
        try { fs.unlinkSync(entry.path); } catch {}
      }
      this.downloads.splice(index, 1);
      this.persistDownloads(true);
      this.emitSnapshot();
    }
  }

  markFormState(contentsId: number, dirty: boolean): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === contentsId);
    if (tab) this.memoryManager.updateTab(tab.id, { hasFormEdits: dirty, lastInteractionAt: Date.now() });
  }

  async navigate(tabId: string, rawInput: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (typeof rawInput !== 'string') return;
    if (rawInput === NEW_TAB_URL) { this.activateInternalTab(tab); return; }
    const intent = parseOmniboxInput(rawInput, this.stores.settings.get().searchEngine);
    if (intent.kind === 'invalid') {
      this.eventListener?.({ type: 'navigation-error', message: intent.reason });
      return;
    }
    if (intent.url === NEW_TAB_URL) {
      this.activateInternalTab(tab);
      return;
    }
    if (!isSafeWebUrl(intent.url)) {
      this.eventListener?.({ type: 'navigation-error', message: 'Разрешены только HTTP и HTTPS адреса.' });
      return;
    }
    tab.isInternal = false;
    tab.url = intent.url;
    tab.title = intent.url;
    tab.lifecycle = 'active';
    let navigation: Promise<void> | undefined;
    if (!tab.view || tab.view.webContents.isDestroyed()) this.attachWebContents(tab, intent.url);
    else navigation = this.loadUrl(tab.view.webContents, intent.url);
    this.activateTab(tab.id);
    await navigation;
    if (!this.tabs.has(tab.id)) return;
    this.emitSnapshot();
  }

  async goBack(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.view?.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  }

  async goForward(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.view?.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  }

  async reload(tabId: string, ignoreCache = false): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal) return;
    if (tab.lifecycle === 'crashed' || !tab.view || tab.view.webContents.isDestroyed()) {
      this.detachView(tab);
      tab.lifecycle = 'active';
      this.attachWebContents(tab, tab.url);
      this.activateTab(tab.id);
    } else {
      if (ignoreCache) {
        tab.view.webContents.reloadIgnoringCache();
      } else {
        tab.view.webContents.reload();
      }
    }
  }

  async stop(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.view) tab.view.webContents.stop();
  }

  private async hibernateIdleTabs(idleMinutes: number): Promise<void> {
    if (this.disposed || this.memorySweepRunning) return;
    this.memorySweepRunning = true;
    try {
      // Release the oldest eligible page first. Staggering discard avoids a
      // burst of renderer teardown and subsequent reloads after a long idle.
      for (const tabId of this.memoryManager.getHibernateCandidates(idleMinutes)) {
        const tab = this.tabs.get(tabId);
        // Private pages may contain transient authentication/unsaved state;
        // only an explicit user request may discard them.
        if (!tab || tab.isPrivate) continue;
        if (await this.hibernateTab(tabId)) break;
      }
    } finally {
      this.memorySweepRunning = false;
    }
  }

  async hibernateTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    // OAuth popups need their original WebContents/WindowProxy until the flow
    // finishes. Discarding either endpoint would silently break postMessage.
    if (this.popupOpeners.has(tabId) || [...this.popupOpeners.values()].includes(tabId) || [...this.popupToTab.values()].includes(tabId)) return false;
    if (!tab || tab.id === this.activeTabId || tab.isInternal || tab.isPictureInPicture || !tab.view) return false;
    const eligible = this.memoryManager.canHibernate(tabId, 0);
    if (!eligible.allowed) return false;
    this.detachView(tab);
    tab.lifecycle = 'hibernated';
    this.memoryManager.updateTab(tab.id, { lifecycle: 'hibernated', active: false, loading: false, audible: false, capturing: false });
    this.emitSnapshot();
    return true;
  }

  async wakeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.lifecycle !== 'hibernated') return;
    tab.lifecycle = 'background';
    this.attachWebContents(tab, tab.url);
    this.memoryManager.updateTab(tab.id, { lifecycle: 'background', loading: true });
    this.activateTab(tabId);
    this.emitSnapshot();
  }

  samplePerformance(): BrowserSnapshot['performance'] {
    const metrics = this.memoryManager.sample();
    return {
      sampledAt: metrics.sampledAt,
      availableMemory: metrics.availableMemory,
      processCount: metrics.processes.length,
      totalWorkingSet: metrics.processes.reduce((sum, process) => sum + process.workingSetSize, 0),
    };
  }

  getTaskManagerMetrics(): TaskManagerSnapshot {
    let rawMetrics: Electron.ProcessMetric[] = [];
    try {
      rawMetrics = app.getAppMetrics();
    } catch {
      rawMetrics = [];
    }

    let shellPid: number | undefined;
    try {
      if (this.shellView?.webContents && !this.shellView.webContents.isDestroyed()) {
        shellPid = this.shellView.webContents.getOSProcessId();
      }
    } catch {}

    const processes: TaskManagerProcess[] = [];

    for (const metric of rawMetrics) {
      const cpuPercent = Math.round((metric.cpu?.percentCPUUsage ?? 0) * 10) / 10;
      const memoryWorkingSetMB = Math.round(((metric.memory?.workingSetSize ?? 0) / 1024) * 10) / 10;

      if (process.pid === metric.pid) {
        processes.push({
          pid: metric.pid,
          type: 'browser',
          title: 'Браузер (Основной процесс)',
          cpuPercent,
          memoryWorkingSetMB,
          isKillable: false,
        });
        continue;
      }

      if (shellPid !== undefined && shellPid === metric.pid) {
        processes.push({
          pid: metric.pid,
          type: 'shell',
          title: 'Интерфейс soulm8te',
          cpuPercent,
          memoryWorkingSetMB,
          isKillable: false,
        });
        continue;
      }

      let tabFound: TabRecord | undefined;
      for (const tab of this.tabs.values()) {
        try {
          if (tab.view?.webContents && !tab.view.webContents.isDestroyed() && tab.view.webContents.getOSProcessId() === metric.pid) {
            tabFound = tab;
            break;
          }
        } catch {}
      }

      if (tabFound) {
        processes.push({
          pid: metric.pid,
          type: 'tab',
          title: tabFound.title || tabFound.url || 'Новая вкладка',
          url: tabFound.url,
          tabId: tabFound.id,
          favicon: tabFound.favicon,
          cpuPercent,
          memoryWorkingSetMB,
          isKillable: true,
        });
        continue;
      }

      if (metric.type?.toLowerCase() === 'gpu') {
        processes.push({
          pid: metric.pid,
          type: 'gpu',
          title: 'Процесс GPU',
          cpuPercent,
          memoryWorkingSetMB,
          isKillable: true,
        });
        continue;
      }

      processes.push({
        pid: metric.pid,
        type: 'utility',
        title: `Служебный процесс (${metric.name || metric.type})`,
        cpuPercent,
        memoryWorkingSetMB,
        isKillable: true,
      });
    }

    const typeOrder: Record<TaskManagerProcessType, number> = {
      browser: 1,
      shell: 2,
      gpu: 3,
      tab: 4,
      utility: 5,
      zygote: 6,
      unknown: 7,
    };

    processes.sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99));

    return {
      sampledAt: Date.now(),
      processes,
    };
  }

  killProcess(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
      for (const view of [this.shellView, this.voodooView]) {
        if (view && !view.webContents.isDestroyed() && view.webContents.getOSProcessId() === pid) return false;
      }
      const metric = app.getAppMetrics().find(entry => entry.pid === pid);
      if (!metric) return false;
      for (const tab of this.tabs.values()) {
        const contents = tab.view?.webContents;
        if (contents && !contents.isDestroyed() && contents.getOSProcessId() === pid) {
          contents.forcefullyCrashRenderer();
          return true;
        }
      }
      // Only explicitly enumerated browser-owned service processes are killable.
      // Never let an arbitrary shell-provided PID reach the OS signal API.
      if (!['gpu', 'utility'].includes(metric.type.toLowerCase())) return false;
      process.kill(pid);
      return true;
    } catch { return false; }
  }

  async toggleDevTools(): Promise<void> {
    const active = this.tabs.get(this.activeTabId);
    const targetContents = (active?.view && !active.view.webContents.isDestroyed())
      ? active.view.webContents
      : (this.shellView && !this.shellView.webContents.isDestroyed())
        ? this.shellView.webContents
        : undefined;
    if (!targetContents) return;
    if (targetContents.isDevToolsOpened()) {
      targetContents.closeDevTools();
    } else {
      targetContents.openDevTools({ mode: 'detach', activate: true });
    }
  }

  toggleBookmark(tabId: string): BookmarkEntry | null {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal) return null;
    const bookmark = this.stores.toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
    this.emitSnapshot();
    return bookmark;
  }

  queryHistory(query = ''): HistoryEntry[] {
    const normalized = query.trim().toLowerCase();
    return this.stores.history.get().filter((entry) =>
      !normalized || entry.title.toLowerCase().includes(normalized) || entry.url.toLowerCase().includes(normalized),
    );
  }

  async openDownload(downloadId: string): Promise<void> {
    const download = this.downloads.find((entry) => entry.id === downloadId);
    if (!download?.path || download.state !== 'completed') throw new Error('Файл ещё не готов или уже недоступен.');
    const error = await shell.openPath(download.path);
    if (error) throw new Error(error);
  }

  showDownloadInFolder(downloadId: string): void {
    const download = this.downloads.find((entry) => entry.id === downloadId);
    if (download?.path) shell.showItemInFolder(download.path);
  }

  retryDownload(downloadId: string): void {
    const download = this.downloads.find((entry) => entry.id === downloadId);
    if (!download?.url || !isSafeWebUrl(download.url)) return;
    const isPrivate = Boolean(download.isPrivate);
    const sourceSession = isPrivate ? this.privateSession : this.browserSession;
    if (!sourceSession) throw new Error('Приватная сессия завершена. Повторите загрузку из новой приватной вкладки.');
    if (download.kind === 'video' || download.kind === 'audio') {
      void this.downloadWithYtDlp(download.url, download.filename, download.kind === 'audio', isPrivate);
    } else if (isPrivate) {
      void this.privateProxyReady.then(() => {
        if (this.privateSession !== sourceSession || this.disposed) return;
        sourceSession.downloadURL(download.url);
      }).catch(() => this.eventListener?.({ type: 'navigation-error', message: 'Не удалось повторить приватную загрузку.' }));
    } else sourceSession.downloadURL(download.url);
  }

  startDownloadDrag(downloadId: string, sender: Electron.WebContents): void {
    const download = this.downloads.find((entry) => entry.id === downloadId);
    if (!download?.path || download.state !== 'completed') return;
    if (!fs.existsSync(download.path)) return;

    let iconPath = path.join(__dirname, '../../assets/icons/png/32x32.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(app.getAppPath(), 'assets/icons/png/32x32.png');
    }
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

    try {
      sender.startDrag({
        file: download.path,
        icon,
      });
    } catch (err) {
      console.error('[startDownloadDrag] Failed to start drag:', err);
    }
  }

  saveBookmark(input: { id?: string; title: string; url: string }): BookmarkEntry {
    const bookmark = this.stores.saveBookmark(input);
    this.emitSnapshot();
    return bookmark;
  }

  removeBookmark(id: string): void {
    this.stores.bookmarks.set(this.stores.bookmarks.get().filter(entry => entry.id !== id));
    this.emitSnapshot();
  }

  removeHistoryEntry(id: string): void {
    this.stores.history.set(this.stores.history.get().filter(entry => entry.id !== id));
    this.emitSnapshot();
  }

  async clearBrowsingHistory(): Promise<void> {
    if (!this.window) return;
    const { response } = await dialog.showMessageBox(this.window, { type: 'question', title: 'Очистить историю?', message: 'Удалить историю посещений обычного профиля?', detail: 'Cookies, входы на сайты, закладки и файлы загрузок сохранятся.', buttons: ['Отмена', 'Очистить историю'], defaultId: 0, cancelId: 0, noLink: true });
    if (response !== 1) return;
    this.stores.history.set([]);
    this.closedTabs.length = 0;
    for (const tab of this.tabs.values()) if (!tab.isPrivate && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.navigationHistory.clear();
      this.updateNavigationState(tab);
    }
    this.emitSnapshot();
  }

  clearFinishedDownloads(isPrivate = false): void {
    if (typeof isPrivate !== 'boolean') throw new Error('Некорректный режим загрузок.');
    const active = this.downloads.filter(entry => Boolean(entry.isPrivate) !== isPrivate || this.liveDownloads.has(entry.id) || entry.state === 'queued' || entry.state === 'progressing');
    this.downloads.splice(0, this.downloads.length, ...active);
    this.stores.downloads.set(active.filter(entry => !entry.isPrivate).slice(0, 100));
    this.emitSnapshot();
  }

  updateSettings(patch: Partial<BrowserSettings>): BrowserSettings {
    const next = this.stores.settings.update((current) => {
      const theme = patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'graphite' || patch.theme === 'system' ? patch.theme : current.theme;
      const searchEngine = typeof patch.searchEngine === 'string' && /^https?:\/\//i.test(patch.searchEngine) ? patch.searchEngine : current.searchEngine;
      const sleepAfterMinutes = patch.sleepAfterMinutes === 0 || patch.sleepAfterMinutes === 5 || patch.sleepAfterMinutes === 15 || patch.sleepAfterMinutes === 30 || patch.sleepAfterMinutes === 60
        ? patch.sleepAfterMinutes
        : current.sleepAfterMinutes;
      return {
        ...current,
        theme,
        sidebarCollapsed: typeof patch.sidebarCollapsed === 'boolean' ? patch.sidebarCollapsed : current.sidebarCollapsed,
        searchEngine,
        newTabBackground: normalizeNewTabBackground(patch.newTabBackground === undefined ? current.newTabBackground : patch.newTabBackground),
        appearancePreset: patch.appearancePreset === 'detroit' || patch.appearancePreset === 'classic' || patch.appearancePreset === 'cyberpink' || patch.appearancePreset === 'cyberpink-fuji' || patch.appearancePreset === 'cyber-butterfly' || patch.appearancePreset === 'tokyo-night' || patch.appearancePreset === 'celestial-palace' ? patch.appearancePreset : current.appearancePreset ?? 'classic',
        accentColor: ['blue', 'teal', 'violet', 'rose', 'pink', 'white', 'milk', 'graphite'].includes(patch.accentColor ?? '') ? patch.accentColor as BrowserSettings['accentColor'] : current.accentColor ?? 'blue',
        wallpaperDim: typeof patch.wallpaperDim === 'number' && Number.isFinite(patch.wallpaperDim) ? Math.max(0, Math.min(75, Math.round(patch.wallpaperDim))) : current.wallpaperDim ?? 0,
        sleepAfterMinutes,
        adBlockEnabled: typeof patch.adBlockEnabled === 'boolean' ? patch.adBlockEnabled : current.adBlockEnabled ?? true,
        adBlockExceptions: patch.adBlockExceptions === undefined ? current.adBlockExceptions ?? [] : normalizeSiteExceptions(patch.adBlockExceptions),
        blockThirdPartyCookies: typeof patch.blockThirdPartyCookies === 'boolean' ? patch.blockThirdPartyCookies : current.blockThirdPartyCookies ?? true,
        googleSignInCompatibility: typeof patch.googleSignInCompatibility === 'boolean' ? patch.googleSignInCompatibility : current.googleSignInCompatibility ?? true,
        thirdPartyCookieExceptions: patch.thirdPartyCookieExceptions === undefined ? current.thirdPartyCookieExceptions ?? [] : normalizeCookieExceptions(patch.thirdPartyCookieExceptions),
        restoreSession: typeof patch.restoreSession === 'boolean' ? patch.restoreSession : current.restoreSession ?? true,
        voodooEnabled: typeof patch.voodooEnabled === 'boolean' ? patch.voodooEnabled : current.voodooEnabled ?? true,
        voodooBubbleVisible: typeof patch.voodooBubbleVisible === 'boolean' ? patch.voodooBubbleVisible : current.voodooBubbleVisible ?? true,
        voodooKeys: Array.isArray(patch.voodooKeys)
          ? patch.voodooKeys.map(k => String(k).trim()).filter(Boolean)
          : current.voodooKeys,
        voodooContextWindowTokens: requestedContextWindow(typeof patch.voodooContextWindowTokens === 'number' ? patch.voodooContextWindowTokens : current.voodooContextWindowTokens),
        voodooModel: typeof patch.voodooModel === 'string' && patch.voodooModel.trim() ? patch.voodooModel.trim() : current.voodooModel,
        voodooBaseUrl: typeof patch.voodooBaseUrl === 'string' && patch.voodooBaseUrl.trim() ? patch.voodooBaseUrl.trim() : current.voodooBaseUrl,
      };
    });
    if (next.theme) {
      nativeTheme.themeSource = next.theme === 'graphite' ? 'dark' : next.theme;
    }
    this.adBlock.engine.setEnabled(next.adBlockEnabled !== false);
    this.privateAdBlock.engine.setEnabled(next.adBlockEnabled !== false);
    this.adBlock.engine.setExceptions(next.adBlockExceptions ?? []);
    this.privateAdBlock.engine.setExceptions(next.adBlockExceptions ?? []);
    this.broadcastPageAdBlockPolicy();
    this.refreshVoodooBounds();
    this.emitSnapshot();
    return next;
  }

  createWorkspace(rawName: string): WorkspaceEntry {
    const name = rawName.trim().slice(0, 40);
    if (!name) throw new Error('Название пространства не может быть пустым.');
    const colors = ['#e52d3f', '#4b82c3', '#7b61a8', '#3c9274', '#c98a35'];
    const existing = this.stores.workspaces.get();
    const workspace: WorkspaceEntry = {
      id: crypto.randomUUID(),
      name,
      color: colors[existing.length % colors.length],
      tabIds: [],
    };
    this.stores.workspaces.set([...existing, workspace]);
    this.emitSnapshot();
    return workspace;
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    if (!this.stores.workspaces.get().some((workspace) => workspace.id === workspaceId)) return;
    this.clearSplitView();
    const isPrivate = this.tabs.get(this.activeTabId)?.isPrivate ?? false;
    this.activeWorkspaceId = workspaceId;
    const firstTab = Array.from(this.tabs.values()).find((tab) => tab.workspaceId === workspaceId && tab.isPrivate === isPrivate);
    if (firstTab) {
      this.activateTab(firstTab.id);
      return;
    }
    await this.createTab({ url: NEW_TAB_URL, isPrivate, active: true });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const existing = this.stores.workspaces.get();
    if (existing.length <= 1) {
      throw new Error('Нельзя удалить единственное пространство.');
    }
    const target = existing.find((w) => w.id === workspaceId);
    if (!target) return;
    const fallback = existing.find((w) => w.id !== workspaceId)!;

    for (const tab of this.tabs.values()) {
      if (tab.workspaceId === workspaceId) {
        tab.workspaceId = fallback.id;
      }
    }

    this.stores.workspaces.set(existing.filter((w) => w.id !== workspaceId));

    if (this.activeWorkspaceId === workspaceId) {
      await this.switchWorkspace(fallback.id);
    } else {
      this.emitSnapshot();
    }
  }

  listLocalExtensions(): ReturnType<LocalExtensionManager['list']> { return this.extensionsManager.list(); }
  async installLocalExtension(): Promise<ReturnType<LocalExtensionManager['list']>[number] | null> {
    if (!this.window) throw new Error('Окно браузера не готово.');
    return this.extensionsManager.install(this.window);
  }
  removeLocalExtension(id: string): void {
    this.extensionsManager.remove(id);
  }

  getVpnSnapshot(): VpnSnapshot {
    return this.vpn.getSnapshot();
  }

  async importVpnConfig(): Promise<VpnSnapshot> {
    if (!this.window) throw new Error('Окно браузера ещё не создано.');
    const snapshot = await this.vpn.importFromDialog(this.window);
    this.emitSnapshot();
    return snapshot;
  }

  clearVpnConfig(): VpnSnapshot {
    const snapshot = this.vpn.clear();
    this.emitSnapshot();
    return snapshot;
  }

  async clearHistoryAndCookies(): Promise<void> {
    this.stores.history.set([]);
    this.closedTabs.length = 0;
    this.stores.session.set({ tabs: [], activeIndex: 0 });
    await this.browserSession.clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] });
    await this.browserSession.clearCache();
    for (const tab of this.tabs.values()) {
      if (tab.isPrivate || !tab.view) continue;
      tab.view.webContents.navigationHistory.clear();
      tab.canGoBack = false;
      tab.canGoForward = false;
    }
    this.emitSnapshot();
  }

  broadcastHistoryUpdate(): void {
    this.eventListener?.({ type: 'history-cleared' });
    this.emitSnapshot();
  }

  async getStorageMetrics(): Promise<StorageMetrics> {
    let cacheSizeBytes = 0;
    let cacheMeasured = false;
    try {
      if (typeof this.browserSession.getCacheSize === 'function') {
        cacheSizeBytes = await this.browserSession.getCacheSize();
        cacheMeasured = Number.isFinite(cacheSizeBytes) && cacheSizeBytes >= 0;
      }
    } catch {
      cacheSizeBytes = 0;
    }

    if (!cacheMeasured) {
      try {
        const userData = app.getPath('userData');
        const possibleDirs = [
          path.join(userData, 'Cache'),
          path.join(userData, 'GPUCache'),
          path.join(userData, 'Code Cache'),
          path.join(userData, 'DawnWebGPUCache'),
          path.join(userData, 'Partitions', 'northstar-default', 'Cache'),
          path.join(userData, 'Partitions', 'northstar-default', 'GPUCache'),
          path.join(userData, 'Partitions', 'northstar-default', 'Code Cache'),
          path.join(userData, 'Partitions', 'northstar-default', 'DawnWebGPUCache'),
        ];
        for (const dir of possibleDirs) {
          cacheSizeBytes += await getDirectorySize(dir);
        }
      } catch {
        // ignore
      }
    }

    let cookiesCount = 0;
    try {
      if (this.browserSession.cookies && typeof this.browserSession.cookies.get === 'function') {
        const cookies = await this.browserSession.cookies.get({});
        cookiesCount = cookies.length;
      }
    } catch {
      cookiesCount = 0;
    }

    return {
      cacheSizeBytes,
      cacheSizeFormatted: formatBytes(cacheSizeBytes),
      cookiesCount,
      historyCount: this.stores.history.get().length,
      downloadsCount: this.stores.downloads.get().length,
      passwordsCount: this.passwords.count(),
      openTabsCount: Array.from(this.tabs.values()).filter((t) => !t.isPrivate).length,
      hasSecureStorage: this.passwords.canPersistSecurely(),
      sampledAt: Date.now(),
    };
  }

  async executeClean(options: CleanTargetOptions): Promise<CleanResult> {
    const startTime = performance.now();
    const before = await this.getStorageMetrics();

    // 1. options.cache
    if (options.cache) {
      if (typeof this.browserSession.clearCache === 'function') {
        await this.browserSession.clearCache();
      }
      if (typeof this.browserSession.clearStorageData === 'function') {
        await this.browserSession.clearStorageData({ storages: ['shadercache', 'cachestorage'] });
      }
      if (this.privateSession && typeof this.privateSession.clearCache === 'function') {
        await this.privateSession.clearCache();
      }
      if (session.defaultSession && typeof session.defaultSession.clearCache === 'function') {
        await session.defaultSession.clearCache();
      }
    }

    // 2. options.cookies
    if (options.cookies) {
      if (typeof this.browserSession.clearStorageData === 'function') {
        await this.browserSession.clearStorageData({ storages: ['cookies'] });
      }
      if (this.privateSession && typeof this.privateSession.clearStorageData === 'function') {
        await this.privateSession.clearStorageData({ storages: ['cookies'] });
      }
      if (session.defaultSession && typeof session.defaultSession.clearStorageData === 'function') {
        await session.defaultSession.clearStorageData({ storages: ['cookies'] });
      }
    }

    // 3. options.localStorage
    if (options.localStorage) {
      if (typeof this.browserSession.clearStorageData === 'function') {
        await this.browserSession.clearStorageData({ storages: ['localstorage', 'websql' as any] });
      }
      if (this.privateSession && typeof this.privateSession.clearStorageData === 'function') {
        await this.privateSession.clearStorageData({ storages: ['localstorage', 'websql' as any] });
      }
    }

    // 4. options.indexedDB
    if (options.indexedDB) {
      if (typeof this.browserSession.clearStorageData === 'function') {
        await this.browserSession.clearStorageData({ storages: ['indexdb', 'filesystem'] });
      }
      if (this.privateSession && typeof this.privateSession.clearStorageData === 'function') {
        await this.privateSession.clearStorageData({ storages: ['indexdb', 'filesystem'] });
      }
    }

    // 5. options.serviceWorkers
    if (options.serviceWorkers) {
      if (typeof this.browserSession.clearStorageData === 'function') {
        await this.browserSession.clearStorageData({ storages: ['serviceworkers'] });
      }
      if (this.privateSession && typeof this.privateSession.clearStorageData === 'function') {
        await this.privateSession.clearStorageData({ storages: ['serviceworkers'] });
      }
    }

    // 6. options.authCache
    if (options.authCache) {
      if (typeof this.browserSession.clearAuthCache === 'function') {
        await this.browserSession.clearAuthCache();
      }
      if (this.privateSession && typeof this.privateSession.clearAuthCache === 'function') {
        await this.privateSession.clearAuthCache();
      }
    }

    // 7. options.dnsCache
    if (options.dnsCache) {
      if (typeof this.browserSession.clearHostResolverCache === 'function') {
        await this.browserSession.clearHostResolverCache();
      }
      if (this.privateSession && typeof this.privateSession.clearHostResolverCache === 'function') {
        await this.privateSession.clearHostResolverCache();
      }
    }

    // 8. options.history
    if (options.history) {
      this.stores.history.set([]);
      for (const tab of this.tabs.values()) {
        if (!tab.isPrivate) {
          if (tab.view && !tab.view.webContents.isDestroyed()) {
            try {
              tab.view.webContents.navigationHistory.clear();
            } catch {}
          }
          (tab as any).navigationHistory = [];
          tab.canGoBack = false;
          tab.canGoForward = false;
        }
      }
      this.broadcastHistoryUpdate();
    }

    // 9. options.downloadsHistory
    if (options.downloadsHistory) {
      this.stores.downloads.set([]);
      const remaining = this.downloads.filter((entry) => this.liveDownloads.has(entry.id) || entry.state === 'queued' || entry.state === 'progressing');
      this.downloads.splice(0, this.downloads.length, ...remaining);
      this.eventListener?.({ type: 'downloads-cleared' });
    }

    // 11. options.passwords
    if (options.passwords) {
      this.passwords.clearAll();
      this.eventListener?.({ type: 'passwords-changed' });
    }

    // 12. options.closeTabs
    if (options.closeTabs) {
      const normalTabs = Array.from(this.tabs.values()).filter((t) => !t.isPrivate);
      let keptNewTab = false;
      for (const tab of normalTabs) {
        if (!keptNewTab && tab.url === NEW_TAB_URL) {
          keptNewTab = true;
          continue;
        }
        await this.closeTab(tab.id);
      }
      const remainingNormal = Array.from(this.tabs.values()).filter((t) => !t.isPrivate);
      if (remainingNormal.length === 0) {
        await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
      } else if (keptNewTab && remainingNormal[0]) {
        this.activateTab(remainingNormal[0].id);
      }
      this.stores.session.set({ tabs: [], activeIndex: 0 });
    }

    // 10. options.closedTabsHistory
    if (options.closedTabsHistory) {
      this.closedTabs = [];
    }

    this.emitSnapshot();

    const after = await this.getStorageMetrics();
    let freed = Math.max(0, before.cacheSizeBytes - after.cacheSizeBytes);
    if (options.cache && freed === 0 && before.cacheSizeBytes > 0) {
      freed = before.cacheSizeBytes;
    }

    const clearedTargets = (Object.keys(options) as Array<keyof CleanTargetOptions>).filter(
      (k) => Boolean(options[k]),
    );

    return {
      success: true,
      freedBytesEstimate: freed,
      freedFormatted: formatBytes(freed),
      clearedTargets,
      durationMs: Math.round(performance.now() - startTime),
      metricsAfter: after,
    };
  }

  async openCurrentPageExternally(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal || !this.window) return;
    const url = getExternalPageUrl(tab.url);
    if (!url) throw new Error('Этот адрес нельзя открыть во внешнем браузере.');
    const result = await dialog.showMessageBox(this.window, {
      type: 'question', title: 'Открыть системный браузер',
      message: `Открыть ${new URL(url).hostname} в системном браузере?`,
      detail: tab.isPrivate
        ? 'Адрес будет передан обычному системному браузеру. Приватная сессия и её прокси не распространяются на него. Выполненный там вход не переносится в SOUL-M8TE.'
        : 'Страница откроется в системном браузере. Выполненный там вход не переносится в SOUL-M8TE автоматически.',
      buttons: ['Отмена', 'Открыть'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await shell.openExternal(url);
  }

  async setSiteCookieException(tabId: string, allow: boolean): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isPrivate || tab.isInternal || typeof allow !== 'boolean') throw new Error('Исключения cookies доступны только для обычных сайтов.');
    const site = getSiteKey(tab.url);
    if (!site) throw new Error('Некорректный адрес сайта.');
    const current = this.stores.settings.get().thirdPartyCookieExceptions ?? [];
    this.updateSettings({ thirdPartyCookieExceptions: allow ? [...current, site] : current.filter((item) => item !== site) });
  }

  setSiteNotificationPermission(tabId: string, decision: NotificationPermissionDecision | 'ask'): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isPrivate || tab.isInternal) throw new Error('Разрешения уведомлений доступны только для обычных сайтов.');
    const origin = normalizePermissionOrigin(tab.url);
    if (!origin) throw new Error('Разрешения уведомлений доступны только для HTTPS-сайтов.');
    if (decision === 'ask') {
      this.notificationPermissions.delete(origin);
      this.stores.clearNotificationPermission(origin);
    } else {
      this.stores.setNotificationPermission(origin, decision);
      this.notificationPermissions.set(origin, decision);
    }
    this.emitSnapshot();
  }

  async setSiteAdBlockEnabled(tabId: string, enabled: boolean): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal || typeof enabled !== 'boolean') {
      throw new Error('Управление блокировщиком доступно только для открытых веб-сайтов.');
    }
    const site = normalizeSiteKey(tab.url);
    if (!site) throw new Error('Некорректный адрес сайта.');
    const current = this.stores.settings.get().adBlockExceptions ?? [];
    const next = enabled
      ? current.filter((item) => normalizeSiteKey(item) !== site)
      : [...new Set([...current, site])];
    this.updateSettings({ adBlockExceptions: next });
  }

  async importBrowserFile(kind: ImportFileKind): Promise<ImportFileReport | null> {
    if (!this.window || !['bookmarks', 'passwords'].includes(kind)) throw new Error('Неподдерживаемый тип импорта.');
    const result = await dialog.showOpenDialog(this.window, {
      title: kind === 'bookmarks' ? 'Импорт закладок HTML' : 'Импорт паролей CSV',
      properties: ['openFile'],
      filters: kind === 'bookmarks' ? [{ name: 'Закладки браузера', extensions: ['html', 'htm'] }] : [{ name: 'Экспорт паролей', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const report = await this.importer.importFile(result.filePaths[0], kind);
    this.emitSnapshot();
    return report;
  }

  discoverImportProfiles(): ImportProfile[] {
    return this.importer.discoverProfiles();
  }

  async importBrowserData(input: { profileId: string; data: ImportDataKind[] }): Promise<ImportReport> {
    const report = await this.importer.import(input.profileId, input.data);
    this.emitSnapshot();
    return report;
  }

  getImportedPasswordSummaries(): ImportedPasswordSummary[] {
    return this.passwords.summaries();
  }

  async deleteSavedPassword(passwordId: string): Promise<boolean> {
    if (!this.window || typeof passwordId !== 'string') throw new Error('Выберите запись пароля.');
    const summary = this.passwords.summaries().find(record => record.id === passwordId);
    if (!summary) return false;
    const result = await dialog.showMessageBox(this.window, {
      type: 'question', title: 'Удалить сохранённый пароль',
      message: `Удалить запись для ${summary.origin}?`,
      detail: `Логин: ${summary.username.replace(/[\r\n\0]/g, ' ').slice(0, 160) || 'не указан'}. Удаление нельзя отменить.`,
      buttons: ['Отмена', 'Удалить'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) return false;
    const deleted = this.passwords.delete(passwordId);
    if (deleted) this.eventListener?.({ type: 'passwords-changed' });
    return deleted;
  }

  async fillSavedPassword(tabId: string, passwordId: string): Promise<{ filled: boolean; reason?: string }> {
    const tab = this.tabs.get(tabId);
    const contents = tab?.view?.webContents;
    if (!this.window || !tab || tab.id !== this.activeTabId || tab.isPrivate || tab.isInternal || !contents || contents.isDestroyed()) {
      throw new Error('Заполнение доступно только для текущей обычной HTTPS-вкладки.');
    }
    const owner = this.window;
    const result = await fillSavedCredential({
      contents, passwordId, store: this.passwords,
      isCurrent: () => !this.disposed && this.activeTabId === tabId && this.tabs.get(tabId) === tab && tab.view?.webContents === contents && !tab.isPrivate,
      confirm: async metadata => {
        const decision = await dialog.showMessageBox(owner, {
          type: 'question', title: 'Заполнить сохранённый пароль',
          message: `Заполнить форму входа на ${metadata.origin}?`,
          detail: `Логин: ${metadata.username.replace(/[\r\n\0]/g, ' ').slice(0, 160) || 'не указан'}. Браузер заполнит поля и не будет нажимать кнопку входа. Сайт сможет прочитать данные и сам отреагировать на ввод.`,
          buttons: ['Отмена', 'Заполнить'], defaultId: 0, cancelId: 0, noLink: true,
        });
        return decision.response === 1;
      },
    });
    if (result.filled) this.memoryManager.updateTab(tabId, { hasFormEdits: true, lastInteractionAt: Date.now() });
    return result;
  }

  async saveCredential(origin: string, username: string, password: string): Promise<{ success: boolean; id: string; updated: boolean }> {
    const { id, updated } = this.passwords.save(origin, username, password);
    this.shellView?.webContents.send('browser:event', { type: 'passwords-changed' });
    this.emitSnapshot();
    return { success: true, id, updated };
  }

  async revealSavedPassword(passwordId: string): Promise<string | null> {
    return this.passwords.getSecret(passwordId);
  }

  async getSavedCredentialsForOrigin(origin: string): Promise<ImportedPasswordSummary[]> {
    return this.passwords.summaries().filter((s) => s.origin === origin);
  }

  async neverSavePasswordForOrigin(origin: string): Promise<void> {
    this.neverSaveOrigins.add(origin);
  }

  setChromeBounds(bounds: ChromeBounds): void {
    if (!bounds || typeof bounds !== 'object') return;
    const safeNumber = (value: number, fallback: number): number => Number.isFinite(value) ? Math.round(value) : fallback;
    const w = safeNumber(bounds.width, 0);
    const h = safeNumber(bounds.height, 0);
    if (w > 0 && h > 0) {
      const windowBounds = this.window?.getContentBounds();
      const measuredY = safeNumber(bounds.y, 144);
      const safeY = (measuredY >= 80 || this.htmlFullscreenTabId) ? measuredY : 144;
      const safeX = Math.max(0, safeNumber(bounds.x, 0));
      const safeH = windowBounds ? Math.max(0, windowBounds.height - safeY) : h;

      this.chromeBounds = {
        x: safeX,
        y: safeY,
        width: w,
        height: safeH,
      };
      if (!this.window?.isFullScreen()) {
        this.lastValidBounds = { ...this.chromeBounds };
      }
    }
    this.refreshViewBounds();
  }

  setPopoverOpen(open: boolean): void {
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    const wasOpen = this.popoverOpen;
    this.popoverOpen = Boolean(open);
    this.refreshViewBounds();
    const activeTab = this.tabs.get(this.activeTabId);
    if (wasOpen && !this.popoverOpen && activeTab?.view && !activeTab.view.webContents.isDestroyed()
      && !activeTab.isInternal && !activeTab.isReaderActive && activeTab.lifecycle !== 'crashed') {
      activeTab.view.webContents.focus();
    }
  }

  private raiseShellOverlay(): void {
    if (!this.popoverOpen || !this.window || this.window.isDestroyed() || !this.shellView || this.shellView.webContents.isDestroyed()) return;
    const children = this.window.contentView.children;
    const shellIdx = children.indexOf(this.shellView);
    if (shellIdx !== -1 && children.some((view, index) => index > shellIdx && view !== this.voodooView)) {
      try { this.window.contentView.removeChildView(this.shellView); } catch {}
      this.window.contentView.addChildView(this.shellView);
    }
    // If voodooView was present and should be top-most, ensure it stays above shellView
    if (this.voodooView && !this.voodooView.webContents.isDestroyed() && children.includes(this.voodooView)) {
      const curChildren = this.window.contentView.children;
      if (curChildren[curChildren.length - 1] !== this.voodooView) {
        try {
          this.window.contentView.removeChildView(this.voodooView);
          this.window.contentView.addChildView(this.voodooView);
        } catch {}
      }
    }
  }

  reorderTab(tabId: string, targetTabId: string, position: 'before' | 'after' = 'before'): void {
    const entries = [...this.tabs.entries()];
    const sourceIndex = entries.findIndex(([id]) => id === tabId);
    if (sourceIndex === -1) return;

    if (targetTabId === 'end') {
      const [removed] = entries.splice(sourceIndex, 1);
      entries.push(removed);
    } else {
      const targetIndex = entries.findIndex(([id]) => id === targetTabId);
      if (targetIndex === -1 || sourceIndex === targetIndex) return;
      const [removed] = entries.splice(sourceIndex, 1);
      let insertIndex = entries.findIndex(([id]) => id === targetTabId);
      if (position === 'after') {
        insertIndex += 1;
      }
      entries.splice(insertIndex, 0, removed);
    }
    this.tabs.clear();
    for (const [id, tab] of entries) {
      this.tabs.set(id, tab);
    }
    this.emitSnapshot();
    this.persistSession();
  }

  private async getCookieArgsForUrl(targetUrl: string, sourceSession: Electron.Session = this.browserSession): Promise<{ args: string[]; cleanup: () => void }> {
    try {
      const u = new URL(targetUrl);
      const host = u.hostname.toLowerCase();
      let cookies: Electron.Cookie[] = [];
      const isYoutube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
      const isVk = host === 'vk.com' || host.endsWith('.vk.com') || host === 'vkvideo.ru' || host.endsWith('.vkvideo.ru') || host.includes('vkuser');

      if (isYoutube) {
        const ytCookiesDot = await sourceSession.cookies.get({ domain: '.youtube.com' });
        const ytCookiesBare = await sourceSession.cookies.get({ domain: 'youtube.com' });
        const googleCookiesDot = await sourceSession.cookies.get({ domain: '.google.com' });
        const googleCookiesBare = await sourceSession.cookies.get({ domain: 'google.com' });
        cookies = [...ytCookiesDot, ...ytCookiesBare, ...googleCookiesDot, ...googleCookiesBare];
      } else if (isVk) {
        const vkDot = await sourceSession.cookies.get({ domain: '.vk.com' });
        const vkDirect = await sourceSession.cookies.get({ domain: 'vk.com' });
        const vkvDot = await sourceSession.cookies.get({ domain: '.vkvideo.ru' });
        cookies = [...vkDot, ...vkDirect, ...vkvDot];
      } else {
        cookies = await sourceSession.cookies.get({ url: targetUrl });
      }

      if (!cookies || cookies.length === 0) {
        return { args: [], cleanup: () => {} };
      }
      return createMediaCookieFile(cookies, host);
    } catch {
      return { args: [], cleanup: () => {} };
    }
  }

  downloadMediaUrl(url: string, filename?: string, isAudio = false, sourceWebContentsId?: number): void {
    if (!url || !isSafeWebUrl(url)) return;
    const activeTab = sourceWebContentsId === undefined
      ? this.tabs.get(this.activeTabId)
      : [...this.tabs.values()].find((tab) => tab.webContentsId === sourceWebContentsId);
    const activeStream = activeTab?.webContentsId ? this.capturedMediaStreams.get(activeTab.webContentsId) : undefined;

    // 1. Audio request handling (VK music, direct mp3/m3u8, page audio)
    if (isAudio) {
      if (activeStream?.audio && (url === activeTab?.url || url.includes('vk.com') || url.includes('vkuseraudio.net'))) {
        const audioUrl = activeStream.audio;
        const customName = filename || activeTab?.capturedAudioFilename;
        if (audioUrl.includes('.m3u8')) {
          void this.downloadWithYtDlp(audioUrl, customName, true, activeTab?.isPrivate ?? false);
        } else if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
          this.downloadMedia(activeTab.view.webContents, audioUrl);
        } else {
          void this.downloadWithYtDlp(audioUrl, customName, true, activeTab?.isPrivate ?? false);
        }
        return;
      }
      if (url.includes('vkuseraudio.net') || mediaKindForUrl(url) === 'audio') {
        if (url.includes('.m3u8')) {
          void this.downloadWithYtDlp(url, filename, true, activeTab?.isPrivate ?? false);
        } else if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
          this.downloadMedia(activeTab.view.webContents, url);
        } else {
          void this.downloadWithYtDlp(url, filename, true, activeTab?.isPrivate ?? false);
        }
        return;
      }
    }

    // 2. Pinterest photo & video intelligent extraction
    if (url.includes('pinterest.') || url.includes('pin.it') || url.includes('pinimg.com')) {
      if (url.includes('pinimg.com')) {
        const origUrl = url.replace(/\/(?:236|474|564|736)x\//, '/originals/');
        if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
          this.downloadMedia(activeTab.view.webContents, origUrl);
        } else {
          this.browserSession.downloadURL(origUrl);
        }
        return;
      }

      if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
        const contents = activeTab.view.webContents;
        contents.executeJavaScript(`
          (function() {
            try {
              // A. Parse __PWS_DATA__ for highest quality direct MP4 video or original image
              const pwsScript = document.getElementById('__PWS_DATA__');
              if (pwsScript && pwsScript.textContent) {
                try {
                  const pwsStr = pwsScript.textContent;
                  const mp4Matches = pwsStr.match(/https:\\/\\/[^"'\\s]+\\.mp4/g);
                  if (mp4Matches && mp4Matches.length > 0) {
                    const bestMp4 = mp4Matches.find(u => u.includes('720p') || u.includes('1080p') || u.includes('V_720P')) || mp4Matches[0];
                    return { type: 'video', url: bestMp4 };
                  }
                  const origMatches = pwsStr.match(/https:\\/\\/i\\.pinimg\\.com\\/originals\\/[^"'\\s]+(?:\\.jpg|\\.png|\\.webp)/g);
                  if (origMatches && origMatches.length > 0) {
                    return { type: 'image', url: origMatches[0] };
                  }
                } catch {}
              }

              // B. Direct video element
              const video = document.querySelector('video');
              if (video && video.src && video.src.startsWith('http')) return { type: 'video', url: video.src };
              const source = video?.querySelector('source');
              if (source && source.src && source.src.startsWith('http')) return { type: 'video', url: source.src };

              // C. Main pin image - pick largest on page
              const candidates = Array.from(document.querySelectorAll('img[src*="pinimg.com"]'));
              if (candidates.length > 0) {
                candidates.sort((a, b) => {
                  const areaA = (a.naturalWidth || a.clientWidth || 0) * (a.naturalHeight || a.clientHeight || 0);
                  const areaB = (b.naturalWidth || b.clientWidth || 0) * (b.naturalHeight || b.clientHeight || 0);
                  return areaB - areaA;
                });
                const best = candidates[0];
                if (best && best.src) {
                  return { type: 'image', url: best.src.replace(/\\/(?:236|474|564|736)x\\//, '/originals/') };
                }
              }

              // D. OpenGraph fallbacks
              const ogVideo = document.querySelector('meta[property="og:video"]')?.getAttribute('content');
              if (ogVideo && ogVideo.startsWith('http')) return { type: 'video', url: ogVideo };

              const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
              if (ogImg && ogImg.startsWith('http')) {
                return { type: 'image', url: ogImg.replace(/\\/(?:236|474|564|736)x\\//, '/originals/') };
              }
            } catch {}
            return null;
          })()
        `).then((res: { type: string; url: string } | null) => {
          if (res?.url && isSafeWebUrl(res.url)) {
            if (res.type === 'video' && res.url.includes('.m3u8')) {
              void this.downloadWithYtDlp(res.url, filename, false, activeTab?.isPrivate ?? false);
            } else {
              this.downloadMedia(contents, res.url);
            }
          } else {
            void this.downloadWithYtDlp(url, filename, isAudio, activeTab?.isPrivate ?? false);
          }
        }).catch(() => {
          void this.downloadWithYtDlp(url, filename, isAudio, activeTab?.isPrivate ?? false);
        });
        return;
      }
    }

    // 3. Normalize VK and YouTube modal URLs
    const normalizedUrl = normalizeVideoUrl(url);

    if (isVideoPageUrl(normalizedUrl)) {
      void this.downloadWithYtDlp(normalizedUrl, filename, isAudio, activeTab?.isPrivate ?? false);
      return;
    }

    if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
      this.downloadMedia(activeTab.view.webContents, normalizedUrl);
    }
  }

  private async downloadWithYtDlp(rawUrl: string, customFilename?: string, isAudio = false, isPrivate = false): Promise<void> {
    const sourceSession = isPrivate ? this.privateSession : this.browserSession;
    if (!sourceSession || this.disposed) return;
    const url = normalizeVideoUrl(rawUrl);
    const localBin = path.join(os.homedir(), '.local/bin/yt-dlp');
    const ytDlpPath = fs.existsSync(localBin) ? localBin : 'yt-dlp';

    const id = crypto.randomUUID();
    const downloadDir = app.getPath('downloads');
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
    } catch {}
    const outputFilename = this.mediaOutputFilename(customFilename, isAudio);
    const isGenericName = !customFilename || /^(?:youtube[-_]?(?:video|shorts|audio)|youtube|shorts|video|audio|untitled|stream)(?:\.(?:mp[34]|mkv|webm|m4a))?$/i.test(customFilename.trim());
    const effectiveOutputName = isGenericName ? undefined : outputFilename;
    const expectedOutputPath = effectiveOutputName ? path.join(downloadDir, effectiveOutputName) : undefined;

    const entry: DownloadEntry = {
      id,
      url,
      filename: effectiveOutputName || (isAudio ? 'audio.mp3' : 'video.mp4'),
      path: expectedOutputPath,
      kind: isAudio ? 'audio' : 'video',
      isPrivate,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: 0,
      startedAt: Date.now(),
      isLive: true,
    };
    this.downloads.unshift(entry);
    this.emitSnapshot();

    const args = [
      '--no-warnings',
      '--newline',
      '--no-playlist',
      '--socket-timeout', '25',
      '--retries', '10',
      '--fragment-retries', '10',
      '--file-access-retries', '5',
      '--concurrent-fragments', '4',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '-P', downloadDir,
    ];

    args.push('-o', expectedOutputPath || path.join(downloadDir, '%(title)s.%(ext)s'));

    const targetSite = videoSiteForUrl(url);
    if (targetSite === 'vk' || url.includes('vkuservideo.net') || url.includes('vkuseraudio.net')) {
      args.push('--referer', url.includes('vkvideo.ru') ? 'https://vkvideo.ru/' : 'https://vk.com/');
      args.push('--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    } else if (targetSite === 'youtube') {
      args.push('--http-chunk-size', '10M');
    }

    const cookieInfo = await this.getCookieArgsForUrl(url, sourceSession);
    if (this.disposed || (isPrivate && this.privateSession !== sourceSession)) {
      cookieInfo.cleanup();
      entry.isLive = false;
      entry.state = 'interrupted';
      entry.error = 'Сессия загрузки завершена.';
      return;
    }
    const releaseCookies = () => {
      cookieInfo.cleanup();
      this.mediaCookieCleanup?.delete(id);
    };
    this.mediaCookieCleanup?.set(id, releaseCookies);
    if (cookieInfo.args.length > 0) {
      args.push(...cookieInfo.args);
    }

    if (isAudio) {
      args.push('-x', '--audio-format', 'mp3');
    } else {
      args.push('--merge-output-format', 'mp4', '-f', 'bestvideo+bestaudio/bestvideo*+bestaudio*/best');
    }
    args.push(url);

    try {
      const child = spawn(ytDlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.ytDlpProcesses.set(id, { child, isPaused: false });
      let stderrText = '';
      let finalized = false;

      const finalizeFailure = (message: string) => {
        if (finalized) return;
        finalized = true;
        releaseCookies();
        this.ytDlpProcesses.delete(id);
        entry.isLive = false;
        entry.state = 'interrupted';
        entry.error = this.userFacingMediaDownloadError(message, isAudio);
        this.persistDownloads(true);
        this.emitSnapshot();
      };

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrText = (stderrText + chunk.toString()).slice(-65536);
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const destMatch = text.match(/Destination:\s*(.+)$/m) || text.match(/\[Merger\] Merging formats into "(.+)"/m) || text.match(/\[download\]\s+(.+?\.mp[34])/m);
        if (destMatch && destMatch[1]) {
          const filePath = destMatch[1].trim();
          entry.path = filePath;
          entry.filename = path.basename(filePath);
        }
        const progMatch = text.match(/\[download\]\s+([\d.]+)%(?:\s+of\s+~?([\d.]+)\s*([A-Za-z]+))?/);
        if (progMatch) {
          const pct = parseFloat(progMatch[1]);
          if (!Number.isNaN(pct)) {
            if (progMatch[2] && progMatch[3]) {
              const num = parseFloat(progMatch[2]);
              const unit = progMatch[3].toLowerCase();
              let bytes = num;
              if (unit.startsWith('g')) bytes = num * 1024 * 1024 * 1024;
              else if (unit.startsWith('m')) bytes = num * 1024 * 1024;
              else if (unit.startsWith('k')) bytes = num * 1024;
              entry.totalBytes = Math.round(bytes);
              entry.receivedBytes = Math.round((pct / 100) * entry.totalBytes);
            } else if (entry.totalBytes > 0) {
              entry.receivedBytes = Math.round((pct / 100) * entry.totalBytes);
            }
          }
        }
        if (entry.path && fs.existsSync(entry.path)) {
          try {
            const sz = fs.statSync(entry.path).size;
            if (sz > 0) {
              entry.receivedBytes = sz;
              if (entry.totalBytes < sz) entry.totalBytes = sz;
            }
          } catch {}
        }
        this.emitSnapshot();
      });

      child.on('close', (code) => {
        if (finalized) return;
        finalized = true;
        releaseCookies();
        this.ytDlpProcesses.delete(id);
        entry.isLive = false;
        entry.canResume = false;
        entry.finishedAt = Date.now();
        if (code === 0) {
          entry.state = 'completed';
          let finalSize = 0;
          if (entry.path && fs.existsSync(entry.path)) {
            try { finalSize = fs.statSync(entry.path).size; } catch {}
          }
          if (finalSize > 0) {
            entry.receivedBytes = finalSize;
            entry.totalBytes = finalSize;
          } else if (entry.totalBytes > 0) {
            entry.receivedBytes = entry.totalBytes;
          }
        } else {
          entry.state = 'interrupted';
          const errLine = stderrText.split('\n').filter(l => l.trim().startsWith('ERROR:')).pop() || '';
          entry.error = this.userFacingMediaDownloadError(errLine ? errLine.replace(/^ERROR:\s*/, '') : '', isAudio);
        }
        this.persistDownloads(true);
        this.emitSnapshot();
      });

      child.on('error', (err) => {
        finalizeFailure(err.message || 'Ошибка загрузчика');
      });
    } catch (cause) {
      releaseCookies();
      this.ytDlpProcesses.delete(id);
      entry.isLive = false;
      entry.state = 'interrupted';
      entry.error = cause instanceof Error ? cause.message : 'Ошибка загрузки';
      this.persistDownloads(true);
      this.emitSnapshot();
    }
  }

  private sanitizeMediaFilename(rawFilename?: string): string | undefined {
    if (typeof rawFilename !== 'string') return undefined;
    const cleaned = rawFilename
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '')
      .slice(0, 180);
    return cleaned || undefined;
  }

  private mediaOutputFilename(rawFilename: string | undefined, isAudio: boolean): string | undefined {
    const cleaned = this.sanitizeMediaFilename(rawFilename);
    if (!cleaned) return undefined;
    const base = cleaned
      .replace(/\.(?:mp3|m4a|aac|flac|wav|ogg|mp4|mkv|webm|mov|avi|m4v)$/i, '')
      .replace(/\.+$/, '')
      .trim();
    return `${base || (isAudio ? 'audio' : 'video')}.${isAudio ? 'mp3' : 'mp4'}`;
  }

  private userFacingMediaDownloadError(error: string, isAudio: boolean): string {
    const lower = error.toLowerCase();
    if (lower.includes('yt-dlp') || lower.includes('not found') || lower.includes('enoent')) return 'Загрузчик видео не найден. Установите yt-dlp и повторите попытку.';
    if (lower.includes('sign in') || lower.includes('login') || lower.includes('cookies')) return 'Сайт требует входа. Откройте сайт в этой вкладке и повторите скачивание.';
    if (lower.includes('private') || lower.includes('members-only')) return 'Видео доступно только авторизованным пользователям или имеет ограниченный доступ.';
    if (lower.includes('unsupported url')) return 'Эта страница не поддерживается для скачивания.';
    if (lower.includes('requested format') || lower.includes('format')) return isAudio ? 'Не удалось получить аудиопоток для этой страницы.' : 'Не удалось подобрать совместимый видеопоток.';
    return error || (isAudio ? 'Не удалось скачать аудио.' : 'Не удалось скачать видео.');
  }

  minimizeWindow(): void {
    this.window?.minimize();
  }

  toggleMaximizeWindow(): void {
    if (!this.window) return;
    if (this.window.isMaximized()) this.window.unmaximize();
    else this.window.maximize();
  }

  toggleFullScreen(): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    if (this.htmlFullscreenTabId) {
      this.exitPageFullscreen();
      return false;
    }
    const next = !this.window.isFullScreen();
    this.window.setFullScreen(next);
    if (typeof this.refreshViewBounds === 'function') this.refreshViewBounds();
    if (typeof this.notifyFullscreenChange === 'function') this.notifyFullscreenChange(next);
    if (this.stores) this.emitSnapshot();
    return next;
  }

  exitFullScreenIfActive(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.htmlFullscreenTabId) {
      this.exitPageFullscreen();
    } else if (this.window.isFullScreen()) {
      this.toggleFullScreen();
    }
  }

  private notifyFullscreenChange(isFullScreen: boolean): void {
    const activeTab = this.tabs?.get(this.activeTabId);
    if (activeTab?.view && !activeTab.view.webContents.isDestroyed()) {
      activeTab.view.webContents.send('tab:fullscreen-changed', {
        isFullScreen,
        isHtmlFullscreen: Boolean(this.htmlFullscreenTabId),
      });
    }
    if (this.shellView && !this.shellView.webContents.isDestroyed()) {
      this.shellView.webContents.send('shell:fullscreen-changed', { isFullScreen });
    }
  }

  closeWindow(): void {
    this.window?.close();
  }

  private ensurePrivateSession(): Electron.Session {
    if (!this.privateSession) {
      this.privateSession = session.fromPartition(`private-${crypto.randomUUID()}`, { cache: false });
      this.privateAdBlock = new SessionAdBlock(new FilterEngine());
      this.privateAdBlock.engine.setExceptions(this.stores.settings.get().adBlockExceptions ?? []);
      this.configureSession(this.privateSession, true);
      if (this.privateProxy) {
        this.privateProxyReady = this.applyPrivateProxy(this.privateSession, this.privateProxy);
      } else {
        void this.browsec.registerSession(this.privateSession);
      }
    }
    return this.privateSession;
  }

  async setPrivateProxy(rawProxy: string): Promise<void> {
    if (typeof rawProxy !== 'string') throw new Error('Некорректный адрес прокси.');
    let value = rawProxy.trim();
    if (value) {
      let parsed: URL;
      try { parsed = new URL(value); } catch { throw new Error('Введите socks5://host:port или http://host:port.'); }
      const explicitPort = /^[a-z0-9]+:\/\/(?:\[[^\]]+\]|[^/:?#]+):(\d+)\/?$/i.exec(value)?.[1];
      const port = parsed.port || explicitPort;
      if (!['socks5:', 'http:', 'https:'].includes(parsed.protocol) || !/^(?:[a-z0-9._-]+|\[[a-f0-9:]+\])$/i.test(parsed.hostname) || !port || Number(port) < 1 || Number(port) > 65535 || /\s/.test(value) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
        throw new Error('Прокси должен содержать только протокол, сервер и порт; логин и пароль не поддерживаются.');
      }
      value = `${parsed.protocol}//${parsed.hostname}:${port}`;
    }
    const target = this.ensurePrivateSession();
    const operation = this.privateProxyReady.then(() => this.applyPrivateProxy(target, value));
    this.privateProxyReady = operation.catch(() => undefined);
    await operation;
    this.privateProxy = value;
    this.emitSnapshot();
  }

  private async applyPrivateProxy(target: Electron.Session, value: string): Promise<void> {
    if (value) {
      this.browsec.unregisterSession(target);
      await target.setProxy({ mode: 'fixed_servers', proxyRules: value, proxyBypassRules: '<-loopback>' });
    } else {
      await target.setProxy({ mode: 'direct' });
      void this.browsec.registerSession(target);
    }
    await target.closeAllConnections();
  }

  getBrowsecSnapshot(): BrowsecState {
    return this.browsec.getSnapshot();
  }

  getBrowsecCountries(): BrowsecCountry[] {
    return this.browsec.getCountries();
  }

  getHealthStatus(): VpnHealthStatus {
    return this.browsec.getHealthStatus();
  }

  async triggerManualHealthCheck(countryCode?: string): Promise<VpnHealthStatus> {
    const result = await this.browsec.triggerManualHealthCheck(countryCode);
    this.emitSnapshot();
    return result;
  }

  async toggleBrowsec(enabled?: boolean): Promise<BrowsecState> {
    return this.browsec.toggle(enabled);
  }

  async setBrowsecCountry(code: string): Promise<BrowsecState> {
    return this.browsec.setCountry(code);
  }

  async setBrowsecWebRtcLeakProtection(enabled: boolean): Promise<BrowsecState> {
    return this.browsec.setWebRtcLeakProtection(enabled);
  }

  async addBrowsecSmartRule(domain: string, country: string): Promise<BrowsecState> {
    return this.browsec.addSmartRule(domain, country);
  }

  async removeBrowsecSmartRule(domain: string): Promise<BrowsecState> {
    return this.browsec.removeSmartRule(domain);
  }

  async toggleBrowsecSmartRule(domain: string): Promise<BrowsecState> {
    return this.browsec.toggleSmartRule(domain);
  }

  async updateBrowsec(patch: Partial<BrowsecState>): Promise<BrowsecState> {
    if (typeof patch.enabled === 'boolean') {
      await this.browsec.toggle(patch.enabled);
    }
    const country = patch.country || patch.selectedCountry;
    if (typeof country === 'string' && country) {
      await this.browsec.setCountry(country);
    }
    const webrtc = typeof patch.webrtcProtection === 'boolean'
      ? patch.webrtcProtection
      : (typeof patch.webrtcLeakProtection === 'boolean' ? patch.webrtcLeakProtection : undefined);
    if (typeof webrtc === 'boolean') {
      await this.browsec.setWebRtcLeakProtection(webrtc);
    }
    if (Array.isArray(patch.smartRules)) {
      for (const rule of patch.smartRules) {
        if (rule && rule.domain) {
          const ruleCountry = rule.country || rule.countryCode || 'direct';
          await this.browsec.addSmartRule(rule.domain, ruleCountry);
          if (rule.enabled === false) {
            await this.browsec.toggleSmartRule(rule.domain);
          }
        }
      }
    }
    return this.browsec.getSnapshot();
  }

  private async endPrivateSession(): Promise<void> {
    const target = this.privateSession;
    this.privateSession = undefined;
    this.privateAdBlock = new SessionAdBlock(new FilterEngine());
    if (target) {
      this.browsec.unregisterSession(target);
    }
    for (const [id, download] of this.liveDownloads) {
      if (this.downloads.find((entry) => entry.id === id)?.isPrivate) download.item.cancel();
    }
    for (const [id, process] of this.ytDlpProcesses) {
      if (!this.downloads.find((entry) => entry.id === id)?.isPrivate) continue;
      try { if (process.isPaused) process.child.kill('SIGCONT'); process.child.kill('SIGTERM'); } catch {}
      this.ytDlpProcesses.delete(id);
      this.mediaCookieCleanup?.get(id)?.();
    }
    this.downloads.splice(0, this.downloads.length, ...this.downloads.filter((entry) => !entry.isPrivate));
    if (target) {
      const handler = this.sessionDownloadHandlers.get(target);
      if (handler) target.removeListener('will-download', handler);
      this.sessionDownloadHandlers.delete(target);
      target.webRequest.onBeforeRequest(null);
      target.webRequest.onBeforeSendHeaders(null);
      target.webRequest.onHeadersReceived(null);
      target.setPermissionCheckHandler(null);
      target.setPermissionRequestHandler(null);
      await Promise.allSettled([target.clearStorageData(), target.clearCache(), target.clearAuthCache(), target.closeAllConnections()]);
    }
    if (!this.privateSession) this.privateProxyReady = Promise.resolve();
  }

  private configureSession(targetSession: Electron.Session, isPrivate = false): void {
    const blocker = isPrivate ? this.privateAdBlock : this.adBlock;
    blocker.engine.setEnabled(this.stores.settings.get().adBlockEnabled !== false);
    this.browsec.applyWebRtcPolicyToSession(targetSession);
    // Identify as native Google Chrome 134 on Linux/current OS without any Electron or custom app tokens.
    targetSession.setUserAgent(getChromeUserAgent());
    const allowedPermissions = new Set<string>();
    const notificationPermissions = isPrivate ? new Map<string, NotificationPermissionDecision>() : this.notificationPermissions;
    const pendingNotificationPermissions = new Map<string, Promise<NotificationPermissionDecision>>();
    const permissionKey = (origin: string, permission: string) => `${origin}:${permission}`;
    const storageKey = (top: string, origin: string): string => {
      try { return `storage-access:${new URL(top).origin}:${new URL(origin).origin}`; } catch { return ''; }
    };
    const storageEligible = (requestUrl: string, contents: Electron.WebContents | null): boolean => Boolean(contents && !contents.isDestroyed() && canRequestStorageAccess({
      requestUrl, topLevelUrl: contents.getURL(), isPrivate,
      exceptions: this.stores.settings.get().thirdPartyCookieExceptions,
      googleSignInCompatibility: this.stores.settings.get().googleSignInCompatibility,
    }));
    targetSession.setPermissionCheckHandler((contents, permission, origin, details) => {
      const isInternal = origin.startsWith('app://') || contents?.id === this.voodooContentsId || contents?.id === this.shellContentsId;
      if (['media', 'mediaKeySystem', 'speechRecognition', 'audioCapture'].includes(permission)) {
        if (isInternal) {
          return true;
        }
      }
      if (permission === 'storage-access') {
        return storageEligible(details.requestingUrl || origin, contents) && Boolean(contents && allowedPermissions.has(storageKey(contents.getURL(), origin)));
      }
      if (permission === 'notifications') {
        const decision = notificationPermissions.get(origin) ?? (isPrivate ? undefined : this.stores.getNotificationPermission(origin));
        return decision === 'allow';
      }
      return permission === 'fullscreen' || permission === 'clipboard-sanitized-write' || allowedPermissions.has(permissionKey(origin, permission));
    });
    targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission === 'fullscreen' || permission === 'clipboard-sanitized-write') { callback(true); return; }
      const reqOrigin = details.requestingUrl || (contents && !contents.isDestroyed() ? contents.getURL() : '') || '';
      const isInternal = reqOrigin.startsWith('app://') || contents?.id === this.voodooContentsId || contents?.id === this.shellContentsId;
      if (['media', 'mediaKeySystem', 'speechRecognition', 'audioCapture'].includes(permission)) {
        if (isInternal) {
          callback(true);
          return;
        }
      }
      if (!contents || contents.isDestroyed()) { callback(false); return; }
      const permissionContext = permissionRequestGuard(contents, reqOrigin, details.isMainFrame !== false);
      const answer = callback;
      let answered = false;
      callback = (granted) => {
        if (answered) return;
        answered = true;
        const current = permissionContext.current();
        permissionContext.dispose();
        answer(granted && current);
      };
      if (permission === 'storage-access') {
        if (!this.window || !storageEligible(details.requestingUrl, contents)) { callback(false); return; }
        const topOrigin = new URL(contents.getURL()).origin;
        const origin = new URL(details.requestingUrl).origin;
        void dialog.showMessageBox(this.window, { type: 'question', title: 'Cookies для входа', message: `${origin} запрашивает доступ к своим cookies внутри ${topOrigin}.`, detail: 'Разрешение действует для этой пары сайтов до закрытия приложения. Оно может помочь завершить вход.', buttons: ['Запретить', 'Разрешить на эту сессию'], defaultId: 0, cancelId: 0, noLink: true }).then(({ response }) => {
          const allowed = response === 1 && permissionContext.current() && storageEligible(details.requestingUrl, contents) && new URL(contents.getURL()).origin === topOrigin;
          if (allowed) allowedPermissions.add(storageKey(topOrigin, origin));
          callback(allowed);
        }).catch(() => callback(false));
        return;
      }
      let origin: string;
      try { origin = new URL(details.requestingUrl || contents.getURL()).origin; } catch { callback(false); return; }
      if (!origin.startsWith('https://') || !['media', 'geolocation', 'notifications'].includes(permission) || !this.window || contents.isDestroyed()) { callback(false); return; }
      if (permission === 'notifications') {
        const storedDecision = notificationPermissions.get(origin) ?? (isPrivate ? undefined : this.stores.getNotificationPermission(origin));
        if (storedDecision) { callback(storedDecision === 'allow'); return; }
        const requestKey = permissionKey(origin, permission);
        const pending = pendingNotificationPermissions.get(requestKey);
        if (pending) {
          void pending.then((decision) => callback(decision === 'allow')).catch(() => callback(false));
          return;
        }
        const decisionPromise = dialog.showMessageBox(this.window, {
          type: 'question',
          title: 'Разрешение сайта',
          message: `${origin} запрашивает доступ к уведомлениям.`,
          detail: 'Выбор будет сохранён для этого сайта и больше не будет спрашиваться при каждом обновлении страницы.',
          buttons: ['Запретить', 'Разрешить'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }).then(({ response }): NotificationPermissionDecision => {
          if (!permissionContext.current()) return 'deny';
          const decision: NotificationPermissionDecision = response === 1 ? 'allow' : 'deny';
          notificationPermissions.set(origin, decision);
          if (!isPrivate) {
            try { this.stores.setNotificationPermission(origin, decision); } catch { /* Keep the in-memory decision for this session. */ }
          }
          return decision;
        }).catch(() => {
          notificationPermissions.set(origin, 'deny');
          return 'deny' as const;
        });
        pendingNotificationPermissions.set(requestKey, decisionPromise);
        void decisionPromise.then((decision) => callback(decision === 'allow')).catch(() => callback(false)).finally(() => {
          if (pendingNotificationPermissions.get(requestKey) === decisionPromise) pendingNotificationPermissions.delete(requestKey);
        });
        return;
      }
      const label = permission === 'media' ? 'камере или микрофону' : permission === 'geolocation' ? 'местоположению' : 'уведомлениям';
      void dialog.showMessageBox(this.window, { type: 'question', title: 'Разрешение сайта', message: `${origin} запрашивает доступ к ${label}.`, buttons: ['Запретить', 'Разрешить на эту сессию'], defaultId: 0, cancelId: 0, noLink: true }).then(({ response }) => {
        const allowed = response === 1 && permissionContext.current();
        if (allowed) {
          allowedPermissions.add(permissionKey(origin, permission));
          if (permission === 'media') {
            const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === contents.id);
            if (tab) this.memoryManager.updateTab(tab.id, { capturing: true });
          }
        }
        callback(allowed);
      }).catch(() => callback(false));
    });
    const stripCookies = (details: Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails): boolean => {
      const topLevelUrl = details.webContents && !details.webContents.isDestroyed()
        ? details.webContents.getURL() : details.initiatorOrigin || details.referrer;
      return shouldStripThirdPartyCookies({
        requestUrl: details.url, topLevelUrl, resourceType: details.resourceType, isPrivate,
        enabled: this.stores.settings.get().blockThirdPartyCookies !== false,
        exceptions: this.stores.settings.get().thirdPartyCookieExceptions,
        googleSignInCompatibility: this.stores.settings.get().googleSignInCompatibility,
      });
    };
    targetSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const topLevelUrl = details.webContents && !details.webContents.isDestroyed()
        ? details.webContents.getURL()
        : (details.webContentsId ? [...this.tabs.values()].find((t) => t.webContentsId === details.webContentsId)?.url : undefined)
          || details.referrer;
      if (blocker.engine.shouldBlock(details.url, details.resourceType, topLevelUrl)) {
        this.emitSnapshot();
        callback({ cancel: true });
        return;
      }
      if (details.webContentsId && details.url.includes('googlevideo.com/videoplayback')) {
        try {
          const rawUrl = new URL(details.url);
          rawUrl.searchParams.delete('range');
          const cleanUrl = rawUrl.toString();
          const itag = rawUrl.searchParams.get('itag');
          const current = this.capturedMediaStreams.get(details.webContentsId) || {};
          if (itag === '18' || itag === '22') {
            current.video = cleanUrl;
          } else if (itag === '140' || itag === '251' || itag === '250' || itag === '249') {
            current.audio = cleanUrl;
          } else if (!current.video && itag && ['137', '136', '135', '134'].includes(itag)) {
            current.video = cleanUrl;
          }
          this.capturedMediaStreams.set(details.webContentsId, current);
        } catch {}
      } else if (details.webContentsId && (
        details.url.includes('vkuseraudio.net') ||
        details.url.includes('audio_api_unavailable') ||
        details.url.includes('.mp3') ||
        details.url.includes('vkuservideo.net') ||
        (details.resourceType === 'media' && !details.url.includes('googlevideo.com'))
      )) {
        try {
          const current = this.capturedMediaStreams.get(details.webContentsId) || {};
          if (details.url.includes('vkuservideo.net') || details.url.includes('.mp4')) {
            current.video = details.url;
          } else {
            current.audio = details.url;
          }
          this.capturedMediaStreams.set(details.webContentsId, current);
          const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === details.webContentsId);
          if (tab && !tab.hasDownloadableMedia) {
            tab.hasDownloadableMedia = true;
            this.emitSnapshot();
          }
        } catch {}
      }
      callback({});
    });
    targetSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (isPrivate) { headers.DNT = '1'; headers['Sec-GPC'] = '1'; }
      if (stripCookies(details)) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cookie') delete headers[key];
      }
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (['user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(lower)) {
          delete headers[key];
        }
      }
      const clientHints = getClientHintHeaders();
      headers['User-Agent'] = clientHints['User-Agent'];
      headers['Sec-CH-UA'] = clientHints['Sec-CH-UA'];
      headers['Sec-CH-UA-Mobile'] = clientHints['Sec-CH-UA-Mobile'];
      headers['Sec-CH-UA-Platform'] = clientHints['Sec-CH-UA-Platform'];
      callback({ requestHeaders: headers });
    });
    targetSession.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.responseHeaders };
      if (stripCookies(details)) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'set-cookie') delete headers[key];
      }
      callback({ responseHeaders: headers });
    });
    const onDownload = (_event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => this.handleDownload(item, contents, targetSession);
    this.sessionDownloadHandlers.set(targetSession, onDownload);
    targetSession.on('will-download', onDownload);

    // Certificate names are untrusted metadata; keep Chromium's full chain,
    // hostname and expiry validation for every issuer.
    targetSession.setCertificateVerifyProc((_request, callback) => callback(-3));
  }

  private attachWebContents(tab: TabRecord, initialUrl: string, popupOptions?: Electron.BrowserWindowConstructorOptions): Electron.WebContents | undefined {
    if (!this.window || this.disposed) return;
    const tabSession = tab.isPrivate ? this.ensurePrivateSession() : this.browserSession;
    // Electron passes the already-created native popup WebContents in options
    // (documented by setWindowOpenHandler, absent from BrowserWindow's typings).
    // Adopting it is essential: constructing a replacement loses WindowProxy and
    // can violate Chromium's pending window invariants.
    const nativePopupContents = (popupOptions as Electron.WebContentsViewConstructorOptions | undefined)?.webContents;
    const view = new WebContentsView({ ...(nativePopupContents ? { webContents: nativePopupContents } : {}), webPreferences: {
      ...popupOptions?.webPreferences,
      session: tabSession, preload: pagePreloadPath, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      nodeIntegrationInSubFrames: true, nodeIntegrationInWorker: false, webviewTag: false,
      backgroundThrottling: true, spellcheck: true,
    } });
    view.setBackgroundColor('#171C23');
    tab.view = view;
    tab.webContentsId = view.webContents.id;
    tab.isLoading = !popupOptions || initialUrl !== 'about:blank';
    this.memoryManager.updateTab(tab.id, { loading: tab.isLoading, lifecycle: tab.lifecycle });
    view.webContents.setAudioMuted(tab.isMuted);
    if (tab.zoomFactor) view.webContents.setZoomFactor(tab.zoomFactor);
    if (tab.isPrivate) {
      view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } else {
      this.browsec.applyWebRtcPolicyToWebContents(view.webContents);
    }
    this.installTabHandlers(tab);
    if (tab.id === this.activeTabId && !tab.isInternal && tab.lifecycle !== 'crashed') {
      (view as any).setVisible?.(true);
      if (this.window && !this.window.contentView.children.includes(view)) {
        this.window.contentView.addChildView(view);
      }
      this.applyBounds(tab);
      this.ensureVoodooOnTop();
    } else {
      (view as any).setVisible?.(false);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    // Electron loads the requested popup URL after createWindow returns this
    // WebContents. Loading it ourselves severs/competes with native opener setup.
    if (nativePopupContents) return view.webContents;
    const ready = tab.isPrivate ? this.privateProxyReady : Promise.resolve();
    void ready.then(() => this.loadUrl(view.webContents, initialUrl)).catch((error) => {
      this.eventListener?.({ type: 'navigation-error', message: error instanceof Error ? error.message : 'Не удалось загрузить страницу.' });
    });
    return view.webContents;
  }

  private createPopupTab(opener: TabRecord, url: string, active: boolean, options: Electron.BrowserWindowConstructorOptions): Electron.WebContents {
    const id = crypto.randomUUID();
    const tab: TabRecord = {
      id, url, title: url === 'about:blank' ? 'Пустая страница' : 'Новая страница',
      isLoading: url !== 'about:blank', ...emptyNavigation(url),
      isMuted: false, isAudible: false, isPinned: false, isPrivate: opener.isPrivate, isInternal: false,
      lifecycle: active ? 'active' : 'background', workspaceId: opener.workspaceId,
    };
    this.tabs.set(id, tab);
    this.popupOpeners.set(id, opener.id);
    this.memoryManager.registerTab({ tabId: id, active: false, pinned: false, audible: false,
      loading: tab.isLoading, downloading: false, lastInteractionAt: Date.now(), lifecycle: 'background' });
    const contents = this.attachWebContents(tab, url, options);
    if (!contents) {
      this.tabs.delete(id);
      this.popupOpeners.delete(id);
      this.memoryManager.removeTab(id);
      throw new Error('Окно браузера уже закрыто.');
    }
    if (active) this.activateTab(id);
    this.emitSnapshot();
    return contents;
  }

  private createNativePopupWindow(
    opener: TabRecord,
    url: string,
    options: Electron.BrowserWindowConstructorOptions,
    features: ParsedWindowFeatures,
  ): Electron.WebContents {
    if (!this.window || this.disposed) throw new Error('Окно браузера недоступно');

    const parentBounds = this.window.getBounds();
    const bounds = computePopupWindowBounds(parentBounds, features);

    const appIconPath = path.join(app.getAppPath(), 'assets/icons/png/app-icon-512.png');
    const appIcon = nativeImage.createFromPath(appIconPath);

    const popupWindow = new BrowserWindow({
      ...options,
      parent: this.window,
      modal: false,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 360,
      minHeight: 400,
      title: 'Авторизация',
      autoHideMenuBar: true,
      backgroundColor: '#1e1f29',
      ...(appIcon && !appIcon.isEmpty() ? { icon: appIcon } : {}),
      webPreferences: {
        ...options.webPreferences,
        session: opener.isPrivate ? this.ensurePrivateSession() : this.browserSession,
        preload: pagePreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: false,
      },
    });

    popupWindow.setMenu(null);
    this.popupWindows.add(popupWindow);
    this.popupToTab.set(popupWindow.id, opener.id);

    const popupContents = popupWindow.webContents;
    this.installShortcuts(popupContents);

    if (opener.isPrivate) {
      popupContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } else {
      this.browsec.applyWebRtcPolicyToWebContents(popupContents);
    }

    popupWindow.on('closed', () => {
      this.popupWindows.delete(popupWindow);
      this.popupToTab.delete(popupWindow.id);
    });

    popupContents.on('page-title-updated', (_event, title) => {
      if (title && !popupWindow.isDestroyed()) {
        popupWindow.setTitle(title);
      }
    });

    popupContents.on('will-navigate', (event, targetUrl) => {
      if (!isSafeWebUrl(targetUrl)) event.preventDefault();
    });

    popupContents.on('will-redirect', (event, targetUrl) => {
      if (!isSafeWebUrl(targetUrl)) event.preventDefault();
    });

    popupContents.on('context-menu', (_event, params) => this.showContextMenu(popupContents, params));

    popupContents.setWindowOpenHandler(({ url: nestedUrl, disposition: nestedDisp, features: nestedFeat }) => {
      if (this.disposed || !this.window || this.window.isDestroyed()) return { action: 'deny' };
      const safeNestedUrl = nestedUrl || 'about:blank';
      if (safeNestedUrl !== 'about:blank' && !isSafeWebUrl(safeNestedUrl)) {
        if (this.isAllowedExternalUrl(nestedUrl)) void shell.openExternal(nestedUrl).catch(() => undefined);
        return { action: 'deny' };
      }
      const isNestedPopup = isPopupWindowRequest({ url: safeNestedUrl, disposition: nestedDisp, features: nestedFeat });
      if (isNestedPopup) {
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            parent: popupWindow,
            modal: false,
            autoHideMenuBar: true,
            title: 'Авторизация',
            webPreferences: {
              session: popupContents.session,
              preload: pagePreloadPath,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: true,
              allowRunningInsecureContent: false,
              webviewTag: false,
              spellcheck: true,
              backgroundThrottling: false,
            },
          },
          createWindow: (nestedOpts) => this.createNativePopupWindow(opener, safeNestedUrl, nestedOpts, parseWindowFeatures(nestedFeat)),
        };
      }
      void this.createTab({ url: safeNestedUrl, isPrivate: opener.isPrivate, active: true });
      return { action: 'deny' };
    });

    const nativePopupContents = (options as { webContents?: Electron.WebContents }).webContents;
    if (!nativePopupContents && url && url !== 'about:blank') {
      void popupContents.loadURL(url).catch(() => undefined);
    }

    popupWindow.show();
    popupWindow.focus();

    return popupContents;
  }

  private async loadUrl(contents: Electron.WebContents, url: string): Promise<void> {
    if (contents.isDestroyed()) return;
    try { await contents.loadURL(url); } catch {
      // did-fail-load supplies the precise main-frame error. Chromium also rejects
      // loadURL for cancelled navigation and downloads, which are not app crashes.
    }
  }

  private detachView(tab: TabRecord): void {
    const wasSplit = tab.id === this.splitView?.primaryTabId || tab.id === this.splitView?.secondaryTabId;
    if (wasSplit) this.clearSplitView();
    const view = tab.view;
    const contents = view?.webContents;
    if (this.htmlFullscreenTabId === tab.id) this.leaveHtmlFullscreen();
    tab.view = undefined;
    tab.webContentsId = undefined;
    tab.isLoading = false;
    tab.isAudible = false;
    tab.hasVideoMedia = false;
    tab.hasDownloadableMedia = false;
    tab.capturedAudioFilename = undefined;
    tab.isPictureInPicture = false;
    tab.pipMode = undefined;
    if (!view) return;
    if (contents) {
      // Detach our closures before closing native content: late navigation,
      // renderer-gone or window-close events must not corrupt a sleeping tab.
      this.tabHandlerCleanup?.get(contents.id)?.();
      this.tabHandlerCleanup?.delete(contents.id);
      this.capturedMediaStreams?.delete(contents.id);
    }
    if (this.window && !this.window.isDestroyed()) {
      try { this.window.contentView.removeChildView(view); } catch {}
    }
    if (contents && !contents.isDestroyed()) contents.close();
    if (wasSplit && !this.disposed) this.refreshViewBounds();
  }

  private installTabHandlers(tab: TabRecord): void {
    const contents = tab.view?.webContents;
    if (!contents) return;
    const before = new Map<string | symbol, Set<Function>>();
    if (typeof contents.eventNames === 'function') {
      for (const event of contents.eventNames()) before.set(event, new Set(contents.listeners(event)));
    }
    this.installShortcuts(contents);
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      if (this.disposed || !this.window || this.window.isDestroyed()) return { action: 'deny' };
      // A real about:blank popup is required by common login flows that open a
      // WindowProxy synchronously and assign its HTTPS location afterwards.
      const popupUrl = url || 'about:blank';
      if (popupUrl !== 'about:blank' && !isSafeWebUrl(popupUrl)) {
        if (this.isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
        return { action: 'deny' };
      }

      const isPopup = isPopupWindowRequest({ url: popupUrl, disposition, features });

      if (isPopup) {
        const parsedFeatures = parseWindowFeatures(features);
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            parent: this.window,
            modal: false,
            autoHideMenuBar: true,
            title: 'Авторизация',
            backgroundColor: '#1e1f29',
            webPreferences: {
              session: contents.session,
              preload: pagePreloadPath,
              nodeIntegration: false,
              nodeIntegrationInSubFrames: true,
              nodeIntegrationInWorker: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
              allowRunningInsecureContent: false,
              webviewTag: false,
              spellcheck: true,
              backgroundThrottling: false,
            },
          },
          createWindow: (options) => this.createNativePopupWindow(tab, popupUrl, options, parsedFeatures),
        };
      }

      return {
        action: 'allow',
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          webPreferences: {
            session: contents.session,
            preload: pagePreloadPath,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: true,
            nodeIntegrationInWorker: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
          },
        },
        createWindow: (options) => this.createPopupTab(tab, popupUrl, disposition !== 'background-tab', options),
      };
    });
    contents.on('focus', () => {
      if (this.splitView?.secondaryTabId === tab.id && this.activeTabId !== tab.id) this.activateTab(tab.id);
    });
    contents.on('context-menu', (_event, params) => this.showContextMenu(contents, params));
    contents.on('zoom-changed', (_event, zoomDirection) => {
      void this.tabAction(tab.id, zoomDirection === 'in' ? 'zoom-in' : 'zoom-out');
    });
    contents.on('devtools-opened', () => {
      const devContents = contents.devToolsWebContents;
      if (devContents && !devContents.isDestroyed()) {
        void devContents.insertCSS(':root { color-scheme: dark !important; } body { background-color: #1e1f29 !important; }').catch(() => undefined);
      }
    });
    contents.on('devtools-closed', () => this.refreshViewBounds());
    contents.on('will-navigate', (event, url) => {
      if (!isSafeWebUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => { if (!isSafeWebUrl(url)) event.preventDefault(); });
    contents.on('did-start-loading', () => {
      tab.isLoading = true;
      if (tab.lifecycle === 'crashed') tab.lifecycle = 'active';
      tab.lastError = undefined;
      this.memoryManager.updateTab(tab.id, { loading: true, lifecycle: tab.lifecycle });
      this.emitSnapshot();
    });
    contents.on('did-stop-loading', () => {
      tab.isLoading = false;
      this.memoryManager.updateTab(tab.id, { loading: false });
      this.updateNavigationState(tab);
      this.emitSnapshot();
    });
    const clearCapturedMedia = () => {
      this.capturedMediaStreams.delete(contents.id);
      tab.hasDownloadableMedia = false;
      tab.capturedAudioFilename = undefined;
      this.memoryManager.updateTab(tab.id, { capturing: false });
    };
    const resetTabMediaAndReader = () => {
      clearCapturedMedia();
      tab.hasVideoMedia = false;
      tab.hasDownloadableMedia = false;
      tab.isReaderAvailable = false;
      tab.isReaderActive = false;
      if (tab.isPictureInPicture) {
        tab.isPictureInPicture = false;
        if (tab.id !== this.activeTabId && tab.view && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.setBackgroundThrottling(true);
          (tab.view as any).setVisible?.(false);
        }
      }
    };
    contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => { if (isMainFrame) { resetTabMediaAndReader(); this.emitSnapshot(); } });
    contents.on('did-navigate', (_event, url) => { resetTabMediaAndReader(); this.memoryManager.updateTab(tab.id, { hasFormEdits: false }); this.updateUrl(tab, url); });
    contents.on('did-navigate-in-page', (_event, url) => { resetTabMediaAndReader(); this.updateUrl(tab, url); });
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (contents.isDestroyed() || this.tabs.get(tab.id) !== tab || tab.webContentsId !== contents.id) return;
      const currentUrl = contents.getURL();
      // Ignore a title from the previous document while a new omnibox
      // navigation is pending, or from a detached/replaced WebContents.
      if (currentUrl !== tab.url) return;
      tab.title = title || tab.url;
      if (!tab.isPrivate && !tab.isInternal && isSafeWebUrl(currentUrl)) this.stores.updateHistoryTitle(currentUrl, tab.title);
      this.emitSnapshot();
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      tab.favicon = favicons.find((value) => isSafeWebUrl(value) || value.startsWith('data:image/'));
      this.emitSnapshot();
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      tab.isLoading = false;
      tab.lifecycle = 'crashed';
      tab.lastError = { errorCode, errorDescription, validatedURL };
      if (tab.view) {
        try { this.window?.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      this.memoryManager.updateTab(tab.id, { loading: false, lifecycle: 'crashed' });
      this.eventListener?.({ type: 'navigation-error', tab: this.toSnapshot(tab), message: `${errorDescription}: ${validatedURL}` });
      this.refreshViewBounds();
      this.emitSnapshot();
    });
    contents.on('media-started-playing', () => {
      tab.isAudible = true;
      this.memoryManager.updateTab(tab.id, { audible: true });
      this.emitSnapshot();
    });
    contents.on('media-paused', () => {
      tab.isAudible = contents.isCurrentlyAudible();
      this.memoryManager.updateTab(tab.id, { audible: tab.isAudible });
      this.emitSnapshot();
    });
    contents.on('enter-html-full-screen', () => {
      if (tab.id !== this.activeTabId || !this.window) return;
      this.fullscreenBeforeVideo = this.window.isFullScreen();
      this.htmlFullscreenTabId = tab.id;
      this.window.setFullScreen(true);
      this.refreshViewBounds();
      this.notifyFullscreenChange(true);
      if (this.stores) this.emitSnapshot();
    });
    contents.on('leave-html-full-screen', () => {
      if (this.htmlFullscreenTabId === tab.id) {
        this.leaveHtmlFullscreen();
        this.notifyFullscreenChange(Boolean(this.window && !this.window.isDestroyed() && this.window.isFullScreen()));
        if (this.stores) this.emitSnapshot();
      }
    });
    contents.on('found-in-page', (_event, result) => { if (tab.id === this.activeTabId) this.eventListener?.({ type: 'find-result', message: `${result.activeMatchOrdinal} / ${result.matches}` }); });
    contents.on('render-process-gone', (_event, details) => {
      if (this.htmlFullscreenTabId === tab.id) this.leaveHtmlFullscreen();
      tab.lifecycle = 'crashed';
      tab.isLoading = false;
      tab.lastError = { errorDescription: details.reason };
      if (tab.view) {
        try { this.window?.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      this.memoryManager.updateTab(tab.id, { loading: false, lifecycle: 'crashed' });
      this.eventListener?.({ type: 'renderer-gone', tab: this.toSnapshot(tab), message: details.reason });
      this.refreshViewBounds();
      this.emitSnapshot();
    });
    contents.on('destroyed', () => {
      this.tabHandlerCleanup?.get(contents.id)?.();
      this.tabHandlerCleanup?.delete(contents.id);
      this.capturedMediaStreams.delete(contents.id);
      if (this.tabs.has(tab.id) && tab.webContentsId === contents.id) {
        if (this.popupOpeners.has(tab.id)) { void this.closeTab(tab.id); return; }
        this.detachView(tab);
        tab.lifecycle = 'crashed';
        this.memoryManager.updateTab(tab.id, { lifecycle: 'crashed', loading: false, audible: false, capturing: false });
        this.emitSnapshot();
      }
    });
    (contents as unknown as NodeJS.EventEmitter).on('window-close', () => {
      void this.closeTab(tab.id);
    });
    if (typeof contents.eventNames === 'function') {
      const ownedListeners = contents.eventNames().flatMap(event => contents.listeners(event)
        .filter(listener => !before.get(event)?.has(listener))
        .map(listener => ({ event, listener })));
      this.tabHandlerCleanup?.set(contents.id, () => {
        for (const { event, listener } of ownedListeners) (contents as NodeJS.EventEmitter).removeListener(event, listener as (...args: any[]) => void);
      });
    }

  }

  private updateUrl(tab: TabRecord, url: string): void {
    if (!isSafeWebUrl(url)) return;
    tab.url = url;
    tab.isInternal = false;
    tab.isLoading = false;
    tab.lifecycle = tab.id === this.activeTabId ? 'active' : 'background';
    if (!tab.isPrivate) this.stores.addHistory({ url, title: tab.title || url });
    this.memoryManager.updateTab(tab.id, { lifecycle: tab.lifecycle });
    this.updateNavigationState(tab);
    this.emitSnapshot();
  }

  private updateNavigationState(tab: TabRecord): void {
    if (!tab.view) {
      Object.assign(tab, emptyNavigation(tab.url));
      return;
    }
    tab.canGoBack = tab.view.webContents.navigationHistory.canGoBack();
    tab.canGoForward = tab.view.webContents.navigationHistory.canGoForward();
  }

  private activateInternalTab(tab: TabRecord): void {
    this.detachView(tab);
    this.memoryManager.updateTab(tab.id, { loading: false, hasFormEdits: false, capturing: false, audible: false });
    tab.hasVideoMedia = false;
    tab.hasDownloadableMedia = false;
    tab.isReaderAvailable = false;
    tab.isReaderActive = false;
    tab.isPictureInPicture = false;
    tab.isLoading = false;
    tab.isAudible = false;
    tab.favicon = undefined;
    tab.lastError = undefined;
    tab.capturedAudioFilename = undefined;
    tab.url = NEW_TAB_URL;
    tab.title = tab.isPrivate ? 'Приватная вкладка' : 'Новая вкладка';
    tab.isInternal = true;
    tab.lifecycle = 'active';
    Object.assign(tab, emptyNavigation(tab.url));
    this.activateTab(tab.id);
  }

  private refreshViewBounds(): void {
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    this.validateSplitView();
    const windowBounds = this.window.getContentBounds();
    this.shellView?.setBounds({ x: 0, y: 0, width: windowBounds.width, height: windowBounds.height });

    const activeTab = this.tabs.get(this.activeTabId);
    for (const tab of this.tabs.values()) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      if ((tab === activeTab || tab.id === this.splitView?.secondaryTabId) && !tab.isInternal && tab.lifecycle !== 'crashed' && !tab.isReaderActive) {
        (tab.view as any).setVisible?.(true);
        tab.view.webContents.setBackgroundThrottling(false);
        tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
        if (!this.window.contentView.children.includes(tab.view)) {
          this.window.contentView.addChildView(tab.view);
        }
        this.applyBounds(tab);
      } else if (tab.isPictureInPicture && !tab.isInternal && tab.lifecycle !== 'crashed') {
        (tab.view as any).setVisible?.(true);
        tab.view.webContents.setBackgroundThrottling(false);
        tab.view.setBounds(this.getMiniPipBounds(tab.id));
        tab.pipMode = 'mini';
        tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: true, tabId: tab.id, title: tab.title });
      } else if (tab.isInternal || tab.lifecycle === 'crashed' || tab.isReaderActive) {
        (tab.view as any).setVisible?.(false);
        tab.view.webContents.setBackgroundThrottling(true);
        try { this.window.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      } else {
        (tab.view as any).setVisible?.(false);
        tab.view.webContents.setBackgroundThrottling(true);
      }
    }

    const secondary = this.splitView ? this.tabs.get(this.splitView.secondaryTabId) : undefined;
    if (secondary?.view && !this.popoverOpen && this.shellView) {
      const children = this.window.contentView.children;
      if (children.indexOf(secondary.view) < children.indexOf(this.shellView)) {
        try { this.window.contentView.removeChildView(secondary.view); } catch {}
        this.window.contentView.addChildView(secondary.view);
      }
    }

    if (activeTab && (activeTab.isInternal || activeTab.isReaderActive || activeTab.lifecycle === 'crashed')) {
      if (this.shellView && !this.shellView.webContents.isDestroyed() && this.window) {
        const children = this.window.contentView.children;
        const shellIdx = children.indexOf(this.shellView);
        if (shellIdx !== -1 && shellIdx !== children.length - 1 && (!this.voodooView || children[children.length - 1] !== this.voodooView)) {
          try {
            this.window.contentView.removeChildView(this.shellView);
            this.window.contentView.addChildView(this.shellView);
          } catch {}
        }
      }
    } else if (activeTab?.view && !activeTab.view.webContents.isDestroyed() && this.window) {
      if (!this.popoverOpen && this.shellView && !this.shellView.webContents.isDestroyed()) {
        const children = this.window.contentView.children;
        const tabIdx = children.indexOf(activeTab.view);
        const shellIdx = children.indexOf(this.shellView);
        if (tabIdx !== -1 && shellIdx !== -1 && tabIdx < shellIdx) {
          try {
            this.window.contentView.removeChildView(activeTab.view);
            this.window.contentView.addChildView(activeTab.view);
          } catch {}
        }
      }
    }

    // Ensure floating PiP tabs stay on top of the active tab / shell
    for (const tab of this.tabs.values()) {
      if (tab !== activeTab && tab.isPictureInPicture && !tab.isInternal && tab.view && !tab.view.webContents.isDestroyed() && tab.lifecycle !== 'crashed' && this.window) {
        const children = this.window.contentView.children;
        const pipIdx = children.indexOf(tab.view);
        if (pipIdx !== -1 && pipIdx < children.length - 1 && (!this.voodooView || children[children.length - 1] !== this.voodooView)) {
          try { this.window.contentView.removeChildView(tab.view); } catch {}
          this.window.contentView.addChildView(tab.view);
        }
      }
    }
    // Bounds updates arrive after React layout and must never cover a dialog.
    this.raiseShellOverlay();

    // Ensure Voodoo floating assistant stays on top of all views
    if (this.voodooView && !this.voodooView.webContents.isDestroyed() && this.window && !this.window.isDestroyed()) {
      const children = this.window.contentView.children;
      if (children[children.length - 1] !== this.voodooView) {
        try { this.window.contentView.removeChildView(this.voodooView); } catch {}
        this.window.contentView.addChildView(this.voodooView);
      }
      this.refreshVoodooBounds();
    }
  }

  private applyBounds(tab: TabRecord): void {
    if (!tab.view || tab.isInternal || tab.lifecycle === 'crashed' || tab.isReaderActive) {
      if (tab.view) {
        (tab.view as any).setVisible?.(false);
        try { this.window?.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      return;
    }
    const bounds = this.window?.getContentBounds();
    if (!bounds) return;
    const isFullScreen = Boolean(this.window && !this.window.isDestroyed() && this.window.isFullScreen());
    if (this.htmlFullscreenTabId === tab.id || (isFullScreen && tab.id === this.activeTabId)) {
      (tab.view as any).setVisible?.(true);
      tab.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      return;
    }
    const chrome = (this.chromeBounds.width > 0 && this.chromeBounds.height > 0)
      ? this.chromeBounds
      : (this.lastValidBounds.width > 0 && this.lastValidBounds.height > 0)
        ? this.lastValidBounds
        : { x: 200, y: 144, width: Math.max(0, bounds.width - 200), height: Math.max(0, bounds.height - 144) };
    const x = Math.min(chrome.x, bounds.width);
    const y = Math.min(chrome.y, bounds.height);
    // Tab WebContentsView must stretch all the way to the bottom edge of the window
    const height = Math.max(0, bounds.height - y);
    const width = Math.min(chrome.width, bounds.width - x);
    if (width <= 0 || height <= 0) {
      (tab.view as any).setVisible?.(false);
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    (tab.view as any).setVisible?.(true);
    const split = this.splitView;
    if (split && (tab.id === split.primaryTabId || tab.id === split.secondaryTabId)) {
      const panes = getSplitViewBounds({ x, y, width, height }, split.ratio);
      // Focus changes the address bar/active identity, never the physical pane order.
      tab.view.setBounds(tab.id === split.firstTabId ? panes.primary : panes.secondary);
    } else tab.view.setBounds({ x, y, width, height });
  }

  private exitPageFullscreen(): void {
    if (!this.htmlFullscreenTabId) return;
    const contents = this.tabs.get(this.htmlFullscreenTabId)?.view?.webContents;
    this.leaveHtmlFullscreen();
    if (contents && !contents.isDestroyed()) void contents.executeJavaScript('if (document.fullscreenElement) document.exitFullscreen();').catch(() => undefined);
  }

  private leaveHtmlFullscreen(): void {
    this.htmlFullscreenTabId = undefined;
    if (this.window && !this.window.isDestroyed()) this.window.setFullScreen(this.fullscreenBeforeVideo);
    this.refreshViewBounds();
  }

  private handleDownload(item: Electron.DownloadItem, webContents: Electron.WebContents, sourceSession?: Electron.Session): void {
    if (!this.window || this.disposed) { item.cancel(); return; }
    const id = crypto.randomUUID();
    const filename = item.getFilename().replace(/[\\/:*?"<>|]/g, '_') || 'download';
    const url = item.getURL();
    const mimeType = item.getMimeType();
    const mimeKind = mediaKindForMime(mimeType);
    const kind = mimeKind === 'file' ? mediaKindForUrl(url) : mimeKind;
    const sourceTab = [...this.tabs.values()].find((tab) => tab.webContentsId === webContents?.id);
    const entry: DownloadEntry = {
      id, url, filename, kind, mimeType: mimeType || undefined,
      isPrivate: sourceTab?.isPrivate ?? Boolean(this.privateSession && this.privateSession === (sourceSession || webContents?.session)),
      isLive: true, canResume: false, state: 'queued', receivedBytes: 0, totalBytes: item.getTotalBytes(), startedAt: Date.now(),
    };
    // This API must run synchronously inside will-download. Electron owns the
    // native dialog and the DownloadItem remains live while the user chooses.
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), filename), title: 'Сохранить файл' });
    this.liveDownloads.set(id, { item, tabId: sourceTab?.id });
    this.downloads.unshift(entry);
    if (sourceTab) {
      this.memoryManager.updateTab(sourceTab.id, { downloading: true });
      this.eventListener?.({ type: 'download-started', tab: this.toSnapshot(sourceTab) });
    }
    item.on('updated', (_event, state) => {
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.path = item.getSavePath() || undefined;
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      entry.isPaused = item.isPaused();
      entry.canResume = item.canResume();
      this.persistDownloads();
      this.emitSnapshot();
    });
    item.once('done', (_event, state) => {
      this.liveDownloads.delete(id);
      entry.isLive = false;
      entry.canResume = false;
      entry.path = item.getSavePath() || undefined;
      entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.finishedAt = Date.now();
      entry.isPaused = false;
      if (entry.state !== 'completed') entry.error = state === 'cancelled' ? 'Загрузка отменена.' : 'Загрузка прервана.';
      if (sourceTab) this.memoryManager.updateTab(sourceTab.id, { downloading: [...this.liveDownloads.values()].some((download) => download.tabId === sourceTab.id) });
      this.persistDownloads(true);
      if (entry.state === 'completed' && entry.path && !entry.isPrivate) {
        const isImage = entry.kind === 'image' || /\.(png|jpe?g|webp|gif|bmp|ico|svg|avif)$/i.test(entry.filename);
        if (isImage) void this.createDownloadThumbnail(entry);
      }
    });
    this.persistDownloads();
    this.emitSnapshot();
  }

  private persistDownloads(immediate = false): void {
    const persist = () => {
      this.downloadPersistTimer = undefined;
      this.stores.downloads.set(this.downloads.filter((entry) => !entry.isPrivate).slice(0, 100));
    };
    if (immediate) { if (this.downloadPersistTimer) clearTimeout(this.downloadPersistTimer); persist(); }
    else if (!this.downloadPersistTimer) this.downloadPersistTimer = setTimeout(persist, 1000);
  }

  private normalizeDownloads(): void {
    let changed = false;
    for (const download of this.downloads) {
      if (download.isPaused) { download.isPaused = false; changed = true; }
      download.isLive = false;
      download.canResume = false;
      const legacyDownload = download as DownloadEntry & { kind?: DownloadEntry['kind']; startedAt?: number };
      if (!legacyDownload.kind) {
        legacyDownload.kind = 'file';
        changed = true;
      }
      if (!legacyDownload.startedAt) {
        legacyDownload.startedAt = Date.now();
        changed = true;
      }
      if (download.state === 'queued' || download.state === 'progressing') {
        download.state = 'interrupted';
        download.finishedAt = Date.now();
        download.error = 'Загрузка прервана после перезапуска браузера.';
        changed = true;
      }
    }
    if (changed) this.persistDownloads();
    this.populateMissingThumbnails();
  }

  private populateMissingThumbnails(): void {
    for (const download of this.downloads) {
      if (download.state === 'completed' && download.path && !download.thumbnail && !download.isPrivate) {
        const isImage = download.kind === 'image' || /\.(png|jpe?g|webp|gif|bmp|ico|svg|avif)$/i.test(download.filename);
        if (isImage) {
          void this.createDownloadThumbnail(download);
        }
      }
    }
  }

  private async createDownloadThumbnail(entry: DownloadEntry): Promise<void> {
    if (this.disposed) return;
    this.thumbnailQueue ??= new DownloadThumbnailQueue({
      isCurrent: candidate => !this.disposed && this.downloads.includes(candidate),
      render: filename => renderDownloadThumbnail(filename, nativeImage),
      onReady: (candidate, dataUrl) => {
        candidate.thumbnail = dataUrl;
        this.persistDownloads();
        this.emitSnapshot();
      },
    });
    this.thumbnailQueue.enqueue(entry);
  }

  private async setImportedCookies(cookies: ImportedCookie[]): Promise<number> {
    let imported = 0;
    for (const cookie of cookies) {
      try {
        const host = new URL(cookie.url).hostname;
        const domain = (cookie.domain || host).replace(/^\./, '');
        const existing = (await this.browserSession.cookies.get({ url: cookie.url, name: cookie.name })).find((item) =>
          (item.domain || host).replace(/^\./, '') === domain && item.path === cookie.path && item.hostOnly === !cookie.domain,
        );
        if (existing && existing.value === cookie.value && existing.secure === cookie.secure && existing.httpOnly === cookie.httpOnly &&
          (!cookie.sameSite || existing.sameSite === cookie.sameSite) &&
          ((cookie.expirationDate === undefined && existing.session) || Math.abs((existing.expirationDate || 0) - (cookie.expirationDate || 0)) < 1)) continue;
        await this.browserSession.cookies.set(cookie);
        imported += 1;
      } catch {
        // Invalid or expired cookies are counted as skipped by the importer.
      }
    }
    if (imported) await this.browserSession.cookies.flushStore();
    return imported;
  }

  private showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
    // Chromium already identified a rendered media element. CDN/API image or
    // media endpoints need not have an extension; arbitrary links still do.
    const recognizedMedia = ['image', 'video', 'audio'].includes(params.mediaType);
    const mediaUrl = recognizedMedia && params.srcURL && isSafeWebUrl(params.srcURL) ? params.srcURL : undefined;
    const linkedMediaUrl = params.linkURL && isSafeMediaUrl(params.linkURL) ? params.linkURL : undefined;
    const linkedMediaKind = linkedMediaUrl ? mediaKindForUrl(linkedMediaUrl) : undefined;
    const template: Electron.MenuItemConstructorOptions[] = [];

    const currentUrl = contents.getURL();
    if (params.mediaType === 'image') {
      const finalImageUrl = mediaUrl && mediaUrl.includes('pinimg.com')
        ? mediaUrl.replace(/\/(?:236|474|736)x\//, '/originals/')
        : mediaUrl;
      template.push({
        label: finalImageUrl ? (mediaUrl?.includes('pinimg.com') ? 'Скачать фото Pinterest (в максимальном качестве)' : 'Сохранить изображение') : 'Изображение недоступно для сохранения',
        enabled: Boolean(finalImageUrl),
        click: () => { if (finalImageUrl) this.downloadMedia(contents, finalImageUrl); },
      });
    } else if (params.mediaType === 'video') {
      template.push({
        label: mediaUrl ? 'Сохранить видео' : 'Видеопоток защищён (используйте кнопку скачивания)',
        enabled: Boolean(mediaUrl),
        click: () => { if (mediaUrl) this.downloadMedia(contents, mediaUrl); },
      });
    } else if (params.mediaType === 'audio') {
      template.push({
        label: mediaUrl ? 'Сохранить аудио' : 'Аудио недоступно для сохранения',
        enabled: Boolean(mediaUrl),
        click: () => { if (mediaUrl) this.downloadMedia(contents, mediaUrl); },
      });
    } else if (linkedMediaUrl) {
      template.push({
        label: `Сохранить ${linkedMediaKind === 'image' ? 'изображение' : linkedMediaKind === 'video' ? 'видео' : linkedMediaKind === 'audio' ? 'аудио' : 'файл'}`,
        click: () => this.downloadMedia(contents, linkedMediaUrl),
      });
    }

    // Smart native media downloaders for YouTube, VK, Pinterest (NO third-party sites)
    if (isVideoPageUrl(currentUrl) && videoSiteForUrl(currentUrl) === 'youtube') {
      const ytMatch = currentUrl.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const videoId = ytMatch ? ytMatch[1] : null;
      if (videoId) {
        template.push({
          label: 'Скачать видео YouTube (MP4)',
          click: () => {
            this.downloadMediaUrl(currentUrl, undefined, false);
          },
        });
        template.push({
          label: 'Скачать аудио YouTube (MP3/M4A)',
          click: () => {
            this.downloadMediaUrl(currentUrl, undefined, true);
          },
        });
      }
    } else if (isVideoPageUrl(currentUrl) && videoSiteForUrl(currentUrl) === 'vk') {
      template.push({
        label: 'Скачать видео VK (HD)',
        click: () => {
          this.downloadMediaUrl(currentUrl, undefined, false);
        },
      });
      template.push({
        label: 'Скачать фото VK',
        click: () => {
          void contents.executeJavaScript(`
            (function() {
              try {
                const pv = document.getElementById('pv_photo');
                if (pv) {
                  const img = pv.querySelector('img');
                  if (img && img.src) return img.src;
                }
              } catch {}
              return null;
            })()
          `).then((vkPhotoUrl: unknown) => {
            if (typeof vkPhotoUrl === 'string' && isSafeWebUrl(vkPhotoUrl)) {
              this.downloadMedia(contents, vkPhotoUrl);
            }
          }).catch(() => undefined);
        },
      });
    } else if (currentUrl.includes('pinterest.') || currentUrl.includes('pin.it') || (params.srcURL && params.srcURL.includes('pinimg.com'))) {
      template.push({
        label: 'Скачать фото Pinterest (в максимальном качестве)',
        click: () => {
          void contents.executeJavaScript(`
            (function(x, y) {
              try {
                const elements = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
                for (const el of elements) {
                  if (!el) continue;
                  const img = (el.tagName === 'IMG' && el.src && el.src.includes('pinimg.com'))
                    ? el
                    : el.querySelector('img[src*="pinimg.com"]') || el.closest('[data-test-id*="pin"], [role="listitem"]')?.querySelector('img[src*="pinimg.com"]');
                  if (img && img.src) {
                    return img.src.replace(/\\/(?:236|474|564|736)x\\//, '/originals/');
                  }
                }
              } catch {}
              return null;
            })(${params.x}, ${params.y})
          `).then((pinPhotoUrl: unknown) => {
            if (typeof pinPhotoUrl === 'string' && isSafeWebUrl(pinPhotoUrl)) {
              this.downloadMedia(contents, pinPhotoUrl);
            } else if (params.srcURL && isSafeWebUrl(params.srcURL)) {
              const orig = params.srcURL.replace(/\/(?:236|474|564|736)x\//, '/originals/');
              this.downloadMedia(contents, orig);
            }
          }).catch(() => undefined);
        },
      });
      template.push({
        label: 'Скачать видео Pinterest',
        click: () => {
          void contents.executeJavaScript(`
            (function(x, y) {
              try {
                const elements = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
                for (const el of elements) {
                  if (!el) continue;
                  const vid = (el.tagName === 'VIDEO')
                    ? el
                    : el.querySelector('video') || el.closest('[data-test-id*="pin"], [role="listitem"]')?.querySelector('video');
                  if (vid && vid.src && vid.src.startsWith('http')) return vid.src;
                  const source = vid?.querySelector('source');
                  if (source && source.src && source.src.startsWith('http')) return source.src;
                }
              } catch {}
              return null;
            })(${params.x}, ${params.y})
          `).then((pinVideoUrl: unknown) => {
            if (typeof pinVideoUrl === 'string' && isSafeWebUrl(pinVideoUrl)) {
              this.downloadMedia(contents, pinVideoUrl);
            }
          }).catch(() => undefined);
        },
      });
    }

    if (template.length > 0) template.push({ type: 'separator' });
    if (params.isEditable) {
      template.push({ label: 'Вырезать', click: () => contents.cut() });
      template.push({ label: 'Копировать', click: () => contents.copy() });
      template.push({ label: 'Вставить', click: () => contents.paste() });
      if (params.selectionText?.trim()) {
        template.push({
          label: 'Анализировать с ВуДу',
          click: () => this.analyzeWithVoodoo(params.selectionText),
        });
      }
      template.push({ type: 'separator' });
    } else if (params.selectionText) {
      template.push({ label: 'Копировать выделение', click: () => contents.copy() });
      const query = params.selectionText.trim();
      if (query) {
        template.push({
          label: 'Анализировать с ВуДу',
          click: () => this.analyzeWithVoodoo(params.selectionText),
        });
        const querySnippet = query.length > 25 ? `${query.slice(0, 25)}…` : query;
        template.push({
          label: `Найти «${querySnippet}» в Google`,
          click: () => {
            const isPriv = [...this.tabs.values()].find((tab) => tab.webContentsId === contents.id)?.isPrivate ?? false;
            void this.createTab({
              url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
              isPrivate: isPriv,
              active: true,
            });
          },
        });
      }
      template.push({ type: 'separator' });
    }
    template.push({ label: 'Назад', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    template.push({ label: 'Вперёд', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    template.push({ label: 'Перезагрузить страницу', click: () => contents.reload() });
    template.push({ label: 'Открыть ссылку в новой вкладке', enabled: isSafeWebUrl(params.linkURL), click: () => {
      if (isSafeWebUrl(params.linkURL)) void this.createTab({ url: params.linkURL, isPrivate: [...this.tabs.values()].find((tab) => tab.webContentsId === contents.id)?.isPrivate ?? false, active: true });
    } });
    template.push({ label: 'Копировать адрес', enabled: Boolean(params.linkURL || params.srcURL), click: () => {
      const target = params.linkURL || params.srcURL;
      if (target) void this.copyText(target);
    } });
    if (mediaUrl) template.push({ label: 'Копировать адрес медиа', click: () => clipboard.writeText(mediaUrl) });

    template.push({ type: 'separator' });
    template.push({
      label: 'Печать…',
      accelerator: 'CmdOrCtrl+P',
      click: () => contents.print(),
    });
    template.push({ type: 'separator' });
    template.push({
      label: 'Просмотреть код',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => {
        if (contents.isDevToolsOpened()) {
          contents.closeDevTools();
        } else {
          contents.openDevTools({ mode: 'detach', activate: true });
          contents.inspectElement(params.x, params.y);
        }
      },
    });

    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private downloadMedia(contents: Electron.WebContents, url: string): void {
    if (!isSafeWebUrl(url) || contents.isDestroyed()) return;
    try { contents.downloadURL(url); } catch (cause) {
      this.eventListener?.({ type: 'navigation-error', message: cause instanceof Error ? cause.message : 'Не удалось сохранить медиафайл.' });
    }
  }

  private isAllowedExternalUrl(rawUrl: string): boolean {
    try {
      return new Set(['mailto:', 'tel:', 'webcal:']).has(new URL(rawUrl).protocol);
    } catch {
      return false;
    }
  }

  private copyText(value: string): void {
    clipboard.writeText(value);
  }

  private toSnapshot(tab: TabRecord): TabSnapshot {
    const { view: _view, webContentsId, pipMode: _pipMode, ...snapshot } = tab;
    const stream = webContentsId ? this.capturedMediaStreams.get(webContentsId) : undefined;
    const url = tab.url || '';
    const isVideoSite = Boolean(
      (url && isVideoPageUrl(url)) ||
      (url.includes('pinterest.') && url.includes('/pin/')) ||
      url.includes('pin.it/')
    );
    const canDownloadMedia = Boolean(!tab.isInternal && (tab.hasDownloadableMedia || isVideoSite || Boolean(stream?.video) || Boolean(stream?.audio)));
    return {
      ...snapshot,
      canDownloadMedia,
      isReaderAvailable: Boolean(!tab.isInternal && tab.isReaderAvailable),
      isReaderActive: Boolean(!tab.isInternal && tab.isReaderActive),
      hasVideoMedia: Boolean(!tab.isInternal && (tab.hasVideoMedia || isVideoSite)),
      isPictureInPicture: Boolean(!tab.isInternal && tab.isPictureInPicture),
    };
  }

  markTabHasMedia(webContentsId: number, hasMedia: boolean): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab && tab.hasDownloadableMedia !== hasMedia) {
      tab.hasDownloadableMedia = hasMedia;
      this.emitSnapshot();
    }
  }

  markTabVideoDetected(webContentsId: number, hasVideo: boolean): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab && tab.hasVideoMedia !== hasVideo) {
      tab.hasVideoMedia = hasVideo;
      this.emitSnapshot();
    }
  }

  markTabPipChanged(webContentsId: number, isPip: boolean, source?: 'native' | 'mini'): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab && !isPip && source === 'native' && tab.pipMode === 'mini') return;
    if (tab && tab.isPictureInPicture !== isPip) {
      if (isPip && (tab.id === this.splitView?.primaryTabId || tab.id === this.splitView?.secondaryTabId)) this.setSplitView();
      if (isPip) this.stopOtherPictureInPictureTabs(tab.id);
      tab.pipMode = isPip ? (source ?? 'mini') : undefined;
      tab.isPictureInPicture = isPip;
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        const isActive = tab.id === this.activeTabId;
        tab.view.webContents.setBackgroundThrottling(!isActive && !isPip);
        if (!isActive) {
          (tab.view as any).setVisible?.(isPip);
          if (isPip) {
            tab.view.setBounds(this.getMiniPipBounds(tab.id));
            tab.pipMode = 'mini';
            tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: true, tabId: tab.id, title: tab.title });
          } else {
            tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
          }
          this.refreshViewBounds();
        } else {
          tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
        }
      }
      this.emitSnapshot();
    }
  }

  markTabReaderStatus(webContentsId: number, available: boolean): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab && tab.isReaderAvailable !== available) {
      tab.isReaderAvailable = available;
      this.emitSnapshot();
    }
  }

  async toggleReaderMode(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    if (tab.id === this.splitView?.primaryTabId || tab.id === this.splitView?.secondaryTabId) this.clearSplitView();
    tab.isReaderActive = !tab.isReaderActive;
    this.refreshViewBounds();
    this.emitSnapshot();
    return Boolean(tab.isReaderActive);
  }

  async getReaderArticle(tabId: string): Promise<ReaderArticle | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return null;
    try {
      // Preload helpers live in Electron's isolated world (999), not in the
      // site's main world. Never execute a similarly named site-owned helper.
      const article = await tab.view.webContents.executeJavaScriptInIsolatedWorld(
        999, [{ code: `typeof window.__extractReaderArticle === 'function' ? window.__extractReaderArticle() : null` }], true,
      );
      return article as ReaderArticle | null;
    } catch {
      return null;
    }
  }

  async updateReaderSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings> {
    const current = this.stores.settings.get();
    const currentReader = current.readerSettings || defaultReaderSettings;
    const nextReader: ReaderSettings = {
      theme: patch.theme && ['light', 'sepia', 'dark', 'graphite'].includes(patch.theme) ? patch.theme : currentReader.theme,
      fontFamily: patch.fontFamily && ['sans', 'serif', 'mono'].includes(patch.fontFamily) ? patch.fontFamily : currentReader.fontFamily,
      fontSize: typeof patch.fontSize === 'number' && Number.isFinite(patch.fontSize) ? Math.max(12, Math.min(36, Math.round(patch.fontSize))) : currentReader.fontSize,
      lineHeight: typeof patch.lineHeight === 'number' && Number.isFinite(patch.lineHeight) ? Math.max(1.0, Math.min(2.5, Number(patch.lineHeight.toFixed(2)))) : currentReader.lineHeight,
      maxWidth: typeof patch.maxWidth === 'number' && Number.isFinite(patch.maxWidth) ? Math.max(400, Math.min(1200, Math.round(patch.maxWidth))) : currentReader.maxWidth,
    };
    this.stores.settings.set({
      ...current,
      readerSettings: nextReader,
    });
    this.emitSnapshot();
    return nextReader;
  }

  async togglePictureInPicture(tabId: string): Promise<{ success: boolean; isPip: boolean }> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return { success: false, isPip: false };
    try {
      if (!tab.isPictureInPicture) {
        const hasVideo = await tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{
          code: `typeof window.__hasPipVideo === 'function' && window.__hasPipVideo()`,
        }], true);
        if (!hasVideo) return { success: false, isPip: false };
        if (!tab.view || tab.view.webContents.isDestroyed() || this.tabs.get(tabId) !== tab) return { success: false, isPip: false };
      }
      const nextPip = !tab.isPictureInPicture;
      if (nextPip) this.stopOtherPictureInPictureTabs(tab.id);
      tab.pipMode = nextPip ? 'mini' : undefined;
      tab.isPictureInPicture = nextPip;
      await tab.view.webContents.executeJavaScript(`
        (async () => {
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            }
          } catch {}
        })()
      `, true).catch(() => undefined);

      if (tab.view && !tab.view.webContents.isDestroyed()) {
        const isActive = tab.id === this.activeTabId;
        tab.view.webContents.setBackgroundThrottling(!isActive && !nextPip);
        if (!isActive) {
          (tab.view as any).setVisible?.(nextPip);
          if (nextPip) {
            tab.view.setBounds(this.getMiniPipBounds(tab.id));
            tab.pipMode = 'mini';
            tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: true, tabId: tab.id, title: tab.title });
          } else {
            tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
          }
        } else {
          tab.view.webContents.send('tab:set-pip-mini-mode', { enabled: false, tabId: tab.id });
        }
        this.refreshViewBounds();
      }
      this.emitSnapshot();
      return { success: true, isPip: nextPip };
    } catch {
      return { success: false, isPip: Boolean(tab.isPictureInPicture) };
    }
  }

  async getNotes(query?: string): Promise<NoteEntry[]> {
    let items = this.stores.notes.get();
    if (query && typeof query === 'string' && query.trim()) {
      const q = query.trim().toLowerCase();
      items = items.filter((n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        (n.tabTitle && n.tabTitle.toLowerCase().includes(q)) ||
        (n.url && n.url.toLowerCase().includes(q))
      );
    }
    return items.slice().sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  async saveNote(input: SaveNoteInput): Promise<NoteEntry> {
    if (!input || typeof input.content !== 'string') {
      throw new Error('Укажите текст заметки.');
    }
    const items = this.stores.notes.get();
    const existingIndex = input.id ? items.findIndex((n) => n.id === input.id) : -1;
    const now = Date.now();
    let note: NoteEntry;

    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      note = {
        ...existing,
        title: input.title !== undefined ? input.title.trim().slice(0, 500) : existing.title,
        content: input.content.slice(0, 50000),
        color: input.color || existing.color || 'default',
        url: input.url !== undefined ? input.url : existing.url,
        tabTitle: input.tabTitle !== undefined ? input.tabTitle : existing.tabTitle,
        isPinned: input.isPinned !== undefined ? Boolean(input.isPinned) : existing.isPinned,
        updatedAt: now,
      };
      const updated = [...items];
      updated[existingIndex] = note;
      this.stores.notes.set(updated);
    } else {
      if (items.length >= 500) {
        throw new Error('Достигнут лимит 500 заметок. Удалите ненужную заметку перед созданием новой; существующие заметки сохранены.');
      }
      note = {
        id: input.id || crypto.randomUUID(),
        title: (input.title || '').trim().slice(0, 500),
        content: input.content.slice(0, 50000),
        color: input.color || 'default',
        url: input.url,
        tabTitle: input.tabTitle,
        isPinned: Boolean(input.isPinned),
        createdAt: now,
        updatedAt: now,
      };
      this.stores.notes.set([note, ...items]);
    }
    this.emitSnapshot();
    return note;
  }

  async deleteNote(id: string): Promise<boolean> {
    const items = this.stores.notes.get();
    const next = items.filter((n) => n.id !== id);
    if (next.length === items.length) return false;
    this.stores.notes.set(next);
    this.emitSnapshot();
    return true;
  }

  async togglePinNote(id: string): Promise<NoteEntry | null> {
    const items = this.stores.notes.get();
    const index = items.findIndex((n) => n.id === id);
    if (index < 0) return null;
    const target = items[index];
    const updated: NoteEntry = {
      ...target,
      isPinned: !target.isPinned,
      updatedAt: Date.now(),
    };
    const next = [...items];
    next[index] = updated;
    this.stores.notes.set(next);
    this.emitSnapshot();
    return updated;
  }

  async createNoteFromTab(tabId: string, textSnippet?: string): Promise<NoteEntry> {
    const tab = this.tabs.get(tabId);
    let snippet = textSnippet;
    if (snippet === undefined && tab?.view && !tab.view.webContents.isDestroyed()) {
      try {
        snippet = await tab.view.webContents.executeJavaScript('window.getSelection() ? window.getSelection().toString() : ""', true);
      } catch {
        snippet = '';
      }
    }
    const note = await this.saveNote({
      title: tab?.title || 'Заметка со страницы',
      content: (snippet || '').trim(),
      url: tab?.url,
      tabTitle: tab?.title,
      color: 'default',
      isPinned: false,
    });
    return note;
  }

  registerCapturedAudio(webContentsId: number, url: string, _title?: string, _artist?: string, filename?: string): void {
    if (!isSafeWebUrl(url)) return;
    const current = this.capturedMediaStreams.get(webContentsId) || {};
    const mediaChanged = current.audio !== url;
    current.audio = url;
    this.capturedMediaStreams.set(webContentsId, current);
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab) {
      const wasAvailable = tab.hasDownloadableMedia;
      const filenameChanged = Boolean(filename && tab.capturedAudioFilename !== filename);
      tab.hasDownloadableMedia = true;
      if (filename) tab.capturedAudioFilename = filename;
      if (mediaChanged || filenameChanged || !wasAvailable) this.emitSnapshot();
    }
  }

  addGoogleAccount(email: string, name?: string): GoogleAccount {
    const data = this.stores.googleAccounts.get();
    const existing = data.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      existing.isActive = true;
      if (name) existing.name = name;
      data.activeId = existing.id;
      data.accounts.forEach((a) => { if (a.id !== existing.id) a.isActive = false; });
      this.stores.googleAccounts.set(data);
      this.emitSnapshot();
      return existing;
    }
    const newAccount: GoogleAccount = {
      id: crypto.randomUUID(),
      email,
      name: name || email.split('@')[0],
      isActive: true,
      addedAt: Date.now(),
    };
    data.accounts.forEach((a) => { a.isActive = false; });
    data.accounts.push(newAccount);
    data.activeId = newAccount.id;
    this.stores.googleAccounts.set(data);
    this.emitSnapshot();
    return newAccount;
  }

  switchGoogleAccount(accountId: string): void {
    const data = this.stores.googleAccounts.get();
    const acc = data.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    data.accounts.forEach((a) => { a.isActive = a.id === accountId; });
    data.activeId = accountId;
    this.stores.googleAccounts.set(data);
    this.emitSnapshot();
  }

  removeGoogleAccount(accountId: string): void {
    const data = this.stores.googleAccounts.get();
    data.accounts = data.accounts.filter((a) => a.id !== accountId);
    if (data.activeId === accountId) {
      data.activeId = data.accounts[0]?.id;
      if (data.accounts[0]) data.accounts[0].isActive = true;
    }
    this.stores.googleAccounts.set(data);
    this.emitSnapshot();
  }

  registerGoogleAccount(email: string, name?: string, avatar?: string): void {
    if (!email || !email.includes('@')) return;
    const data = this.stores.googleAccounts.get();
    const existing = data.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      let changed = false;
      if (name && existing.name !== name) { existing.name = name; changed = true; }
      if (avatar && existing.avatar !== avatar) { existing.avatar = avatar; changed = true; }
      if (changed) {
        this.stores.googleAccounts.set(data);
        this.emitSnapshot();
      }
      return;
    }
    const newAcc: GoogleAccount = {
      id: crypto.randomUUID(),
      email,
      name: name || email.split('@')[0],
      avatar,
      isActive: data.accounts.length === 0,
      addedAt: Date.now(),
    };
    data.accounts.push(newAcc);
    if (!data.activeId) data.activeId = newAcc.id;
    this.stores.googleAccounts.set(data);
    this.emitSnapshot();
  }

  private installShortcuts(contents: Electron.WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const modifier = process.platform === 'darwin' ? input.meta : input.control;
      const tab = this.tabs.get(this.activeTabId);
      const run = (action: () => void) => { event.preventDefault(); action(); };
      if (tab && contents.id === tab.webContentsId) {
        this.memoryManager.markInteraction(tab.id);
        // Cross-origin iframe form events do not bubble to the main preload.
        // Conservatively preserve any page where text editing keys were used.
        if ((!modifier && !input.alt && (input.key.length === 1 || ['backspace', 'delete'].includes(key))) || (modifier && key === 'v')) {
          this.memoryManager.updateTab(tab.id, { hasFormEdits: true });
        }
      }
      if (input.shift && key === 'escape') run(() => {
        this.shellView?.webContents.focus();
        this.eventListener?.({ type: 'toggle-task-manager' });
      });
      else if (modifier && input.shift && key === 'v') run(() => {
        this.toggleVoodoo();
      });
      else if (modifier && input.shift && (key === 'delete' || key === 'backspace')) run(() => {
        this.shellView?.webContents.focus();
        this.eventListener?.({ type: 'toggle-click-and-clean' });
      });
      else if (modifier && key === 'l') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'focus-address' }); });
      else if (modifier && input.shift && key === 'a') run(() => {
        this.exitPageFullscreen();
        this.shellView?.webContents.focus();
        // The user can request search immediately after activation, before the
        // coalesced snapshot arrives. Its privacy mode must use current state.
        this.snapshotListener?.(this.getSnapshot());
        this.eventListener?.({ type: 'show-tab-search' });
      });
      else if (modifier && input.shift && key === 't') run(() => { void this.reopenClosedTab(); });
      else if (modifier && input.shift && (key === 'n' || key === 'p')) run(() => { void this.createTab({ isPrivate: true }); });
      else if (modifier && key === 't') run(() => { void this.createTab(); });
      else if (modifier && key === 'w' && tab) run(() => { void this.closeTab(tab.id); });
      else if (modifier && key === 'd' && tab) run(() => { this.toggleBookmark(tab.id); });
      else if (modifier && key === 'f') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-find' }); });
      else if (modifier && key === 'h') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-history' }); });
      else if (modifier && key === 'j') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-downloads' }); });
      else if (((modifier && input.shift && key === 'r') || (modifier && key === 'f5') || (input.shift && key === 'f5')) && tab) run(() => { void this.reload(tab.id, true); });
      else if ((modifier && key === 'r' || key === 'f5') && tab) run(() => { void this.reload(tab.id, false); });
      else if (modifier && key === 'p' && tab) run(() => { void this.tabAction(tab.id, 'print'); });
      else if (modifier && ['+', '=', '-', '0'].includes(key) && tab) run(() => { void this.tabAction(tab.id, key === '0' ? 'zoom-reset' : key === '-' ? 'zoom-out' : 'zoom-in'); });
      // Familiar Chromium shortcuts: Ctrl/Cmd+1..8 selects a visible tab,
      // Ctrl/Cmd+9 selects the last. Respect workspace and privacy boundaries.
      else if (modifier && !input.alt && !input.shift && /^[1-9]$/.test(key) && tab) run(() => {
        const visible = [...this.tabs.values()]
          .filter(entry => entry.workspaceId === tab.workspaceId && entry.isPrivate === tab.isPrivate)
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
        const selected = visible[key === '9' ? visible.length - 1 : Number(key) - 1];
        if (selected) this.activateTab(selected.id);
      });
      else if (modifier && key === 'tab') run(() => {
        const tabs = [...this.tabs.values()]
          .filter((entry) => entry.workspaceId === this.activeWorkspaceId && entry.isPrivate === tab?.isPrivate)
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
        const index = tabs.findIndex((entry) => entry.id === this.activeTabId);
        const next = tabs[(index + (input.shift ? -1 : 1) + tabs.length) % tabs.length];
        if (next) this.activateTab(next.id);
      });
      else if (input.alt && key === 'arrowleft' && tab) run(() => { void this.goBack(tab.id); });
      else if (input.alt && key === 'arrowright' && tab) run(() => { void this.goForward(tab.id); });
      else if (key === 'f11') run(() => {
        if (this.htmlFullscreenTabId) this.exitPageFullscreen();
        else this.toggleFullScreen();
      });
      else if (key === 'f12' || (modifier && input.shift && key === 'i')) run(() => {
        void this.toggleDevTools();
      });
      // Escape exits fullscreen (HTML5 video or F11) or stops loading if page is loading.
      else if (key === 'escape') {
        if (this.htmlFullscreenTabId) run(() => { this.exitPageFullscreen(); });
        else if (this.window && !this.window.isDestroyed() && this.window.isFullScreen()) run(() => {
          this.toggleFullScreen();
        });
        else if (tab?.isLoading && contents.id === tab.webContentsId) run(() => { void this.stop(tab.id); });
      }
    });
  }

  private persistSession(): void {
    if (this.restoring) return;
    const saved = this.stores.settings.get().restoreSession !== false ? buildStoredSession([...this.tabs.values()].map((tab) => this.toSnapshot(tab)), this.activeTabId) : { tabs: [], activeIndex: 0 };
    const signature = JSON.stringify(saved);
    if (signature === this.sessionSignature) return;
    this.sessionSignature = signature;
    this.stores.session.set(saved);
  }

  private emitSnapshot(): void {
    if (this.disposed) return;
    if (!this.snapshotTimer) this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.disposed) this.snapshotListener?.(this.getSnapshot());
    }, 32);
    if (!this.restoring && !this.sessionPersistTimer) this.sessionPersistTimer = setTimeout(() => {
      this.sessionPersistTimer = undefined;
      this.persistSession();
    }, 250);
  }

  toggleVoodoo(): void {
    this.setVoodooOpen(!this.voodooOpen);
  }

  ensureVoodooOnTop(): void {
    if (!this.voodooView || this.voodooView.webContents.isDestroyed() || !this.window || this.window.isDestroyed()) return;
    const settings = this.stores.settings.get();
    if (settings.voodooEnabled === false) return;
    const children = this.window.contentView.children;
    if (children.length > 0 && children[children.length - 1] !== this.voodooView) {
      try {
        this.window.contentView.removeChildView(this.voodooView);
        this.window.contentView.addChildView(this.voodooView);
      } catch {}
    }
  }

  setVoodooOpen(open: boolean): void {
    this.voodooOpen = Boolean(open);
    if (!this.voodooOpen) {
      // When minimizing/folding Voodoo, ensure the floating circle avatar is visible
      const settings = this.stores.settings.get();
      if (settings.voodooBubbleVisible === false) {
        this.stores.settings.set({ ...settings, voodooBubbleVisible: true });
        this.emitSnapshot();
      }
    }
    this.refreshVoodooBounds();
    this.ensureVoodooOnTop();
    this.voodooView?.webContents.send('browser:event', {
      type: 'voodoo-set-open',
      message: String(this.voodooOpen),
    });
    this.shellView?.webContents.send('browser:event', {
      type: 'voodoo-set-open',
      message: String(this.voodooOpen),
    });
    if (this.voodooOpen) {
      this.voodooView?.webContents.focus();
    }
  }

  moveVoodoo(deltaX: number, deltaY: number): void {
    if (!this.window || this.window.isDestroyed()) return;
    const winBounds = this.window.getContentBounds();
    if (this.voodooOpen) {
      const curX = this.voodooPosition.x ?? (winBounds.width - this.voodooDimensions.width - 24);
      const curY = this.voodooPosition.y ?? (winBounds.height - this.voodooDimensions.height - 24);
      this.voodooPosition = {
        x: Math.max(0, Math.min(curX + deltaX, winBounds.width - 100)),
        y: Math.max(0, Math.min(curY + deltaY, winBounds.height - 100)),
      };
    } else {
      const curSettings = this.stores.settings.get();
      const curX = this.voodooBubblePosition.x ?? curSettings.voodooBubblePosition?.x ?? (winBounds.width - 76 - 24);
      const curY = this.voodooBubblePosition.y ?? curSettings.voodooBubblePosition?.y ?? (winBounds.height - 76 - 24);
      const newX = Math.max(0, Math.min(curX + deltaX, winBounds.width - 60));
      const newY = Math.max(0, Math.min(curY + deltaY, winBounds.height - 60));
      this.voodooBubblePosition = { x: newX, y: newY };
      this.stores.settings.set({ ...curSettings, voodooBubblePosition: { x: newX, y: newY } });
    }
    this.refreshVoodooBounds();
  }

  resizeVoodoo(width: number, height: number, deltaX?: number, deltaY?: number): void {
    const winBounds = this.window?.getContentBounds() || { width: 1200, height: 800 };
    const maxW = Math.max(320, winBounds.width - 20);
    const maxH = Math.max(380, winBounds.height - 30);
    const newW = Math.min(Math.max(320, Math.round(width)), maxW);
    const newH = Math.min(Math.max(380, Math.round(height)), maxH);
    this.voodooDimensions = { width: newW, height: newH };
    if (this.voodooPosition.x === undefined) {
      this.voodooPosition.x = Math.max(10, winBounds.width - newW - 24);
    }
    if (this.voodooPosition.y === undefined) {
      this.voodooPosition.y = Math.max(10, winBounds.height - newH - 24);
    }
    if (typeof deltaX === 'number' && deltaX !== 0) {
      this.voodooPosition.x = Math.max(0, Math.min(this.voodooPosition.x + deltaX, winBounds.width - newW));
    }
    if (typeof deltaY === 'number' && deltaY !== 0) {
      this.voodooPosition.y = Math.max(0, Math.min(this.voodooPosition.y + deltaY, winBounds.height - newH));
    }
    this.refreshVoodooBounds();
  }

  resetVoodooPosition(): void {
    this.voodooPosition = {};
    this.voodooBubblePosition = {};
    const curSettings = this.stores.settings.get();
    if (curSettings.voodooBubblePosition) {
      const updated = { ...curSettings };
      delete updated.voodooBubblePosition;
      this.stores.settings.set(updated);
    }
    this.refreshVoodooBounds();
  }

  refreshVoodooBounds(): void {
    if (!this.window || this.window.isDestroyed() || !this.voodooView || this.voodooView.webContents.isDestroyed()) return;
    const winBounds = this.window.getContentBounds();
    const settings = this.stores.settings.get();

    if (settings.voodooEnabled === false) {
      (this.voodooView as any).setVisible?.(false);
      this.voodooView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    this.ensureVoodooOnTop();

    if (this.voodooOpen) {
      const w = Math.min(Math.max(320, this.voodooDimensions.width), winBounds.width - 10);
      const h = Math.min(Math.max(380, this.voodooDimensions.height), winBounds.height - 20);
      const defaultX = Math.max(10, winBounds.width - w - 24);
      const defaultY = Math.max(10, winBounds.height - h - 24);

      let targetX = this.voodooPosition.x ?? defaultX;
      let targetY = this.voodooPosition.y ?? defaultY;

      targetX = Math.max(0, Math.min(targetX, winBounds.width - w));
      targetY = Math.max(0, Math.min(targetY, winBounds.height - h));

      this.voodooPosition = { x: targetX, y: targetY };
      (this.voodooView as any).setVisible?.(true);
      this.voodooView.setBounds({ x: targetX, y: targetY, width: w, height: h });
    } else if (settings.voodooBubbleVisible !== false) {
      const size = 76;
      const defaultX = Math.max(10, winBounds.width - size - 24);
      const defaultY = Math.max(10, winBounds.height - size - 24);

      let targetX = this.voodooBubblePosition.x ?? settings.voodooBubblePosition?.x ?? defaultX;
      let targetY = this.voodooBubblePosition.y ?? settings.voodooBubblePosition?.y ?? defaultY;

      targetX = Math.max(0, Math.min(targetX, winBounds.width - size));
      targetY = Math.max(0, Math.min(targetY, winBounds.height - size));

      this.voodooBubblePosition = { x: targetX, y: targetY };
      (this.voodooView as any).setVisible?.(true);
      this.voodooView.setBounds({ x: targetX, y: targetY, width: size, height: size });
    } else {
      (this.voodooView as any).setVisible?.(false);
      this.voodooView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  analyzeWithVoodoo(selectedText: string): void {
    const text = (selectedText || '').trim();
    if (!text) return;
    this.setVoodooOpen(true);
    this.voodooView?.webContents.focus();
    this.voodooView?.webContents.send('browser:event', {
      type: 'voodoo-analyze-text',
      message: text,
    });
  }

  async sendVoodooMessage(
    messages: VoodooChatMessage[],
    tabContext?: { url?: string; title?: string; chatText?: string }
  ): Promise<VoodooChatResponse> {
    this.cancelVoodooRequest();
    const requestController = new AbortController();
    this.voodooAbortController = requestController;
    const settings = this.stores.settings.get();
    const baseUrl = settings.voodooBaseUrl || 'https://api.xkiro.com/v1';
    const model = settings.voodooModel || 'qwen/qwen3.8-max:free';
    const catalog = this.voodooModelCatalog;
    // Fetch metadata in the background; completion latency never waits for it.
    void catalog?.warm(baseUrl, model, settings.voodooKeys?.[0] || '');
    try {
      return await this.voodooService.chat(messages, {
        contextWindowTokens: settings.voodooContextWindowTokens,
        providerContextWindowTokens: catalog?.getLimit(baseUrl, model),
        keys: settings.voodooKeys,
        model: settings.voodooModel,
        baseUrl: settings.voodooBaseUrl,
        tabContext,
        signal: requestController.signal,
        onProgress: (message) => {
          if (requestController.signal.aborted) return;
          for (const view of [this.voodooView, this.shellView]) {
            if (view && !view.webContents.isDestroyed()) {
              try { view.webContents.send('browser:event', { type: 'voodoo-agent-progress', message }); } catch {}
            }
          }
        },
        toolExecutor: (name, args) => {
          requestController.signal.throwIfAborted();
          return this.executeVoodooTool(name, args, requestController.signal);
        },
      });
    } finally {
      if (this.voodooAbortController === requestController) this.voodooAbortController = undefined;
    }
  }

  cancelVoodooRequest(): void {
    this.voodooAbortController?.abort();
    this.voodooAbortController = undefined;
  }

  private async waitForVoodooPage(tabId: string, timeoutMs = 10000, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const contents = this.tabs.get(tabId)?.view?.webContents;
      if (!contents || contents.isDestroyed()) throw new Error('Вкладка закрыта или недоступна');
      if (!contents.isLoadingMainFrame?.()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Страница ещё загружается. Повторите чтение или дождитесь элемента.');
  }

  async executeVoodooTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ success: boolean; result?: unknown; error?: string; summary?: string }> {
    try {
      signal?.throwIfAborted();
      const pageTools = ['read_page', 'get_page_elements', 'click_element', 'fill_input', 'scroll_page', 'execute_script', 'press_key', 'wait_for_element', 'navigate_history', 'analyze_page_data'];
      if (pageTools.includes(toolName)) {
        const tabId = String(args.tab_id || this.activeTabId || '').trim();
        const tab = this.tabs.get(tabId);
        if (tab?.lifecycle === 'hibernated') await this.wakeTab(tabId);
        if (tab && !tab.isInternal) await this.waitForVoodooPage(tabId, 10000, signal);
      }
      switch (toolName) {
        case 'search_web': {
          const query = String(args.query || '').trim();
          if (!query) {
            return { success: false, error: 'Поисковый запрос не может быть пустым', summary: '❌ Поиск: пустой запрос' };
          }
          const newTab = Boolean(args.new_tab);
          const searchEngine = this.stores.settings.get().searchEngine;
          const intent = parseOmniboxInput(query, searchEngine);
          const targetUrl = intent.kind === 'url' ? intent.url : intent.kind === 'search' ? intent.url : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

          if (newTab) {
            await this.createTab({ url: targetUrl, active: true });
          } else {
            const activeTab = this.tabs.get(this.activeTabId);
            if (activeTab) {
              await this.navigate(activeTab.id, targetUrl);
            } else {
              await this.createTab({ url: targetUrl, active: true });
            }
          }
          return {
            success: true,
            result: { url: targetUrl, query, inNewTab: newTab },
            summary: `🔍 Поиск: «${query}»${newTab ? ' (новая вкладка)' : ''}`,
          };
        }

        case 'open_url': {
          let rawUrl = String(args.url || '').trim();
          if (!rawUrl) {
            return { success: false, error: 'Адрес URL не может быть пустым', summary: '❌ Открытие: URL не указан' };
          }
          const newTab = Boolean(args.new_tab);
          if (/^file:/i.test(rawUrl) || path.isAbsolute(rawUrl)) {
            return { success: false, error: 'Локальные файлы читайте инструментом read_file. Вкладки поддерживают HTTP и HTTPS.', summary: '❌ Локальный файл нельзя открыть как веб-страницу' };
          }
          const searchEngine = this.stores.settings.get().searchEngine;
          const intent = parseOmniboxInput(rawUrl, searchEngine);
          const targetUrl = rawUrl === NEW_TAB_URL ? NEW_TAB_URL : intent.kind === 'url' ? intent.url : '';
          if (!targetUrl || (targetUrl !== NEW_TAB_URL && !isSafeWebUrl(targetUrl))) {
            return { success: false, error: 'Нужен корректный HTTP или HTTPS адрес', summary: '❌ Некорректный адрес' };
          }

          if (newTab) {
            await this.createTab({ url: targetUrl, active: true });
          } else {
            const activeTab = this.tabs.get(this.activeTabId);
            if (activeTab) {
              await this.navigate(activeTab.id, targetUrl);
            } else {
              await this.createTab({ url: targetUrl, active: true });
            }
          }
          return {
            success: true,
            result: { url: targetUrl, inNewTab: newTab },
            summary: `🌐 Открыта страница: ${targetUrl}${newTab ? ' (новая вкладка)' : ''}`,
          };
        }

        case 'list_tabs': {
          const tabList = Array.from(this.tabs.values()).map((t) => ({
            id: t.id,
            title: t.title || 'Новая вкладка',
            url: t.url,
            isActive: t.id === this.activeTabId,
            isPinned: Boolean(t.isPinned),
          }));
          return {
            success: true,
            result: { tabs: tabList, count: tabList.length },
            summary: `📑 Список вкладок (${tabList.length})`,
          };
        }

        case 'switch_tab': {
          const tabId = String(args.tab_id || '').trim();
          if (!tabId || !this.tabs.has(tabId)) {
            return { success: false, error: `Вкладка с ID "${tabId}" не найдена`, summary: `❌ Вкладка не найдена` };
          }
          const targetTab = this.tabs.get(tabId)!;
          this.activateTab(tabId);
          const title = targetTab.title || targetTab.url || tabId;
          return {
            success: true,
            result: { tabId, title, url: targetTab.url },
            summary: `📑 Переключено на вкладку: «${title}»`,
          };
        }

        case 'close_tab': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          if (!tabId || !this.tabs.has(tabId)) {
            return { success: false, error: `Вкладка не найдена`, summary: `❌ Закрытие: вкладка не найдена` };
          }
          const targetTab = this.tabs.get(tabId)!;
          const title = targetTab.title || targetTab.url || tabId;
          await this.closeTab(tabId);
          return {
            success: true,
            result: { closedTabId: tabId, title },
            summary: `❌ Закрыта вкладка: «${title}»`,
          };
        }

        case 'read_page': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
            return { success: false, error: 'Вкладка недоступна для чтения', summary: '❌ Страница недоступна' };
          }
          if (tab.isInternal) {
            return {
              success: true,
              result: { title: tab.title, url: tab.url, text: 'Служебная страница браузера.' },
              summary: `📄 Служебная страница «${tab.title}»`,
            };
          }

          const maxLength = typeof args.max_length === 'number' && Number.isFinite(args.max_length) && args.max_length > 0 ? Math.max(1, Math.min(50000, Math.floor(args.max_length))) : 4000;
          const start = typeof args.start === 'number' && Number.isFinite(args.start) ? Math.max(0, Math.floor(args.start)) : 0;
          const pageData = await tab.view.webContents.executeJavaScript(`
            (function(maxChars, requestedStart) {
              try {
                const clone = document.body ? document.body.cloneNode(true) : null;
                if (clone) {
                  const removeSelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'svg', 'iframe', 'input', 'textarea', 'select', '[contenteditable="true"]'];
                  for (const sel of removeSelectors) {
                    const elements = clone.querySelectorAll(sel);
                    elements.forEach((el) => el.remove());
                  }
                }

                const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
                  .map((h) => h.textContent ? h.textContent.trim() : '')
                  .filter(Boolean)
                  .slice(0, 8);

                const fullText = clone ? (clone.innerText || clone.textContent || '')
                  .replace(/\\s+/g, ' ')
                  .trim() : '';
                const totalLength = fullText.length;
                const start = Math.min(requestedStart, totalLength);
                const end = Math.min(start + maxChars, totalLength);
                const links = [];
                const seen = new Set();
                for (const link of document.querySelectorAll('a[href]')) {
                  let href;
                  try {
                    const url = new URL(link.getAttribute('href'), document.baseURI || location.href);
                    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
                    href = url.href;
                  } catch (_) { continue; }
                  if (seen.has(href)) continue;
                  seen.add(href);
                  links.push({
                    title: (link.innerText || link.textContent || link.getAttribute('aria-label') || link.title || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
                    href,
                  });
                  if (links.length >= 40) break;
                }

                return {
                  title: document.title,
                  url: location.href,
                  headings,
                  text: fullText.slice(start, end),
                  totalLength,
                  start,
                  next_start: end < totalLength ? end : null,
                  truncated: end < totalLength,
                  links,
                };
              } catch (e) {
                return { title: document.title, url: location.href, text: '', error: String(e) };
              }
            })(${JSON.stringify(maxLength)}, ${JSON.stringify(start)})
          `, true);

          if (pageData.error) {
            return { success: false, error: String(pageData.error), result: pageData, summary: '❌ Не удалось прочитать страницу' };
          }
          return {
            success: true,
            result: pageData,
            summary: `📄 Прочитана страница «${pageData.title || tab.title}» (${pageData.text?.length || 0} симв., начало ${pageData.start ?? 0}${pageData.truncated ? ', есть продолжение' : ''})`,
          };
        }

        case 'get_page_elements': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для анализа элементов', summary: '❌ Элементы недоступны' };
          }
          const filterType = String(args.type || 'all');
          const elements = await tab.view.webContents.executeJavaScript(`
            (function(type) {
              try {
                const results = [];
                const isVisible = function(el) {
                  const r = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                // Every returned selector must identify exactly the observed element.
                const selectorFor = function(el) {
                  if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
                  const parts = [];
                  while (el && el.nodeType === 1) {
                    const tag = el.tagName.toLowerCase();
                    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(n => n.tagName === el.tagName) : [];
                    parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')' : ''));
                    el = el.parentElement;
                  }
                  return parts.join(' > ');
                };

                if (type === 'all' || type === 'buttons') {
                  const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
                  for (const b of btns) {
                    if (!isVisible(b)) continue;
                    const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
                    const id = b.id ? '#' + b.id : '';
                    const cls = b.className && typeof b.className === 'string' ? '.' + b.className.trim().split(/\\s+/)[0] : '';
                    results.push({
                      category: 'button',
                      tag: b.tagName.toLowerCase(),
                      text: text.slice(0, 60),
                      selector: selectorFor(b),
                      disabled: Boolean(b.disabled || b.getAttribute('aria-disabled') === 'true'),
                      id: b.id || undefined,
                    });
                    if (results.length >= 30) break;
                  }
                }

                if ((type === 'all' || type === 'links') && results.length < 30) {
                  const links = Array.from(document.querySelectorAll('a[href]'));
                  for (const a of links) {
                    if (!isVisible(a)) continue;
                    const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
                    if (!text && !a.title) continue;
                    const id = a.id ? '#' + a.id : '';
                    results.push({
                      category: 'link',
                      tag: 'a',
                      text: (text || a.title || '').slice(0, 60),
                      href: a.href,
                      selector: selectorFor(a),
                    });
                    if (results.length >= 30) break;
                  }
                }

                if ((type === 'all' || type === 'inputs') && results.length < 30) {
                  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]'));
                  for (const inp of inputs) {
                    if (!isVisible(inp)) continue;
                    const id = inp.id ? '#' + inp.id : '';
                    const name = inp.name ? '[name="' + inp.name + '"]' : '';
                    const ph = inp.placeholder || inp.getAttribute('aria-label') || '';
                    results.push({
                      category: 'input',
                      tag: inp.tagName.toLowerCase(),
                      type: inp.type || 'text',
                      placeholder: ph,
                      name: inp.name || undefined,
                      selector: selectorFor(inp),
                      disabled: Boolean(inp.disabled || inp.readOnly),
                      currentValue: inp.type === 'password' ? '[скрыто]' : (inp.value || inp.innerText || '').slice(0, 30),
                    });
                    if (results.length >= 30) break;
                  }
                }

                return results;
              } catch (e) {
                return [];
              }
            })(${JSON.stringify(filterType)})
          `, true);

          return {
            success: true,
            result: { elements, count: elements.length },
            summary: `🔍 Найдено ${elements.length} интерактивных элементов на странице`,
          };
        }

        case 'click_element': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для клика', summary: '❌ Вкладка недоступна' };
          }
          const targetText = typeof args.text === 'string' ? args.text.trim() : '';
          const targetSelector = typeof args.selector === 'string' ? args.selector.trim() : '';
          if (!targetText && !targetSelector) {
            return { success: false, error: 'Не указан селектор или текст для клика', summary: '❌ Не указан элемент' };
          }

          const clickResult = await tab.view.webContents.executeJavaScript(`
            (function(text, selector) {
              try {
                let target = null;
                if (selector) {
                  target = document.querySelector(selector);
                }
                if (!target && text) {
                  const lower = text.toLowerCase();
                  const candidates = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span, div, p'));
                  target = candidates.find(function(el) {
                    const content = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden' && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && (content === lower || (content.includes(lower) && content.length < lower.length + 30));
                  });
                }

                if (!target) {
                  return { success: false, error: 'Элемент не найден на странице' };
                }

                if (target.disabled || target.getAttribute('aria-disabled') === 'true') return { success: false, error: 'Элемент отключён' };
                const rect = target.getBoundingClientRect();
                if (!rect.width || !rect.height || getComputedStyle(target).visibility === 'hidden') return { success: false, error: 'Элемент скрыт' };
                target.scrollIntoView({ behavior: 'instant', block: 'center' });
                if (typeof target.focus === 'function') target.focus();
                target.click();

                return {
                  success: true,
                  tag: target.tagName.toLowerCase(),
                  text: (target.innerText || target.value || target.getAttribute('aria-label') || '').slice(0, 40),
                };
              } catch (err) {
                return { success: false, error: String(err) };
              }
            })(${JSON.stringify(targetText)}, ${JSON.stringify(targetSelector)})
          `, true);

          if (clickResult.success) {
            return {
              success: true,
              result: clickResult,
              summary: `🖱️ Клик по элементу: «${targetText || targetSelector}»`,
            };
          } else {
            return {
              success: false,
              error: clickResult.error || 'Элемент не найден',
              summary: `❌ Не удалось кликнуть по «${targetText || targetSelector}»`,
            };
          }
        }

        case 'fill_input': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для ввода текста', summary: '❌ Вкладка недоступна' };
          }
          const text = String(args.text ?? '');
          const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
          const placeholder = typeof args.placeholder === 'string' ? args.placeholder.trim() : '';
          const submit = Boolean(args.submit);

          const fillResult = await tab.view.webContents.executeJavaScript(`
            (function(val, sel, ph, doSubmit) {
              try {
                let target = null;
                if (sel) target = document.querySelector(sel);
                if (sel && !target) return { success: false, error: 'Поле по указанному селектору не найдено' };
                if (!target && ph) {
                  const lowerPh = ph.toLowerCase();
                  target = Array.from(document.querySelectorAll('input, textarea')).find(function(el) {
                    return (el.placeholder || el.getAttribute('aria-label') || '').toLowerCase().includes(lowerPh);
                  });
                }
                if (ph && !target) return { success: false, error: 'Поле с указанной подсказкой не найдено' };
                if (!target) {
                  target = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]')).find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly; });
                }

                if (!target) {
                  return { success: false, error: 'Поле ввода не найдено' };
                }

                const targetRect = target.getBoundingClientRect();
                if (!targetRect.width || !targetRect.height || getComputedStyle(target).visibility === 'hidden') return { success: false, error: 'Поле скрыто' };
                if (target.disabled || target.readOnly) return { success: false, error: 'Поле недоступно для редактирования' };
                if (!target.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return { success: false, error: 'Выбранный элемент не является полем ввода' };
                target.focus();
                if (target.isContentEditable) {
                  target.innerText = val;
                  target.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                  const prototype = target.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : target.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
                  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                  if (nativeSetter) {
                    nativeSetter.call(target, val);
                  } else {
                    target.value = val;
                  }
                  target.dispatchEvent(new Event('input', { bubbles: true }));
                  target.dispatchEvent(new Event('change', { bubbles: true }));
                }

                if (doSubmit) {
                  const form = target.form || target.closest('form');
                  if (form) {
                    if (typeof form.requestSubmit === 'function') form.requestSubmit();
                    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                  }
                  else {
                    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
                  }
                }

                return {
                  success: true,
                  tag: target.tagName.toLowerCase(),
                  placeholder: target.placeholder || undefined,
                };
              } catch (e) {
                return { success: false, error: String(e) };
              }
            })(${JSON.stringify(text)}, ${JSON.stringify(selector)}, ${JSON.stringify(placeholder)}, ${JSON.stringify(submit)})
          `, true);

          if (fillResult.success) {
            const preview = text.length > 25 ? text.slice(0, 25) + '…' : text;
            return {
              success: true,
              result: fillResult,
              summary: `✏️ Введён текст «${preview}»${submit ? ' с отправкой' : ''}`,
            };
          } else {
            return {
              success: false,
              error: fillResult.error,
              summary: `❌ Ошибка ввода в поле: ${fillResult.error}`,
            };
          }
        }

        case 'scroll_page': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для прокрутки', summary: '❌ Вкладка недоступна' };
          }
          const direction = String(args.direction || 'down');
          if (!['up', 'down', 'top', 'bottom'].includes(direction)) return { success: false, error: 'Неизвестное направление прокрутки' };
          const amount = typeof args.amount === 'number' && Number.isFinite(args.amount) && args.amount > 0 ? Math.min(100000, args.amount) : 500;

          await tab.view.webContents.executeJavaScript(`
            (function(dir, px) {
              try {
                if (dir === 'up') window.scrollBy({ top: -px, behavior: 'smooth' });
                else if (dir === 'down') window.scrollBy({ top: px, behavior: 'smooth' });
                else if (dir === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
                else if (dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              } catch (_) {}
            })(${JSON.stringify(direction)}, ${JSON.stringify(amount)})
          `, true);

          const dirLabel = direction === 'up' ? 'вверх' : direction === 'down' ? 'вниз' : direction === 'top' ? 'в самое начало' : 'в самый низ';
          return {
            success: true,
            result: { direction, amount },
            summary: `📜 Прокрутка страницы ${dirLabel}`,
          };
        }

        case 'execute_script': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для выполнения скрипта', summary: '❌ Вкладка недоступна' };
          }
          const code = String(args.code || '');
          if (!code.trim()) {
            return { success: false, error: 'Код скрипта не может быть пустым', summary: '❌ Пустой скрипт' };
          }

          let timer: ReturnType<typeof setTimeout> | undefined;
          let abortHandler: (() => void) | undefined;
          let scriptResult: unknown;
          try {
            scriptResult = await Promise.race([
              tab.view.webContents.executeJavaScript(code, true),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Скрипт не завершился за 15 секунд')), 15000);
                abortHandler = () => reject(new Error('Выполнение отменено'));
                if (signal?.aborted) abortHandler();
                else signal?.addEventListener('abort', abortHandler, { once: true });
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
            if (abortHandler) signal?.removeEventListener('abort', abortHandler);
          }
          const codeSnippet = code.slice(0, 30).replace(/\s+/g, ' ');
          return {
            success: true,
            result: scriptResult,
            summary: `⚡ Выполнен скрипт: «${codeSnippet}…»`,
          };
        }

        case 'get_active_dialog': {
          const dialogCtx = await this.extractActiveTabChatContext();
          return {
            success: true,
            result: dialogCtx,
            summary: `💬 Извлечён диалог (${dialogCtx.source || 'чат'}, сообщений: ${dialogCtx.count})`,
          };
        }

        case 'navigate_history': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          const contents = tab?.view?.webContents;
          if (!contents || contents.isDestroyed() || tab?.isInternal) return { success: false, error: 'Вкладка недоступна для навигации' };
          const direction = String(args.direction || '');
          if (direction === 'back') {
            if (!contents.navigationHistory.canGoBack()) return { success: false, error: 'Нет предыдущей страницы' };
            contents.navigationHistory.goBack();
          } else if (direction === 'forward') {
            if (!contents.navigationHistory.canGoForward()) return { success: false, error: 'Нет следующей страницы' };
            contents.navigationHistory.goForward();
          } else if (direction === 'reload') contents.reload();
          else return { success: false, error: 'Неизвестное направление навигации' };
          await this.waitForVoodooPage(tabId, 10000, signal);
          return { success: true, result: { tabId, direction, url: contents.getURL() }, summary: '🌐 Навигация: ' + direction };
        }

        case 'press_key': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          const contents = tab?.view?.webContents;
          if (!contents || contents.isDestroyed() || tab?.isInternal) return { success: false, error: 'Вкладка недоступна для клавиатуры' };
          const key = String(args.key || '').trim();
          const allowedKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Home', 'End', 'PageUp', 'PageDown'];
          if (!allowedKeys.includes(key)) return { success: false, error: 'Допустимые клавиши: ' + allowedKeys.join(', ') };
          const keyCode = ({ ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' } as Record<string, string>)[key] || key;
          contents.sendInputEvent({ type: 'keyDown', keyCode });
          contents.sendInputEvent({ type: 'keyUp', keyCode });
          return { success: true, result: { tabId, key }, summary: '⌨️ Нажата клавиша: ' + key };
        }

        case 'wait_for_element': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
          if (!selector) return { success: false, error: 'Не указан селектор' };
          const timeout = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) ? Math.max(0, Math.min(10000, args.timeout_ms)) : 5000;
          const deadline = Date.now() + timeout;
          do {
            signal?.throwIfAborted();
            const tab = this.tabs.get(tabId);
            const contents = tab?.view?.webContents;
            if (!contents || contents.isDestroyed() || tab?.isInternal) return { success: false, error: 'Вкладка недоступна' };
            const found = await contents.executeJavaScript(`(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
            })()`);
            if (found) return { success: true, result: { tabId, selector }, summary: '🔍 Элемент появился: ' + selector };
            if (Date.now() >= deadline) break;
            await new Promise(resolve => setTimeout(resolve, 150));
          } while (Date.now() <= deadline);
          return { success: false, error: 'Элемент не появился за отведённое время: ' + selector };
        }

        case 'clean_browser': {
          const preset = String(args.preset || 'quick');
          const cleanPresets: Record<string, CleanTargetOptions> = {
            quick: {
              cache: true,
              history: true,
              closedTabsHistory: true,
              dnsCache: true,
              cookies: false,
              downloadsHistory: false,
              localStorage: false,
              indexedDB: false,
              serviceWorkers: false,
              authCache: false,
              closeTabs: false,
              passwords: false,
            },
            'post-payment': {
              cache: true,
              cookies: true,
              localStorage: true,
              indexedDB: true,
              serviceWorkers: true,
              authCache: true,
              history: false,
              downloadsHistory: false,
              dnsCache: false,
              closedTabsHistory: false,
              closeTabs: false,
              passwords: false,
            },
            kiosk: {
              cache: true,
              cookies: true,
              history: true,
              downloadsHistory: true,
              localStorage: true,
              indexedDB: true,
              serviceWorkers: true,
              authCache: true,
              dnsCache: true,
              closedTabsHistory: true,
              closeTabs: true,
              passwords: false,
            },
          };

          const options = cleanPresets[preset] || cleanPresets.quick;
          const cleanResult = await this.executeClean(options);
          return {
            success: cleanResult.success,
            result: cleanResult,
            error: cleanResult.error,
            summary: `🧹 Click & Clean (${preset}): освобождено ${cleanResult.freedFormatted}`,
          };
        }

        case 'create_file':
        case 'read_file':
        case 'list_files': {
          const files = new VoodooFileService({
            downloads: app.getPath('downloads'),
            desktop: app.getPath('desktop'),
            documents: app.getPath('documents'),
          });
          if (toolName === 'read_file') {
            const result = files.read(args);
            return { success: true, result, summary: `📄 Прочитан файл: «${result.filename}»${result.truncated ? ' (текст сокращён)' : ''}` };
          }
          if (toolName === 'list_files') {
            const result = files.list(args);
            return { success: true, result, summary: `📁 Найдено файлов: ${result.files.length}${result.truncated ? ' (список сокращён)' : ''}` };
          }
          const result = files.write(args);
          let openedInTab = false;
          let openError: string | undefined;
          if (args.open_in_new_tab === true) {
            openError = 'Файл сохранён; просмотр локального файла во вкладке недоступен. Используйте read_file';
          }
          return {
            success: true,
            result: { ...result, openedInTab, ...(openError ? { openError } : {}) },
            summary: `💾 Файл сохранён: «${result.filename}» (${result.sizeBytes} байт)${openedInTab ? ' и открыт в новой вкладке' : openError ? '; вкладку открыть не удалось' : ''}`,
          };
        }

        case 'create_note_or_list': {
          const rawTitle = String(args.title || 'Новый список').trim();
          const items = Array.isArray(args.items) ? args.items.map((it) => String(it).trim()).filter(Boolean) : [];
          const rawContent = typeof args.content === 'string' ? args.content.trim() : '';
          const color = (['default', 'yellow', 'pink', 'blue', 'green', 'violet'].includes(String(args.color)) ? args.color : 'default') as NoteColor;

          let body = '';
          if (items.length > 0) {
            body = items.map((it) => `- [ ] ${it}`).join('\n');
            if (rawContent) body += `\n\n${rawContent}`;
          } else {
            body = rawContent || 'Пустой список';
          }

          const note = await this.saveNote({
            title: rawTitle,
            content: body,
            color,
          });

          return {
            success: true,
            result: {
              noteId: note.id,
              title: note.title,
              itemsCount: items.length,
              color: note.color,
            },
            summary: `📝 Создан список в Заметках: «${rawTitle}» (${items.length > 0 ? `${items.length} пунктов` : 'заметка'})`,
          };
        }

        case 'analyze_page_data': {
          const tabId = String(args.tab_id || this.activeTabId || '').trim();
          const tab = this.tabs.get(tabId);
          if (!tab || !tab.view || tab.view.webContents.isDestroyed() || tab.isInternal) {
            return { success: false, error: 'Вкладка недоступна для анализа данных', summary: '❌ Страница недоступна' };
          }
          const focus = String(args.focus || 'all');

          const analysis = await tab.view.webContents.executeJavaScript(`
            (function(focusType) {
              try {
                const result = {
                  title: document.title,
                  url: location.href,
                  tables: [],
                  prices: [],
                  contacts: { emails: [], phones: [] },
                  keyFacts: [],
                  schemaMeta: {},
                };

                // OpenGraph / Schema metadata
                const metaTags = document.querySelectorAll('meta[property^="og:"], meta[name="description"]');
                metaTags.forEach(function(m) {
                  const key = m.getAttribute('property') || m.getAttribute('name');
                  const val = m.getAttribute('content');
                  if (key && val) result.schemaMeta[key] = val.slice(0, 300);
                });

                // JSON-LD
                const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
                jsonLd.forEach(function(s) {
                  try {
                    const parsed = JSON.parse(s.textContent || '{}');
                    if (parsed.name || parsed.price || parsed['@type']) {
                      result.schemaMeta['ld+json'] = parsed;
                    }
                  } catch (_) {}
                });

                // Tables
                if (focusType === 'all' || focusType === 'tables') {
                  const tables = Array.from(document.querySelectorAll('table')).slice(0, 3);
                  tables.forEach(function(table) {
                    const rows = Array.from(table.querySelectorAll('tr')).slice(0, 10).map(function(tr) {
                      return Array.from(tr.querySelectorAll('th, td')).map(function(cell) {
                        return (cell.innerText || '').trim().slice(0, 60);
                      });
                    }).filter(function(r) { return r.length > 0; });
                    if (rows.length > 0) result.tables.push(rows);
                  });
                }

                // Prices
                if (focusType === 'all' || focusType === 'prices') {
                  const bodyText = document.body ? document.body.innerText : '';
                  const priceRegex = /(\\d[\\d\\s.,]{0,12}\\s?(?:₽|руб|\\$|€|USD|EUR|RUB))/gi;
                  const matches = Array.from(bodyText.matchAll(priceRegex)).map(function(m) { return m[0].trim(); });
                  const uniquePrices = Array.from(new Set(matches)).slice(0, 10);
                  result.prices = uniquePrices;
                }

                // Contacts
                if (focusType === 'all' || focusType === 'contacts') {
                  const text = document.body ? document.body.innerText : '';
                  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/g;
                  const emails = Array.from(new Set(Array.from(text.matchAll(emailRegex)).map(function(m) { return m[0]; }))).slice(0, 6);
                  const phoneRegex = /(?:\\+7|8)[\\s(-]*\\d{3}[)\\s-]*\\d{3}[\\s-]*\\d{2}[\\s-]*\\d{2}/g;
                  const phones = Array.from(new Set(Array.from(text.matchAll(phoneRegex)).map(function(m) { return m[0]; }))).slice(0, 6);
                  result.contacts.emails = emails;
                  result.contacts.phones = phones;
                }

                // Key headings / facts
                const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
                  .map(function(h) { return (h.innerText || '').trim(); })
                  .filter(Boolean)
                  .slice(0, 8);
                result.keyFacts = headings;

                return result;
              } catch (e) {
                return { error: String(e), title: document.title, url: location.href };
              }
            })(${JSON.stringify(focus)})
          `, true);

          return {
            success: true,
            result: analysis,
            summary: `📊 Анализ страницы «${analysis.title || tab.title}»: найдено ${analysis.prices?.length || 0} цен, ${analysis.tables?.length || 0} таблиц, контакты (${analysis.contacts?.emails?.length || 0} e-mail, ${analysis.contacts?.phones?.length || 0} тел.)`,
          };
        }

        case 'geo_lookup': {
          let geoData: Record<string, unknown> = {};
          try {
            const resp = await fetch('http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,query', {
              signal: AbortSignal.timeout(4500),
            });
            if (resp.ok) {
              geoData = await resp.json() as Record<string, unknown>;
            }
          } catch (_) {}

          const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
          const nowStr = new Date().toLocaleTimeString('ru-RU', { timeZone: String(geoData.timezone || localTz), hour: '2-digit', minute: '2-digit' });
          const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: String(geoData.timezone || localTz), day: 'numeric', month: 'long', year: 'numeric' });

          if (geoData.status !== 'success' || !geoData.city) {
            return { success: false, error: 'Сервис геопозиции недоступен или не вернул местоположение', result: { timezone: localTz, currentTime: nowStr, currentDate: dateStr }, summary: '📍 Местоположение определить не удалось' };
          }
          const city = String(geoData.city);
          const country = String(geoData.country || '');

          return {
            success: true,
            result: {
              ...geoData,
              city,
              country,
              timezone: geoData.timezone || localTz,
              currentTime: nowStr,
              currentDate: dateStr,
              yandexMapsUrl: `https://yandex.ru/maps/?text=${encodeURIComponent(city + ', ' + country)}`,
              googleMapsUrl: `https://www.google.com/maps/search/${encodeURIComponent(city + ', ' + country)}`,
            },
            summary: `📍 Геопозиция: ${city}, ${country} (${nowStr}, часовой пояс ${geoData.timezone || localTz})`,
          };
        }

        case 'search_places': {
          const query = String(args.query || '').trim();
          if (!query) {
            return { success: false, error: 'Поисковый запрос мест не может быть пустым', summary: '❌ Пустой запрос мест' };
          }
          const city = typeof args.city === 'string' && args.city.trim() ? args.city.trim() : '';
          const fullQuery = city ? `${query} ${city}` : query;

          // Perform lightweight geocoding/places lookup via OpenStreetMap Nominatim
          let places: Array<Record<string, unknown>> = [];
          try {
            const endpoint = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullQuery)}&format=json&addressdetails=1&limit=5`;
            const resp = await fetch(endpoint, {
              headers: { 'User-Agent': 'soulm8te-browser/1.0' },
              signal: AbortSignal.timeout(4500),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data)) {
                places = data.map((item: any) => ({
                  name: item.display_name?.split(',')?.[0]?.trim() || item.name || query,
                  address: item.display_name || '',
                  lat: item.lat,
                  lon: item.lon,
                  type: item.type || item.class,
                  yandexMapsUrl: `https://yandex.ru/maps/?text=${encodeURIComponent(item.display_name || fullQuery)}`,
                  twoGisUrl: `https://2gis.ru/search/${encodeURIComponent(item.display_name || fullQuery)}`,
                  googleMapsUrl: `https://www.google.com/maps/search/${encodeURIComponent(item.display_name || fullQuery)}`,
                }));
              }
            }
          } catch (_) {}

          const yandexMapsUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(fullQuery)}`;
          const twoGisUrl = `https://2gis.ru/search/${encodeURIComponent(fullQuery)}`;
          const googleMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;

          return {
            success: true,
            result: {
              query,
              city,
              foundPlaces: places,
              links: {
                yandexMaps: yandexMapsUrl,
                twoGis: twoGisUrl,
                googleMaps: googleMapsUrl,
              },
            },
            summary: `🗺️ Поиск мест «${query}»${city ? ` в «${city}»` : ''}: найдено ${places.length}, подготовлены ссылки на карты`,
          };
        }

        case 'get_weather_and_time': {
          const city = String(args.city || 'Москва').trim();
          let weatherData: Record<string, unknown> = {};

          try {
            const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
              signal: AbortSignal.timeout(5000),
            });
            if (resp.ok) {
              const raw = await resp.json() as any;
              const cur = raw?.current_condition?.[0];
              const nearest = raw?.nearest_area?.[0];
              if (cur) {
                const tempC = cur.temp_C;
                const feelsLikeC = cur.FeelsLikeC;
                const weatherDesc = cur.lang_ru?.[0]?.value || cur.weatherDesc?.[0]?.value || 'Ясно';
                const humidity = cur.humidity;
                const windKmph = cur.windspeedKmph;
                const windDir = cur.winddir16Point;
                const pressure = cur.pressure;
                const cityName = nearest?.areaName?.[0]?.value || city;
                const country = nearest?.country?.[0]?.value || '';

                weatherData = {
                  city: cityName,
                  country,
                  temperatureC: tempC,
                  feelsLikeC,
                  description: weatherDesc,
                  humidityPercent: humidity,
                  windSpeedKmH: windKmph,
                  windDirection: windDir,
                  pressureMm: Math.round(Number(pressure) * 0.750062),
                  forecastNextDays: raw.weather?.slice(0, 3)?.map((w: any) => ({
                    date: w.date,
                    maxTempC: w.maxtempC,
                    minTempC: w.mintempC,
                    condition: w.hourly?.[4]?.lang_ru?.[0]?.value || w.hourly?.[4]?.weatherDesc?.[0]?.value || '',
                  })),
                };
              }
            }
          } catch (_) {}

          const available = weatherData.temperatureC !== undefined;
          return {
            success: available,
            error: available ? undefined : 'Сервис погоды не вернул актуальные данные',
            result: {
              city,
              ...weatherData,
              mapsWeatherUrl: `https://yandex.ru/pogoda/${encodeURIComponent(city)}`,
            },
            summary: `🌤️ Погода в «${city}»: ${weatherData.temperatureC !== undefined ? `${weatherData.temperatureC}°C (${weatherData.description}), ощущается как ${weatherData.feelsLikeC}°C` : 'актуальные данные недоступны'}`,
          };
        }

        case 'get_route_info': {
          const from = String(args.from || '').trim();
          const to = String(args.to || '').trim();
          if (!from || !to) {
            return { success: false, error: 'Начальная и конечная точки обязательны для маршрута', summary: '❌ Не указан маршрут' };
          }
          const mode = String(args.mode || 'auto');

          const yandexRtt = mode === 'transit' ? 'mt' : mode === 'pedestrian' ? 'pd' : mode === 'bicycle' ? 'bc' : 'auto';
          const googleMode = mode === 'transit' ? 'transit' : mode === 'pedestrian' ? 'walking' : mode === 'bicycle' ? 'bicycling' : 'driving';
          const modeLabel = mode === 'transit' ? 'общественный транспорт' : mode === 'pedestrian' ? 'пешком' : mode === 'bicycle' ? 'велосипед' : 'автомобиль';

          const yandexUrl = `https://yandex.ru/maps/?rtext=${encodeURIComponent(from)}~${encodeURIComponent(to)}&rtt=${yandexRtt}`;
          const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=${googleMode}`;
          const twoGisUrl = `https://2gis.ru/directions/points/${encodeURIComponent(from)}%7C${encodeURIComponent(to)}`;

          return {
            success: true,
            result: {
              from,
              to,
              mode: modeLabel,
              links: {
                yandexMaps: yandexUrl,
                googleMaps: googleUrl,
                twoGis: twoGisUrl,
              },
            },
            summary: `🧭 Маршрут «${from}» ➔ «${to}» (${modeLabel}) готов для навигаторов Яндекс / Google / 2ГИС`,
          };
        }

        default: {
          return {
            success: false,
            error: `Неизвестный инструмент: ${toolName}`,
            summary: `❓ Неизвестное действие: ${toolName}`,
          };
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
        summary: `❌ Ошибка выполнения ${toolName}: ${errorMsg}`,
      };
    }
  }

  getVoodooKeysStatus(): VoodooKeyStatusItem[] {
    const settings = this.stores.settings.get();
    return this.voodooService.getKeysStatus(settings.voodooKeys || []);
  }

  async transcribeAudio(audioBase64: string, mimeType?: string): Promise<TranscribeAudioResult> {
    const cleanB64 = String(audioBase64 || '').trim();
    if (!cleanB64) {
      return { success: false, error: 'Аудиоданные не получены' };
    }

    const settings = this.stores.settings.get();
    const sttKey = (settings.voodooSttKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '').trim();

    if (!sttKey) {
      return {
        success: false,
        error: 'NO_STT_KEY',
      };
    }

    try {
      const buffer = Buffer.from(cleanB64, 'base64');
      const isWav = mimeType?.includes('wav');
      const isOgg = mimeType?.includes('ogg');
      const ext = isWav ? 'wav' : isOgg ? 'ogg' : 'webm';
      const actualMime = mimeType || (isWav ? 'audio/wav' : isOgg ? 'audio/ogg' : 'audio/webm');

      const formData = new FormData();
      const audioBlob = new Blob([buffer], { type: actualMime });
      formData.append('file', audioBlob, `speech.${ext}`);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'ru');

      const endpoint = (settings as any).voodooSttEndpoint || 'https://api.groq.com/openai/v1/audio/transcriptions';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sttKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Ошибка STT (${response.status}): ${errText.slice(0, 150)}` };
      }

      const data = await response.json() as { text?: string };
      const recognized = String(data.text || '').trim();
      return {
        success: true,
        text: recognized,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  async openPath(targetPath: string): Promise<string> {
    const clean = String(targetPath || '').trim();
    if (!clean) return 'Пустой путь';
    return shell.openPath(clean);
  }

  async testVoodooKey(key: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const settings = this.stores.settings.get();
    return this.voodooService.testKey(key, settings.voodooBaseUrl, settings.voodooModel);
  }

  async performStartupVoodooKeysCheck(): Promise<void> {
    try {
      const settings = this.stores.settings.get();
      const rawKeys = Array.isArray(settings?.voodooKeys) ? settings.voodooKeys : [];
      const keys = rawKeys.map((k) => String(k).trim()).filter(Boolean);

      if (keys.length === 0) return;

      console.log(`[Voodoo AI] Auto-checking ${keys.length} xkiro key(s) on browser launch...`);
      const checkResult = await this.voodooService.checkAllKeys(
        keys,
        settings.voodooBaseUrl,
        settings.voodooModel
      );

      const { healthyKeys, reorderedKeys } = checkResult;
      const primaryWorkingKey = healthyKeys.length > 0 && reorderedKeys[0] ? VoodooAiService.maskKey(reorderedKeys[0]) : null;
      console.log(
        `[Voodoo AI] Startup key check finished: ${healthyKeys.length}/${keys.length} healthy. Active working key:`,
        primaryWorkingKey || 'none'
      );

      if (healthyKeys.length > 0) {
        const orderChanged = reorderedKeys.length !== keys.length || reorderedKeys.some((k, i) => k !== keys[i]);
        if (orderChanged) {
          console.log('[Voodoo AI] Reordering keys to ensure healthy working keys are used first.');
          const freshSettings = this.stores.settings.get();
          this.stores.settings.set({
            ...freshSettings,
            voodooKeys: reorderedKeys,
          });
        }
      }

      this.emitSnapshot();
      const eventData = {
        type: 'voodoo-keys-checked',
        data: {
          healthyCount: healthyKeys.length,
          totalCount: keys.length,
          primaryKey: primaryWorkingKey,
        },
      };

      if (this.voodooView?.webContents && !this.voodooView.webContents.isDestroyed()) {
        try { this.voodooView.webContents.send('browser:event', eventData); } catch {}
      }
      if (this.shellView?.webContents && !this.shellView.webContents.isDestroyed()) {
        try { this.shellView.webContents.send('browser:event', eventData); } catch {}
      }
    } catch (err) {
      console.warn('[Voodoo AI] Startup keys check error:', err);
    }
  }

  async checkAllVoodooKeys(): Promise<VoodooCheckAllKeysResult> {
    try {
      const settings = this.stores.settings.get();
      const rawKeys = Array.isArray(settings?.voodooKeys) ? settings.voodooKeys : [];
      const keys = rawKeys.map((k) => String(k).trim()).filter(Boolean);

      const checkResult = await this.voodooService.checkAllKeys(
        keys,
        settings.voodooBaseUrl,
        settings.voodooModel
      );

      if (checkResult.healthyKeys.length > 0) {
        const orderChanged = checkResult.reorderedKeys.length !== keys.length || checkResult.reorderedKeys.some((k, i) => k !== keys[i]);
        if (orderChanged) {
          const freshSettings = this.stores.settings.get();
          this.stores.settings.set({
            ...freshSettings,
            voodooKeys: checkResult.reorderedKeys,
          });
        }
      }

      this.emitSnapshot();
      const primaryWorkingKey = checkResult.healthyKeys.length > 0 && checkResult.reorderedKeys[0]
        ? VoodooAiService.maskKey(checkResult.reorderedKeys[0])
        : null;

      const eventData = {
        type: 'voodoo-keys-checked',
        data: {
          healthyCount: checkResult.healthyKeys.length,
          totalCount: keys.length,
          primaryKey: primaryWorkingKey,
        },
      };

      if (this.voodooView?.webContents && !this.voodooView.webContents.isDestroyed()) {
        try { this.voodooView.webContents.send('browser:event', eventData); } catch {}
      }
      if (this.shellView?.webContents && !this.shellView.webContents.isDestroyed()) {
        try { this.shellView.webContents.send('browser:event', eventData); } catch {}
      }

      return {
        results: checkResult.results,
        healthyCount: checkResult.healthyKeys.length,
        reorderedKeys: checkResult.reorderedKeys,
      };
    } catch (err) {
      console.warn('[Voodoo AI] checkAllVoodooKeys error:', err);
      return {
        results: [],
        healthyCount: 0,
        reorderedKeys: [],
      };
    }
  }

  async extractActiveTabChatContext(): Promise<{ text: string; source: string; count: number }> {
    const activeTab = this.tabs.get(this.activeTabId);
    if (!activeTab || !activeTab.view || activeTab.view.webContents.isDestroyed() || activeTab.isInternal) {
      return { text: '', source: 'none', count: 0 };
    }

    const contents = activeTab.view.webContents;
    try {
      const result = await contents.executeJavaScript(`
        (function() {
          try {
            const selection = window.getSelection()?.toString()?.trim();
            if (selection && selection.length > 5) {
              return { text: selection, source: 'selection', count: 1 };
            }

            const hostname = window.location.hostname || '';

            if (hostname.includes('vk.com') || hostname.includes('vk.ru') || hostname.includes('vk.me')) {
              // a) Determine active peer ID
              let activePeer = null;

              // 1. Check window.cur && window.cur.peer
              try {
                if (window.cur && window.cur.peer) {
                  activePeer = String(window.cur.peer);
                }
              } catch (_) {}

              // 2. Parse 'sel' from URL query
              if (!activePeer) {
                try {
                  const sel = new URLSearchParams(window.location.search).get('sel');
                  if (sel) {
                    if (sel.startsWith('c')) {
                      const chatNum = parseInt(sel.slice(1), 10);
                      if (!isNaN(chatNum)) activePeer = String(2000000000 + chatNum);
                    } else if (/^-?\\d+$/.test(sel)) {
                      activePeer = sel;
                    }
                  }
                } catch (_) {}
              }

              // 3. Parse URL pathname (/im/convo/12345, /im/c12, etc.)
              if (!activePeer) {
                try {
                  const pathMatch = window.location.pathname.match(/\\/im\\/(?:convo\\/)?([-\\w]+)/);
                  if (pathMatch && pathMatch[1]) {
                    const raw = pathMatch[1];
                    if (raw.startsWith('c')) {
                      const chatNum = parseInt(raw.slice(1), 10);
                      if (!isNaN(chatNum)) activePeer = String(2000000000 + chatNum);
                    } else if (/^-?\\d+$/.test(raw)) {
                      activePeer = raw;
                    }
                  }
                } catch (_) {}
              }

              // 4. Find selected dialog in left column
              if (!activePeer) {
                const selectedDialog = document.querySelector('._im_dialog_selected, .nim-dialog_selected, [class*="DialogItem--active"]');
                if (selectedDialog) {
                  activePeer = selectedDialog.getAttribute('data-peer') || selectedDialog.getAttribute('data-list-id');
                }
              }

              // b) Find active chat container
              let activeContainer = null;
              if (activePeer) {
                activeContainer =
                  document.querySelector('._im_peer_history[data-peer="' + activePeer + '"]') ||
                  document.querySelector('.im-page--history[data-peer="' + activePeer + '"]') ||
                  document.querySelector('[data-peer="' + activePeer + '"].im-page--history') ||
                  document.querySelector('[data-peer="' + activePeer + '"]');
              }

              if (!activeContainer) {
                const allCandidates = Array.from(document.querySelectorAll(
                  '._im_peer_history, .im-page--history, [data-peer].im-page--history, [data-testid="chat-history"], [class*="ChatContent"], [class*="Convo__history"]'
                ));
                activeContainer = allCandidates.find(function(el) {
                  return (
                    !el.classList.contains('_im_peer_history_hidden') &&
                    !el.classList.contains('im-page--history_hidden') &&
                    el.offsetParent !== null &&
                    el.getBoundingClientRect().height > 50 &&
                    window.getComputedStyle(el).display !== 'none'
                  );
                });
              }

              if (!activeContainer) {
                activeContainer =
                  document.querySelector('.im-page--history.im-page--history_active') ||
                  document.querySelector('.im-page--chat-body ._im_peer_history:not(._im_peer_history_hidden):not(.im-page--history_hidden)') ||
                  document.querySelector('.im-page--chat-body');
              }

              if (activeContainer) {
                // c) Extract interlocutor / chat title
                const titleEl = document.querySelector(
                  '._im_page_peer_name, .im-page--chat-header ._im_page_peer_name, .im-page--title, a.im-page--title-meta, [class*="Header__title"], [data-testid="chat-header-title"]'
                );
                const listTitleEl = document.querySelector(
                  '._im_dialog_selected ._im_dialog_link, .nim-dialog_selected .nim-dialog--name, [class*="DialogItem--active"] [class*="DialogItem__name"]'
                );
                const chatPartnerName = (titleEl?.textContent || listTitleEl?.textContent || '').trim() || 'Собеседник';

                // d) Extract messages strictly inside activeContainer
                const stacks = Array.from(activeContainer.querySelectorAll('._im_mess_stack, .im-mess-stack'));
                const messages = [];

                if (stacks.length > 0) {
                  for (const st of stacks.slice(-15)) {
                    const isOutgoing =
                      st.classList.contains('im-mess-stack_out') ||
                      st.classList.contains('_im_mess_out') ||
                      st.classList.contains('im-mess_out') ||
                      st.matches('.im-mess-stack_out, [class*="Message--out"], [data-out="1"]');

                    const authorEl = st.querySelector('.im-mess-stack--lnk, ._im_log_author_chat_name, [class*="AuthorName"], a.im-mess-stack--lnk');
                    let authorName = isOutgoing ? 'Вы' : ((authorEl?.textContent || '').trim() || chatPartnerName);

                    const msgEls = Array.from(st.querySelectorAll('._im_mess_text, .im-mess--text, .im_msg_text, [class*="MessageText"], [class*="Message__text"]'));
                    for (const m of msgEls) {
                      const txt = (m.textContent || '').trim();
                      if (txt) {
                        messages.push('[' + authorName + ']: ' + txt);
                      }
                    }
                  }
                }

                if (messages.length === 0) {
                  const rawMsgNodes = Array.from(activeContainer.querySelectorAll(
                    '._im_mess_stack, .im-mess-stack, [class*="Message__root"], [class*="ChatMessage"], .im-mess, [data-msgid]'
                  ));
                  for (const node of rawMsgNodes.slice(-15)) {
                    const isOutgoing =
                      node.classList.contains('im-mess-stack_out') ||
                      node.classList.contains('_im_mess_out') ||
                      node.classList.contains('im-mess_out') ||
                      Boolean(node.closest('.im-mess-stack_out, ._im_mess_out, .im-mess_out, [class*="Message--out"], [data-out="1"]'));

                    const authorEl = node.querySelector('.im-mess-stack--lnk, ._im_log_author_chat_name, [class*="AuthorName"], a.im-mess-stack--lnk');
                    const authorName = isOutgoing ? 'Вы' : ((authorEl?.textContent || '').trim() || chatPartnerName);

                    const textEl = node.querySelector('._im_mess_text, .im-mess--text, .im_msg_text, [class*="MessageText"], [class*="Message__text"]') || node;
                    const txt = (textEl.textContent || '').trim();
                    if (txt && txt.length > 0 && !txt.startsWith('[' + authorName + ']')) {
                      messages.push('[' + authorName + ']: ' + txt);
                    }
                  }
                }

                if (messages.length > 0) {
                  const recent = messages.slice(-10);
                  return {
                    text: recent.join('\\n'),
                    source: 'vk_active_dialog (' + chatPartnerName + ')',
                    count: recent.length,
                  };
                }
              }
            }

            if (hostname.includes('telegram.org')) {
              const activeTgContainer =
                document.querySelector('.chat-content .messages-container') ||
                document.querySelector('#middle-column .messages-container') ||
                document.querySelector('.bubbles-group') ||
                document.querySelector('.MessageList');
              const container = activeTgContainer || document;
              const msgEls = Array.from(container.querySelectorAll('.message-content, .bubble-content, .message-item, .Message'));
              if (msgEls.length > 0) {
                const messages = [];
                for (const el of msgEls.slice(-10)) {
                  const author = el.querySelector('.message-title, .peer-title, .sender-title')?.textContent?.trim() || '';
                  const body = el.querySelector('.text-content, .message, .bubble-content-text')?.textContent?.trim() || el.textContent?.trim() || '';
                  if (body) {
                    messages.push(author ? ('[' + author + ']: ' + body) : body);
                  }
                }
                if (messages.length > 0) {
                  return { text: messages.join('\\n'), source: 'telegram', count: messages.length };
                }
              }
            }

            if (hostname.includes('whatsapp.com')) {
              const msgEls = Array.from(document.querySelectorAll('[data-testid="msg-container"], .message-in, .message-out'));
              if (msgEls.length > 0) {
                const messages = [];
                for (const el of msgEls.slice(-10)) {
                  const isOut = el.classList.contains('message-out') || el.querySelector('[data-icon="msg-dblcheck"]');
                  const body = el.querySelector('.selectable-text')?.textContent?.trim() || el.textContent?.trim() || '';
                  if (body) {
                    messages.push((isOut ? '[Вы]: ' : '[Собеседник]: ') + body);
                  }
                }
                if (messages.length > 0) {
                  return { text: messages.join('\\n'), source: 'whatsapp', count: messages.length };
                }
              }
            }

            const article = document.querySelector('article, main, [role="main"], #content, .content');
            if (article) {
              const text = (article.innerText || article.textContent || '').trim();
              if (text.length > 30) {
                return { text: text.slice(0, 3000), source: 'page_article', count: 1 };
              }
            }

            const bodyText = (document.body ? (document.body.innerText || '') : '').trim();
            if (bodyText.length > 30) {
              return { text: bodyText.slice(0, 2000), source: 'page_body', count: 1 };
            }

            return { text: '', source: 'empty', count: 0 };
          } catch {
            return { text: '', source: 'error', count: 0 };
          }
        })()
      `, true);

      if (result && typeof result.text === 'string') {
        return result;
      }
      return { text: '', source: 'none', count: 0 };
    } catch {
      return { text: '', source: 'error', count: 0 };
    }
  }

  async insertTextIntoActiveTab(text: string): Promise<boolean> {
    const activeTab = this.tabs.get(this.activeTabId);
    if (!activeTab || !activeTab.view || activeTab.view.webContents.isDestroyed() || activeTab.isInternal) {
      return false;
    }

    const contents = activeTab.view.webContents;
    try {
      contents.focus();
      const injected = await contents.executeJavaScript(`
        (function(textToInsert) {
          try {
            let target = document.activeElement;
            const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

            if (!isInput) {
              const vkInput = document.querySelector('div.im-chat-input--text[contenteditable="true"], div[contenteditable="true"].im_editable, div.im_chat_input');
              const tgInput = document.querySelector('div.input-message-input[contenteditable="true"], div.editable-message-text[contenteditable="true"]');
              const waInput = document.querySelector('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');
              const generalInput = vkInput || tgInput || waInput || document.querySelector('textarea, input[type="text"], [contenteditable="true"]');

              if (generalInput) {
                target = generalInput;
                generalInput.focus();
              }
            }

            if (target) {
              target.focus();
              if (target.isContentEditable) {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(false);
                selection?.removeAllRanges();
                selection?.addRange(range);
                document.execCommand('insertText', false, textToInsert);
                target.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              } else if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                const start = target.selectionStart || 0;
                const end = target.selectionEnd || 0;
                const val = target.value;
                target.value = val.substring(0, start) + textToInsert + val.substring(end);
                target.selectionStart = target.selectionEnd = start + textToInsert.length;
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        })(${JSON.stringify(text)})
      `, true);

      return Boolean(injected);
    } catch {
      return false;
    }
  }

  private dispose(): void {
    this.voodooModelCatalog?.dispose();
    if (this.disposed) return;
    this.persistSession();
    this.disposed = true;
    this.thumbnailQueue?.dispose();
    this.thumbnailQueue = undefined;
    this.cancelVoodooRequest();
    for (const cleanup of this.pageIpcCleanup) cleanup();
    this.pageIpcCleanup.length = 0;
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    if (this.sessionPersistTimer) clearTimeout(this.sessionPersistTimer);
    if (this.downloadPersistTimer) clearTimeout(this.downloadPersistTimer);
    for (const popup of this.popupWindows) {
      if (!popup.isDestroyed()) popup.destroy();
    }
    this.popupWindows.clear();
    this.popupToTab.clear();
    for (const [target, handler] of this.sessionDownloadHandlers) target.removeListener('will-download', handler);
    this.sessionDownloadHandlers.clear();
    for (const { item } of this.liveDownloads.values()) item.cancel();
    for (const [id, process] of this.ytDlpProcesses) {
      // A stopped POSIX child cannot handle SIGTERM until resumed.
      try { if (process.isPaused) process.child.kill('SIGCONT'); process.child.kill('SIGTERM'); } catch {}
      const entry = this.downloads.find((download) => download.id === id);
      if (entry) { entry.state = 'interrupted'; entry.isLive = false; entry.canResume = false; }
    }
    this.ytDlpProcesses.clear();
    for (const cleanup of this.mediaCookieCleanup?.values() || []) cleanup();
    this.mediaCookieCleanup?.clear();
    this.persistDownloads(true);
    for (const tab of this.tabs.values()) this.detachView(tab);
    this.tabs.clear();
    this.tabHandlerCleanup.clear();
    this.memoryManager.clear();
    this.findQueries.clear();
    this.pipBounds.clear();
    this.capturedMediaStreams.clear();
    this.popupOpeners.clear();
    void this.endPrivateSession();
    if (this.shellView && !this.shellView.webContents.isDestroyed()) this.shellView.webContents.close();
    if (this.voodooView && !this.voodooView.webContents.isDestroyed()) this.voodooView.webContents.close();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.browsec.destroy();
  }
}
