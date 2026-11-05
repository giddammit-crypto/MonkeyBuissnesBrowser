import { afterEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { inspectPageFonts, PAGE_FONT_PROBE } from '../../src/main/services/PageFontInspector';

vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';

const data = () => ({ documentStatus: 'loaded', faces: [{ family: 'Monomakh', style: 'normal', weight: '400', status: 'loaded' }], computedFonts: [{ family: 'Monomakh, serif', style: 'normal', weight: '400', count: 2 }], sampledElements: 2, facesTruncated: false });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const contents = { isDestroyed: vi.fn(() => false), executeJavaScriptInIsolatedWorld: vi.fn(async () => data()) };
  const tab = { id: 'page', url: 'https://example.test/', isPrivate: false, isInternal: false, lifecycle: 'active', view: { webContents: contents } };
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id, disposed: false });
  return { controller, tab, contents };
}

afterEach(() => vi.useRealTimers());

describe('Page font inspection', () => {
  it('samples a bounded DOM/font inventory without reading page text or font URLs', () => {
    let elementsRead = 0;
    const element = { get textContent() { throw new Error('Page text must remain private'); } };
    const fonts = Array.from({ length: 500 }, () => ({ family: 'Monomakh', style: 'normal', weight: '400', status: 'loaded', url: 'secret' }));
    Object.assign(fonts, { status: 'loaded' });
    const result = vm.runInNewContext(PAGE_FONT_PROBE, {
      document: { fonts, body: element, createTreeWalker: () => ({ currentNode: element, nextNode: () => element }) },
      NodeFilter: { SHOW_ELEMENT: 1 },
      getComputedStyle: () => { elementsRead++; return { fontFamily: 'Monomakh, serif', fontStyle: 'normal', fontWeight: '400' }; },
    });
    expect(elementsRead).toBe(150);
    expect(result.sampledElements).toBe(150);
    expect(result.computedFonts).toHaveLength(1);
    expect(result.computedFonts[0].count).toBe(150);
    expect(result.faces).toHaveLength(100);
    expect(result.facesTruncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns only font metadata from the isolated world and removes undeclared fields', async () => {
    const raw = { ...data(), cookies: 'secret', text: 'page body', faces: [{ ...data().faces[0], sourceUrl: 'secret' }] };
    const contents = { executeJavaScriptInIsolatedWorld: vi.fn(async () => raw) } as any;
    const result = await inspectPageFonts(contents);
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(999, [{ code: PAGE_FONT_PROBE }], false);
    expect(result).toEqual(data());
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('times out a nonresponsive renderer and releases the deadline timer on success', async () => {
    vi.useFakeTimers();
    const never = { executeJavaScriptInIsolatedWorld: () => new Promise(() => {}) } as any;
    const pending = inspectPageFonts(never);
    const rejected = expect(pending).rejects.toThrow('не ответила');
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await inspectPageFonts({ executeJavaScriptInIsolatedWorld: async () => data() } as any);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not invent loaded fonts for a malformed renderer response', async () => {
    await expect(inspectPageFonts({ executeJavaScriptInIsolatedWorld: async () => ({ documentStatus: 'unknown', text: 'secret' }) } as any))
      .rejects.toThrow('Не удалось');
  });

  it('refuses absent, suspended, internal or inactive private pages before accessing them', async () => {
    const { controller, tab, contents } = fixture();
    await expect(controller.getPageFonts('missing')).rejects.toThrow('Откройте');
    for (const patch of [{ isInternal: true }, { lifecycle: 'hibernated' }, { lifecycle: 'crashed' }, { isPrivate: true }]) {
      const original = { ...tab };
      Object.assign(tab, patch);
      if (patch.isPrivate) controller.activeTabId = 'other';
      await expect(controller.getPageFonts(tab.id)).rejects.toThrow('Откройте');
      Object.assign(tab, original);
    }
    expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });

  it.each(['close', 'navigate', 'replace-view', 'leave-private'])('rejects stale inspection after %s', async (change) => {
    const { controller, tab, contents } = fixture();
    if (change === 'leave-private') tab.isPrivate = true;
    const read = deferred();
    contents.executeJavaScriptInIsolatedWorld = vi.fn(() => read.promise) as any;
    const pending = controller.getPageFonts(tab.id);
    if (change === 'close') controller.tabs.delete(tab.id);
    if (change === 'navigate') tab.url = 'https://other.test/';
    if (change === 'replace-view') tab.view = { webContents: {} } as any;
    if (change === 'leave-private') controller.activeTabId = 'other';
    read.resolve(data());
    await expect(pending).rejects.toThrow('изменилась');
  });

  it('returns a live private-page snapshot only after an explicit current-tab call', async () => {
    const { controller, tab } = fixture();
    tab.isPrivate = true;
    expect(await controller.getPageFonts(tab.id)).toMatchObject({ ...data(), tabId: tab.id, sampledAt: expect.any(Number) });
  });
});
