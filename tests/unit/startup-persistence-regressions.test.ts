import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { registerSingleInstance } from '../../src/main/services/SingleInstance';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';
afterEach(() => vi.restoreAllMocks());

it('quits a second process before startup and activates only the owning process', async () => {
  const activate = vi.fn().mockResolvedValue(undefined);
  const application = Object.assign(new EventEmitter(), { requestSingleInstanceLock: vi.fn(() => false), quit: vi.fn() });
  expect(registerSingleInstance(application as any, activate)).toBe(false);
  expect(application.quit).toHaveBeenCalledOnce();
  expect(application.listenerCount('second-instance')).toBe(0);
  application.requestSingleInstanceLock.mockReturnValue(true);
  expect(registerSingleInstance(application as any, activate)).toBe(true);
  application.emit('second-instance');
  await Promise.resolve();
  expect(activate).toHaveBeenCalledOnce();
});

function fixture() {
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, {
    disposed: false, restoring: false, pageIpcCleanup: [],
    cancelVoodooRequest: vi.fn(), endPrivateSession: vi.fn().mockResolvedValue(undefined), detachView: vi.fn(),
    popupWindows: new Set(), popupToTab: new Map(), sessionDownloadHandlers: new Map(),
    liveDownloads: new Map(), ytDlpProcesses: new Map(), tabs: new Map(), tabHandlerCleanup: new Map(),
    findQueries: new Map(), pipBounds: new Map(), capturedMediaStreams: new Map(), popupOpeners: new Map(),
    memoryManager: { clear: vi.fn() }, browsec: { destroy: vi.fn() }, downloads: [],
    stores: { settings: { get: () => ({ restoreSession: true }) }, session: { set: vi.fn() }, downloads: { set: vi.fn() } },
  });
  return controller;
}

it('retries an unchanged session after disk failure and deduplicates only successful writes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const controller = fixture();
  controller.stores.session.set.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
  expect(() => controller.persistSession()).not.toThrow();
  expect(controller.sessionSignature).toBeUndefined();
  controller.persistSession();
  controller.persistSession();
  expect(controller.stores.session.set).toHaveBeenCalledTimes(2);
  expect(controller.sessionSignature).toBeDefined();
});

it('finishes window resource disposal when both persistence writes fail', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const controller = fixture();
  controller.stores.session.set.mockImplementation(() => { throw new Error('ENOSPC'); });
  controller.stores.downloads.set.mockImplementation(() => { throw new Error('ENOSPC'); });
  const child = { kill: vi.fn() };
  controller.ytDlpProcesses.set('download', { child, isPaused: true });
  const view = { webContents: { isDestroyed: () => false, close: vi.fn() } };
  controller.shellView = view;
  expect(() => controller.dispose()).not.toThrow();
  expect(child.kill.mock.calls).toEqual([['SIGCONT'], ['SIGTERM']]);
  expect(view.webContents.close).toHaveBeenCalledOnce();
  expect(controller.memoryManager.clear).toHaveBeenCalledOnce();
  expect(controller.browsec.destroy).toHaveBeenCalledOnce();
});
