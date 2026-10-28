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
  SavePasswordOffer,
  TabSnapshot,
  VpnSnapshot,
  WorkspaceEntry,
  NotificationPermissionDecision,
  PrivacyDashboardSnapshot,
  VpnHealthStatus,
  TaskManagerSnapshot,
  ReaderSettings,
  ReaderArticle,
  NoteEntry,
  SaveNoteInput,
  VoodooChatMessage,
  VoodooChatResponse,
  VoodooKeyStatusItem,
  VoodooCheckAllKeysResult,
  TranscribeAudioResult,
  CleanTargetOptions,
  StorageMetrics,
  CleanResult,
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
  getPrivacyDashboard(tabId?: string): Promise<PrivacyDashboardSnapshot>;
  createTab(input?: { url?: string; isPrivate?: boolean }): Promise<TabSnapshot>;
  activateTab(tabId: string): Promise<void>;
  openCurrentPageExternally(tabId: string): Promise<void>;
  setSiteCookieException(tabId: string, allow: boolean): Promise<void>;
  setSiteNotificationPermission(tabId: string, decision: NotificationPermissionDecision | 'ask'): Promise<void>;
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
  reload(tabId: string, ignoreCache?: boolean): Promise<void>;
  stop(tabId: string): Promise<void>;
  hibernateTab(tabId: string): Promise<boolean>;
  wakeTab(tabId: string): Promise<void>;
  samplePerformance(): Promise<BrowserSnapshot['performance']>;
  getTaskManagerMetrics(): Promise<TaskManagerSnapshot>;
  killProcess(pid: number): Promise<boolean>;
  toggleDevTools(): Promise<void>;
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
  getHealthStatus(): Promise<VpnHealthStatus>;
  triggerManualHealthCheck(countryCode?: string): Promise<VpnHealthStatus>;
  toggleBrowsec(enabled?: boolean): Promise<BrowsecState>;
  setBrowsecCountry(code: string): Promise<BrowsecState>;
  setBrowsecWebRtcLeakProtection(enabled: boolean): Promise<BrowsecState>;
  addBrowsecSmartRule(domain: string, country: string): Promise<BrowsecState>;
  removeBrowsecSmartRule(domain: string): Promise<BrowsecState>;
  toggleBrowsecSmartRule(domain: string): Promise<BrowsecState>;
  updateBrowsec(patch: Partial<BrowsecState>): Promise<BrowsecState>;
  clearHistoryAndCookies(): Promise<void>;
  getStorageMetrics(): Promise<StorageMetrics>;
  executeClean(options: CleanTargetOptions): Promise<CleanResult>;
  discoverImportProfiles(): Promise<ImportProfile[]>;
  importBrowserData(input: { profileId: string; data: ImportDataKind[] }): Promise<ImportReport>;
  getImportedPasswordSummaries(): Promise<ImportedPasswordSummary[]>;
  deleteSavedPassword(passwordId: string): Promise<boolean>;
  fillSavedPassword(tabId: string, passwordId: string): Promise<{ filled: boolean; reason?: string }>;
  saveCredential(origin: string, username: string, password: string): Promise<{ success: boolean; id: string; updated: boolean }>;
  revealSavedPassword(passwordId: string): Promise<string | null>;
  getSavedCredentialsForOrigin(origin: string): Promise<ImportedPasswordSummary[]>;
  neverSavePasswordForOrigin(origin: string): Promise<void>;
  setChromeBounds(bounds: ChromeBounds): Promise<void>;
  setPopoverOpen(open: boolean): Promise<void>;
  reorderTab(tabId: string, targetTabId: string, position?: 'before' | 'after'): Promise<void>;
  downloadMediaUrl(url: string, filename?: string, isAudio?: boolean): Promise<void>;
  addGoogleAccount(email: string, name?: string): Promise<void>;
  switchGoogleAccount(accountId: string): Promise<void>;
  removeGoogleAccount(accountId: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  toggleFullScreen(): Promise<boolean>;
  closeWindow(): Promise<void>;
  toggleReaderMode(tabId: string): Promise<boolean>;
  getReaderArticle(tabId: string): Promise<ReaderArticle | null>;
  updateReaderSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings>;
  togglePictureInPicture(tabId: string): Promise<{ success: boolean; isPip: boolean }>;
  getNotes(query?: string): Promise<NoteEntry[]>;
  saveNote(input: SaveNoteInput): Promise<NoteEntry>;
  deleteNote(id: string): Promise<boolean>;
  togglePinNote(id: string): Promise<NoteEntry | null>;
  createNoteFromTab(tabId: string, textSnippet?: string): Promise<NoteEntry>;
  sendVoodooMessage(messages: VoodooChatMessage[], tabContext?: { url?: string; title?: string; chatText?: string }): Promise<VoodooChatResponse>;
  testVoodooKey(key: string): Promise<{ success: boolean; latencyMs?: number; error?: string }>;
  checkAllVoodooKeys(): Promise<VoodooCheckAllKeysResult>;
  getVoodooKeysStatus(): Promise<VoodooKeyStatusItem[]>;
  transcribeAudio(audioBase64: string, mimeType?: string): Promise<TranscribeAudioResult>;
  openPath(targetPath: string): Promise<string>;
  extractActiveTabChatContext(): Promise<{ text: string; source: string; count: number }>;
  insertTextIntoActiveTab(text: string): Promise<boolean>;
  setVoodooOpen(open: boolean): Promise<void>;
  moveVoodoo(deltaX: number, deltaY: number): Promise<void>;
  resizeVoodoo(width: number, height: number, deltaX?: number, deltaY?: number): Promise<void>;
  resetVoodooPosition(): Promise<void>;
  onSnapshotChanged(callback: (snapshot: BrowserSnapshot) => void): () => void;
  onTabEvent(callback: (event: { type: string; tab?: TabSnapshot; message?: string; data?: unknown }) => void): () => void;
  onBrowsecSnapshot(callback: (snapshot: BrowsecState) => void): () => void;
}
