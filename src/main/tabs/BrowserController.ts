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
import { isSafeMediaUrl, mediaKindForMime, mediaKindForUrl } from '../../shared/media';
import { isSafeWebUrl, parseOmniboxInput } from '../../shared/omnibox';
import { normalizeNewTabBackground } from '../../shared/background';
import { canRequestStorageAccess, getExternalPageUrl, getSiteKey, normalizeCookieExceptions, shouldStripThirdPartyCookies } from '../../shared/sitePolicy';
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
  ImportFileKind,
  ImportFileReport,
  ImportProfile,
  ImportReport,
  ImportedPasswordSummary,
} from '../../shared/types';
import { BrowserStores, buildStoredSession } from '../persistence/BrowserStores';
import { PasswordStore } from '../persistence/PasswordStore';
import { fillSavedCredential } from '../passwords/PasswordAutofill';
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
  private readonly popupOpeners = new Map<string, string>();
  private readonly findQueries = new Map<string, string>();

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
    if (!tab.isPrivate && (tab.url === NEW_TAB_URL || isSafeWebUrl(tab.url))) {
      this.closedTabs.push({ url: tab.url, workspaceId: tab.workspaceId, isPinned: tab.isPinned, isMuted: tab.isMuted });
      if (this.closedTabs.length > 20) this.closedTabs.shift();
    }
    this.tabs.delete(tabId);
    this.findQueries.delete(tabId);
    this.popupOpeners.delete(tabId);
    this.memoryManager.removeTab(tabId);
    this.detachView(tab);
    // Clearing is scoped to the whole private session: closing a popup must not
    // sign out the other private tabs. Hibernated private tabs count too.
    if (tab.isPrivate && ![...this.tabs.values()].some((entry) => entry.isPrivate)) await this.endPrivateSession();
    if (this.tabs.size === 0) await this.createTab({ url: NEW_TAB_URL, isPrivate: false, active: true });
    else if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.values()];
      const reversed = remaining.slice().reverse();
      const fallback = reversed.find((entry) => entry.workspaceId === tab.workspaceId && entry.isPrivate === tab.isPrivate)
        ?? reversed.find((entry) => entry.isPrivate === tab.isPrivate)
        ?? reversed.find((entry) => entry.workspaceId === tab.workspaceId)
        ?? reversed[0];
      if (fallback) this.activateTab(fallback.id);
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

  async closeRelatedTabs(tabId: string, scope: 'others' | 'right'): Promise<void> {
    const reference = this.tabs.get(tabId);
    if (!reference || (scope !== 'others' && scope !== 'right')) return;
    // Match the visible strip order. Bulk actions never cross workspaces or
    // normal/private boundaries, and pinned tabs remain protected.
    const ordered = [...this.tabs.values()]
      .filter((tab) => tab.workspaceId === reference.workspaceId && tab.isPrivate === reference.isPrivate)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
    const referenceIndex = ordered.findIndex((tab) => tab.id === tabId);
    const closing = ordered.filter((tab, index) => tab.id !== tabId && !tab.isPinned && (scope === 'others' || index > referenceIndex));
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
      { type: 'separator' },
      { label: 'Закрыть вкладку', click: safely(() => this.closeTab(tabId)) },
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
        newTabBackground: normalizeNewTabBackground(patch.newTabBackground === undefined ? current.newTabBackground : patch.newTabBackground),
        accentColor: ['blue', 'teal', 'violet', 'rose'].includes(patch.accentColor ?? '') ? patch.accentColor : current.accentColor ?? 'blue',
        wallpaperDim: typeof patch.wallpaperDim === 'number' && Number.isFinite(patch.wallpaperDim) ? Math.max(0, Math.min(75, Math.round(patch.wallpaperDim))) : current.wallpaperDim ?? 0,
        sleepAfterMinutes,
        adBlockEnabled: typeof patch.adBlockEnabled === 'boolean' ? patch.adBlockEnabled : current.adBlockEnabled ?? true,
        blockThirdPartyCookies: typeof patch.blockThirdPartyCookies === 'boolean' ? patch.blockThirdPartyCookies : current.blockThirdPartyCookies ?? true,
        googleSignInCompatibility: typeof patch.googleSignInCompatibility === 'boolean' ? patch.googleSignInCompatibility : current.googleSignInCompatibility ?? true,
        thirdPartyCookieExceptions: patch.thirdPartyCookieExceptions === undefined ? current.thirdPartyCookieExceptions ?? [] : normalizeCookieExceptions(patch.thirdPartyCookieExceptions),
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
    const isPrivate = this.tabs.get(this.activeTabId)?.isPrivate ?? false;
    this.activeWorkspaceId = workspaceId;
    const firstTab = Array.from(this.tabs.values()).find((tab) => tab.workspaceId === workspaceId && tab.isPrivate === isPrivate);
    if (firstTab) {
      this.activateTab(firstTab.id);
      return;
    }
    await this.createTab({ url: NEW_TAB_URL, isPrivate, active: true });
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
    targetSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (isPrivate) { headers.DNT = '1'; headers['Sec-GPC'] = '1'; }
      if (stripCookies(details)) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cookie') delete headers[key];
      }
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
      nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webviewTag: false,
      backgroundThrottling: true, spellcheck: true,
    } });
    tab.view = view;
    tab.webContentsId = view.webContents.id;
    tab.isLoading = !popupOptions || initialUrl !== 'about:blank';
    this.memoryManager.updateTab(tab.id, { loading: tab.isLoading, lifecycle: tab.lifecycle });
    view.webContents.setAudioMuted(tab.isMuted);
    if (tab.zoomFactor) view.webContents.setZoomFactor(tab.zoomFactor);
    this.window.contentView.addChildView(view);
    if (tab.isPrivate) view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    this.installTabHandlers(tab);
    if (tab.id === this.activeTabId) this.applyBounds(tab);
    else view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
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
      isMuted: false, isPinned: false, isPrivate: opener.isPrivate, isInternal: false,
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
    if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (contents && !contents.isDestroyed()) contents.close();
  }

  private installTabHandlers(tab: TabRecord): void {
    const contents = tab.view?.webContents;
    if (!contents) return;
    this.installShortcuts(contents);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (this.disposed || !this.window || this.window.isDestroyed()) return { action: 'deny' };
      // A real about:blank popup is required by common login flows that open a
      // WindowProxy synchronously and assign its HTTPS location afterwards.
      const popupUrl = url || 'about:blank';
      if (popupUrl !== 'about:blank' && !isSafeWebUrl(popupUrl)) {
        if (this.isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
        return { action: 'deny' };
      }
      return {
        action: 'allow', outlivesOpener: true,
        overrideBrowserWindowOptions: { webPreferences: {
          session: contents.session, preload: pagePreloadPath, nodeIntegration: false,
          nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
          contextIsolation: true, sandbox: true, webSecurity: true,
          allowRunningInsecureContent: false, webviewTag: false,
        } },
        createWindow: (options) => this.createPopupTab(tab, popupUrl, disposition !== 'background-tab', options),
      };
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
      if (this.tabs.has(tab.id) && tab.webContentsId === contents.id) {
        if (this.popupOpeners.has(tab.id)) { void this.closeTab(tab.id); return; }
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
        label: `Сохранить ${linkedMediaKind === 'image' ? 'изображение' : linkedMediaKind === 'video' ? 'видео' : linkedMediaKind === 'audio' ? 'аудио' : 'файл'}`,
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
      else if ((modifier && key === 'r' || key === 'f5') && tab) run(() => { void this.reload(tab.id); });
      else if (modifier && key === 'p' && tab) run(() => { void this.tabAction(tab.id, 'print'); });
      else if (modifier && ['+', '=', '-', '0'].includes(key) && tab) run(() => { void this.tabAction(tab.id, key === '0' ? 'zoom-reset' : key === '-' ? 'zoom-out' : 'zoom-in'); });
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
      else if (key === 'f11') run(() => { if (this.htmlFullscreenTabId) this.exitPageFullscreen(); else if (this.window) this.window.setFullScreen(!this.window.isFullScreen()); });
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
