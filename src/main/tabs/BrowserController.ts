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
import type { ChromeBounds } from '../../shared/ipc';
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
import { BrowserStores } from '../persistence/BrowserStores';
import { PasswordStore } from '../persistence/PasswordStore';
import { BrowserDataImporter, type ImportedCookie } from '../import/BrowserDataImporter';

const shellPreloadPath = path.resolve(__dirname, '../../preload/shell-preload.js');

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
      backgroundColor: '#eef3f8',
      title: 'MonkeyBuissnesBrowser',
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
    this.window.contentView.addChildView(this.shellView);
    this.shellView.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
    await this.shellView.webContents.loadURL('app://shell/index.html');

    await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
    this.window.on('resize', () => this.refreshViewBounds());
    this.window.on('closed', () => this.dispose());
    this.memoryManager.sample();
    this.metricsTimer = setInterval(() => {
      this.memoryManager.sample();
      this.emitSnapshot();
    }, 2000);
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

  async createTab(input: { url?: string; isPrivate?: boolean; active?: boolean } = {}): Promise<TabSnapshot> {
    const id = crypto.randomUUID();
    const url = input.url ?? NEW_TAB_URL;
    if (url !== NEW_TAB_URL && !isSafeWebUrl(url)) throw new Error('Разрешены только HTTP и HTTPS адреса.');
    const isInternal = url === NEW_TAB_URL;
    const tab: TabRecord = {
      id,
      url,
      title: isInternal ? (input.isPrivate ? 'Анонимная вкладка' : 'Новая вкладка') : 'Новая страница',
      isLoading: false,
      ...emptyNavigation(url),
      isMuted: false,
      isPinned: false,
      isPrivate: Boolean(input.isPrivate),
      isInternal,
      lifecycle: input.active ?? true ? 'active' : 'background',
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
    if (!isInternal) this.attachWebContents(tab, url);
    if (input.active ?? true) this.activateTab(id);
    this.emitSnapshot();
    return this.toSnapshot(tab);
  }

  activateTab(tabId: string): void {
    const next = this.tabs.get(tabId);
    if (!next) return;
    if (next.lifecycle === 'hibernated') {
      this.activeTabId = tabId;
      void this.wakeTab(tabId);
      return;
    }
    this.activeTabId = tabId;
    this.activeWorkspaceId = next.workspaceId;
    for (const tab of this.tabs.values()) {
      if (!tab.view) continue;
      if (tab.id === tabId) {
        this.window?.contentView.removeChildView(tab.view);
        this.window?.contentView.addChildView(tab.view);
        this.applyBounds(tab);
        tab.lifecycle = 'active';
        this.memoryManager.updateTab(tab.id, { active: true, lifecycle: 'active', lastInteractionAt: Date.now() });
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        if (tab.lifecycle === 'active') tab.lifecycle = 'background';
        this.memoryManager.updateTab(tab.id, { active: false, lifecycle: tab.lifecycle });
      }
    }
    this.emitSnapshot();
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab.view) {
      if (tab.isPrivate) {
        await tab.view.webContents.session.clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] });
        await tab.view.webContents.session.clearCache();
      }
      this.window?.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    this.tabs.delete(tabId);
    this.memoryManager.removeTab(tabId);
    if (this.tabs.size === 0) {
      await this.createTab({ url: NEW_TAB_URL, active: true });
      return;
    }
    if (this.activeTabId === tabId) {
      const fallback = Array.from(this.tabs.keys()).at(-1);
      if (fallback) this.activateTab(fallback);
    }
    this.emitSnapshot();
  }

  async navigate(tabId: string, rawInput: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
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
    if (!tab.view) this.attachWebContents(tab, intent.url);
    else await tab.view.webContents.loadURL(intent.url);
    tab.isInternal = false;
    tab.url = intent.url;
    tab.title = intent.url;
    tab.lifecycle = 'active';
    this.activateTab(tab.id);
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
    if (tab?.view) tab.view.webContents.reload();
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
    this.window?.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tab.view = undefined;
    tab.webContentsId = undefined;
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
      };
    });
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

  private configureSession(targetSession: Electron.Session): void {
    this.adBlock.install(targetSession);
    targetSession.setPermissionCheckHandler((_webContents, permission) => permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
    targetSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write'));
    targetSession.on('will-download', (event, item, webContents) => {
      event.preventDefault();
      void this.handleDownload(item, webContents);
    });
  }

  private attachWebContents(tab: TabRecord, initialUrl: string): void {
    if (!this.window) return;
    const tabSession = tab.isPrivate ? session.fromPartition(`private-${tab.id}`) : this.browserSession;
    if (tab.isPrivate) this.configureSession(tabSession);
    const view = new WebContentsView({
      webPreferences: {
        session: tabSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    tab.view = view;
    tab.webContentsId = view.webContents.id;
    this.window.contentView.addChildView(view);
    if (tab.isPrivate) view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    this.installTabHandlers(tab);
    if (tab.id === this.activeTabId) this.applyBounds(tab);
    else view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    void view.webContents.loadURL(initialUrl);
  }

  private installTabHandlers(tab: TabRecord): void {
    const contents = tab.view?.webContents;
    if (!contents) return;
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isSafeWebUrl(url)) {
        if (this.isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
        return { action: 'deny' };
      }
      void this.createTab({ url, active: disposition !== 'background-tab' });
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => this.showContextMenu(contents, params));
    contents.on('will-navigate', (event, url) => {
      if (!isSafeWebUrl(url)) event.preventDefault();
    });
    contents.on('did-start-loading', () => {
      tab.isLoading = true;
      this.emitSnapshot();
    });
    contents.on('did-stop-loading', () => {
      tab.isLoading = false;
      this.updateNavigationState(tab);
      this.emitSnapshot();
    });
    contents.on('did-navigate', (_event, url) => this.updateUrl(tab, url));
    contents.on('did-navigate-in-page', (_event, url) => this.updateUrl(tab, url));
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      tab.title = title || tab.url;
      this.emitSnapshot();
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      tab.favicon = favicons[0];
      this.emitSnapshot();
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      tab.isLoading = false;
      tab.lifecycle = 'crashed';
      this.eventListener?.({ type: 'navigation-error', tab: this.toSnapshot(tab), message: `${errorDescription}: ${validatedURL}` });
      this.emitSnapshot();
    });
    contents.on('render-process-gone', (_event, details) => {
      tab.lifecycle = 'crashed';
      this.eventListener?.({ type: 'renderer-gone', tab: this.toSnapshot(tab), message: details.reason });
      this.emitSnapshot();
    });
    contents.on('destroyed', () => {
      if (this.tabs.has(tab.id)) {
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
    if (tab.view) {
      this.window?.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
      tab.view = undefined;
      tab.webContentsId = undefined;
    }
    tab.url = NEW_TAB_URL;
    tab.title = tab.isPrivate ? 'Анонимная вкладка' : 'Новая вкладка';
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
    tab.view.setBounds(this.chromeBounds);
  }

  private async handleDownload(item: Electron.DownloadItem, webContents: Electron.WebContents): Promise<void> {
    if (!this.window) {
      item.cancel();
      return;
    }
    const id = crypto.randomUUID();
    const filename = item.getFilename().replace(/[\\/:*?"<>|]/g, '_');
    const url = item.getURL();
    const mimeType = item.getMimeType();
    const mimeKind = mediaKindForMime(mimeType);
    const kind = mimeKind === 'file' ? mediaKindForUrl(url) : mimeKind;
    const entry: DownloadEntry = {
      id,
      url,
      filename,
      kind,
      mimeType: mimeType || undefined,
      state: 'queued',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    this.downloads.unshift(entry);
    this.persistDownloads();
    this.emitSnapshot();

    const result = await dialog.showSaveDialog(this.window, {
      defaultPath: path.join(app.getPath('downloads'), filename),
      title: 'Сохранить файл',
    });
    if (result.canceled || !result.filePath) {
      item.cancel();
      entry.state = 'cancelled';
      entry.finishedAt = Date.now();
      entry.error = 'Сохранение отменено пользователем.';
      this.persistDownloads();
      this.emitSnapshot();
      return;
    }
    item.setSavePath(result.filePath);
    entry.path = result.filePath;
    entry.state = 'progressing';
    this.persistDownloads();
    const sourceTab = Array.from(this.tabs.values()).find((tab) => tab.webContentsId === webContents.id);
    if (sourceTab) this.eventListener?.({ type: 'download-started', tab: this.toSnapshot(sourceTab) });
    item.on('updated', () => {
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      entry.state = 'progressing';
      this.persistDownloads();
      this.emitSnapshot();
    });
    item.once('done', (_event, state) => {
      entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      entry.receivedBytes = item.getReceivedBytes();
      entry.finishedAt = Date.now();
      if (entry.state !== 'completed') entry.error = state === 'cancelled' ? 'Загрузка отменена.' : 'Загрузка прервана.';
      this.persistDownloads();
      this.emitSnapshot();
      if (entry.state === 'completed' && entry.kind === 'image' && entry.path) void this.createDownloadThumbnail(entry);
    });
    this.emitSnapshot();
  }

  private persistDownloads(): void {
    this.stores.downloads.set(this.downloads.slice(0, 100));
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
      if (isSafeWebUrl(params.linkURL)) void this.createTab({ url: params.linkURL, active: true });
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

  private emitSnapshot(): void {
    this.snapshotListener?.(this.getSnapshot());
  }

  private dispose(): void {
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    if (this.shellView && !this.shellView.webContents.isDestroyed()) this.shellView.webContents.close();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
  }
}
