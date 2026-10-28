import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockDefaultSession } = vi.hoisted(() => ({
  mockDefaultSession: {
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userdata') },
  BaseWindow: class {},
  BrowserWindow: class {},
  clipboard: {},
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  nativeImage: {},
  nativeTheme: {},
  session: {
    defaultSession: mockDefaultSession,
    fromPartition: vi.fn(() => ({
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
    })),
  },
  shell: {},
  WebContentsView: class {},
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  },
}));

import { BrowserController } from '../../src/main/tabs/BrowserController';

function createMockController() {
  const browserSession = {
    getCacheSize: vi.fn().mockResolvedValue(1024 * 1024 * 10), // 10 MB
    cookies: {
      get: vi.fn().mockResolvedValue([{ name: 'sid' }, { name: 'token' }]),
    },
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearAuthCache: vi.fn().mockResolvedValue(undefined),
    clearHostResolverCache: vi.fn().mockResolvedValue(undefined),
  };

  const privateSession = {
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearAuthCache: vi.fn().mockResolvedValue(undefined),
    clearHostResolverCache: vi.fn().mockResolvedValue(undefined),
  };

  const stores = {
    history: {
      data: [{ url: 'https://example.com', title: 'Example' }, { url: 'https://test.com', title: 'Test' }],
      get: vi.fn(function() { return stores.history.data; }),
      set: vi.fn(function(v) { stores.history.data = v; }),
    },
    downloads: {
      data: [{ id: 'd1', url: 'https://test.com/f.zip' }],
      get: vi.fn(function() { return stores.downloads.data; }),
      set: vi.fn(function(v) { stores.downloads.data = v; }),
    },
    session: {
      data: { tabs: [], activeIndex: 0 },
      get: vi.fn(function() { return stores.session.data; }),
      set: vi.fn(function(v) { stores.session.data = v; }),
    },
    settings: {
      get: vi.fn(() => ({})),
      set: vi.fn(),
    },
  };

  const passwords = {
    count: vi.fn(() => 3),
    canPersistSecurely: vi.fn(() => true),
    clearAll: vi.fn(() => 3),
  };

  const tab1Contents = {
    isDestroyed: () => false,
    navigationHistory: {
      clear: vi.fn(),
      canGoBack: () => false,
      canGoForward: () => false,
    },
  };
  const tab2Contents = {
    isDestroyed: () => false,
    navigationHistory: {
      clear: vi.fn(),
      canGoBack: () => false,
      canGoForward: () => false,
    },
  };
  const tab1 = {
    id: 'tab1',
    url: 'https://example.com',
    isPrivate: false,
    view: { webContents: tab1Contents },
    canGoBack: true,
    canGoForward: true,
  };
  const tab2 = {
    id: 'tab2',
    url: 'browser://newtab',
    isPrivate: false,
    view: { webContents: tab2Contents },
  };
  const tabPrivate = {
    id: 'tab-priv',
    url: 'https://private.com',
    isPrivate: true,
  };

  const controller = Object.create(BrowserController.prototype) as any;
  const eventListener = vi.fn();
  const snapshotListener = vi.fn();

  Object.assign(controller, {
    browserSession,
    privateSession,
    stores,
    passwords,
    tabs: new Map([
      ['tab1', tab1],
      ['tab2', tab2],
      ['tab-priv', tabPrivate],
    ]),
    activeTabId: 'tab1',
    closedTabs: [{ url: 'https://closed.com', workspaceId: 'personal' }],
    downloads: [...stores.downloads.data],
    liveDownloads: new Map(),
    eventListener,
    snapshotListener,
    emitSnapshot: vi.fn(),
    closeTab: vi.fn(async (id: string) => {
      controller.tabs.delete(id);
    }),
    createTab: vi.fn(async ({ url }: { url: string }) => {
      const newTab = { id: 'new-tab', url, isPrivate: false };
      controller.tabs.set('new-tab', newTab);
      return newTab;
    }),
    activateTab: vi.fn(),
  });

  return { controller, browserSession, privateSession, stores, passwords, eventListener, tab1Contents };
}

describe('BrowserController Click & Clean Backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects storage metrics accurately across components', async () => {
    const { controller, browserSession, stores, passwords } = createMockController();

    const metrics = await controller.getStorageMetrics();
    expect(metrics.cacheSizeBytes).toBe(1024 * 1024 * 10);
    expect(metrics.cacheSizeFormatted).toBe('10 МБ');
    expect(metrics.cookiesCount).toBe(2);
    expect(metrics.historyCount).toBe(2);
    expect(metrics.downloadsCount).toBe(1);
    expect(metrics.passwordsCount).toBe(3);
    expect(metrics.openTabsCount).toBe(2); // 2 normal tabs, 1 private ignored
    expect(metrics.hasSecureStorage).toBe(true);
    expect(metrics.sampledAt).toBeGreaterThan(0);
  });

  it('executes cache cleaning across browserSession, privateSession, and defaultSession', async () => {
    const { controller, browserSession, privateSession } = createMockController();

    // Simulate cache size dropping after clean
    browserSession.getCacheSize.mockResolvedValueOnce(1024 * 1024 * 10).mockResolvedValueOnce(0);

    const result = await controller.executeClean({ cache: true });

    expect(browserSession.clearCache).toHaveBeenCalledOnce();
    expect(browserSession.clearStorageData).toHaveBeenCalledWith({ storages: ['shadercache', 'cachestorage'] });
    expect(privateSession.clearCache).toHaveBeenCalledOnce();
    expect(mockDefaultSession.clearCache).toHaveBeenCalledOnce();

    expect(result.success).toBe(true);
    expect(result.clearedTargets).toContain('cache');
    expect(result.freedBytesEstimate).toBe(1024 * 1024 * 10);
    expect(result.freedFormatted).toBe('10 МБ');
  });

  it('executes cookies cleaning across all sessions', async () => {
    const { controller, browserSession, privateSession } = createMockController();

    const result = await controller.executeClean({ cookies: true });

    expect(browserSession.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(privateSession.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(mockDefaultSession.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(result.clearedTargets).toEqual(['cookies']);
  });

  it('executes web storage cleaning (localStorage, indexedDB, serviceWorkers, authCache, dnsCache)', async () => {
    const { controller, browserSession, privateSession } = createMockController();

    await controller.executeClean({
      localStorage: true,
      indexedDB: true,
      serviceWorkers: true,
      authCache: true,
      dnsCache: true,
    });

    expect(browserSession.clearStorageData).toHaveBeenCalledWith({ storages: ['localstorage', 'websql'] });
    expect(browserSession.clearStorageData).toHaveBeenCalledWith({ storages: ['indexdb', 'filesystem'] });
    expect(browserSession.clearStorageData).toHaveBeenCalledWith({ storages: ['serviceworkers'] });
    expect(browserSession.clearAuthCache).toHaveBeenCalledOnce();
    expect(browserSession.clearHostResolverCache).toHaveBeenCalledOnce();

    expect(privateSession.clearAuthCache).toHaveBeenCalledOnce();
    expect(privateSession.clearHostResolverCache).toHaveBeenCalledOnce();
  });

  it('executes history, downloads, closedTabs and passwords cleaning', async () => {
    const { controller, stores, passwords, eventListener, tab1Contents } = createMockController();

    await controller.executeClean({
      history: true,
      downloadsHistory: true,
      closedTabsHistory: true,
      passwords: true,
    });

    // History cleared
    expect(stores.history.set).toHaveBeenCalledWith([]);
    expect(tab1Contents.navigationHistory.clear).toHaveBeenCalledOnce();
    expect(eventListener).toHaveBeenCalledWith({ type: 'history-cleared' });

    // Downloads cleared
    expect(stores.downloads.set).toHaveBeenCalledWith([]);
    expect(eventListener).toHaveBeenCalledWith({ type: 'downloads-cleared' });

    // Passwords cleared
    expect(passwords.clearAll).toHaveBeenCalledOnce();
    expect(eventListener).toHaveBeenCalledWith({ type: 'passwords-changed' });

    // Closed tabs stack cleared
    expect(controller.closedTabs).toEqual([]);
  });

  it('executes closeTabs to close regular pages while preserving or creating newtab', async () => {
    const { controller, stores } = createMockController();

    await controller.executeClean({ closeTabs: true });

    // Closed tab1 (example.com), kept tab2 (browser://newtab)
    expect(controller.closeTab).toHaveBeenCalledWith('tab1');
    expect(controller.closeTab).not.toHaveBeenCalledWith('tab2');
    expect(stores.session.set).toHaveBeenCalledWith({ tabs: [], activeIndex: 0 });
  });
});
