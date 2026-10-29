import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userdata', getAppPath: () => '/mock/app' },
  BaseWindow: class {
    on = vi.fn();
    show = vi.fn();
    setIcon = vi.fn();
    getContentBounds = () => ({ width: 1280, height: 800 });
    contentView = {
      children: [],
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    };
  },
  BrowserWindow: class {},
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template) => ({
      template,
      popup: vi.fn(),
    })),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  nativeTheme: { themeSource: 'dark' },
  session: {
    defaultSession: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setUserAgent: vi.fn(),
      webRequest: {
        onBeforeSendHeaders: vi.fn(),
        onHeadersReceived: vi.fn(),
      },
    },
    fromPartition: vi.fn(() => ({
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setUserAgent: vi.fn(),
      webRequest: {
        onBeforeRequest: vi.fn(),
      },
      cookies: { get: vi.fn(() => Promise.resolve([])) },
    })),
  },
  shell: {},
  WebContentsView: class {
    webContents = {
      id: Math.floor(Math.random() * 100000),
      isDestroyed: () => false,
      setBackgroundThrottling: vi.fn(),
      send: vi.fn(),
      focus: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    setBackgroundColor = vi.fn();
    setBounds = vi.fn();
  },
  safeStorage: {},
}));

import { BrowserController } from '../../src/main/tabs/BrowserController';
import { Menu } from 'electron';

describe('Tab tear-off and multi-window routing', () => {
  beforeEach(() => {
    BrowserController.controllers.clear();
    BrowserController.transferringTabs.clear();
  });

  it('prevents detaching when only 1 tab exists', async () => {
    const controller = Object.create(BrowserController.prototype) as any;
    const tab1 = { id: 'tab-1', url: 'https://example.com', title: 'Example 1' };
    controller.tabs = new Map([['tab-1', tab1]]);
    controller.onDetachTab = vi.fn();

    await controller.detachTabToNewWindow('tab-1', 500, 300);
    expect(controller.onDetachTab).not.toHaveBeenCalled();
  });

  it('invokes onDetachTab when multiple tabs exist', async () => {
    const controller = Object.create(BrowserController.prototype) as any;
    const tab1 = { id: 'tab-1', url: 'https://example.com', title: 'Example 1' };
    const tab2 = { id: 'tab-2', url: 'https://github.com', title: 'GitHub' };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
    ]);
    controller.onDetachTab = vi.fn();

    await controller.detachTabToNewWindow('tab-2', 500, 300);
    expect(controller.onDetachTab).toHaveBeenCalledWith(controller, 'tab-2', 500, 300);
  });

  it('correctly registers and unregisters in BrowserController.controllers', () => {
    const controller = Object.create(BrowserController.prototype) as any;
    controller.tabs = new Map();
    controller.popupWindows = new Set();
    controller.liveDownloads = new Map();
    controller.browsec = { destroy: vi.fn() };
    controller.pageIpcCleanup = [];
    controller.cancelVoodooRequest = vi.fn();
    controller.persistSession = vi.fn();
    controller.persistDownloads = vi.fn();
    controller.shellContentsId = 101;

    BrowserController.controllers.add(controller);
    expect(BrowserController.controllers.has(controller)).toBe(true);

    controller.dispose();
    expect(BrowserController.controllers.has(controller)).toBe(false);
  });

  it('findControllerForShell finds the matching controller', () => {
    const controller1 = Object.create(BrowserController.prototype) as any;
    controller1.shellContentsId = 101;
    controller1.isTrustedShell = (id: number) => id === 101;

    const controller2 = Object.create(BrowserController.prototype) as any;
    controller2.shellContentsId = 102;
    controller2.isTrustedShell = (id: number) => id === 102;

    BrowserController.controllers.add(controller1);
    BrowserController.controllers.add(controller2);

    expect(BrowserController.findControllerForShell(101)).toBe(controller1);
    expect(BrowserController.findControllerForShell(102)).toBe(controller2);
    expect(BrowserController.findControllerForShell(999)).toBeUndefined();
    expect(BrowserController.findControllerForShell(undefined)).toBeUndefined();
  });

  it('findControllerForPage and findTab locate page resources correctly', () => {
    const controller = Object.create(BrowserController.prototype) as any;
    const tab = { id: 't-1', webContentsId: 201, url: 'https://test.com' };
    controller.tabs = new Map([['t-1', tab]]);
    controller.isTrustedPage = (id: number) => id === 201;

    BrowserController.controllers.add(controller);

    expect(BrowserController.findControllerForPage(201)).toBe(controller);
    expect(BrowserController.findControllerForPage(999)).toBeUndefined();
    expect(BrowserController.findTab(201)).toBe(tab);
    expect(BrowserController.findTab(999)).toBeUndefined();
  });

  it('includes "Переместить в новое окно" in showTabMenu and respects tabs.size', () => {
    const controller = Object.create(BrowserController.prototype) as any;
    const tab1 = { id: 'tab-1', url: 'https://example.com', title: 'Example 1', workspaceId: 'personal', isPrivate: false };
    const tab2 = { id: 'tab-2', url: 'https://github.com', title: 'GitHub', workspaceId: 'personal', isPrivate: false };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
    ]);
    controller.window = { isDestroyed: () => false };
    controller.disposed = false;
    controller.closedTabs = [];

    controller.showTabMenu('tab-1');

    const buildCall = (Menu.buildFromTemplate as any).mock.calls.at(-1);
    expect(buildCall).toBeDefined();
    const template = buildCall[0] as Array<{ label?: string; enabled?: boolean }>;
    const moveItem = template.find((item) => item.label === 'Переместить в новое окно');
    expect(moveItem).toBeDefined();
    expect(moveItem?.enabled).toBe(true);

    // When only 1 tab exists
    controller.tabs = new Map([['tab-1', tab1]]);
    controller.showTabMenu('tab-1');
    const singleTabCall = (Menu.buildFromTemplate as any).mock.calls.at(-1);
    const singleTemplate = singleTabCall[0] as Array<{ label?: string; enabled?: boolean }>;
    const singleMoveItem = singleTemplate.find((item) => item.label === 'Переместить в новое окно');
    expect(singleMoveItem?.enabled).toBe(false);
  });

  it('findControllerForTab locates the controller that owns the tab', () => {
    const controller1 = Object.create(BrowserController.prototype) as any;
    controller1.tabs = new Map([['tab-1', { id: 'tab-1' }]]);

    const controller2 = Object.create(BrowserController.prototype) as any;
    controller2.tabs = new Map([['tab-2', { id: 'tab-2' }]]);

    BrowserController.controllers.add(controller1);
    BrowserController.controllers.add(controller2);

    expect(BrowserController.findControllerForTab('tab-1')).toBe(controller1);
    expect(BrowserController.findControllerForTab('tab-2')).toBe(controller2);
    expect(BrowserController.findControllerForTab('tab-999')).toBeUndefined();
    expect(BrowserController.findControllerForTab(undefined)).toBeUndefined();
  });

  it('adoptTabFromController transfers tab and keeps source window open when source has >1 tabs', async () => {
    const controllerA = Object.create(BrowserController.prototype) as any;
    controllerA.tabs = new Map([
      ['tab-A1', { id: 'tab-A1', url: 'https://example.com/a1', title: 'A1', workspaceId: 'personal', isPrivate: false, isPinned: false, isMuted: false }],
      ['tab-A2', { id: 'tab-A2', url: 'https://example.com/a2', title: 'A2', workspaceId: 'personal', isPrivate: false, isPinned: false, isMuted: false }],
    ]);
    controllerA.closeTab = vi.fn(async (id: string) => { controllerA.tabs.delete(id); });
    controllerA.closeWindow = vi.fn();

    const controllerB = Object.create(BrowserController.prototype) as any;
    const tabB1 = { id: 'tab-B1', url: 'https://example.com/b1', title: 'B1', workspaceId: 'personal', isPrivate: false, isPinned: false, isMuted: false };
    controllerB.tabs = new Map([['tab-B1', tabB1]]);
    controllerB.createTab = vi.fn(async (opts) => {
      const created = { id: 'tab-new', url: opts.url, isPrivate: opts.isPrivate, title: 'A1', workspaceId: 'personal' };
      controllerB.tabs.set('tab-new', created);
      return created;
    });
    controllerB.memoryManager = { updateTab: vi.fn() };
    controllerB.emitSnapshot = vi.fn();
    controllerB.persistSession = vi.fn();
    controllerB.window = { isDestroyed: () => false, focus: vi.fn() };

    await controllerB.adoptTabFromController(controllerA, 'tab-A1', 'tab-B1', 'before');

    expect(controllerA.closeTab).toHaveBeenCalledWith('tab-A1');
    expect(controllerA.closeWindow).not.toHaveBeenCalled();
    expect(controllerB.createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/a1',
      isPrivate: false,
      active: true,
    }));
    expect([...controllerB.tabs.keys()]).toEqual(['tab-new', 'tab-B1']);
    expect(controllerB.window.focus).toHaveBeenCalled();
  });

  it('adoptTabFromController transfers tab and closes source window when source has only 1 tab', async () => {
    const controllerA = Object.create(BrowserController.prototype) as any;
    controllerA.tabs = new Map([
      ['tab-A1', { id: 'tab-A1', url: 'https://example.com/sole', title: 'Sole', workspaceId: 'personal', isPrivate: false, isPinned: false, isMuted: false }],
    ]);
    controllerA.closeTab = vi.fn();
    controllerA.closeWindow = vi.fn();

    const controllerB = Object.create(BrowserController.prototype) as any;
    const tabB1 = { id: 'tab-B1', url: 'https://example.com/b1', title: 'B1', workspaceId: 'personal', isPrivate: false, isPinned: false, isMuted: false };
    controllerB.tabs = new Map([['tab-B1', tabB1]]);
    controllerB.createTab = vi.fn(async (opts) => {
      const created = { id: 'tab-new', url: opts.url, isPrivate: opts.isPrivate, title: 'Sole', workspaceId: 'personal' };
      controllerB.tabs.set('tab-new', created);
      return created;
    });
    controllerB.memoryManager = { updateTab: vi.fn() };
    controllerB.emitSnapshot = vi.fn();
    controllerB.persistSession = vi.fn();
    controllerB.window = { isDestroyed: () => false, focus: vi.fn() };

    await controllerB.adoptTabFromController(controllerA, 'tab-A1', 'end');

    expect(controllerA.closeWindow).toHaveBeenCalled();
    expect(controllerA.closeTab).not.toHaveBeenCalled();
    expect(controllerB.createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/sole',
      isPrivate: false,
      active: true,
    }));
    expect([...controllerB.tabs.keys()]).toEqual(['tab-B1', 'tab-new']);
  });

  it('reorderTab delegates to adoptTabFromController when tab belongs to another controller', async () => {
    const controllerA = Object.create(BrowserController.prototype) as any;
    controllerA.tabs = new Map([['tab-A1', { id: 'tab-A1' }]]);

    const controllerB = Object.create(BrowserController.prototype) as any;
    controllerB.tabs = new Map([['tab-B1', { id: 'tab-B1' }]]);
    controllerB.adoptTabFromController = vi.fn();

    BrowserController.controllers.add(controllerA);
    BrowserController.controllers.add(controllerB);

    await controllerB.reorderTab('tab-A1', 'tab-B1', 'after');

    expect(controllerB.adoptTabFromController).toHaveBeenCalledWith(controllerA, 'tab-A1', 'tab-B1', 'after');
  });

  it('prevents detachTabToNewWindow when tab is marked in transferringTabs', async () => {
    const controller = Object.create(BrowserController.prototype) as any;
    controller.tabs = new Map([
      ['tab-1', { id: 'tab-1' }],
      ['tab-2', { id: 'tab-2' }],
    ]);
    controller.onDetachTab = vi.fn();

    BrowserController.transferringTabs.add('tab-1');
    await controller.detachTabToNewWindow('tab-1', 500, 300);
    expect(controller.onDetachTab).not.toHaveBeenCalled();

    BrowserController.transferringTabs.delete('tab-1');
    await controller.detachTabToNewWindow('tab-1', 500, 300);
    expect(controller.onDetachTab).toHaveBeenCalledWith(controller, 'tab-1', 500, 300);
  });
});
