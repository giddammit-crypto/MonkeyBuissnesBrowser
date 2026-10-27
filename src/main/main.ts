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
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  app.commandLine.appendSwitch('use-webgpu-adapter', 'opengles');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
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
let applicationPromise: Promise<void> | undefined;

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
  ipcMain.handle('browser:get-privacy-dashboard', (event, tabId?: string) => requireShell(event).getPrivacyDashboard(typeof tabId === 'string' ? tabId : undefined));
  ipcMain.handle('browser:create-tab', (event, input: { url?: string; isPrivate?: boolean } = {}) =>
    requireShell(event).createTab(input),
  );
  ipcMain.handle('browser:activate-tab', (event, tabId: string) => requireShell(event).activateTab(tabId));
  ipcMain.handle('browser:open-page-externally', (event, tabId: string) => requireShell(event).openCurrentPageExternally(tabId));
  ipcMain.handle('browser:set-site-cookie-exception', (event, tabId: string, allow: boolean) => requireShell(event).setSiteCookieException(tabId, allow));
  ipcMain.handle('browser:set-site-notification-permission', (event, tabId: string, decision: 'allow' | 'deny' | 'ask') => requireShell(event).setSiteNotificationPermission(tabId, decision));
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
  ipcMain.handle('browser:reload', (event, tabId: string, ignoreCache?: boolean) => requireShell(event).reload(tabId, ignoreCache));
  ipcMain.handle('browser:stop', (event, tabId: string) => requireShell(event).stop(tabId));
  ipcMain.handle('browser:hibernate-tab', (event, tabId: string) => requireShell(event).hibernateTab(tabId));
  ipcMain.handle('browser:wake-tab', (event, tabId: string) => requireShell(event).wakeTab(tabId));
  ipcMain.handle('browser:sample-performance', (event) => requireShell(event).samplePerformance());
  ipcMain.handle('browser:get-task-manager-metrics', (event) => requireShell(event).getTaskManagerMetrics());
  ipcMain.handle('browser:kill-process', (event, pid: number) => requireShell(event).killProcess(pid));
  ipcMain.handle('browser:toggle-devtools', (event) => requireShell(event).toggleDevTools());
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
  ipcMain.handle('browsec:get-health-status', (event) => requireShell(event).getHealthStatus());
  ipcMain.handle('browsec:trigger-health-check', (event, countryCode?: string) => requireShell(event).triggerManualHealthCheck(countryCode));
  ipcMain.handle('vpn:get-health-status', (event) => requireShell(event).getHealthStatus());
  ipcMain.handle('vpn:trigger-health-check', (event, countryCode?: string) => requireShell(event).triggerManualHealthCheck(countryCode));
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
  ipcMain.handle('browser:reorder-tab', (event, tabId: string, targetTabId: string, position?: 'before' | 'after') => requireShell(event).reorderTab(tabId, targetTabId, position));
  ipcMain.handle('browser:download-media-url', (event, url: string, filename?: string, isAudio?: boolean) => requireShell(event).downloadMediaUrl(url, filename, isAudio));
  ipcMain.handle('browser:delete-download', (event, downloadId: string, deleteFile?: boolean) => requireShell(event).deleteDownload(downloadId, deleteFile));
  ipcMain.handle('browser:retry-download', (event, downloadId: string) => requireShell(event).retryDownload(downloadId));
  ipcMain.on('browser:start-download-drag', (event, downloadId: string) => {
    try {
      requireShell(event).startDownloadDrag(downloadId, event.sender);
    } catch {
      // The drag command is fire-and-forget; ignore calls from non-shell frames.
    }
  });
  ipcMain.handle('browser:add-google-account', (event, email: string, name?: string) => requireShell(event).addGoogleAccount(email, name));
  ipcMain.handle('browser:switch-google-account', (event, accountId: string) => requireShell(event).switchGoogleAccount(accountId));
  ipcMain.handle('browser:remove-google-account', (event, accountId: string) => requireShell(event).removeGoogleAccount(accountId));
  ipcMain.on('page:download-media', (event, data: { url: string; filename?: string; isAudio?: boolean }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id) && data?.url && typeof data.url === 'string' && (data.url.startsWith('https://') || data.url.startsWith('http://'))) {
      controller.downloadMediaUrl(data.url, typeof data.filename === 'string' ? data.filename : undefined, typeof data.isAudio === 'boolean' ? data.isAudio : false, event.sender.id);
    }
  });
  ipcMain.on('page:media-detected', (event, data: { hasVideo?: boolean; hasAudio?: boolean }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id)) controller.markTabHasMedia(event.sender.id, Boolean(data?.hasVideo || data?.hasAudio));
  });
  ipcMain.on('page:video-detected', (event, data: { hasVideo?: boolean }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id)) controller.markTabVideoDetected(event.sender.id, Boolean(data?.hasVideo));
  });
  ipcMain.on('page:pip-changed', (event, data: { isPip?: boolean }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id)) controller.markTabPipChanged(event.sender.id, Boolean(data?.isPip));
  });
  ipcMain.on('page:reader-status', (event, data: { available?: boolean }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id)) controller.markTabReaderStatus(event.sender.id, Boolean(data?.available));
  });
  ipcMain.on('page:audio-stream-captured', (event, data: { url: string; title?: string; artist?: string; filename?: string }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id) && data?.url && typeof data.url === 'string') {
      controller.registerCapturedAudio(
        event.sender.id,
        data.url,
        typeof data.title === 'string' ? data.title : undefined,
        typeof data.artist === 'string' ? data.artist : undefined,
        typeof data.filename === 'string' ? data.filename : undefined,
      );
    }
  });
  ipcMain.on('page:google-account-detected', (event, data: { email: string; name?: string; avatar?: string }) => {
    if (event.senderFrame === event.sender.mainFrame && controller?.isTrustedPage(event.sender.id) && typeof data?.email === 'string' && data.email) {
      controller.registerGoogleAccount(
        data.email,
        typeof data.name === 'string' ? data.name : undefined,
        typeof data.avatar === 'string' ? data.avatar : undefined,
      );
    }
  });
  ipcMain.handle('browser:toggle-reader-mode', (event, tabId: string) => requireShell(event).toggleReaderMode(tabId));
  ipcMain.handle('browser:get-reader-article', (event, tabId: string) => requireShell(event).getReaderArticle(tabId));
  ipcMain.handle('browser:update-reader-settings', (event, patch: Partial<import('../shared/types').ReaderSettings>) => requireShell(event).updateReaderSettings(patch));
  ipcMain.handle('browser:toggle-pip', (event, tabId: string) => requireShell(event).togglePictureInPicture(tabId));
  ipcMain.handle('browser:get-notes', (event, query?: string) => requireShell(event).getNotes(query));
  ipcMain.handle('browser:save-note', (event, input: import('../shared/types').SaveNoteInput) => requireShell(event).saveNote(input));
  ipcMain.handle('browser:delete-note', (event, id: string) => requireShell(event).deleteNote(id));
  ipcMain.handle('browser:toggle-pin-note', (event, id: string) => requireShell(event).togglePinNote(id));
  ipcMain.handle('browser:create-note-from-tab', (event, tabId: string, textSnippet?: string) => requireShell(event).createNoteFromTab(tabId, textSnippet));
  ipcMain.handle('window:minimize', (event) => requireShell(event).minimizeWindow());
  ipcMain.handle('window:toggle-maximize', (event) => requireShell(event).toggleMaximizeWindow());
  ipcMain.handle('window:close', (event) => requireShell(event).closeWindow());
}

async function createApplication(): Promise<void> {
  if (applicationPromise) return applicationPromise;
  applicationPromise = (async () => {
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
  })();
  try {
    await applicationPromise;
  } finally {
    applicationPromise = undefined;
  }
}

void app.whenReady().then(createApplication);

app.on('activate', () => {
  void createApplication();
});

app.on('login', (event, _webContents, _authInfo, _authResponseDetails, callback) => {
  event.preventDefault();
  callback('', '');
});

app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    void controller?.samplePerformance();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export type { BrowserApi };
