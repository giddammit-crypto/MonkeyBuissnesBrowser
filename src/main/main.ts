import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  ipcMain,
  nativeTheme,
  protocol,
  screen,
} from 'electron';
import type { BrowserApi, ChromeBounds } from '../shared/ipc';
import type { BrowserSettings } from '../shared/types';
import { getChromeUserAgent } from '../shared/chromiumIdentity';
import { BrowserController } from './tabs/BrowserController';
import { registerSingleInstance } from './services/SingleInstance';

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
  app.commandLine.appendSwitch('disable-features', 'Vulkan,WaylandVulkan');
  app.commandLine.appendSwitch('disable-vulkan-fallback');
  app.commandLine.appendSwitch('use-webgpu-adapter', 'opengles');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

app.on('certificate-error', (event, _webContents, _url, error, certificate, callback) => {
  const isAuthorityOrRevocation = error === 'net::ERR_CERT_AUTHORITY_INVALID' || error === 'net::ERR_CERT_UNABLE_TO_CHECK_REVOCATION';
  if (isAuthorityOrRevocation && certificate) {
    const nowSec = Date.now() / 1000;
    if (certificate.validStart && certificate.validExpiry && (nowSec < certificate.validStart || nowSec > certificate.validExpiry)) {
      callback(false);
      return;
    }
    let currentCert: Electron.Certificate | undefined = certificate;
    while (currentCert) {
      const issuer = (currentCert.issuerName || '').toLowerCase();
      if (
        issuer.includes('russian trusted') ||
        issuer.includes('минцифры') ||
        issuer.includes('ministry of digital development') ||
        issuer.includes('национальный удостоверяющий центр') ||
        issuer.includes('госуслуги') ||
        issuer.includes('минкомсвязь') ||
        issuer.includes('sber ca') ||
        issuer.includes('sberbank ca')
      ) {
        event.preventDefault();
        callback(true);
        return;
      }
      currentCert = currentCert.issuerCert;
    }
  }
  callback(false);
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let primaryController: BrowserController | undefined;
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
  const frameUrl = event.senderFrame?.url || '';
  const isAppShell = frameUrl === 'app://shell/index.html' || frameUrl.startsWith('app://shell/index.html?');
  const matched = BrowserController.findControllerForShell(event.sender.id);
  if (!matched || event.senderFrame !== event.sender.mainFrame || !isAppShell) {
    throw new Error('Untrusted IPC sender');
  }
  return matched;
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
  ipcMain.handle('page:get-adblock-policy', (event) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame !== event.sender.mainFrame || !c) return false;
    return c.getPageAdBlockPolicy(event.sender.id);
  });
  ipcMain.handle('page:get-autofill-credentials', (event, data: { origin: string; hostname?: string }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame !== event.sender.mainFrame || !c) return [];
    return c.getPageAutofillCredentials(event.sender.id, data);
  });
  ipcMain.on('page:form-state', (event, dirty: unknown) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && typeof dirty === 'boolean') c?.markFormState(event.sender.id, dirty);
  });
  ipcMain.handle('browser:close-tab', (event, tabId: string) => requireShell(event).closeTab(tabId));
  ipcMain.handle('browser:detach-tab', async (event, tabId: string, screenX: number, screenY: number) => {
    const source = requireShell(event);
    await source.detachTabToNewWindow(tabId, screenX, screenY);
  });
  ipcMain.handle('browser:set-split-view', (event, tabId?: string) => requireShell(event).setSplitView(tabId));
  ipcMain.handle('browser:set-split-view-ratio', (event, ratio: number) => requireShell(event).setSplitViewRatio(ratio));
  ipcMain.handle('browser:export-bookmarks', (event) => requireShell(event).exportBookmarks());
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
  ipcMain.handle('browser:get-storage-metrics', (event) => requireShell(event).getStorageMetrics());
  ipcMain.handle('browser:execute-clean', (event, options: import('../shared/types').CleanTargetOptions) => requireShell(event).executeClean(options));
  ipcMain.handle('browser:discover-import-profiles', (event) => requireShell(event).discoverImportProfiles());
  ipcMain.handle('browser:import-data', (event, input: { profileId: string; data: import('../shared/types').ImportDataKind[] }) => requireShell(event).importBrowserData(input));
  ipcMain.handle('browser:get-imported-passwords', (event) => requireShell(event).getImportedPasswordSummaries());
  ipcMain.handle('browser:delete-saved-password', (event, id: string) => requireShell(event).deleteSavedPassword(id));
  ipcMain.handle('browser:fill-saved-password', (event, tabId: string, id: string) => requireShell(event).fillSavedPassword(tabId, id));
  ipcMain.handle('browser:save-credential', (event, origin: string, username: string, password: string) => requireShell(event).saveCredential(origin, username, password));
  ipcMain.handle('browser:reveal-password', (event, passwordId: string) => requireShell(event).revealSavedPassword(passwordId));
  ipcMain.handle('browser:get-saved-credentials-for-origin', (event, origin: string) => requireShell(event).getSavedCredentialsForOrigin(origin));
  ipcMain.handle('browser:never-save-origin', (event, origin: string) => requireShell(event).neverSavePasswordForOrigin(origin));
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
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c && data?.url && typeof data.url === 'string' && (data.url.startsWith('https://') || data.url.startsWith('http://'))) {
      c.downloadMediaUrl(data.url, typeof data.filename === 'string' ? data.filename : undefined, typeof data.isAudio === 'boolean' ? data.isAudio : false, event.sender.id);
    }
  });
  ipcMain.on('page:media-detected', (event, data: { hasVideo?: boolean; hasAudio?: boolean }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c) c.markTabHasMedia(event.sender.id, Boolean(data?.hasVideo || data?.hasAudio));
  });
  ipcMain.on('page:video-detected', (event, data: { hasVideo?: boolean }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (c) c.markTabVideoDetected(event.sender.id, Boolean(data?.hasVideo));
  });
  ipcMain.on('page:pip-changed', (event, data: { isPip?: boolean; source?: 'native' | 'mini' }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (c) c.markTabPipChanged(event.sender.id, Boolean(data?.isPip), data?.source === 'native' ? 'native' : 'mini');
  });
  ipcMain.on('page:pip-layout', (event, patch: { deltaX?: number; deltaY?: number; width?: number }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c) c.updatePictureInPictureLayout(event.sender.id, patch);
  });
  ipcMain.on('page:request-activate-tab', (event, tabId?: string) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (typeof tabId === 'string' && tabId && c
      && event.senderFrame === event.sender.mainFrame && c.tabs.get(tabId)?.webContentsId === event.sender.id) {
      c.activateTab(tabId);
    }
  });
  ipcMain.on('page:exit-fullscreen', (event) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (c) c.exitFullScreenIfActive();
  });
  ipcMain.on('page:reader-status', (event, data: { available?: boolean }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c) c.markTabReaderStatus(event.sender.id, Boolean(data?.available));
  });
  ipcMain.on('page:audio-stream-captured', (event, data: { url: string; title?: string; artist?: string; filename?: string }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c && data?.url && typeof data.url === 'string') {
      c.registerCapturedAudio(
        event.sender.id,
        data.url,
        typeof data.title === 'string' ? data.title : undefined,
        typeof data.artist === 'string' ? data.artist : undefined,
        typeof data.filename === 'string' ? data.filename : undefined,
      );
    }
  });
  ipcMain.on('page:google-account-detected', (event, data: { email: string; name?: string; avatar?: string }) => {
    const c = BrowserController.findControllerForPage(event.sender.id);
    if (event.senderFrame === event.sender.mainFrame && c && typeof data?.email === 'string' && data.email) {
      c.registerGoogleAccount(
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
  ipcMain.handle('browser:voodoo-cancel', (event) => requireShell(event).cancelVoodooRequest());
  ipcMain.handle('browser:voodoo-message', (event, messages, tabContext) => requireShell(event).sendVoodooMessage(messages, tabContext));
  ipcMain.handle('browser:voodoo-test-key', (event, key: string) => requireShell(event).testVoodooKey(key));
  ipcMain.handle('browser:voodoo-check-all-keys', (event) => requireShell(event).checkAllVoodooKeys());
  ipcMain.handle('browser:voodoo-get-keys-status', (event) => requireShell(event).getVoodooKeysStatus());
  ipcMain.handle('browser:transcribe-audio', (event, audioBase64: string, mimeType?: string) => requireShell(event).transcribeAudio(audioBase64, mimeType));
  ipcMain.handle('browser:open-path', (event, targetPath: string) => requireShell(event).openPath(targetPath));
  ipcMain.handle('browser:voodoo-extract-chat', (event) => requireShell(event).extractActiveTabChatContext());
  ipcMain.handle('browser:voodoo-insert-text', (event, text: string) => requireShell(event).insertTextIntoActiveTab(text));
  ipcMain.handle('browser:set-voodoo-open', (event, open: boolean) => requireShell(event).setVoodooOpen(open));
  ipcMain.handle('browser:move-voodoo', (event, deltaX: number, deltaY: number) => requireShell(event).moveVoodoo(deltaX, deltaY));
  ipcMain.handle('browser:resize-voodoo', (event, width: number, height: number, deltaX?: number, deltaY?: number) => requireShell(event).resizeVoodoo(width, height, deltaX, deltaY));
  ipcMain.handle('browser:reset-voodoo-position', (event) => requireShell(event).resetVoodooPosition());
  ipcMain.handle('browser:check-for-updates', (event, manual?: boolean) => requireShell(event).checkForUpdates(manual));
  ipcMain.handle('browser:download-update', (event, assetUrl?: string, customFilename?: string) => requireShell(event).downloadUpdate(assetUrl, customFilename));
  ipcMain.handle('browser:open-downloaded-update', (event, filePath: string) => requireShell(event).openDownloadedUpdate(filePath));
  ipcMain.handle('browser:get-update-status', (event) => requireShell(event).getUpdateStatus());
  ipcMain.handle('window:minimize', (event) => requireShell(event).minimizeWindow());
  ipcMain.handle('window:toggle-maximize', (event) => requireShell(event).toggleMaximizeWindow());
  ipcMain.handle('window:toggle-fullscreen', (event) => requireShell(event).toggleFullScreen());
  ipcMain.handle('window:close', (event) => requireShell(event).closeWindow());
}

function setupController(c: BrowserController): void {
  if (!primaryController) primaryController = c;
  c.setListeners(
    (snapshot) => {
      c.shellView?.webContents.send('browser:snapshot', snapshot);
      c.voodooView?.webContents.send('browser:snapshot', snapshot);
    },
    (event) => {
      c.shellView?.webContents.send('browser:event', event);
      c.voodooView?.webContents.send('browser:event', event);
    },
  );
  c.onFocus = () => {
    primaryController = c;
  };
  c.onClosed = () => {
    if (primaryController === c) {
      primaryController = BrowserController.controllers.values().next().value;
    }
  };
  c.onDetachTab = async (source, tabId, screenX, screenY) => {
    await detachTabToNewWindow(source, tabId, screenX, screenY);
  };
}

async function detachTabToNewWindow(
  source: BrowserController,
  tabId: string,
  screenX?: number,
  screenY?: number,
): Promise<void> {
  const tab = source.tabs.get(tabId);
  if (!tab || source.tabs.size <= 1) return;

  const tabData = {
    url: tab.url,
    title: tab.title,
    isPrivate: tab.isPrivate,
    isPinned: tab.isPinned,
    isMuted: tab.isMuted,
    workspaceId: tab.workspaceId,
  };

  await source.closeTab(tabId);

  const sourceBounds = source.window && !source.window.isDestroyed()
    ? source.window.getBounds()
    : { x: 100, y: 100, width: 1280, height: 800 };

  let targetX = sourceBounds.x + 40;
  let targetY = sourceBounds.y + 40;
  const targetWidth = sourceBounds.width || 1280;
  const targetHeight = sourceBounds.height || 800;

  if (typeof screenX === 'number' && typeof screenY === 'number' && (screenX !== 0 || screenY !== 0)) {
    try {
      const point = { x: Math.round(screenX), y: Math.round(screenY) };
      const display = screen.getDisplayNearestPoint(point);
      const workArea = display.workArea;
      targetX = Math.round(screenX - 150);
      targetY = Math.round(screenY - 20);
      if (targetX + targetWidth > workArea.x + workArea.width) {
        targetX = workArea.x + workArea.width - targetWidth;
      }
      if (targetX < workArea.x) targetX = workArea.x;
      if (targetY + targetHeight > workArea.y + workArea.height) {
        targetY = workArea.y + workArea.height - targetHeight;
      }
      if (targetY < workArea.y) targetY = workArea.y;
    } catch {
      targetX = sourceBounds.x + 40;
      targetY = sourceBounds.y + 40;
    }
  }

  const newController = new BrowserController();
  setupController(newController);
  await newController.createWindow({
    bounds: {
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: targetHeight,
    },
    initialTab: tabData,
  });
  if (newController.window && !newController.window.isDestroyed()) {
    newController.window.focus();
  }
}

async function createApplication(): Promise<void> {
  if (applicationPromise) return applicationPromise;
  applicationPromise = (async () => {
    if (primaryController?.window && !primaryController.window.isDestroyed()) {
      primaryController.window.show();
      return;
    }
    registerAppProtocol();
    registerIpc();
    const initialController = new BrowserController();
    setupController(initialController);
    await initialController.createWindow();
  })();
  try {
    await applicationPromise;
  } finally {
    applicationPromise = undefined;
  }
}

async function showApplication(): Promise<void> {
  await app.whenReady();
  await createApplication();
  const window = primaryController?.window;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

if (registerSingleInstance(app, showApplication)) {
  void showApplication().catch((error) => console.error('Unable to start browser:', error));
  app.on('activate', () => {
    void showApplication().catch((error) => console.error('Unable to activate browser:', error));
  });
}

app.on('login', (event, _webContents, _authInfo, _authResponseDetails, callback) => {
  event.preventDefault();
  callback('', '');
});

app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    for (const c of BrowserController.controllers) {
      void c.samplePerformance();
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export type { BrowserApi };
