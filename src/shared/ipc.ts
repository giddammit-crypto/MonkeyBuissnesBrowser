import type {
  BookmarkEntry,
  BrowserSettings,
  BrowserSnapshot,
  DownloadEntry,
  HistoryEntry,
  ImportDataKind,
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

export interface BrowserApi {
  getSnapshot(): Promise<BrowserSnapshot>;
  createTab(input?: { url?: string; isPrivate?: boolean }): Promise<TabSnapshot>;
  activateTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  navigate(tabId: string, input: string): Promise<void>;
  goBack(tabId: string): Promise<void>;
  goForward(tabId: string): Promise<void>;
  reload(tabId: string): Promise<void>;
  stop(tabId: string): Promise<void>;
  hibernateTab(tabId: string): Promise<boolean>;
  wakeTab(tabId: string): Promise<void>;
  samplePerformance(): Promise<BrowserSnapshot['performance']>;
  toggleBookmark(tabId: string): Promise<BookmarkEntry | null>;
  queryHistory(query?: string): Promise<HistoryEntry[]>;
  getDownloads(): Promise<DownloadEntry[]>;
  openDownload(downloadId: string): Promise<void>;
  showDownloadInFolder(downloadId: string): Promise<void>;
  updateSettings(patch: Partial<BrowserSettings>): Promise<BrowserSettings>;
  createWorkspace(name: string): Promise<WorkspaceEntry>;
  switchWorkspace(workspaceId: string): Promise<void>;
  getVpnSnapshot(): Promise<VpnSnapshot>;
  importVpnConfig(): Promise<VpnSnapshot>;
  clearVpnConfig(): Promise<VpnSnapshot>;
  clearHistoryAndCookies(): Promise<void>;
  discoverImportProfiles(): Promise<ImportProfile[]>;
  importBrowserData(input: { profileId: string; data: ImportDataKind[] }): Promise<ImportReport>;
  getImportedPasswordSummaries(): Promise<ImportedPasswordSummary[]>;
  setChromeBounds(bounds: ChromeBounds): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshotChanged(callback: (snapshot: BrowserSnapshot) => void): () => void;
  onTabEvent(callback: (event: { type: string; tab?: TabSnapshot; message?: string }) => void): () => void;
}
