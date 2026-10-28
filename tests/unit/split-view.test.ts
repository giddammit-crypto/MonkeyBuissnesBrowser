import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {} }));
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { getSplitViewBounds } from '../../src/shared/splitView';
import { MemoryManager } from '../../src/services/memory/MemoryManager';

function fixture() {
  const children: any[] = [];
  const view = () => ({ webContents: { isDestroyed: () => false, setBackgroundThrottling: vi.fn(), send: vi.fn(), focus: vi.fn(), close: vi.fn() }, setBounds: vi.fn(), setVisible: vi.fn() });
  const shell = view(); children.push(shell);
  const tabs = new Map(); const memory = new MemoryManager();
  for (const id of ['a', 'b', 'c']) {
    const tab = { id, url: 'https://example.com/' + id, workspaceId: 'personal', isPrivate: false, isInternal: false, lifecycle: id === 'a' ? 'active' : 'background', view: view() };
    tabs.set(id, tab); children.push(tab.view);
    memory.registerTab({ tabId: id, active: id === 'a', pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt: 0, lifecycle: id === 'a' ? 'active' : 'background' });
  }
  const controller = Object.create(BrowserController.prototype) as any;
  const windowBounds = { width: 1280, height: 800 };
  Object.assign(controller, { tabs, activeTabId: 'a', activeWorkspaceId: 'personal', memoryManager: memory, shellView: shell,
    chromeBounds: { x: 100, y: 140, width: 1180, height: 660 }, emitSnapshot: vi.fn(), popupOpeners: new Map(), popupToTab: new Map(),
    window: { isDestroyed: () => false, getContentBounds: () => windowBounds, isFullScreen: () => false,
      contentView: { children, removeChildView: (v: any) => { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); }, addChildView: (v: any) => children.push(v) } },
  });
  return { controller, tabs, shell, children, windowBounds, memory };
}

describe('Native split view', () => {
  it('computes bounded adaptive panes and a fixed gap without overflow', () => {
    const wide = getSplitViewBounds({ x: 10, y: 20, width: 1000, height: 600 }, 0.65);
    expect(wide.orientation).toBe('horizontal');
    expect(wide.primary.width + wide.secondary.width + 6).toBe(1000);
    expect(wide.secondary.x + wide.secondary.width).toBe(1010);
    const narrow = getSplitViewBounds({ x: 0, y: 140, width: 420, height: 500 }, Number.NaN);
    expect(narrow.orientation).toBe('vertical');
    expect(narrow.primary.height + narrow.secondary.height + 6).toBe(500);
    expect(narrow.secondary.y + narrow.secondary.height).toBe(640);
    const tiny = getSplitViewBounds({ x: 0, y: 0, width: 1, height: 1 });
    expect(tiny.secondary.height).toBeGreaterThanOrEqual(0);
  });

  it('shows both native panes, protects the secondary from automatic or manual discard, and restores on exit', async () => {
    const { controller, tabs, memory } = fixture();
    controller.setSplitView('b');
    expect(controller.splitView).toMatchObject({ primaryTabId: 'a', secondaryTabId: 'b', ratio: 0.5 });
    expect(tabs.get('a').view.setBounds.mock.lastCall[0].width).toBe(587);
    expect(tabs.get('b').view.setBounds.mock.lastCall[0]).toEqual({ x: 693, y: 140, width: 587, height: 660 });
    expect(tabs.get('b').view.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(false);
    expect(memory.canHibernate('b', 0).reason).toBe('active-tab');
    expect(await controller.hibernateTab('b')).toBe(false);
    controller.setSplitView();
    expect(controller.splitView).toBeUndefined();
    expect(tabs.get('b').view.setVisible).toHaveBeenLastCalledWith(false);
    expect(tabs.get('a').view.setBounds.mock.lastCall[0].width).toBe(1180);
    expect(memory.canHibernate('b', 0).allowed).toBe(true);
  });

  it('swaps when selecting the secondary and exits when selecting an unrelated tab', () => {
    const { controller } = fixture();
    controller.setSplitView('b'); controller.activateTab('b');
    expect(controller.activeTabId).toBe('b');
    expect(controller.splitView).toMatchObject({ primaryTabId: 'b', secondaryTabId: 'a' });
    controller.activateTab('c');
    expect(controller.splitView).toBeUndefined();
  });

  it('keeps physical pane geometry and the first-pane ratio stable when keyboard focus changes', () => {
    const { controller, tabs, windowBounds } = fixture();
    controller.setSplitView('b'); controller.setSplitViewRatio(0.65);
    const boundsA = { ...tabs.get('a').view.setBounds.mock.lastCall[0] };
    const boundsB = { ...tabs.get('b').view.setBounds.mock.lastCall[0] };
    controller.activateTab('b');
    expect(controller.activeTabId).toBe('b');
    expect(controller.splitView.secondaryTabId).toBe('a');
    expect(tabs.get('a').view.setBounds.mock.lastCall[0]).toEqual(boundsA);
    expect(tabs.get('b').view.setBounds.mock.lastCall[0]).toEqual(boundsB);
    expect(boundsA.width).toBeGreaterThan(boundsB.width);
    windowBounds.width = 600; controller.setChromeBounds({ x: 100, y: 140, width: 500, height: 660 });
    const topA = { ...tabs.get('a').view.setBounds.mock.lastCall[0] };
    const bottomB = { ...tabs.get('b').view.setBounds.mock.lastCall[0] };
    controller.activateTab('a');
    expect(tabs.get('a').view.setBounds.mock.lastCall[0]).toEqual(topA);
    expect(tabs.get('b').view.setBounds.mock.lastCall[0]).toEqual(bottomB);
    expect(topA.y).toBeLessThan(bottomB.y);
    expect(topA.height).toBeGreaterThan(bottomB.height);
  });

  it('rejects mixed private/workspace/reader/internal pairs without changing an existing split', () => {
    const { controller, tabs } = fixture(); controller.setSplitView('b');
    for (const patch of [{ isPrivate: true }, { workspaceId: 'other' }, { isReaderActive: true }, { isInternal: true }, { lifecycle: 'crashed' }]) {
      const original = { ...tabs.get('c') }; Object.assign(tabs.get('c'), patch);
      expect(() => controller.setSplitView('c')).toThrow();
      expect(controller.splitView.secondaryTabId).toBe('b');
      Object.assign(tabs.get('c'), original, { isReaderActive: false });
    }
  });

  it('keeps shell overlays above both panes and recomputes stacked layout on resize', () => {
    const { controller, tabs, shell, children, windowBounds } = fixture();
    controller.setSplitView('b'); controller.setPopoverOpen(true);
    expect(children.at(-1)).toBe(shell);
    windowBounds.width = 600; controller.setChromeBounds({ x: 100, y: 140, width: 500, height: 660 });
    expect(tabs.get('b').view.setBounds.mock.lastCall[0]).toEqual({ x: 100, y: 473, width: 500, height: 327 });
    expect(children.at(-1)).toBe(shell);
  });

  it('clears split when either native view detaches, without leaving a half-width primary', () => {
    const { controller, tabs } = fixture(); controller.setSplitView('b');
    controller.detachView(tabs.get('b'));
    expect(controller.splitView).toBeUndefined();
    expect(tabs.get('a').view.setBounds.mock.lastCall[0].width).toBe(1180);
  });
});
