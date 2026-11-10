import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { getAppMetrics } = vi.hoisted(() => ({ getAppMetrics: vi.fn(() => [{ pid: 10, type: 'Browser', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 1024 } }]) }));
vi.mock('electron', () => ({
  app: { getAppMetrics }, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { MemoryManager } from '../../src/services/memory/MemoryManager';
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { siteFontMonitor } from '../../src/main/services/SiteFontMonitor';

function memoryTab(tabId: string, lastInteractionAt: number) {
  return { tabId, active: false, pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt, lifecycle: 'background' as const };
}
function nativeFixture() {
  const contents = Object.assign(new EventEmitter(), {
    id: 7, isDestroyed: () => false, setWindowOpenHandler: vi.fn(), close: vi.fn(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  });
  const external = vi.fn();
  contents.on('destroyed', external);
  const tab = { id: 'page', webContentsId: 7, lifecycle: 'background', isLoading: true, isAudible: true,
    hasVideoMedia: true, hasDownloadableMedia: true, capturedAudioFilename: 'buffer.wav', isPictureInPicture: false,
    view: { webContents: contents }, url: 'https://example.com' };
  const controller = Object.create(BrowserController.prototype) as any;
  const memoryManager = new MemoryManager();
  memoryManager.registerTab(memoryTab(tab.id, 0));
  Object.assign(controller, {
    tabs: new Map([[tab.id, tab]]), activeTabId: 'other', memoryManager,
    tabHandlerCleanup: new Map(), capturedMediaStreams: new Map([[7, { audio: 'captured' }]]),
    popupOpeners: new Map(), popupToTab: new Map(), installShortcuts: vi.fn(), emitSnapshot: vi.fn(),
    stores: { addHistory: vi.fn() }, fontCompatCssKeys: new Map(), fontCompatFamilies: new Map(),
  });
  controller.installTabHandlers(tab);
  return { controller, contents, tab, external };
}

describe('Browser memory runtime regressions', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('orders only eligible idle tabs oldest first without discarding media or unsaved state', () => {
    const memory = new MemoryManager();
    memory.registerTab(memoryTab('newer', 200));
    memory.registerTab(memoryTab('oldest', 100));
    memory.registerTab({ ...memoryTab('dirty', 0), hasFormEdits: true });
    memory.registerTab({ ...memoryTab('media', 0), audible: true });
    memory.registerTab({ ...memoryTab('capture', 0), capturing: true });
    expect(memory.getHibernateCandidates(0)).toEqual(['oldest', 'newer']);
  });

  it('coalesces repeated native process sampling for one second and supports an explicit fresh sample', () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    vi.stubGlobal('process', Object.assign(Object.create(process), { getSystemMemoryInfo: () => ({ available: 2048 }) }));
    const memory = new MemoryManager();
    const first = memory.sample();
    for (let i = 0; i < 100; i++) expect(memory.sample()).toBe(first);
    expect(getAppMetrics).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(memory.sample()).not.toBe(first);
    memory.sample(true);
    expect(getAppMetrics).toHaveBeenCalledTimes(3);
    memory.clear();
    memory.sample();
    expect(getAppMetrics).toHaveBeenCalledTimes(4);
  });

  it('staggered automatic discard skips private tabs and releases at most one safe page per sweep', async () => {
    const memory = new MemoryManager();
    const tabs = new Map();
    for (const [index, id] of ['private', 'oldest', 'newer'].entries()) {
      memory.registerTab(memoryTab(id, index));
      tabs.set(id, { id, isPrivate: id === 'private' });
    }
    const controller = Object.create(BrowserController.prototype) as any;
    Object.assign(controller, { tabs, memoryManager: memory, hibernateTab: vi.fn().mockResolvedValue(true) });
    await controller.hibernateIdleTabs(0);
    expect(controller.hibernateTab.mock.calls).toEqual([['oldest', 0]]);
    expect(controller.memorySweepRunning).toBe(false);
  });

  it('removes owned listener closures and captured media before closing native contents', () => {
    const { controller, contents, tab, external } = nativeFixture();
    expect(contents.listenerCount('did-start-loading')).toBe(1);
    controller.detachView(tab);
    tab.lifecycle = 'hibernated';
    // Native teardown can queue these events; they must not close/crash metadata.
    contents.emit('did-start-loading'); contents.emit('window-close'); contents.emit('destroyed');
    expect(tab).toMatchObject({ lifecycle: 'hibernated', isLoading: false, isAudible: false, hasVideoMedia: false, hasDownloadableMedia: false });
    expect(tab.view).toBeUndefined();
    expect(contents.close).toHaveBeenCalledOnce();
    expect(contents.listenerCount('did-start-loading')).toBe(0);
    expect(contents.listeners('destroyed')).toEqual([external]);
    expect(controller.tabHandlerCleanup.size).toBe(0);
    expect(controller.capturedMediaStreams.size).toBe(0);
  });

  it('cleans spontaneous native destruction and keeps the memory lifecycle consistent', () => {
    const { controller, contents, tab } = nativeFixture();
    contents.emit('destroyed');
    expect(tab.lifecycle).toBe('crashed');
    expect(tab.view).toBeUndefined();
    expect(controller.tabHandlerCleanup.size).toBe(0);
    expect(controller.memoryManager.canHibernate(tab.id, 0).reason).toBe('not-background-tab');
  });

  it('releases document diagnostics even when detaching removes the destroyed listener', () => {
    const { controller, contents, tab } = nativeFixture();
    const caches = BrowserController as any;
    caches.xmlDocuments.set(contents.id, { url: tab.url, contentType: 'text/xml' });
    caches.xsltApplied.add(contents.id);
    caches.relaxedFontResponses.set(contents.id, 1);
    siteFontMonitor.noteHttpStatus(contents.id, 'https://example.com/missing.woff2', 404);
    controller.fontCompatCssKeys.set(tab.id, ['old-css']);
    controller.fontCompatFamilies.set(tab.id, ['Old Font']);

    controller.detachView(tab);

    expect(caches.xmlDocuments.has(contents.id)).toBe(false);
    expect(caches.xsltApplied.has(contents.id)).toBe(false);
    expect(caches.relaxedFontResponses.has(contents.id)).toBe(false);
    expect(siteFontMonitor.snapshot(contents.id)).toEqual([]);
    expect(controller.fontCompatCssKeys.has(tab.id)).toBe(false);
    expect(controller.fontCompatFamilies.has(tab.id)).toBe(false);
  });

  it('preserves current media during same-document navigation and ignores subframe addresses', () => {
    const { controller, contents, tab } = nativeFixture();
    controller.fontCompatFamilies.set(tab.id, ['Substitute']);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    contents.emit('did-navigate-in-page', {}, 'https://embed.example/frame#anchor', false);
    expect(tab.url).toBe('https://example.com');
    expect(controller.stores.addHistory).not.toHaveBeenCalled();

    contents.emit('did-navigate-in-page', {}, 'https://example.com/#anchor', true);
    expect(tab).toMatchObject({ url: 'https://example.com/#anchor', isLoading: true, isAudible: true, hasVideoMedia: true, hasDownloadableMedia: true });
    expect(controller.capturedMediaStreams.has(contents.id)).toBe(true);
    expect(controller.fontCompatFamilies.get(tab.id)).toEqual(['Substitute']);
    expect(controller.stores.addHistory).toHaveBeenCalledOnce();

    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(tab).toMatchObject({ isAudible: false, hasVideoMedia: false, hasDownloadableMedia: false });
    expect(controller.capturedMediaStreams.has(contents.id)).toBe(false);
    expect(controller.fontCompatFamilies.has(tab.id)).toBe(false);
  });
});
