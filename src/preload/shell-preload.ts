import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserApi, ChromeBounds } from '../shared/ipc';
import type { BrowserSettings } from '../shared/types';

const api: BrowserApi = {
  getSnapshot: () => ipcRenderer.invoke('browser:get-snapshot'),
  createTab: (input) => ipcRenderer.invoke('browser:create-tab', input),
  activateTab: (tabId) => ipcRenderer.invoke('browser:activate-tab', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('browser:close-tab', tabId),
  navigate: (tabId, input) => ipcRenderer.invoke('browser:navigate', tabId, input),
  goBack: (tabId) => ipcRenderer.invoke('browser:back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('browser:forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('browser:reload', tabId),
  stop: (tabId) => ipcRenderer.invoke('browser:stop', tabId),
  hibernateTab: (tabId) => ipcRenderer.invoke('browser:hibernate-tab', tabId),
  wakeTab: (tabId) => ipcRenderer.invoke('browser:wake-tab', tabId),
  samplePerformance: () => ipcRenderer.invoke('browser:sample-performance'),
  toggleBookmark: (tabId) => ipcRenderer.invoke('browser:toggle-bookmark', tabId),
  queryHistory: (query) => ipcRenderer.invoke('browser:query-history', query),
  getDownloads: () => ipcRenderer.invoke('browser:get-downloads'),
  openDownload: (downloadId) => ipcRenderer.invoke('browser:open-download', downloadId),
  showDownloadInFolder: (downloadId) => ipcRenderer.invoke('browser:show-download-in-folder', downloadId),
  updateSettings: (patch: Partial<BrowserSettings>) => ipcRenderer.invoke('browser:update-settings', patch),
  createWorkspace: (name) => ipcRenderer.invoke('browser:create-workspace', name),
  switchWorkspace: (workspaceId) => ipcRenderer.invoke('browser:switch-workspace', workspaceId),
  getVpnSnapshot: () => ipcRenderer.invoke('vpn:get-snapshot'),
  importVpnConfig: () => ipcRenderer.invoke('vpn:import'),
  clearVpnConfig: () => ipcRenderer.invoke('vpn:clear'),
  clearHistoryAndCookies: () => ipcRenderer.invoke('browser:clear-history-cookies'),
  discoverImportProfiles: () => ipcRenderer.invoke('browser:discover-import-profiles'),
  importBrowserData: (input) => ipcRenderer.invoke('browser:import-data', input),
  getImportedPasswordSummaries: () => ipcRenderer.invoke('browser:get-imported-passwords'),
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
