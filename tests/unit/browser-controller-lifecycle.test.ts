import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';

function fixture() {
  const view = () => ({
    webContents: { isDestroyed: () => false, setBackgroundThrottling: vi.fn(), send: vi.fn(), focus: vi.fn() },
    setBounds: vi.fn(), setVisible: vi.fn(),
  });
  const shell = view();
  const page = view();
  const children = [shell, page];
  const tab = { id: 'page', view: page, lifecycle: 'active', isInternal: false, isReaderActive: false };
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, {
    tabs: new Map([['page', tab]]), activeTabId: 'page', shellView: shell, disposed: false,
    chromeBounds: { x: 64, y: 140, width: 900, height: 600 }, popoverOpen: false,
    window: {
      isDestroyed: () => false, getContentBounds: () => ({ width: 1000, height: 800 }),
      isFullScreen: () => false, setFullScreen: vi.fn(),
      contentView: {
        children,
        removeChildView: (child: unknown) => { const i = children.indexOf(child as any); if (i >= 0) children.splice(i, 1); },
        addChildView: (child: unknown) => children.push(child as any),
      },
    },
    memoryManager: { canHibernate: vi.fn(() => ({ allowed: true })), markInteraction: vi.fn(), updateTab: vi.fn() },
    popupOpeners: new Map(), popupToTab: new Map(), pipBounds: new Map(),
  });
  return { controller, shell, page, children, tab };
}

describe('BrowserController native view lifecycle', () => {
  it('keeps a shell overlay above native content when renderer bounds change', () => {
    const { controller, shell, page, children } = fixture();
    controller.setPopoverOpen(true);
    expect(children.at(-1)).toBe(shell);
    controller.setChromeBounds({ x: 40, y: 120, width: 600, height: 500 });
    expect(children.at(-1)).toBe(shell);
    controller.setPopoverOpen(false);
    expect(children.at(-1)).toBe(page);
    expect(page.webContents.focus).toHaveBeenCalledOnce();
  });

  it('keeps the reader visible when a dialog closes', () => {
    const { controller, shell, page, children, tab } = fixture();
    tab.isReaderActive = true;
    controller.setPopoverOpen(true);
    controller.setPopoverOpen(false);
    expect(children.at(-1)).toBe(shell);
    expect(children).not.toContain(page);
    expect(page.webContents.focus).not.toHaveBeenCalled();
  });

  it('protects native popup openers and silent picture-in-picture from discarding', async () => {
    const { controller, tab } = fixture();
    controller.activeTabId = 'other';
    controller.popupToTab.set(42, tab.id);
    expect(await controller.hibernateTab(tab.id)).toBe(false);
    controller.popupToTab.clear();
    (tab as any).isPictureInPicture = true;
    expect(await controller.hibernateTab(tab.id)).toBe(false);
    expect(controller.memoryManager.canHibernate).not.toHaveBeenCalled();
  });

  it('fits the floating player within a narrow content area', () => {
    const { controller } = fixture();
    controller.window.getContentBounds = () => ({ width: 360, height: 640 });
    controller.chromeBounds = { x: 40, y: 140, width: 320, height: 500 };
    const bounds = controller.getMiniPipBounds();
    expect(bounds.x).toBeGreaterThanOrEqual(40);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    expect(bounds.width).toBeLessThan(380);
  });

  it('stops paused private media downloads when the private session ends', async () => {
    const { controller } = fixture();
    const privateChild = { kill: vi.fn() };
    const regularChild = { kill: vi.fn() };
    controller.downloads = [{ id: 'private', isPrivate: true }, { id: 'regular', isPrivate: false }];
    controller.liveDownloads = new Map();
    controller.ytDlpProcesses = new Map([
      ['private', { child: privateChild, isPaused: true }],
      ['regular', { child: regularChild, isPaused: false }],
    ]);
    await controller.endPrivateSession();
    expect(privateChild.kill.mock.calls).toEqual([['SIGCONT'], ['SIGTERM']]);
    expect(regularChild.kill).not.toHaveBeenCalled();
    expect(controller.ytDlpProcesses.has('private')).toBe(false);
    expect(controller.downloads).toEqual([{ id: 'regular', isPrivate: false }]);
  });

  it('clears loading, audio and stale error indicators when returning to a new tab', () => {
    const { controller, tab } = fixture();
    Object.assign(tab, { isLoading: true, isAudible: true, favicon: 'old-icon', lastError: { errorCode: -2 } });
    controller.detachView = vi.fn();
    controller.activateTab = vi.fn();
    controller.activateInternalTab(tab);
    expect(tab).toMatchObject({ isLoading: false, isAudible: false, isInternal: true, url: 'browser://newtab' });
    expect((tab as any).favicon).toBeUndefined();
    expect((tab as any).lastError).toBeUndefined();
  });

  it('extracts reader content in the preload isolated world, never the site world', async () => {
    const { controller, page, tab } = fixture();
    const article = { title: 'Article', content: '<p>Body</p>' };
    const executeIsolated = vi.fn().mockResolvedValue(article);
    (page.webContents as any).executeJavaScriptInIsolatedWorld = executeIsolated;
    expect(await controller.getReaderArticle(tab.id)).toBe(article);
    expect(executeIsolated).toHaveBeenCalledWith(999, [expect.objectContaining({ code: expect.stringContaining('__extractReaderArticle') })], true);
  });

  it('moves and resizes only the sending floating player and clamps it inside the window', () => {
    const { controller, tab, page } = fixture();
    Object.assign(tab, { isPictureInPicture: true, webContentsId: 7 });
    controller.activeTabId = 'other';
    controller.updatePictureInPictureLayout(999, { deltaX: 200 });
    expect(page.setBounds).not.toHaveBeenCalled();
    controller.updatePictureInPictureLayout(7, { width: 600, deltaX: -10000, deltaY: 10000 });
    const bounds = page.setBounds.mock.lastCall![0];
    expect(bounds.width).toBe(600);
    expect(bounds.x).toBeGreaterThanOrEqual(64);
    expect(bounds.y).toBeGreaterThanOrEqual(140);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1000);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
    expect(controller.getMiniPipBounds(tab.id)).toEqual(bounds);
  });

  it('ignores stale native PiP exit after transferring playback to the mini player', () => {
    const { controller, tab } = fixture();
    Object.assign(tab, { isPictureInPicture: true, webContentsId: 7, pipMode: 'mini' });
    controller.markTabPipChanged(7, false, 'native');
    expect((tab as any).isPictureInPicture).toBe(true);
  });

  it('does not claim PiP success for a page without a playable video', async () => {
    const { controller, page, tab } = fixture();
    (page.webContents as any).executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue(false);
    expect(await controller.togglePictureInPicture(tab.id)).toEqual({ success: false, isPip: false });
    expect((tab as any).isPictureInPicture).toBeUndefined();
  });

  it('uses F11 for fullscreen while preserving F12 for developer tools', () => {
    const { controller } = fixture();
    let handler: any;
    controller.toggleDevTools = vi.fn();
    controller.installShortcuts({ id: 1, on: (_name: string, listener: any) => { handler = listener; } });
    const event = { preventDefault: vi.fn() };
    handler(event, { type: 'keyDown', key: 'F11' });
    expect(controller.window.setFullScreen).toHaveBeenCalledWith(true);
    expect(controller.toggleDevTools).not.toHaveBeenCalled();
    handler(event, { type: 'keyDown', key: 'F12' });
    expect(controller.toggleDevTools).toHaveBeenCalledOnce();
  });

  it('exits fullscreen on Escape keydown when window is full screen', () => {
    const { controller } = fixture();
    let handler: any;
    controller.window.isFullScreen = () => true;
    controller.installShortcuts({ id: 1, on: (_name: string, listener: any) => { handler = listener; } });
    const event = { preventDefault: vi.fn() };
    handler(event, { type: 'keyDown', key: 'Escape' });
    expect(controller.window.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('expands active tab to full window bounds in fullscreen mode', () => {
    const { controller, page, tab } = fixture();
    controller.window.isFullScreen = () => true;
    controller.applyBounds(tab);
    expect(page.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('exitFullScreenIfActive exits full screen only when active', () => {
    const { controller } = fixture();
    controller.window.isFullScreen = () => true;
    controller.exitFullScreenIfActive();
    expect(controller.window.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('updates tab zoom factor with Chrome zoom steps on tabAction', async () => {
    const { controller, page, tab } = fixture();
    page.webContents.getZoomFactor = vi.fn(() => 1.0);
    page.webContents.setZoomFactor = vi.fn();
    controller.emitSnapshot = vi.fn();

    expect(controller.getActiveTab()).toBe(tab);

    // Zoom in from 1.0 -> 1.10
    await controller.tabAction('page', 'zoom-in');
    expect(page.webContents.setZoomFactor).toHaveBeenCalledWith(1.10);
    expect(tab.zoomFactor).toBe(1.10);

    // Zoom in again -> 1.25
    await controller.tabAction('page', 'zoom-in');
    expect(page.webContents.setZoomFactor).toHaveBeenCalledWith(1.25);
    expect(tab.zoomFactor).toBe(1.25);

    // Zoom out -> 1.10
    await controller.tabAction('page', 'zoom-out');
    expect(page.webContents.setZoomFactor).toHaveBeenCalledWith(1.10);
    expect(tab.zoomFactor).toBe(1.10);

    // Zoom reset -> 1.00
    await controller.tabAction('page', 'zoom-reset');
    expect(page.webContents.setZoomFactor).toHaveBeenCalledWith(1.00);
    expect(tab.zoomFactor).toBe(1.00);
  });

  it('manages credential saving, revealing, filtering and never-save origins', async () => {
    const { controller, shell } = fixture();
    const mockPasswords = {
      save: vi.fn((origin: string, username: string, password: string) => ({ id: 'pass-1', updated: false })),
      getSecret: vi.fn((id: string) => (id === 'pass-1' ? 'secret-pass' : null)),
      summaries: vi.fn(() => [
        { id: 'pass-1', origin: 'https://vk.com', username: 'durov', browser: 'soulm8te', importedAt: 123456 },
        { id: 'pass-2', origin: 'https://other.com', username: 'alice', browser: 'soulm8te', importedAt: 123456 },
      ]),
    };
    controller.passwords = mockPasswords;
    controller.neverSaveOrigins = new Set<string>();
    controller.emitSnapshot = vi.fn();

    // 1. saveCredential
    const saveRes = await controller.saveCredential('https://vk.com', 'durov', 'secret-pass');
    expect(saveRes).toEqual({ success: true, id: 'pass-1', updated: false });
    expect(mockPasswords.save).toHaveBeenCalledWith('https://vk.com', 'durov', 'secret-pass');
    expect(shell.webContents.send).toHaveBeenCalledWith('browser:event', { type: 'passwords-changed' });
    expect(controller.emitSnapshot).toHaveBeenCalledOnce();

    // 2. revealSavedPassword
    const secret = await controller.revealSavedPassword('pass-1');
    expect(secret).toBe('secret-pass');
    expect(mockPasswords.getSecret).toHaveBeenCalledWith('pass-1');

    // 3. getSavedCredentialsForOrigin
    const originCredentials = await controller.getSavedCredentialsForOrigin('https://vk.com');
    expect(originCredentials).toHaveLength(1);
    expect(originCredentials[0].id).toBe('pass-1');

    // 4. neverSavePasswordForOrigin
    await controller.neverSavePasswordForOrigin('https://bank.com');
    expect(controller.neverSaveOrigins.has('https://bank.com')).toBe(true);
  });
});

