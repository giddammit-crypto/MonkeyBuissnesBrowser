import type {
  BookmarkEntry,
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
export type DownloadAction = 'pause' | 'resume' | 'cancel';

export interface BrowserApi {
  getSnapshot(): Promise<BrowserSnapshot>;
  createTab(input?: { url?: string; isPrivate?: boolean }): Promise<TabSnapshot>;
  activateTab(tabId: string): Promise<void>;
  openCurrentPageExternally(tabId: string): Promise<void>;
  setSiteCookieException(tabId: string, allow: boolean): Promise<void>;
  importBrowserFile(kind: ImportFileKind): Promise<ImportFileReport | null>;
  tabAction(tabId: string, action: TabAction): Promise<void>;
  reopenClosedTab(): Promise<void>;
  findInPage(tabId: string, text: string, forward?: boolean): Promise<void>;
  stopFindInPage(tabId: string): Promise<void>;
  controlDownload(downloadId: string, action: DownloadAction): Promise<void>;
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
  listLocalExtensions(): Promise<Array<{ id: string; name: string; version: string; directory: string }>>;
  installLocalExtension(): Promise<{ id: string; name: string; version: string; directory: string } | null>;
  removeLocalExtension(id: string): Promise<void>;
  getVpnSnapshot(): Promise<VpnSnapshot>;
  importVpnConfig(): Promise<VpnSnapshot>;
  clearVpnConfig(): Promise<VpnSnapshot>;
  clearHistoryAndCookies(): Promise<void>;
  discoverImportProfiles(): Promise<ImportProfile[]>;
  importBrowserData(input: { profileId: string; data: ImportDataKind[] }): Promise<ImportReport>;
  getImportedPasswordSummaries(): Promise<ImportedPasswordSummary[]>;
  deleteSavedPassword(passwordId: string): Promise<boolean>;
  fillSavedPassword(tabId: string, passwordId: string): Promise<{ filled: boolean; reason?: string }>;
  setChromeBounds(bounds: ChromeBounds): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshotChanged(callback: (snapshot: BrowserSnapshot) => void): () => void;
  onTabEvent(callback: (event: { type: string; tab?: TabSnapshot; message?: string }) => void): () => void;
}
