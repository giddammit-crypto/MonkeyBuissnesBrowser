import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserApi, ChromeBounds } from '../shared/ipc';
import type { BrowserSettings } from '../shared/types';

const api: BrowserApi = {
  getSnapshot: () => ipcRenderer.invoke('browser:get-snapshot'),
  createTab: (input) => ipcRenderer.invoke('browser:create-tab', input),
  activateTab: (tabId) => ipcRenderer.invoke('browser:activate-tab', tabId),
  openCurrentPageExternally: (tabId) => ipcRenderer.invoke('browser:open-page-externally', tabId),
  setSiteCookieException: (tabId, allow) => ipcRenderer.invoke('browser:set-site-cookie-exception', tabId, allow),
  importBrowserFile: (kind) => ipcRenderer.invoke('browser:import-file', kind),
  tabAction: (tabId, action) => ipcRenderer.invoke('browser:tab-action', tabId, action),
  reopenClosedTab: () => ipcRenderer.invoke('browser:reopen-closed-tab'),
  findInPage: (tabId, text, forward) => ipcRenderer.invoke('browser:find', tabId, text, forward),
  stopFindInPage: (tabId) => ipcRenderer.invoke('browser:stop-find', tabId),
  controlDownload: (downloadId, action) => ipcRenderer.invoke('browser:control-download', downloadId, action),
  setPrivateProxy: (proxy) => ipcRenderer.invoke('browser:private-proxy', proxy),
  closePrivateTabs: () => ipcRenderer.invoke('browser:close-private-tabs'),
  closeTab: (tabId) => ipcRenderer.invoke('browser:close-tab', tabId),
  showTabMenu: (tabId) => ipcRenderer.invoke('browser:show-tab-menu', tabId),
  closeRelatedTabs: (tabId, scope) => ipcRenderer.invoke('browser:close-related-tabs', tabId, scope),
  navigate: (tabId, input) => ipcRenderer.invoke('browser:navigate', tabId, input),
  goBack: (tabId) => ipcRenderer.invoke('browser:back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('browser:forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('browser:reload', tabId),
  stop: (tabId) => ipcRenderer.invoke('browser:stop', tabId),
  hibernateTab: (tabId) => ipcRenderer.invoke('browser:hibernate-tab', tabId),
  wakeTab: (tabId) => ipcRenderer.invoke('browser:wake-tab', tabId),
  samplePerformance: () => ipcRenderer.invoke('browser:sample-performance'),
  toggleBookmark: (tabId) => ipcRenderer.invoke('browser:toggle-bookmark', tabId),
  saveBookmark: (input) => ipcRenderer.invoke('browser:save-bookmark', input),
  removeBookmark: (id) => ipcRenderer.invoke('browser:remove-bookmark', id),
  removeHistoryEntry: (id) => ipcRenderer.invoke('browser:remove-history-entry', id),
  clearBrowsingHistory: () => ipcRenderer.invoke('browser:clear-browsing-history'),
  clearFinishedDownloads: (isPrivate) => ipcRenderer.invoke('browser:clear-finished-downloads', isPrivate),
  queryHistory: (query) => ipcRenderer.invoke('browser:query-history', query),
  getDownloads: () => ipcRenderer.invoke('browser:get-downloads'),
  openDownload: (downloadId) => ipcRenderer.invoke('browser:open-download', downloadId),
  showDownloadInFolder: (downloadId) => ipcRenderer.invoke('browser:show-download-in-folder', downloadId),
  updateSettings: (patch: Partial<BrowserSettings>) => ipcRenderer.invoke('browser:update-settings', patch),
  createWorkspace: (name) => ipcRenderer.invoke('browser:create-workspace', name),
  switchWorkspace: (workspaceId) => ipcRenderer.invoke('browser:switch-workspace', workspaceId),
  listLocalExtensions: () => ipcRenderer.invoke('extensions:list'),
  installLocalExtension: () => ipcRenderer.invoke('extensions:install'),
  removeLocalExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
  getVpnSnapshot: () => ipcRenderer.invoke('vpn:get-snapshot'),
  importVpnConfig: () => ipcRenderer.invoke('vpn:import'),
  clearVpnConfig: () => ipcRenderer.invoke('vpn:clear'),
  clearHistoryAndCookies: () => ipcRenderer.invoke('browser:clear-history-cookies'),
  discoverImportProfiles: () => ipcRenderer.invoke('browser:discover-import-profiles'),
  importBrowserData: (input) => ipcRenderer.invoke('browser:import-data', input),
  getImportedPasswordSummaries: () => ipcRenderer.invoke('browser:get-imported-passwords'),
  deleteSavedPassword: (id) => ipcRenderer.invoke('browser:delete-saved-password', id),
  fillSavedPassword: (tabId, id) => ipcRenderer.invoke('browser:fill-saved-password', tabId, id),
  setChromeBounds: (bounds: ChromeBounds) => ipcRenderer.invoke('browser:set-chrome-bounds', bounds),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onSnapshotChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
    ipcRenderer.on('browser:snapshot', listener);
    return () => ipcRenderer.removeListener('browser:snapshot', listener);
  },
  onTabEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
    ipcRenderer.on('browser:event', listener);
    return () => ipcRenderer.removeListener('browser:event', listener);
  },
};

contextBridge.exposeInMainWorld('browserApi', api);
