import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {} }));
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { FilterEngine } from '../../src/services/adblock/FilterEngine';

function fixture() {
  const controller = Object.create(BrowserController.prototype) as any;
  const normal = {}, privateSession = {};
  const contents = (id: number, session: unknown) => ({ id, session, getURL: () => 'https://www.youtube.com/watch?v=example', isDestroyed: () => false, send: vi.fn() });
  const ordinary = contents(1, normal), privatePage = contents(2, privateSession), popup = contents(3, privateSession);
  let enabled = true;
  Object.assign(controller, { tabs: new Map([[1, { webContentsId: 1, view: { webContents: ordinary } }], [2, { webContentsId: 2, isPrivate: true, view: { webContents: privatePage } }]]),
    popupWindows: new Set([{ isDestroyed: () => false, webContents: popup }]), privateSession,
    adBlock: { engine: new FilterEngine() }, privateAdBlock: { engine: new FilterEngine() }, stores: { settings: { get: () => ({ adBlockEnabled: enabled }) } } });
  return { controller, ordinary, privatePage, popup, disable: () => { enabled = false; } };
}

describe('Page cosmetic adblock policy', () => {
  it('uses the actual sender document and honors global and per-site disabling in both profiles', () => {
    const { controller, disable } = fixture();
    expect(controller.getPageAdBlockPolicy(999)).toBe(false);
    expect(controller.getPageAdBlockPolicy(1)).toBe(true);
    controller.adBlock.engine.setExceptions(['youtube.com']);
    expect(controller.getPageAdBlockPolicy(1)).toBe(false);
    expect(controller.getPageAdBlockPolicy(2)).toBe(true);
    controller.privateAdBlock.engine.setExceptions(['youtube.com']);
    expect(controller.getPageAdBlockPolicy(2)).toBe(false);
    expect(controller.getPageAdBlockPolicy(3)).toBe(false);
    disable(); expect(controller.getPageAdBlockPolicy(1)).toBe(false);
  });

  it('pushes policy changes to existing ordinary, private and popup contents', () => {
    const { controller, ordinary, privatePage, popup, disable } = fixture();
    disable(); controller.broadcastPageAdBlockPolicy();
    for (const page of [ordinary, privatePage, popup]) expect(page.send).toHaveBeenCalledExactlyOnceWith('page:adblock-policy', false);
    controller.disposed = true; expect(controller.getPageAdBlockPolicy(1)).toBe(false);
  });
});
