import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
    nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
    ipcMain: new EventEmitter(),
  };
});
import { ipcMain } from 'electron';
import { BrowserController } from '../../src/main/tabs/BrowserController';

function controllerFixture() {
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, {
    disposed: false, pageIpcCleanup: [],
    isTrustedPage: vi.fn((id: number) => id === 42),
    persistSession: vi.fn(), cancelVoodooRequest: vi.fn(), persistDownloads: vi.fn(),
    endPrivateSession: vi.fn().mockResolvedValue(undefined), detachView: vi.fn(),
    popupWindows: new Set(), popupToTab: new Map(), sessionDownloadHandlers: new Map(),
    liveDownloads: new Map(), ytDlpProcesses: new Map(), tabs: new Map(), tabHandlerCleanup: new Map(),
    findQueries: new Map(), pipBounds: new Map(), capturedMediaStreams: new Map(), popupOpeners: new Map(),
    memoryManager: { clear: vi.fn() }, browsec: { destroy: vi.fn() }, downloads: [],
  });
  return controller;
}
afterEach(() => ipcMain.removeAllListeners('page:test-lifecycle'));

describe('Browser page IPC ownership lifecycle', () => {
  it('rejects foreign senders and ignores callbacks once the controller is disposed', () => {
    const controller = controllerFixture();
    const listener = vi.fn();
    controller.listenToPage('page:test-lifecycle', listener);
    ipcMain.emit('page:test-lifecycle', { sender: { id: 99 } }, { value: 'foreign' });
    expect(listener).not.toHaveBeenCalled();
    const event = { sender: { id: 42 } };
    ipcMain.emit('page:test-lifecycle', event, { value: 'trusted' });
    expect(listener).toHaveBeenCalledExactlyOnceWith(event, { value: 'trusted' });
    controller.disposed = true;
    ipcMain.emit('page:test-lifecycle', event, { value: 'late' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('repeated controller disposal removes owned listeners while retaining unrelated listeners', () => {
    const foreign = vi.fn();
    ipcMain.on('page:test-lifecycle', foreign);
    for (let cycle = 0; cycle < 25; cycle++) {
      const controller = controllerFixture();
      controller.listenToPage('page:test-lifecycle', vi.fn());
      controller.listenToPage('page:test-lifecycle', vi.fn());
      expect(ipcMain.listenerCount('page:test-lifecycle')).toBe(3);
      controller.dispose();
      controller.dispose();
      expect(ipcMain.listenerCount('page:test-lifecycle')).toBe(1);
      expect(controller.pageIpcCleanup).toHaveLength(0);
      expect(controller.memoryManager.clear).toHaveBeenCalledTimes(1);
      expect(controller.browsec.destroy).toHaveBeenCalledTimes(1);
      expect(controller.cancelVoodooRequest).toHaveBeenCalledTimes(1);
    }
    ipcMain.emit('page:test-lifecycle', { sender: { id: 42 } });
    expect(foreign).toHaveBeenCalledTimes(1);
  });
});
