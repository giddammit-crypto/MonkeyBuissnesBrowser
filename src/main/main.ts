import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  ipcMain,
  protocol,
} from 'electron';
import type { BrowserApi, ChromeBounds } from '../shared/ipc';
import type { BrowserSettings } from '../shared/types';
import { BrowserController } from './tabs/BrowserController';

// Branding must not silently create a new profile. Test/explicit CLI profiles
// remain authoritative and the installed browser keeps its original user data.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'MonkeyBuissnesBrowser'));
app.setName('SOUL-M8TE');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let controller: BrowserController | undefined;
let appProtocolRegistered = false;
let ipcRegistered = false;

function registerAppProtocol(): void {
  if (appProtocolRegistered) return;
  appProtocolRegistered = true;
  protocol.handle('app', async (request) => {
    const root = path.resolve(__dirname, '../../renderer');
    let filePath: string;
    try {
      const requestUrl = new URL(request.url);
      const relativePath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
      filePath = path.resolve(root, `.${relativePath}`);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const relativeToRoot = path.relative(root, filePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return new Response('Not found', { status: 404 });
    const contentType = filePath.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : filePath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')
            ? 'image/jpeg'
            : filePath.endsWith('.png')
              ? 'image/png'
              : filePath.endsWith('.svg')
                ? 'image/svg+xml'
                : filePath.endsWith('.webp')
                  ? 'image/webp'
              : 'application/octet-stream';
    try {
      return new Response(await fs.promises.readFile(filePath), { headers: { 'content-type': contentType } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function requireShell(event: Electron.IpcMainInvokeEvent): BrowserController {
  if (!controller || (!controller.isTrustedShell(event.sender.id) || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== 'app://shell/index.html')) {
    throw new Error('Untrusted IPC sender');
  }
  return controller;
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle('browser:get-snapshot', (event) => requireShell(event).getSnapshot());
  ipcMain.handle('browser:create-tab', (event, input: { url?: string; isPrivate?: boolean } = {}) =>
    requireShell(event).createTab(input),
  );
  ipcMain.handle('browser:activate-tab', (event, tabId: string) => requireShell(event).activateTab(tabId));
  ipcMain.handle('browser:open-page-externally', (event, tabId: string) => requireShell(event).openCurrentPageExternally(tabId));
  ipcMain.handle('browser:set-site-cookie-exception', (event, tabId: string, allow: boolean) => requireShell(event).setSiteCookieException(tabId, allow));
  ipcMain.handle('browser:import-file', (event, kind: import('../shared/types').ImportFileKind) => requireShell(event).importBrowserFile(kind));
  ipcMain.handle('browser:tab-action', (event, tabId: string, action: import('../shared/ipc').TabAction) => requireShell(event).tabAction(tabId, action));
  ipcMain.handle('browser:reopen-closed-tab', (event) => requireShell(event).reopenClosedTab());
  ipcMain.handle('browser:find', (event, tabId: string, text: string, forward?: boolean) => requireShell(event).findInPage(tabId, text, forward));
  ipcMain.handle('browser:stop-find', (event, tabId: string) => requireShell(event).stopFindInPage(tabId));
  ipcMain.handle('browser:control-download', (event, id: string, action: import('../shared/ipc').DownloadAction) => requireShell(event).controlDownload(id, action));
  ipcMain.handle('browser:private-proxy', (event, proxy: string) => requireShell(event).setPrivateProxy(proxy));
  ipcMain.handle('browser:close-private-tabs', (event) => requireShell(event).closePrivateTabs());
  ipcMain.on('page:form-state', (event, dirty: unknown) => {
    if (event.senderFrame === event.sender.mainFrame && typeof dirty === 'boolean') controller?.markFormState(event.sender.id, dirty);
  });
  ipcMain.handle('browser:close-tab', (event, tabId: string) => requireShell(event).closeTab(tabId));
  ipcMain.handle('browser:show-tab-menu', (event, tabId: string) => requireShell(event).showTabMenu(tabId));
  ipcMain.handle('browser:close-related-tabs', (event, tabId: string, scope: 'others' | 'right' | 'left') => requireShell(event).closeRelatedTabs(tabId, scope));
  ipcMain.handle('browser:navigate', (event, tabId: string, input: string) => requireShell(event).navigate(tabId, input));
  ipcMain.handle('browser:back', (event, tabId: string) => requireShell(event).goBack(tabId));
  ipcMain.handle('browser:forward', (event, tabId: string) => requireShell(event).goForward(tabId));
  ipcMain.handle('browser:reload', (event, tabId: string) => requireShell(event).reload(tabId));
  ipcMain.handle('browser:stop', (event, tabId: string) => requireShell(event).stop(tabId));
  ipcMain.handle('browser:hibernate-tab', (event, tabId: string) => requireShell(event).hibernateTab(tabId));
  ipcMain.handle('browser:wake-tab', (event, tabId: string) => requireShell(event).wakeTab(tabId));
  ipcMain.handle('browser:sample-performance', (event) => requireShell(event).samplePerformance());
  ipcMain.handle('browser:toggle-bookmark', (event, tabId: string) => requireShell(event).toggleBookmark(tabId));
  ipcMain.handle('browser:save-bookmark', (event, input: { id?: string; title: string; url: string }) => requireShell(event).saveBookmark(input));
  ipcMain.handle('browser:remove-bookmark', (event, id: string) => requireShell(event).removeBookmark(id));
  ipcMain.handle('browser:remove-history-entry', (event, id: string) => requireShell(event).removeHistoryEntry(id));
  ipcMain.handle('browser:clear-browsing-history', (event) => requireShell(event).clearBrowsingHistory());
  ipcMain.handle('browser:clear-finished-downloads', (event, isPrivate?: boolean) => requireShell(event).clearFinishedDownloads(isPrivate));
  ipcMain.handle('browser:query-history', (event, query?: string) => requireShell(event).queryHistory(query));
  ipcMain.handle('browser:get-downloads', (event) => requireShell(event).getSnapshot().downloads);
  ipcMain.handle('browser:open-download', (event, downloadId: string) => requireShell(event).openDownload(downloadId));
  ipcMain.handle('browser:show-download-in-folder', (event, downloadId: string) => requireShell(event).showDownloadInFolder(downloadId));
  ipcMain.handle('browser:update-settings', (event, patch: Partial<BrowserSettings>) => requireShell(event).updateSettings(patch));
  ipcMain.handle('browser:create-workspace', (event, name: string) => requireShell(event).createWorkspace(name));
  ipcMain.handle('browser:switch-workspace', (event, workspaceId: string) => requireShell(event).switchWorkspace(workspaceId));
  ipcMain.handle('vpn:get-snapshot', (event) => requireShell(event).getVpnSnapshot());
  ipcMain.handle('vpn:import', (event) => requireShell(event).importVpnConfig());
  ipcMain.handle('vpn:clear', (event) => requireShell(event).clearVpnConfig());
  ipcMain.handle('browser:clear-history-cookies', (event) => requireShell(event).clearHistoryAndCookies());
  ipcMain.handle('browser:discover-import-profiles', (event) => requireShell(event).discoverImportProfiles());
  ipcMain.handle('browser:import-data', (event, input: { profileId: string; data: import('../shared/types').ImportDataKind[] }) => requireShell(event).importBrowserData(input));
  ipcMain.handle('browser:get-imported-passwords', (event) => requireShell(event).getImportedPasswordSummaries());
  ipcMain.handle('browser:delete-saved-password', (event, id: string) => requireShell(event).deleteSavedPassword(id));
  ipcMain.handle('browser:fill-saved-password', (event, tabId: string, id: string) => requireShell(event).fillSavedPassword(tabId, id));
  ipcMain.handle('browser:set-chrome-bounds', (event, bounds: ChromeBounds) => requireShell(event).setChromeBounds(bounds));
  ipcMain.handle('window:minimize', (event) => requireShell(event).minimizeWindow());
  ipcMain.handle('window:toggle-maximize', (event) => requireShell(event).toggleMaximizeWindow());
  ipcMain.handle('window:close', (event) => requireShell(event).closeWindow());
}

async function createApplication(): Promise<void> {
  if (controller?.window && !controller.window.isDestroyed()) {
    controller.window.show();
    return;
  }
  registerAppProtocol();
  controller = new BrowserController();
  controller.setListeners(
    (snapshot) => controller?.shellView?.webContents.send('browser:snapshot', snapshot),
    (event) => controller?.shellView?.webContents.send('browser:event', event),
  );
  registerIpc();
  await controller.createWindow();
}

void app.whenReady().then(createApplication);

app.on('activate', () => {
  void createApplication();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export type { BrowserApi };
