import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { MemoryManager } from '../../src/services/memory/MemoryManager';

function fixture() {
  let reply!: (value: unknown) => void;
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    executeJavaScript: vi.fn(() => new Promise(resolve => { reply = resolve; })),
  });
  const tab = { id: 'page', url: 'https://example.com/article', lifecycle: 'background', view: { webContents: contents } };
  const memoryManager = new MemoryManager();
  memoryManager.registerTab({ tabId: tab.id, active: false, pinned: false, audible: false, loading: false,
    downloading: false, lifecycle: 'background', lastInteractionAt: 0 });
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, { tabs: new Map([[tab.id, tab]]), activeTabId: 'other', memoryManager,
    popupOpeners: new Map(), popupToTab: new Map(), emitSnapshot: vi.fn(),
    detachView: vi.fn(() => { (tab as any).view = undefined; }),
  });
  return { controller, tab, contents, reply: (value: unknown) => reply(value), memoryManager };
}

describe('tab hibernation race protection and restoration', () => {
  it.each(['activate', 'close', 'navigate', 'form', 'popup', 'replace'])(
    'does not discard a tab changed during scroll sampling: %s', async (change) => {
      const { controller, tab, reply, memoryManager } = fixture();
      const pending = controller.hibernateTab(tab.id);
      if (change === 'activate') controller.activeTabId = tab.id;
      if (change === 'close') controller.tabs.delete(tab.id);
      if (change === 'navigate') tab.url = 'https://example.com/next';
      if (change === 'form') memoryManager.updateTab(tab.id, { hasFormEdits: true });
      if (change === 'popup') controller.popupOpeners.set('popup', tab.id);
      if (change === 'replace') (tab as any).view = { webContents: {} };
      reply({ x: 12, y: 900 });
      expect(await pending).toBe(false);
      expect(controller.detachView).not.toHaveBeenCalled();
      expect(tab.lifecycle).toBe('background');
    },
  );

  it('captures finite scroll coordinates only when the page is still safe to discard', async () => {
    const { controller, tab, reply } = fixture();
    const pending = controller.hibernateTab(tab.id);
    reply({ x: 12, y: 900 });
    expect(await pending).toBe(true);
    expect(tab.lifecycle).toBe('hibernated');
    expect((tab as any).savedScroll).toEqual({ x: 12, y: 900, url: tab.url });
    expect(controller.detachView).toHaveBeenCalledOnce();
  });

  it('rechecks the automatic idle delay if a tab becomes inactive again during scroll sampling', async () => {
    const { controller, tab, reply, memoryManager } = fixture();
    const pending = controller.hibernateTab(tab.id, 5);
    memoryManager.updateTab(tab.id, { active: true, lifecycle: 'active' });
    memoryManager.updateTab(tab.id, { active: false, lifecycle: 'background' });
    reply({ x: 12, y: 900 });
    expect(await pending).toBe(false);
    expect(controller.detachView).not.toHaveBeenCalled();
  });

  it.each([false, true])('restores saved scroll after attaching a discarded page; navigated=%s', (navigated) => {
    const { controller, tab, contents } = fixture();
    (tab as any).savedScroll = { x: 0, y: 900, url: tab.url };
    controller.restoreSavedScroll(tab, contents, tab.url);
    expect((tab as any).savedScroll).toBeUndefined();
    if (navigated) tab.url = 'https://example.com/other';
    contents.emit('did-finish-load');
    if (navigated) expect(contents.executeJavaScript).not.toHaveBeenCalled();
    else expect(contents.executeJavaScript).toHaveBeenCalledWith('window.scrollTo(0, 900)');
  });

  it('never applies discarded page scroll to a newly entered address', () => {
    const { controller, tab, contents } = fixture();
    (tab as any).savedScroll = { x: 0, y: 900, url: tab.url };
    controller.restoreSavedScroll(tab, contents, 'https://example.com/new');
    contents.emit('did-finish-load');
    expect(contents.executeJavaScript).not.toHaveBeenCalled();
  });
});
