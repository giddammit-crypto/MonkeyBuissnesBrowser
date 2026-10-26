import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  ipcMain,
  nativeTheme,
  protocol,
} from 'electron';
import type { BrowserApi, ChromeBounds } from '../shared/ipc';
import type { BrowserSettings } from '../shared/types';
import { getChromeUserAgent } from '../shared/chromiumIdentity';
import { BrowserController } from './tabs/BrowserController';

// Branding must not silently create a new profile. Test/explicit CLI profiles
// remain authoritative and the installed browser keeps its original user data.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const soulDir = path.join(app.getPath('appData'), 'soulm8te');
  const legacyDir = path.join(app.getPath('appData'), 'MonkeyBuissnesBrowser');
  app.setPath('userData', fs.existsSync(legacyDir) && !fs.existsSync(soulDir) ? legacyDir : soulDir);
}
app.setName('soulm8te');
app.setAppUserModelId('soulm8te');
app.userAgentFallback = getChromeUserAgent();
nativeTheme.themeSource = 'dark';
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

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
  ipcMain.handle('browser:set-site-adblock-enabled', (event, tabId: string, enabled: boolean) => requireShell(event).setSiteAdBlockEnabled(tabId, enabled));
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
  ipcMain.handle('browser:delete-workspace', (event, workspaceId: string) => requireShell(event).deleteWorkspace(workspaceId));
  ipcMain.handle('extensions:list', event => requireShell(event).listLocalExtensions());
  ipcMain.handle('extensions:install', event => requireShell(event).installLocalExtension());
  ipcMain.handle('extensions:remove', (event, id: string) => requireShell(event).removeLocalExtension(id));
  ipcMain.handle('vpn:get-snapshot', (event) => requireShell(event).getVpnSnapshot());
  ipcMain.handle('vpn:import', (event) => requireShell(event).importVpnConfig());
  ipcMain.handle('vpn:clear', (event) => requireShell(event).clearVpnConfig());
  ipcMain.handle('browsec:get-snapshot', (event) => requireShell(event).getBrowsecSnapshot());
  ipcMain.handle('browsec:get-countries', (event) => requireShell(event).getBrowsecCountries());
  ipcMain.handle('browsec:toggle', (event, enabled?: boolean) => requireShell(event).toggleBrowsec(enabled));
  ipcMain.handle('browsec:set-country', (event, code: string) => requireShell(event).setBrowsecCountry(code));
  ipcMain.handle('browsec:set-webrtc-leak-protection', (event, enabled: boolean) => requireShell(event).setBrowsecWebRtcLeakProtection(enabled));
  ipcMain.handle('browsec:add-smart-rule', (event, domain: string, country: string) => requireShell(event).addBrowsecSmartRule(domain, country));
  ipcMain.handle('browsec:remove-smart-rule', (event, domain: string) => requireShell(event).removeBrowsecSmartRule(domain));
  ipcMain.handle('browsec:toggle-smart-rule', (event, domain: string) => requireShell(event).toggleBrowsecSmartRule(domain));
  ipcMain.handle('browsec:update', (event, patch: Partial<import('../shared/types').BrowsecState>) => requireShell(event).updateBrowsec(patch));
  ipcMain.handle('browser:clear-history-cookies', (event) => requireShell(event).clearHistoryAndCookies());
  ipcMain.handle('browser:discover-import-profiles', (event) => requireShell(event).discoverImportProfiles());
  ipcMain.handle('browser:import-data', (event, input: { profileId: string; data: import('../shared/types').ImportDataKind[] }) => requireShell(event).importBrowserData(input));
  ipcMain.handle('browser:get-imported-passwords', (event) => requireShell(event).getImportedPasswordSummaries());
  ipcMain.handle('browser:delete-saved-password', (event, id: string) => requireShell(event).deleteSavedPassword(id));
  ipcMain.handle('browser:fill-saved-password', (event, tabId: string, id: string) => requireShell(event).fillSavedPassword(tabId, id));
  ipcMain.handle('browser:set-chrome-bounds', (event, bounds: ChromeBounds) => requireShell(event).setChromeBounds(bounds));
  ipcMain.handle('browser:set-popover-open', (event, open: boolean) => requireShell(event).setPopoverOpen(open));
  ipcMain.handle('browser:reorder-tab', (event, tabId: string, targetTabId: string) => requireShell(event).reorderTab(tabId, targetTabId));
  ipcMain.handle('browser:download-media-url', (event, url: string, filename?: string, isAudio?: boolean) => requireShell(event).downloadMediaUrl(url, filename, isAudio));
  ipcMain.handle('browser:delete-download', (event, downloadId: string, deleteFile?: boolean) => requireShell(event).deleteDownload(downloadId, deleteFile));
  ipcMain.handle('browser:add-google-account', (event, email: string, name?: string) => requireShell(event).addGoogleAccount(email, name));
  ipcMain.handle('browser:switch-google-account', (event, accountId: string) => requireShell(event).switchGoogleAccount(accountId));
  ipcMain.handle('browser:remove-google-account', (event, accountId: string) => requireShell(event).removeGoogleAccount(accountId));
  ipcMain.on('page:download-media', (event, data: { url: string; filename?: string; isAudio?: boolean }) => {
    if (data?.url && typeof data.url === 'string' && (data.url.startsWith('https://') || data.url.startsWith('http://'))) {
      controller?.downloadMediaUrl(data.url, data.filename, data.isAudio);
    }
  });
  ipcMain.on('page:media-detected', (event, data: { hasVideo?: boolean; hasAudio?: boolean }) => {
    controller?.markTabHasMedia(event.sender.id, Boolean(data?.hasVideo || data?.hasAudio));
  });
  ipcMain.on('page:audio-stream-captured', (event, data: { url: string; title?: string; artist?: string; filename?: string }) => {
    if (data?.url && typeof data.url === 'string') {
      controller?.registerCapturedAudio(event.sender.id, data.url, data.title, data.artist, data.filename);
    }
  });
  ipcMain.on('page:google-account-detected', (_event, data: { email: string; name?: string; avatar?: string }) => {
    if (data?.email) {
      controller?.registerGoogleAccount(data.email, data.name, data.avatar);
    }
  });
  ipcMain.on('page:get-theme', (event) => {
    const settings = controller?.stores.settings.get();
    const bg = settings?.newTabBackground ?? 'portrait';
    let appearance = settings?.appearancePreset ?? 'classic';
    if (!appearance || appearance === 'classic') {
      if (bg === 'cyberpink') appearance = 'cyberpink';
      else if (bg === 'cyberpink-fuji') appearance = 'cyberpink-fuji';
      else if (bg === 'cyber-butterfly') appearance = 'cyber-butterfly';
      else if (bg === 'tokyo-night') appearance = 'tokyo-night';
      else if (bg === 'celestial-palace') appearance = 'celestial-palace';
      else if (bg === 'portrait') appearance = 'detroit';
    }
    event.returnValue = {
      theme: settings?.theme ?? 'dark',
      wallpaper: bg,
      appearance,
      accent: settings?.accentColor ?? (
        bg === 'cyberpink' ? 'pink'
        : bg === 'cyberpink-fuji' ? 'violet'
        : bg === 'cyber-butterfly' ? 'violet'
        : bg === 'tokyo-night' ? 'blue'
        : bg === 'celestial-palace' ? 'teal'
        : 'blue'
      ),
    };
  });
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

app.on('login', (event, _webContents, _authInfo, _authResponseDetails, callback) => {
  event.preventDefault();
  callback('', '');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export type { BrowserApi };
