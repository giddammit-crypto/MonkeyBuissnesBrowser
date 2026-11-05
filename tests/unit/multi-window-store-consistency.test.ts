import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) }, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';
import { JsonStore } from '../../src/main/persistence/JsonStore';

const directories: string[] = [];
const subscriptions: Array<() => void> = [];
function directory() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-window-stores-'));
  directories.push(result);
  return result;
}
function windowController(profile: string) {
  const owner = (BrowserController as any).findProfileOwner(profile);
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, {
    profileDataPath: path.resolve(profile), disposed: false,
    stores: owner?.stores ?? new BrowserStores(profile),
    tabs: new Map(), liveDownloads: new Map(), ytDlpProcesses: new Map(), downloads: [], closedTabs: [],
    emitSnapshot: vi.fn(), window: {}, persistSession: vi.fn(), cancelVoodooRequest: vi.fn(),
    pageIpcCleanup: [], profileStoreCleanup: [], endPrivateSession: vi.fn().mockResolvedValue(undefined),
  });
  controller.downloads.push(...structuredClone(controller.stores.downloads.get()));
  controller.downloadStoreCleanup = controller.stores.downloads.subscribe((entries: any[]) => controller.synchronizePersistentDownloads(entries));
  subscriptions.push(controller.downloadStoreCleanup);
  for (const store of [controller.stores.history, controller.stores.bookmarks]) {
    const cleanup = store.subscribe(() => { if (!controller.disposed) controller.emitSnapshot(); });
    controller.profileStoreCleanup.push(cleanup);
    subscriptions.push(cleanup);
  }
  BrowserController.controllers.add(controller);
  return controller;
}
function entry(id: string, state: string = 'completed') {
  return { id, url: `https://example.test/${id}`, filename: `${id}.bin`, kind: 'file', state, receivedBytes: 1, totalBytes: 2, startedAt: 1 };
}

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  BrowserController.controllers.clear();
  for (const target of directories.splice(0)) fs.rmSync(target, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('same-profile window persistence', () => {
  it('reuses only a live owner of the same resolved profile without a global store cache', () => {
    const profile = directory();
    const first = windowController(profile);
    const second = windowController(path.join(profile, 'nested', '..'));
    expect(second.stores).toBe(first.stores);
    const isolated = windowController(directory());
    expect(isolated.stores).not.toBe(first.stores);
    first.disposed = true;
    expect((BrowserController as any).findProfileOwner(profile)).toBe(second);
    second.disposed = true;
    expect((BrowserController as any).findProfileOwner(profile)).toBeUndefined();
  });

  it('does not resurrect history cleared by another window on a late title or new visit', async () => {
    const profile = directory();
    const first = windowController(profile);
    first.stores.addHistory({ url: 'https://example.test/old', title: 'Old' });
    const second = windowController(profile);
    await second.clearBrowsingHistory();
    expect(first.stores.updateHistoryTitle('https://example.test/old', 'Late document title')).toBe(false);
    first.stores.addHistory({ url: 'https://example.test/new', title: 'New' });
    expect(second.stores.history.get().map((record: any) => record.url)).toEqual(['https://example.test/new']);
    expect(new BrowserStores(profile).history.get().map(record => record.url)).toEqual(['https://example.test/new']);
  });

  it('clears normal back stacks and reopen history in every profile window while preserving private navigation', async () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    const normal = { clear: vi.fn(), canGoBack: () => false, canGoForward: () => false };
    const privateHistory = { clear: vi.fn() };
    first.tabs.set('ordinary', { isPrivate: false, view: { webContents: { isDestroyed: () => false, navigationHistory: normal } } });
    first.tabs.set('private', { isPrivate: true, view: { webContents: { isDestroyed: () => false, navigationHistory: privateHistory } } });
    first.closedTabs.push({ url: 'https://example.test/closed' });
    second.closedTabs.push({ url: 'https://example.test/second-closed' });
    await second.clearBrowsingHistory();
    expect(normal.clear).toHaveBeenCalledOnce();
    expect(privateHistory.clear).not.toHaveBeenCalled();
    expect(first.closedTabs).toEqual([]);
    expect(second.closedTabs).toEqual([]);
  });

  it('Click & Clean clears peer ordinary back stacks and reopen history but preserves private and other-profile navigation', async () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    const isolated = windowController(directory());
    second.getStorageMetrics = vi.fn().mockResolvedValue({ cacheSizeBytes: 0 });
    const normal = { clear: vi.fn(), canGoBack: () => false, canGoForward: () => false };
    const privateHistory = { clear: vi.fn() };
    first.tabs.set('ordinary', { isPrivate: false, view: { webContents: { isDestroyed: () => false, navigationHistory: normal } } });
    first.tabs.set('private', { isPrivate: true, view: { webContents: { isDestroyed: () => false, navigationHistory: privateHistory } } });
    first.closedTabs.push({ url: 'https://example.test/closed' });
    isolated.closedTabs.push({ url: 'https://example.test/isolated' });
    await second.executeClean({ history: true });
    expect(normal.clear).toHaveBeenCalledOnce();
    expect(privateHistory.clear).not.toHaveBeenCalled();
    expect(first.closedTabs).toEqual([]);
    expect(isolated.closedTabs).toHaveLength(1);
    first.closedTabs.push({ url: 'https://example.test/closed-again' });
    await second.executeClean({ closedTabsHistory: true });
    expect(first.closedTabs).toEqual([]);
    expect(normal.clear).toHaveBeenCalledOnce();
    expect(isolated.closedTabs).toHaveLength(1);
  });

  it('Click & Clean preserves a peer-owned interrupted native download and persists it before notifying subscribers', async () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    second.getStorageMetrics = vi.fn().mockResolvedValue({ cacheSizeBytes: 0 });
    first.downloads.push(entry('peer-interrupted', 'interrupted'), entry('finished'));
    const nativeItem = { cancel: vi.fn() };
    first.liveDownloads.set('peer-interrupted', { item: nativeItem });
    first.persistDownloads(true);
    await second.executeClean({ downloadsHistory: true });
    expect(second.downloads.map((record: any) => record.id)).toEqual(['peer-interrupted']);
    expect(first.downloads.map((record: any) => record.id)).toEqual(['peer-interrupted']);
    expect(new BrowserStores(first.profileDataPath).downloads.get().map(record => record.id)).toEqual(['peer-interrupted']);
    expect(first.liveDownloads.get('peer-interrupted').item).toBe(nativeItem);
    expect(nativeItem.cancel).not.toHaveBeenCalled();
  });

  it('notifies peer windows of history and bookmark changes for their open managers', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    first.stores.addHistory({ url: 'https://example.test/first', title: 'First' });
    expect(second.emitSnapshot).toHaveBeenCalledOnce();
    second.emitSnapshot.mockClear();
    first.stores.toggleBookmark({ url: 'https://example.test/saved', title: 'Saved' });
    expect(second.emitSnapshot).toHaveBeenCalledOnce();
  });

  it('shares fresh bookmark and settings mutations without losing changes from either window', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    first.stores.toggleBookmark({ url: 'https://example.test/first', title: 'First' });
    second.stores.toggleBookmark({ url: 'https://example.test/second', title: 'Second' });
    expect(first.stores.bookmarks.get()).toHaveLength(2);
    first.stores.settings.update((current: any) => ({ ...current, sleepAfterMinutes: 30 }));
    second.stores.settings.update((current: any) => ({ ...current, sidebarCollapsed: true }));
    expect(first.stores.settings.get()).toMatchObject({ sleepAfterMinutes: 30, sidebarCollapsed: true });
  });

  it('clears completed history across windows without losing active ownership or leaking private entries', () => {
    const profile = directory();
    const first = windowController(profile);
    first.stores.downloads.set([entry('finished')]);
    const second = windowController(profile);
    const active = { ...entry('active', 'progressing'), isLive: true };
    const privateEntry = { ...entry('private'), isPrivate: true };
    const nativeItem = { cancel: vi.fn() };
    first.downloads.unshift(active, privateEntry);
    first.liveDownloads.set('active', { item: nativeItem });
    first.persistDownloads(true);
    expect(first.downloads.find((record: any) => record.id === 'active')).toBe(active);
    expect(second.downloads.map((record: any) => record.id)).toEqual(['active', 'finished']);
    expect(second.liveDownloads.size).toBe(0);
    second.clearFinishedDownloads(false);
    expect(first.downloads.map((record: any) => record.id)).toEqual(['active', 'private']);
    expect(first.downloads.find((record: any) => record.id === 'private')).toBe(privateEntry);
    expect(first.liveDownloads.get('active').item).toBe(nativeItem);
    first.persistDownloads(true);
    expect(new BrowserStores(profile).downloads.get().map(record => record.id)).toEqual(['active']);
    expect(second.downloads.map((record: any) => record.id)).toEqual(['active']);
    expect(nativeItem.cancel).not.toHaveBeenCalled();
  });

  it('keeps a resumable interrupted native download owned by another window when clearing finished rows', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    first.downloads.push(entry('active-interrupted', 'interrupted'), entry('finished'));
    first.liveDownloads.set('active-interrupted', { item: {} });
    first.persistDownloads(true);
    second.clearFinishedDownloads(false);
    expect(second.downloads.map((record: any) => record.id)).toEqual(['active-interrupted']);
    expect(first.downloads.map((record: any) => record.id)).toEqual(['active-interrupted']);
  });

  it('retains completed row identity for pending thumbnails while synchronizing changed metadata', () => {
    const first = windowController(directory());
    first.stores.downloads.set([entry('image')]);
    const candidate = first.downloads[0];
    const second = windowController(first.profileDataPath);
    second.downloads[0].thumbnail = 'data:image/png;base64,fixture';
    second.persistDownloads(true);
    expect(first.downloads[0]).toBe(candidate);
    expect(candidate.thumbnail).toBe('data:image/png;base64,fixture');
    second.clearFinishedDownloads(false);
    expect(first.downloads).not.toContain(candidate);
  });

  it('routes one native download to its page owner, with a single fallback for session-only downloads', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    const sharedSession = {};
    first.browserSession = sharedSession;
    second.browserSession = sharedSession;
    first.tabs.set('page', { webContentsId: 7, view: { webContents: { isDestroyed: () => false } } });
    expect(first.ownsSessionDownload({ id: 7 }, sharedSession)).toBe(true);
    expect(second.ownsSessionDownload({ id: 7 }, sharedSession)).toBe(false);
    expect(first.ownsSessionDownload(undefined, sharedSession)).toBe(true);
    expect(second.ownsSessionDownload(undefined, sharedSession)).toBe(false);
    first.disposed = true;
    expect(second.ownsSessionDownload(undefined, sharedSession)).toBe(true);
  });

  it('routes public active download controls to their owner and keeps private controls local', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    const item = { pause: vi.fn(), cancel: vi.fn() };
    const privateItem = { pause: vi.fn(), cancel: vi.fn() };
    first.downloads.push({ ...entry('active', 'progressing'), isLive: true }, { ...entry('private', 'progressing'), isPrivate: true });
    first.liveDownloads.set('active', { item });
    first.liveDownloads.set('private', { item: privateItem });
    first.persistDownloads(true);
    second.controlDownload('active', 'pause');
    expect(item.pause).toHaveBeenCalledOnce();
    second.controlDownload('private', 'pause');
    expect(privateItem.pause).not.toHaveBeenCalled();
    second.deleteDownload('active');
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(first.downloads.map((record: any) => record.id)).toEqual(['private']);
    expect(second.downloads).toEqual([]);
    expect(first.liveDownloads.has('active')).toBe(false);
    expect(privateItem.cancel).not.toHaveBeenCalled();
  });

  it('unsubscribes a disposed window so later persistence does not update its runtime', () => {
    const first = windowController(directory());
    const second = windowController(first.profileDataPath);
    first.dispose();
    expect(first.downloadStoreCleanup).toBeUndefined();
    first.emitSnapshot.mockClear();
    second.stores.downloads.set([entry('after-close')]);
    expect(first.emitSnapshot).not.toHaveBeenCalled();
    expect(first.downloads).toEqual([]);
    expect(second.downloads.map((record: any) => record.id)).toEqual(['after-close']);
  });
});

describe('store subscriptions', () => {
  it('publishes successful writes only, and supports idempotent unsubscribe', () => {
    const target = path.join(directory(), 'store.json');
    const store = new JsonStore(target, [] as string[]);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(['first']);
    expect(listener).toHaveBeenCalledExactlyOnceWith(['first']);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(() => store.set(['failed'])).toThrow('disk unavailable');
    expect(store.get()).toEqual(['first']);
    expect(listener).toHaveBeenCalledTimes(1);
    rename.mockRestore();
    unsubscribe(); unsubscribe();
    store.set(['later']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
