import type {
  BookmarkEntry,
  BrowsecCountry,
  BrowsecState,
  BrowserSettings,
  BrowserSnapshot,
  DownloadEntry,
  HistoryEntry,
  ImportDataKind,
  ImportFileKind,
  ImportFileReport,
  ImportProfile,
  ImportReport,
  ImportedPasswordSummary,
  TabSnapshot,
  VpnSnapshot,
  WorkspaceEntry,
} from './types';

export interface ChromeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TabAction = 'mute' | 'pin' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'print' | 'duplicate' | 'hibernate';
export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'delete';

export interface BrowserApi {
  getSnapshot(): Promise<BrowserSnapshot>;
  createTab(input?: { url?: string; isPrivate?: boolean }): Promise<TabSnapshot>;
  activateTab(tabId: string): Promise<void>;
  openCurrentPageExternally(tabId: string): Promise<void>;
  setSiteCookieException(tabId: string, allow: boolean): Promise<void>;
  setSiteAdBlockEnabled(tabId: string, enabled: boolean): Promise<void>;
  importBrowserFile(kind: ImportFileKind): Promise<ImportFileReport | null>;
  tabAction(tabId: string, action: TabAction): Promise<void>;
  reopenClosedTab(): Promise<void>;
  findInPage(tabId: string, text: string, forward?: boolean): Promise<void>;
  stopFindInPage(tabId: string): Promise<void>;
  controlDownload(downloadId: string, action: DownloadAction): Promise<void>;
  deleteDownload(downloadId: string, deleteFile?: boolean): Promise<void>;
  retryDownload(downloadId: string): Promise<void>;
  startDownloadDrag(downloadId: string): void;
  setPrivateProxy(proxy: string): Promise<void>;
  closePrivateTabs(): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  showTabMenu(tabId: string): Promise<void>;
  closeRelatedTabs(tabId: string, scope: 'others' | 'right' | 'left'): Promise<void>;
  navigate(tabId: string, input: string): Promise<void>;
  goBack(tabId: string): Promise<void>;
  goForward(tabId: string): Promise<void>;
  reload(tabId: string): Promise<void>;
  stop(tabId: string): Promise<void>;
  hibernateTab(tabId: string): Promise<boolean>;
  wakeTab(tabId: string): Promise<void>;
  samplePerformance(): Promise<BrowserSnapshot['performance']>;
  toggleBookmark(tabId: string): Promise<BookmarkEntry | null>;
  saveBookmark(input: { id?: string; title: string; url: string }): Promise<BookmarkEntry>;
  removeBookmark(id: string): Promise<void>;
  removeHistoryEntry(id: string): Promise<void>;
  clearBrowsingHistory(): Promise<void>;
  clearFinishedDownloads(isPrivate?: boolean): Promise<void>;
  queryHistory(query?: string): Promise<HistoryEntry[]>;
  getDownloads(): Promise<DownloadEntry[]>;
  openDownload(downloadId: string): Promise<void>;
  showDownloadInFolder(downloadId: string): Promise<void>;
  updateSettings(patch: Partial<BrowserSettings>): Promise<BrowserSettings>;
  createWorkspace(name: string): Promise<WorkspaceEntry>;
  switchWorkspace(workspaceId: string): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listLocalExtensions(): Promise<Array<{ id: string; name: string; version: string; directory: string }>>;
  installLocalExtension(): Promise<{ id: string; name: string; version: string; directory: string } | null>;
  removeLocalExtension(id: string): Promise<void>;
  getVpnSnapshot(): Promise<VpnSnapshot>;
  importVpnConfig(): Promise<VpnSnapshot>;
  clearVpnConfig(): Promise<VpnSnapshot>;
  getBrowsecSnapshot(): Promise<BrowsecState>;
  getBrowsecCountries(): Promise<BrowsecCountry[]>;
  toggleBrowsec(enabled?: boolean): Promise<BrowsecState>;
  setBrowsecCountry(code: string): Promise<BrowsecState>;
  setBrowsecWebRtcLeakProtection(enabled: boolean): Promise<BrowsecState>;
  addBrowsecSmartRule(domain: string, country: string): Promise<BrowsecState>;
  removeBrowsecSmartRule(domain: string): Promise<BrowsecState>;
  toggleBrowsecSmartRule(domain: string): Promise<BrowsecState>;
  updateBrowsec(patch: Partial<BrowsecState>): Promise<BrowsecState>;
  clearHistoryAndCookies(): Promise<void>;
  discoverImportProfiles(): Promise<ImportProfile[]>;
  importBrowserData(input: { profileId: string; data: ImportDataKind[] }): Promise<ImportReport>;
  getImportedPasswordSummaries(): Promise<ImportedPasswordSummary[]>;
  deleteSavedPassword(passwordId: string): Promise<boolean>;
  fillSavedPassword(tabId: string, passwordId: string): Promise<{ filled: boolean; reason?: string }>;
  setChromeBounds(bounds: ChromeBounds): Promise<void>;
  setPopoverOpen(open: boolean): Promise<void>;
  reorderTab(tabId: string, targetTabId: string): Promise<void>;
  downloadMediaUrl(url: string, filename?: string, isAudio?: boolean): Promise<void>;
  addGoogleAccount(email: string, name?: string): Promise<void>;
  switchGoogleAccount(accountId: string): Promise<void>;
  removeGoogleAccount(accountId: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshotChanged(callback: (snapshot: BrowserSnapshot) => void): () => void;
  onTabEvent(callback: (event: { type: string; tab?: TabSnapshot; message?: string }) => void): () => void;
  onBrowsecSnapshot(callback: (snapshot: BrowsecState) => void): () => void;
}
