import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  app,
  BaseWindow,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  WebContentsView,
} from 'electron';
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
  SaveNoteInput,
} from '../../shared/types';
import { BrowserStores, buildStoredSession, defaultBrowsecCountries, defaultReaderSettings } from '../persistence/BrowserStores';
import { PasswordStore } from '../persistence/PasswordStore';
import { fillSavedCredential } from '../passwords/PasswordAutofill';
import { BrowserDataImporter, type ImportedCookie } from '../import/BrowserDataImporter';

const shellPreloadPath = path.resolve(__dirname, '../../preload/shell-preload.js');
const pagePreloadPath = path.resolve(__dirname, '../../preload/page-preload.js');

type TabRecord = TabSnapshot & {
  view?: WebContentsView;
  webContentsId?: number;
  hasDownloadableMedia?: boolean;
  capturedAudioFilename?: string;
};

const NEW_TAB_URL = 'browser://newtab';

function emptyNavigation(url: string): Pick<TabSnapshot, 'canGoBack' | 'canGoForward'> {
  return { canGoBack: false, canGoForward: false };
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
  window?: BaseWindow;
  shellView?: WebContentsView;
  private activeTabId = '';
  private activeWorkspaceId = 'personal';
  private chromeBounds: ChromeBounds = { x: 176, y: 112, width: 1200, height: 700 };
  private lastValidBounds: ChromeBounds = { x: 200, y: 144, width: 1240, height: 756 };
  private snapshotListener?: (snapshot: BrowserSnapshot) => void;
  private eventListener?: (event: { type: string; tab?: TabSnapshot; message?: string }) => void;
  private shellContentsId?: number;
  private metricsTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private downloadPersistTimer?: NodeJS.Timeout;
  private sessionPersistTimer?: NodeJS.Timeout;
  private sessionSignature = '';
  private restoring = false;
  private disposed = false;
  private htmlFullscreenTabId?: string;
  private fullscreenBeforeVideo = false;
  private privateSession?: Electron.Session;
  private privateProxy = '';
  private privateProxyReady: Promise<void> = Promise.resolve();
  private privateAdBlock = new SessionAdBlock(new FilterEngine());
  private readonly sessionDownloadHandlers = new Map<Electron.Session, (event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => void>();
  private readonly liveDownloads = new Map<string, { item: Electron.DownloadItem; tabId?: string }>();
  private readonly ytDlpProcesses = new Map<string, { child: ChildProcess; isPaused: boolean }>();
  private readonly closedTabs: Array<Pick<TabSnapshot, 'url' | 'workspaceId' | 'isPinned' | 'isMuted'>> = [];
  private readonly popupOpeners = new Map<string, string>();
  private readonly popupWindows = new Set<Electron.BrowserWindow>();
  private readonly popupToTab = new Map<number, string>();
  private readonly findQueries = new Map<string, string>();
  private readonly capturedMediaStreams = new Map<number, { video?: string; audio?: string }>();
  private readonly notificationPermissions = new Map<string, NotificationPermissionDecision>();
  private readonly extensionsManager: LocalExtensionManager;

  constructor() {
    this.stores = new BrowserStores(app.getPath('userData'));
    const initialSettings = this.stores.settings.get();
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
      this.shellView?.webContents.send('browsec:snapshot', snapshot);
      this.emitSnapshot();
    });
    void this.browsec.registerSession(this.browserSession);
    this.configureSession(this.browserSession);
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
    this.window.on('closed', () => this.dispose());
    this.memoryManager.sample();
    this.metricsTimer = setInterval(() => {
      this.memoryManager.sample();
      const idleMinutes = this.stores.settings.get().sleepAfterMinutes;
      if (idleMinutes > 0) {
        for (const tab of this.tabs.values()) {
          if (tab.lifecycle === 'background' && this.memoryManager.canHibernate(tab.id, idleMinutes).allowed) void this.hibernateTab(tab.id);
        }
      }
      this.emitSnapshot();
    }, 5000);
    this.metricsTimer.unref();
    this.window.show();
    this.emitSnapshot();
  }

  isTrustedShell(senderId: number): boolean {
    return senderId === this.shellContentsId;
  }

  isTrustedPage(senderId: number): boolean {
    if ([...this.tabs.values()].some((tab) => tab.webContentsId === senderId && Boolean(tab.view) && !tab.view!.webContents.isDestroyed())) return true;
    return [...this.popupWindows].some((popup) => !popup.isDestroyed() && popup.webContents.id === senderId && !popup.webContents.isDestroyed());
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
      loading: !isInternal,
      downloading: false,
      lastInteractionAt: Date.now(),
      lifecycle: 'background',
    });
    if (!isInternal && !input.lazy) this.attachWebContents(tab, url);
    if (input.active ?? true) this.activateTab(id);
    this.emitSnapshot();
    return this.toSnapshot(tab);
  }

  activateTab(tabId: string): void {
    const next = this.tabs.get(tabId);
    if (!next) return;
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
      this.memoryManager.updateTab(tab.id, { active, lifecycle: tab.lifecycle, ...(active ? { lastInteractionAt: Date.now() } : {}) });
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      if (active && !tab.isInternal && tab.lifecycle !== 'crashed') {
        (tab.view as any).setVisible?.(true);
        if (this.window && !this.window.contentView.children.includes(tab.view)) {
          this.window.contentView.addChildView(tab.view);
        } else {
          try { this.window?.contentView.removeChildView(tab.view); } catch {}
          this.window?.contentView.addChildView(tab.view);
        }
        this.applyBounds(tab);
        tab.view.webContents.focus();
      } else {
        (tab.view as any).setVisible?.(false);
        if (tab.isInternal || tab.lifecycle === 'crashed') {
          try { this.window?.contentView.removeChildView(tab.view); } catch {}
          tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
      }
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
      const level = action === 'zoom-reset' ? 0 : Math.max(-4, Math.min(5, contents.getZoomLevel() + (action === 'zoom-in' ? 0.5 : -0.5)));
      contents.setZoomLevel(level);
      tab.zoomFactor = contents.getZoomFactor();
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

  async hibernateTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    // OAuth popups need their original WebContents/WindowProxy until the flow
    // finishes. Discarding either endpoint would silently break postMessage.
    if (this.popupOpeners.has(tabId) || [...this.popupOpeners.values()].includes(tabId)) return false;
    if (!tab || tab.id === this.activeTabId || tab.isInternal || !tab.view) return false;
    const eligible = this.memoryManager.canHibernate(tabId, 0);
    if (!eligible.allowed) return false;
    this.detachView(tab);
    tab.lifecycle = 'hibernated';
    this.memoryManager.updateTab(tab.id, { lifecycle: 'hibernated', active: false });
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
    if (pid === process.pid) return false;
    for (const tab of this.tabs.values()) {
      try {
        if (tab.view?.webContents && !tab.view.webContents.isDestroyed() && tab.view.webContents.getOSProcessId() === pid) {
          tab.view.webContents.forcefullyCrashRenderer();
          return true;
        }
      } catch {}
    }
    try {
      process.kill(pid);
      return true;
    } catch {
      return false;
    }
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
    if (!download?.url) return;
    if (download.kind === 'video' || download.kind === 'audio') {
      this.downloadMediaUrl(download.url, download.filename, download.kind === 'audio');
    } else {
      const activeTab = this.tabs.get(this.activeTabId);
      if (activeTab?.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
        this.downloadMedia(activeTab.view.webContents, download.url);
      } else {
        this.browserSession.downloadURL(download.url);
      }
    }
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
      };
    });
    if (next.theme) {
      nativeTheme.themeSource = next.theme === 'graphite' ? 'dark' : next.theme;
    }
    this.adBlock.engine.setEnabled(next.adBlockEnabled !== false);
    this.privateAdBlock.engine.setEnabled(next.adBlockEnabled !== false);
    this.adBlock.engine.setExceptions(next.adBlockExceptions ?? []);
    this.privateAdBlock.engine.setExceptions(next.adBlockExceptions ?? []);
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

  setChromeBounds(bounds: ChromeBounds): void {
    const safeNumber = (value: number, fallback: number): number => Number.isFinite(value) ? Math.round(value) : fallback;
    const w = safeNumber(bounds.width, 0);
    const h = safeNumber(bounds.height, 0);
    if (w > 0 && h > 0) {
      this.chromeBounds = {
        x: Math.max(0, safeNumber(bounds.x, 0)),
        y: Math.max(0, safeNumber(bounds.y, 0)),
        width: w,
        height: h,
      };
      this.lastValidBounds = { ...this.chromeBounds };
    }
    this.refreshViewBounds();
  }

  setPopoverOpen(open: boolean): void {
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    const activeTab = this.tabs.get(this.activeTabId);
    const children = this.window.contentView.children;
    const isShellTop = children.length > 0 && children[children.length - 1] === this.shellView;

    if (open) {
      if (this.shellView && !this.shellView.webContents.isDestroyed() && !isShellTop) {
        try { this.window.contentView.removeChildView(this.shellView); } catch {}
        this.window.contentView.addChildView(this.shellView);
      }
    } else {
      if (activeTab?.view && !activeTab.view.webContents.isDestroyed() && !activeTab.isInternal && activeTab.lifecycle !== 'crashed') {
        const isTabTop = children.length > 0 && children[children.length - 1] === activeTab.view;
        if (!isTabTop) {
          try { this.window.contentView.removeChildView(activeTab.view); } catch {}
          this.window.contentView.addChildView(activeTab.view);
          this.applyBounds(activeTab);
          activeTab.view.webContents.focus();
        }
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
      const lines = [
        '# Netscape HTTP Cookie File',
        '# Generated by Soulm8te Browser',
      ];
      const seen = new Set<string>();
      for (const c of cookies) {
        const domain = c.domain?.startsWith('.') ? c.domain : `.${c.domain || host}`;
        const cookiePath = c.path || '/';
        const key = `${domain}:${cookiePath}:${c.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiration = c.expirationDate ? Math.round(c.expirationDate) : Math.round(Date.now() / 1000 + 86400 * 30);
        lines.push(`${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiration}\t${c.name}\t${c.value}`);
      }
      const tmpPath = path.join(os.tmpdir(), `soulm8te_cookies_${crypto.randomUUID()}.txt`);
      fs.writeFileSync(tmpPath, lines.join('\n'), 'utf8');
      return {
        args: ['--cookies', tmpPath],
        cleanup: () => {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        },
      };
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
    const url = normalizeVideoUrl(rawUrl);
    const localBin = path.join(os.homedir(), '.local/bin/yt-dlp');
    const ytDlpPath = fs.existsSync(localBin) ? localBin : 'yt-dlp';

    const id = crypto.randomUUID();
    const downloadDir = app.getPath('downloads');
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
    } catch {}
    const sourceSession = isPrivate && this.privateSession ? this.privateSession : this.browserSession;
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
        cookieInfo.cleanup();
        this.ytDlpProcesses.delete(id);
        entry.isLive = false;
        entry.state = 'interrupted';
        entry.error = this.userFacingMediaDownloadError(message, isAudio);
        this.persistDownloads(true);
        this.emitSnapshot();
      };

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString();
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
        cookieInfo.cleanup();
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
      cookieInfo.cleanup();
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
      if (permission === 'storage-access') {
        if (!this.window || !storageEligible(details.requestingUrl, contents)) { callback(false); return; }
        const topOrigin = new URL(contents.getURL()).origin;
        const origin = new URL(details.requestingUrl).origin;
        void dialog.showMessageBox(this.window, { type: 'question', title: 'Cookies для входа', message: `${origin} запрашивает доступ к своим cookies внутри ${topOrigin}.`, detail: 'Разрешение действует для этой пары сайтов до закрытия приложения. Оно может помочь завершить вход.', buttons: ['Запретить', 'Разрешить на эту сессию'], defaultId: 0, cancelId: 0, noLink: true }).then(({ response }) => {
          const allowed = response === 1 && storageEligible(details.requestingUrl, contents) && new URL(contents.getURL()).origin === topOrigin;
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
        const allowed = response === 1 && !contents.isDestroyed();
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
    const onDownload = (_event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => this.handleDownload(item, contents);
    this.sessionDownloadHandlers.set(targetSession, onDownload);
    targetSession.on('will-download', onDownload);
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
      try { this.window.contentView.removeChildView(view); } catch {}
      this.window.contentView.addChildView(view);
      this.applyBounds(tab);
    } else {
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
    const view = tab.view;
    const contents = view?.webContents;
    if (this.htmlFullscreenTabId === tab.id) this.leaveHtmlFullscreen();
    tab.view = undefined;
    tab.webContentsId = undefined;
    if (!view) return;
    if (this.window && !this.window.isDestroyed()) {
      try { this.window.contentView.removeChildView(view); } catch {}
    }
    if (contents && !contents.isDestroyed()) contents.close();
  }

  private installTabHandlers(tab: TabRecord): void {
    const contents = tab.view?.webContents;
    if (!contents) return;
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
    contents.on('context-menu', (_event, params) => this.showContextMenu(contents, params));
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
    contents.on('did-navigate', (_event, url) => { clearCapturedMedia(); this.memoryManager.updateTab(tab.id, { hasFormEdits: false }); this.updateUrl(tab, url); });
    contents.on('did-navigate-in-page', (_event, url) => { clearCapturedMedia(); this.updateUrl(tab, url); });
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
    });
    contents.on('leave-html-full-screen', () => { if (this.htmlFullscreenTabId === tab.id) this.leaveHtmlFullscreen(); });
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
      this.capturedMediaStreams.delete(contents.id);
      if (this.tabs.has(tab.id) && tab.webContentsId === contents.id) {
        if (this.popupOpeners.has(tab.id)) { void this.closeTab(tab.id); return; }
        tab.lifecycle = 'crashed';
        this.emitSnapshot();
      }
    });
    (contents as unknown as NodeJS.EventEmitter).on('window-close', () => {
      void this.closeTab(tab.id);
    });
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
    tab.url = NEW_TAB_URL;
    tab.title = tab.isPrivate ? 'Приватная вкладка' : 'Новая вкладка';
    tab.isInternal = true;
    tab.lifecycle = 'active';
    Object.assign(tab, emptyNavigation(tab.url));
    this.activateTab(tab.id);
  }

  private refreshViewBounds(): void {
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    const windowBounds = this.window.getContentBounds();
    this.shellView?.setBounds({ x: 0, y: 0, width: windowBounds.width, height: windowBounds.height });

    const activeTab = this.tabs.get(this.activeTabId);
    for (const tab of this.tabs.values()) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      if (tab === activeTab && !tab.isInternal && tab.lifecycle !== 'crashed' && !tab.isReaderActive) {
        (tab.view as any).setVisible?.(true);
        if (!this.window.contentView.children.includes(tab.view)) {
          this.window.contentView.addChildView(tab.view);
        }
        this.applyBounds(tab);
      } else if (tab.isInternal || tab.lifecycle === 'crashed' || tab.isReaderActive) {
        (tab.view as any).setVisible?.(false);
        try { this.window.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      } else {
        (tab.view as any).setVisible?.(false);
        this.applyBounds(tab);
      }
    }
  }

  private applyBounds(tab: TabRecord): void {
    if (!tab.view || tab.isInternal || tab.lifecycle === 'crashed' || tab.isReaderActive) {
      if (tab.view) {
        try { this.window?.contentView.removeChildView(tab.view); } catch {}
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      return;
    }
    const bounds = this.window?.getContentBounds();
    if (!bounds) return;
    if (this.htmlFullscreenTabId === tab.id) { tab.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); return; }
    const chrome = (this.chromeBounds.width > 0 && this.chromeBounds.height > 0)
      ? this.chromeBounds
      : (this.lastValidBounds.width > 0 && this.lastValidBounds.height > 0)
        ? this.lastValidBounds
        : { x: 200, y: 144, width: Math.max(0, bounds.width - 200), height: Math.max(0, bounds.height - 144) };
    const x = Math.min(chrome.x, bounds.width);
    const y = Math.min(chrome.y, bounds.height);
    tab.view.setBounds({ x, y, width: Math.min(chrome.width, bounds.width - x), height: Math.min(chrome.height, bounds.height - y) });
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

  private handleDownload(item: Electron.DownloadItem, webContents: Electron.WebContents): void {
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
      isPrivate: sourceTab?.isPrivate ?? Boolean(this.privateSession && this.privateSession === webContents?.session),
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
      this.emitSnapshot();
      if (entry.state === 'completed' && entry.kind === 'image' && entry.path && !entry.isPrivate) void this.createDownloadThumbnail(entry);
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
  }

  private async createDownloadThumbnail(entry: DownloadEntry): Promise<void> {
    if (!entry.path) return;
    try {
      const image = await nativeImage.createThumbnailFromPath(entry.path, { width: 96, height: 72 });
      if (image.isEmpty()) return;
      entry.thumbnail = image.toDataURL();
      this.persistDownloads();
      this.emitSnapshot();
    } catch {
      // The download remains available with a media icon when thumbnail creation fails.
    }
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
      template.push({ type: 'separator' });
    } else if (params.selectionText) {
      template.push({ label: 'Копировать выделение', click: () => contents.copy() });
      const query = params.selectionText.trim();
      if (query) {
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
    const { view: _view, webContentsId, ...snapshot } = tab;
    const stream = webContentsId ? this.capturedMediaStreams.get(webContentsId) : undefined;
    const url = tab.url || '';
    const isVideoSite = Boolean(
      (url && isVideoPageUrl(url)) ||
      (url.includes('pinterest.') && url.includes('/pin/')) ||
      url.includes('pin.it/')
    );
    const canDownloadMedia = Boolean(tab.hasDownloadableMedia || isVideoSite || Boolean(stream?.video) || Boolean(stream?.audio));
    return {
      ...snapshot,
      canDownloadMedia,
      isReaderAvailable: Boolean(tab.isReaderAvailable),
      isReaderActive: Boolean(tab.isReaderActive),
      hasVideoMedia: Boolean(tab.hasVideoMedia),
      isPictureInPicture: Boolean(tab.isPictureInPicture),
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

  markTabPipChanged(webContentsId: number, isPip: boolean): void {
    const tab = [...this.tabs.values()].find((entry) => entry.webContentsId === webContentsId);
    if (tab && tab.isPictureInPicture !== isPip) {
      tab.isPictureInPicture = isPip;
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
    tab.isReaderActive = !tab.isReaderActive;
    this.refreshViewBounds();
    this.emitSnapshot();
    return Boolean(tab.isReaderActive);
  }

  async getReaderArticle(tabId: string): Promise<ReaderArticle | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return null;
    try {
      const article = await tab.view.webContents.executeJavaScript(
        `typeof window.__extractReaderArticle === 'function' ? window.__extractReaderArticle() : null`,
        true
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
      const res = await tab.view.webContents.executeJavaScript(
        `typeof window.__togglePictureInPicture === 'function' ? window.__togglePictureInPicture() : { success: false, isPip: false }`,
        true
      );
      const isPip = Boolean(res?.isPip);
      tab.isPictureInPicture = isPip;
      this.emitSnapshot();
      return { success: Boolean(res?.success), isPip };
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
      this.stores.notes.set([note, ...items].slice(0, 500));
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
      else if (key === 'f11' || key === 'f12' || (modifier && input.shift && key === 'i')) run(() => {
        void this.toggleDevTools();
      });
      // Shell dialogs/find own Escape even while the underlying site is loading.
      else if (key === 'escape' && tab?.isLoading && contents.id === tab.webContentsId) run(() => { void this.stop(tab.id); });
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

  private dispose(): void {
    this.persistSession();
    this.disposed = true;
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
    this.persistDownloads(true);
    for (const tab of this.tabs.values()) this.detachView(tab);
    this.tabs.clear();
    void this.endPrivateSession();
    if (this.shellView && !this.shellView.webContents.isDestroyed()) this.shellView.webContents.close();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.browsec.destroy();
  }
}
