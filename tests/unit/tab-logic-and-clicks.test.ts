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

describe('Tab logic, activation and close fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockController() {
    const controller = Object.create(BrowserController.prototype) as any;
    controller.tabs = new Map();
    controller.closedTabs = [];
    controller.findQueries = new Map();
    controller.pipBounds = new Map();
    controller.popupOpeners = new Map();
    controller.popupToTab = new Map();
    controller.popupWindows = new Set();
    controller.memoryManager = {
      removeTab: vi.fn(),
      updateTab: vi.fn(),
      canHibernate: () => ({ allowed: true }),
    };
    controller.detachView = vi.fn();
    controller.endPrivateSession = vi.fn();
    controller.createTab = vi.fn();
    controller.emitSnapshot = vi.fn();
    controller.activeTabId = '';
    controller.activeWorkspaceId = 'personal';
    controller.mruTabIds = [];
    controller.window = {
      isDestroyed: () => false,
      contentView: { children: [], removeChildView: vi.fn(), addChildView: vi.fn() },
    };
    return controller;
  }

  it('closeTab switches to right adjacent peer tab when active tab is closed', async () => {
    const controller = createMockController();
    const tab1 = { id: 'tab-1', url: 'https://site1.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab2 = { id: 'tab-2', url: 'https://site2.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab3 = { id: 'tab-3', url: 'https://site3.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
      ['tab-3', tab3],
    ]);
    controller.activeTabId = 'tab-2';
    controller.activateTab = vi.fn((id: string) => { controller.activeTabId = id; });

    await controller.closeTab('tab-2');

    expect(controller.tabs.has('tab-2')).toBe(false);
    // Tab 3 was to the right of Tab 2 in the tab strip
    expect(controller.activateTab).toHaveBeenCalledWith('tab-3');
  });

  it('closeTab switches to left adjacent peer tab when rightmost active tab is closed', async () => {
    const controller = createMockController();
    const tab1 = { id: 'tab-1', url: 'https://site1.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab2 = { id: 'tab-2', url: 'https://site2.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab3 = { id: 'tab-3', url: 'https://site3.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
      ['tab-3', tab3],
    ]);
    controller.activeTabId = 'tab-3';
    controller.activateTab = vi.fn((id: string) => { controller.activeTabId = id; });

    await controller.closeTab('tab-3');

    expect(controller.tabs.has('tab-3')).toBe(false);
    // Tab 3 was the rightmost tab, so left tab (Tab 2) becomes active
    expect(controller.activateTab).toHaveBeenCalledWith('tab-2');
  });

  it('closeTab prioritizes opener tab when active tab was opened by another tab', async () => {
    const controller = createMockController();
    const tab1 = { id: 'tab-1', url: 'https://site1.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab2 = { id: 'tab-2', url: 'https://site2.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab3 = { id: 'tab-3', url: 'https://site3.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
      ['tab-3', tab3],
    ]);
    // tab-3 was opened from tab-1
    controller.popupOpeners.set('tab-3', 'tab-1');
    controller.activeTabId = 'tab-3';
    controller.activateTab = vi.fn((id: string) => { controller.activeTabId = id; });

    await controller.closeTab('tab-3');

    expect(controller.tabs.has('tab-3')).toBe(false);
    expect(controller.activateTab).toHaveBeenCalledWith('tab-1');
  });

  it('closeTab falls back to MRU tab when adjacent peer tab calculation is unavailable', async () => {
    const controller = createMockController();
    const tab1 = { id: 'tab-1', url: 'https://site1.test', workspaceId: 'personal', isPrivate: false, isPinned: false };
    const tab2 = { id: 'tab-2', url: 'https://site2.test', workspaceId: 'work', isPrivate: false, isPinned: false };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
    ]);
    controller.activeTabId = 'tab-2';
    controller.mruTabIds = ['tab-2', 'tab-1'];
    controller.activateTab = vi.fn((id: string) => { controller.activeTabId = id; });

    await controller.closeTab('tab-2');

    expect(controller.tabs.has('tab-2')).toBe(false);
    expect(controller.activateTab).toHaveBeenCalledWith('tab-1');
  });

  it('showTabStripContextMenu displays New Tab and Reopen Closed Tab', () => {
    const controller = createMockController();
    controller.closedTabs = [{ url: 'https://closed.test', workspaceId: 'personal', isPinned: false, isMuted: false }];
    controller.tabs = new Map([
      ['tab-1', { id: 'tab-1', url: 'https://example.com', workspaceId: 'personal', isPrivate: false }],
    ]);

    controller.showTabStripContextMenu();

    expect(Menu.buildFromTemplate).toHaveBeenCalled();
    const template = (Menu.buildFromTemplate as any).mock.calls[0][0];
    const newTabItem = template.find((item: any) => item.label === 'Новая вкладка');
    const reopenItem = template.find((item: any) => item.label === 'Открыть закрытую вкладку');
    expect(newTabItem).toBeDefined();
    expect(reopenItem).toBeDefined();
    expect(reopenItem.enabled).toBe(true);
  });

  it('tabAction with mute-others mutes all peer tabs', async () => {
    const controller = createMockController();
    const setMutedMock1 = vi.fn();
    const setMutedMock2 = vi.fn();
    const setMutedMock3 = vi.fn();
    const tab1 = { id: 'tab-1', isMuted: false, view: { webContents: { setAudioMuted: setMutedMock1 } } };
    const tab2 = { id: 'tab-2', isMuted: false, view: { webContents: { setAudioMuted: setMutedMock2 } } };
    const tab3 = { id: 'tab-3', isMuted: false, view: { webContents: { setAudioMuted: setMutedMock3 } } };
    controller.tabs = new Map([
      ['tab-1', tab1],
      ['tab-2', tab2],
      ['tab-3', tab3],
    ]);

    await controller.tabAction('tab-1', 'mute-others');

    expect(tab1.isMuted).toBe(false);
    expect(tab2.isMuted).toBe(true);
    expect(tab3.isMuted).toBe(true);
    expect(setMutedMock2).toHaveBeenCalledWith(true);
    expect(setMutedMock3).toHaveBeenCalledWith(true);
    expect(setMutedMock1).not.toHaveBeenCalled();
  });

  it('voodooEnabled = false prevents toggleVoodoo and setVoodooOpen', () => {
    const controller = createMockController();
    controller.voodooOpen = false;
    controller.stores = {
      settings: {
        get: () => ({ voodooEnabled: false, voodooBubbleVisible: false }),
        set: vi.fn(),
      },
    };
    controller.refreshVoodooBounds = vi.fn();
    controller.ensureVoodooOnTop = vi.fn();

    controller.setVoodooOpen(true);
    expect(controller.voodooOpen).toBe(false);

    controller.toggleVoodoo();
    expect(controller.voodooOpen).toBe(false);
  });
});
