import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';

function fixture() {
  let workspaces = [{ id: 'personal', name: 'Personal' }, { id: 'work', name: 'Work' }];
  const controller = Object.create(BrowserController.prototype) as any;
  const active = { id: 'active', url: 'browser://newtab', workspaceId: 'personal', isPrivate: false };
  Object.assign(controller, {
    tabs: new Map([['active', active]]), activeTabId: 'active', activeWorkspaceId: 'personal', closedTabs: [],
    stores: { workspaces: { get: () => workspaces, set: (next: typeof workspaces) => { workspaces = next; } } },
    memoryManager: { registerTab: vi.fn(), updateTab: vi.fn() }, emitSnapshot: vi.fn(), persistSession: vi.fn(),
    ensurePrivateSession: vi.fn(), clearSplitView: vi.fn(),
    attachWebContents: vi.fn((tab) => { tab.view = { webContents: { setAudioMuted: vi.fn() } }; }),
    activateTab: vi.fn((id) => { controller.activeTabId = id; controller.activeWorkspaceId = controller.tabs.get(id).workspaceId; }),
    toSnapshot: (tab: unknown) => ({ ...(tab as object) }),
  });
  return controller;
}

afterEach(() => BrowserController.transferringTabs.clear());

describe('workspace ownership of created, duplicated and reopened tabs', () => {
  it.each([false, true])('duplicates the selected background tab into its original workspace; private=%s', async (isPrivate) => {
    const controller = fixture();
    controller.tabs.set('source', { id: 'source', url: 'https://example.com/background', workspaceId: 'work', isPrivate });
    await controller.tabAction('source', 'duplicate');
    const duplicate = controller.tabs.get(controller.activeTabId);
    expect(duplicate.id).not.toBe('source');
    expect(duplicate).toMatchObject({ url: 'https://example.com/background', workspaceId: 'work', isPrivate });
    expect(controller.activeWorkspaceId).toBe('work');
  });

  it('reopens in the original existing workspace and reapplies pin and mute', async () => {
    const controller = fixture();
    controller.closedTabs.push({ url: 'https://example.com/closed', workspaceId: 'work', isPinned: true, isMuted: true });
    await controller.reopenClosedTab();
    const restored = controller.tabs.get(controller.activeTabId);
    expect(restored).toMatchObject({ workspaceId: 'work', isPinned: true, isMuted: true, isPrivate: false });
    expect(restored.view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(controller.activeWorkspaceId).toBe('work');
  });

  it('never recreates a deleted workspace through recently closed tab history', async () => {
    const controller = fixture();
    controller.closedTabs.push({ url: 'https://example.com/closed', workspaceId: 'work', isPinned: false, isMuted: false });
    controller.tabs.set('work-tab', { id: 'work-tab', workspaceId: 'work' });
    await controller.deleteWorkspace('work');
    expect(controller.tabs.get('work-tab').workspaceId).toBe('personal');
    expect(controller.closedTabs[0].workspaceId).toBe('personal');
    await controller.reopenClosedTab();
    expect(controller.tabs.get(controller.activeTabId).workspaceId).toBe('personal');
    expect(controller.stores.workspaces.get().map((workspace: any) => workspace.id)).toEqual(['personal']);
  });

  it('resolves stale saved workspace IDs to the current existing workspace', async () => {
    const controller = fixture();
    controller.activeWorkspaceId = 'work';
    controller.closedTabs.push({ url: 'https://example.com/closed', workspaceId: 'removed', isPinned: false, isMuted: false });
    await controller.reopenClosedTab();
    expect(controller.tabs.get(controller.activeTabId).workspaceId).toBe('work');
    expect(controller.activeWorkspaceId).toBe('work');
  });

  it('uses an existing workspace when neither requested nor current workspace survives', async () => {
    const controller = fixture();
    controller.activeWorkspaceId = 'removed';
    const created = await controller.createTab({ url: 'https://example.com', workspaceId: 'also-removed' });
    expect(created.workspaceId).toBe('personal');
    expect(controller.activeWorkspaceId).toBe('personal');
  });

  it('keeps ordinary recently closed history hidden while a private tab is active', async () => {
    const controller = fixture();
    controller.tabs.get('active').isPrivate = true;
    controller.closedTabs.push({ url: 'https://example.com/closed', workspaceId: 'work' });
    await controller.reopenClosedTab();
    expect(controller.tabs.size).toBe(1);
    expect(controller.closedTabs).toHaveLength(1);
  });

  it('adopts a muted tab with consistent native sound and workspace activation', async () => {
    const controller = fixture();
    const source = fixture();
    source.tabs.set('transferred', { id: 'transferred', url: 'https://example.com/media', workspaceId: 'work',
      title: 'Media', isPrivate: false, isMuted: true, isPinned: true });
    source.closeTab = vi.fn(async id => source.tabs.delete(id));
    await controller.adoptTabFromController(source, 'transferred');
    const adopted = controller.tabs.get(controller.activeTabId);
    expect(adopted).toMatchObject({ workspaceId: 'work', isMuted: true, isPinned: true, title: 'Media' });
    expect(controller.activeWorkspaceId).toBe('work');
    expect(adopted.view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(source.closeTab).toHaveBeenCalledWith('transferred');
  });
});
