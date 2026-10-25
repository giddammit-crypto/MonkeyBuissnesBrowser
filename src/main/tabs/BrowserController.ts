import path from 'node:path';
import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
  WebContentsView,
} from 'electron';
import type { ChromeBounds, TabAction, DownloadAction } from '../../shared/ipc';
import { FilterEngine, SessionAdBlock } from '../../services/adblock/FilterEngine';
import { MemoryManager } from '../../services/memory/MemoryManager';
import { VpnConfigStore } from '../../services/vpn/VpnConfigStore';
import { isLikelyMediaUrl, isSafeMediaUrl, mediaKindForMime, mediaKindForUrl } from '../../shared/media';
import { isSafeWebUrl, parseOmniboxInput } from '../../shared/omnibox';
import type {
  BookmarkEntry,
  BrowserSettings,
  BrowserSnapshot,
  DownloadEntry,
  HistoryEntry,
  TabSnapshot,
  VpnSnapshot,
  WorkspaceEntry,
  ImportDataKind,
  ImportProfile,
  ImportReport,
  ImportedPasswordSummary,
} from '../../shared/types';
import { BrowserStores, buildStoredSession } from '../persistence/BrowserStores';
import { PasswordStore } from '../persistence/PasswordStore';
import { BrowserDataImporter, type ImportedCookie } from '../import/BrowserDataImporter';

const shellPreloadPath = path.resolve(__dirname, '../../preload/shell-preload.js');
const pagePreloadPath = path.resolve(__dirname, '../../preload/page-preload.js');

type TabRecord = TabSnapshot & {
  view?: WebContentsView;
  webContentsId?: number;
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
  private readonly closedTabs: Array<Pick<TabSnapshot, 'url' | 'workspaceId' | 'isPinned' | 'isMuted'>> = [];

  constructor() {
    this.stores = new BrowserStores(app.getPath('userData'));
    this.downloads = this.stores.downloads.get();
    this.normalizeDownloads();
    this.passwords = new PasswordStore(app.getPath('userData'));
    this.importer = new BrowserDataImporter(this.stores, this.passwords, (cookies) => this.setImportedCookies(cookies));
    this.browserSession = session.fromPartition('persist:northstar-default');
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
    this.window = new BaseWindow({
      width: 1440,
      height: 900,
      minWidth: 920,
      minHeight: 640,
      show: false,
      frame: false,
      backgroundColor: '#171C23',
      title: 'SOUL-M8TE',
      icon: path.join(app.getAppPath(), 'assets/icons/png/app-icon-512.png'),
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
    this.shellContentsId = this.shellView.webContents.id;
    this.shellView.webContents.on('will-navigate', (event) => event.preventDefault());
    this.shellView.webContents.on('will-redirect', (event) => event.preventDefault());
    this.shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.installShortcuts(this.shellView.webContents);
    this.window.contentView.addChildView(this.shellView);
    this.shellView.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
    await this.shellView.webContents.loadURL('app://shell/index.html');

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

  getSnapshot(): BrowserSnapshot {
    const storedWorkspaces = this.stores.workspaces.get();
    const tabsByWorkspace = new Map<string, string[]>();
    for (const tab of this.tabs.values()) {
      const tabIds = tabsByWorkspace.get(tab.workspaceId) ?? [];
      tabIds.push(tab.id);
      tabsByWorkspace.set(tab.workspaceId, tabIds);
    }
    return {
      tabs: Array.from(this.tabs.values()).map(({ view: _view, webContentsId: _id, ...tab }) => tab),
      activeTabId: this.activeTabId,
      privacy: { privateTabCount: [...this.tabs.values()].filter((tab) => tab.isPrivate).length, proxy: this.privateProxy },
      history: this.stores.history.get(),
      bookmarks: this.stores.bookmarks.get(),
      downloads: this.downloads,
      workspaces: storedWorkspaces.map((workspace) => ({ ...workspace, tabIds: tabsByWorkspace.get(workspace.id) ?? [] })),
      settings: this.stores.settings.get(),
      vpn: this.vpn.getSnapshot(),
      adBlock: this.adBlock.engine.stats(),
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
      if (active) {
        this.window?.contentView.removeChildView(tab.view);
        this.window?.contentView.addChildView(tab.view);
        this.applyBounds(tab);
        tab.view.webContents.focus();
      } else tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.emitSnapshot();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (!tab.isPrivate) {
      this.closedTabs.push({ url: tab.url, workspaceId: tab.workspaceId, isPinned: tab.isPinned, isMuted: tab.isMuted });
      if (this.closedTabs.length > 20) this.closedTabs.shift();
    }
    this.tabs.delete(tabId);
    this.memoryManager.removeTab(tabId);
    this.detachView(tab);
    // Clearing is scoped to the whole private session: closing a popup must not
    // sign out the other private tabs. Hibernated private tabs count too.
    if (tab.isPrivate && ![...this.tabs.values()].some((entry) => entry.isPrivate)) await this.endPrivateSession();
    if (this.tabs.size === 0) await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
    else if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.values()];
      const fallback = remaining.slice().reverse().find((entry) => entry.workspaceId === tab.workspaceId) ?? remaining.at(-1);
      if (fallback) this.activateTab(fallback.id);
    }
    this.emitSnapshot();
  }

  async closePrivateTabs(): Promise<void> {
    for (const tab of [...this.tabs.values()]) if (tab.isPrivate) await this.closeTab(tab.id);
  }

  async reopenClosedTab(): Promise<void> {
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

  findInPage(tabId: string, text: string, forward = true): void {
    const contents = this.tabs.get(tabId)?.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (typeof text !== 'string' || !text.trim()) { this.stopFindInPage(tabId); return; }
    contents.findInPage(text.slice(0, 1000), { forward, findNext: true });
  }

  stopFindInPage(tabId: string): void {
    const contents = this.tabs.get(tabId)?.view?.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage('clearSelection');
  }

  controlDownload(downloadId: string, action: DownloadAction): void {
    const download = this.liveDownloads.get(downloadId);
    const entry = this.downloads.find((item) => item.id === downloadId);
    if (!download || !entry) return;
    if (action === 'cancel') download.item.cancel();
    else if (action === 'pause') download.item.pause();
    else if (action === 'resume' && (download.item.isPaused() || download.item.canResume())) download.item.resume();
    entry.isPaused = action === 'pause';
    this.emitSnapshot();
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

  async reload(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal) return;
    if (tab.lifecycle === 'crashed' || !tab.view || tab.view.webContents.isDestroyed()) {
      this.detachView(tab);
      tab.lifecycle = 'active';
      this.attachWebContents(tab, tab.url);
      this.activateTab(tab.id);
    } else tab.view.webContents.reload();
  }

  async stop(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.view) tab.view.webContents.stop();
  }

  async hibernateTab(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
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

  toggleBookmark(tabId: string): BookmarkEntry | null {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isInternal) return null;
    const bookmark = this.stores.toggleBookmark({ url: tab.url, title: tab.title });
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

  updateSettings(patch: Partial<BrowserSettings>): BrowserSettings {
    const next = this.stores.settings.update((current) => {
      const theme = patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system' ? patch.theme : current.theme;
      const searchEngine = typeof patch.searchEngine === 'string' && /^https?:\/\//i.test(patch.searchEngine) ? patch.searchEngine : current.searchEngine;
      const sleepAfterMinutes = patch.sleepAfterMinutes === 0 || patch.sleepAfterMinutes === 5 || patch.sleepAfterMinutes === 15 || patch.sleepAfterMinutes === 30 || patch.sleepAfterMinutes === 60
        ? patch.sleepAfterMinutes
        : current.sleepAfterMinutes;
      return {
        ...current,
        theme,
        sidebarCollapsed: typeof patch.sidebarCollapsed === 'boolean' ? patch.sidebarCollapsed : current.sidebarCollapsed,
        searchEngine,
        newTabBackground: typeof patch.newTabBackground === 'string' ? patch.newTabBackground.slice(0, 120) : current.newTabBackground,
        sleepAfterMinutes,
        adBlockEnabled: typeof patch.adBlockEnabled === 'boolean' ? patch.adBlockEnabled : current.adBlockEnabled ?? true,
        blockThirdPartyCookies: typeof patch.blockThirdPartyCookies === 'boolean' ? patch.blockThirdPartyCookies : current.blockThirdPartyCookies ?? true,
        restoreSession: typeof patch.restoreSession === 'boolean' ? patch.restoreSession : current.restoreSession ?? true,
      };
    });
    this.adBlock.engine.setEnabled(next.adBlockEnabled !== false);
    this.privateAdBlock.engine.setEnabled(next.adBlockEnabled !== false);
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
    this.activeWorkspaceId = workspaceId;
    const firstTab = Array.from(this.tabs.values()).find((tab) => tab.workspaceId === workspaceId);
    if (firstTab) {
      this.activateTab(firstTab.id);
      return;
    }
    await this.createTab({ url: NEW_TAB_URL, active: true });
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

  setChromeBounds(bounds: ChromeBounds): void {
    const safeNumber = (value: number, fallback: number): number => Number.isFinite(value) ? Math.round(value) : fallback;
    this.chromeBounds = {
      x: Math.max(0, safeNumber(bounds.x, 0)),
      y: Math.max(0, safeNumber(bounds.y, 0)),
      width: Math.max(0, safeNumber(bounds.width, 0)),
      height: Math.max(0, safeNumber(bounds.height, 0)),
    };
    this.refreshViewBounds();
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
      this.configureSession(this.privateSession, true);
      if (this.privateProxy) this.privateProxyReady = this.applyPrivateProxy(this.privateSession, this.privateProxy);
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
    // No DIRECT fallback and no implicit loopback bypass for a configured proxy.
    await target.setProxy(value ? { mode: 'fixed_servers', proxyRules: value, proxyBypassRules: '<-loopback>' } : { mode: 'direct' });
    await target.closeAllConnections();
  }

  private async endPrivateSession(): Promise<void> {
    const target = this.privateSession;
    this.privateSession = undefined;
    this.privateAdBlock = new SessionAdBlock(new FilterEngine());
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
    blocker.install(targetSession);
    // Remove Electron/app tokens for compatibility, without fabricating a device fingerprint.
    targetSession.setUserAgent(targetSession.getUserAgent().replace(/\s(?:Electron|monkeybuissnesbrowser|SOUL-M8TE)\/[^\s]+/gi, ''));
    const allowedPermissions = new Set<string>();
    const permissionKey = (origin: string, permission: string) => `${origin}:${permission}`;
    targetSession.setPermissionCheckHandler((_contents, permission, origin) => permission === 'fullscreen' || permission === 'clipboard-sanitized-write' || allowedPermissions.has(permissionKey(origin, permission)));
    targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (permission === 'fullscreen' || permission === 'clipboard-sanitized-write') { callback(true); return; }
      let origin: string;
      try { origin = new URL(details.requestingUrl || contents.getURL()).origin; } catch { callback(false); return; }
      if (!origin.startsWith('https://') || !['media', 'geolocation', 'notifications'].includes(permission) || !this.window || contents.isDestroyed()) { callback(false); return; }
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
    const isCrossHost = (url: string, referrer: string): boolean => {
      try { return Boolean(referrer) && new URL(url).hostname !== new URL(referrer).hostname; } catch { return false; }
    };
    targetSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (isPrivate) { headers.DNT = '1'; headers['Sec-GPC'] = '1'; }
      if ((isPrivate || this.stores.settings.get().blockThirdPartyCookies !== false) && details.resourceType !== 'mainFrame' && isCrossHost(details.url, details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : details.initiatorOrigin || details.referrer)) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cookie') delete headers[key];
      }
      callback({ requestHeaders: headers });
    });
    targetSession.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.responseHeaders };
      if ((isPrivate || this.stores.settings.get().blockThirdPartyCookies !== false) && details.resourceType !== 'mainFrame' && isCrossHost(details.url, details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : details.initiatorOrigin || details.referrer)) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'set-cookie') delete headers[key];
      }
      callback({ responseHeaders: headers });
    });
    const onDownload = (_event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => this.handleDownload(item, contents);
    this.sessionDownloadHandlers.set(targetSession, onDownload);
    targetSession.on('will-download', onDownload);
  }

  private attachWebContents(tab: TabRecord, initialUrl: string): void {
    if (!this.window || this.disposed) return;
    const tabSession = tab.isPrivate ? this.ensurePrivateSession() : this.browserSession;
    const view = new WebContentsView({ webPreferences: {
      session: tabSession, preload: pagePreloadPath, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      backgroundThrottling: true, spellcheck: true,
    } });
    tab.view = view;
    tab.webContentsId = view.webContents.id;
    tab.isLoading = true;
    this.memoryManager.updateTab(tab.id, { loading: true, lifecycle: tab.lifecycle });
    view.webContents.setAudioMuted(tab.isMuted);
    if (tab.zoomFactor) view.webContents.setZoomFactor(tab.zoomFactor);
    this.window.contentView.addChildView(view);
    if (tab.isPrivate) view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    this.installTabHandlers(tab);
    if (tab.id === this.activeTabId) this.applyBounds(tab);
    else view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    const ready = tab.isPrivate ? this.privateProxyReady : Promise.resolve();
    void ready.then(() => this.loadUrl(view.webContents, initialUrl)).catch((error) => {
      this.eventListener?.({ type: 'navigation-error', message: error instanceof Error ? error.message : 'Не удалось загрузить страницу.' });
    });
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
    if (this.htmlFullscreenTabId === tab.id) this.leaveHtmlFullscreen();
    tab.view = undefined;
    tab.webContentsId = undefined;
    if (!view) return;
    if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private installTabHandlers(tab: TabRecord): void {
    const contents = tab.view?.webContents;
    if (!contents) return;
    this.installShortcuts(contents);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isSafeWebUrl(url)) {
        if (this.isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
        return { action: 'deny' };
      }
      void this.createTab({ url, isPrivate: tab.isPrivate, active: disposition !== 'background-tab' });
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => this.showContextMenu(contents, params));
    contents.on('will-navigate', (event, url) => {
      if (!isSafeWebUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => { if (!isSafeWebUrl(url)) event.preventDefault(); });
    contents.on('did-start-loading', () => {
      tab.isLoading = true;
      this.memoryManager.updateTab(tab.id, { loading: true });
      this.emitSnapshot();
    });
    contents.on('did-stop-loading', () => {
      tab.isLoading = false;
      this.memoryManager.updateTab(tab.id, { loading: false });
      this.updateNavigationState(tab);
      this.emitSnapshot();
    });
    contents.on('did-navigate', (_event, url) => { this.memoryManager.updateTab(tab.id, { hasFormEdits: false, capturing: false }); this.updateUrl(tab, url); });
    contents.on('did-navigate-in-page', (_event, url) => this.updateUrl(tab, url));
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      tab.title = title || tab.url;
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
      this.memoryManager.updateTab(tab.id, { loading: false, lifecycle: 'crashed' });
      this.eventListener?.({ type: 'navigation-error', tab: this.toSnapshot(tab), message: `${errorDescription}: ${validatedURL}` });
      this.emitSnapshot();
    });
    contents.on('media-started-playing', () => this.memoryManager.updateTab(tab.id, { audible: true }));
    contents.on('media-paused', () => this.memoryManager.updateTab(tab.id, { audible: contents.isCurrentlyAudible() }));
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
      this.memoryManager.updateTab(tab.id, { loading: false, lifecycle: 'crashed' });
      this.eventListener?.({ type: 'renderer-gone', tab: this.toSnapshot(tab), message: details.reason });
      this.emitSnapshot();
    });
    contents.on('destroyed', () => {
      if (this.tabs.has(tab.id) && tab.view?.webContents === contents) {
        tab.lifecycle = 'crashed';
        this.emitSnapshot();
      }
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
    for (const tab of this.tabs.values()) {
      if (tab.id === this.activeTabId) this.applyBounds(tab);
      else tab.view?.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    this.shellView?.setBounds({ x: 0, y: 0, width: this.window?.getBounds().width ?? 1440, height: this.window?.getBounds().height ?? 900 });
  }

  private applyBounds(tab: TabRecord): void {
    if (!tab.view || tab.isInternal) return;
    const bounds = this.window?.getContentBounds();
    if (!bounds) return;
    if (this.htmlFullscreenTabId === tab.id) { tab.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); return; }
    const x = Math.min(this.chromeBounds.x, bounds.width);
    const y = Math.min(this.chromeBounds.y, bounds.height);
    tab.view.setBounds({ x, y, width: Math.min(this.chromeBounds.width, bounds.width - x), height: Math.min(this.chromeBounds.height, bounds.height - y) });
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
      state: 'queued', receivedBytes: 0, totalBytes: item.getTotalBytes(), startedAt: Date.now(),
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
      this.persistDownloads();
      this.emitSnapshot();
    });
    item.once('done', (_event, state) => {
      this.liveDownloads.delete(id);
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
        await this.browserSession.cookies.set(cookie);
        imported += 1;
      } catch {
        // Invalid or expired cookies are ignored without exposing their values.
      }
    }
    return imported;
  }

  private showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const mediaUrl = params.srcURL && isSafeMediaUrl(params.srcURL) ? params.srcURL : undefined;
    const linkedMediaUrl = params.linkURL && isSafeMediaUrl(params.linkURL) ? params.linkURL : undefined;
    const mediaKind = mediaUrl ? mediaKindForUrl(mediaUrl) : undefined;
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (params.mediaType === 'image') {
      template.push({
        label: mediaUrl ? 'Сохранить изображение' : 'Изображение недоступно для сохранения',
        enabled: Boolean(mediaUrl),
        click: () => { if (mediaUrl) this.downloadMedia(contents, mediaUrl); },
      });
    } else if (params.mediaType === 'video') {
      template.push({
        label: mediaUrl ? 'Сохранить видео' : 'Видео не отдает прямой файл',
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
        label: `Сохранить ${mediaKind === 'image' ? 'изображение' : mediaKind === 'video' ? 'видео' : 'файл'}`,
        click: () => this.downloadMedia(contents, linkedMediaUrl),
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

    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private downloadMedia(contents: Electron.WebContents, url: string): void {
    if (!isSafeMediaUrl(url) || !isLikelyMediaUrl(new URL(url))) return;
    contents.downloadURL(url);
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
    const { view: _view, webContentsId: _id, ...snapshot } = tab;
    return snapshot;
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
      if (modifier && key === 'l') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'focus-address' }); });
      else if (modifier && input.shift && key === 't') run(() => { void this.reopenClosedTab(); });
      else if (modifier && input.shift && (key === 'n' || key === 'p')) run(() => { void this.createTab({ isPrivate: true }); });
      else if (modifier && key === 't') run(() => { void this.createTab(); });
      else if (modifier && key === 'w' && tab) run(() => { void this.closeTab(tab.id); });
      else if (modifier && key === 'd' && tab) run(() => { this.toggleBookmark(tab.id); });
      else if (modifier && key === 'f') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-find' }); });
      else if (modifier && key === 'h') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-history' }); });
      else if (modifier && key === 'j') run(() => { this.exitPageFullscreen(); this.shellView?.webContents.focus(); this.eventListener?.({ type: 'show-downloads' }); });
      else if ((modifier && key === 'r' || key === 'f5') && tab) run(() => { void this.reload(tab.id); });
      else if (modifier && key === 'p' && tab) run(() => { void this.tabAction(tab.id, 'print'); });
      else if (modifier && ['+', '=', '-', '0'].includes(key) && tab) run(() => { void this.tabAction(tab.id, key === '0' ? 'zoom-reset' : key === '-' ? 'zoom-out' : 'zoom-in'); });
      else if (modifier && key === 'tab') run(() => {
        const tabs = [...this.tabs.values()].filter((entry) => entry.workspaceId === this.activeWorkspaceId);
        const index = tabs.findIndex((entry) => entry.id === this.activeTabId);
        const next = tabs[(index + (input.shift ? -1 : 1) + tabs.length) % tabs.length];
        if (next) this.activateTab(next.id);
      });
      else if (input.alt && key === 'arrowleft' && tab) run(() => { void this.goBack(tab.id); });
      else if (input.alt && key === 'arrowright' && tab) run(() => { void this.goForward(tab.id); });
      else if (key === 'f11') run(() => { if (this.htmlFullscreenTabId) this.exitPageFullscreen(); else if (this.window) this.window.setFullScreen(!this.window.isFullScreen()); });
      else if (key === 'escape' && tab?.isLoading) run(() => { void this.stop(tab.id); });
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
    for (const [target, handler] of this.sessionDownloadHandlers) target.removeListener('will-download', handler);
    this.sessionDownloadHandlers.clear();
    for (const { item } of this.liveDownloads.values()) item.cancel();
    this.persistDownloads(true);
    for (const tab of this.tabs.values()) this.detachView(tab);
    this.tabs.clear();
    void this.endPrivateSession();
    if (this.shellView && !this.shellView.webContents.isDestroyed()) this.shellView.webContents.close();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
  }
}
