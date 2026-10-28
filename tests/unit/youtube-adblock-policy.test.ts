import { afterEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ send: vi.fn(), invoke: vi.fn(), on: vi.fn() }));
vi.mock('electron', () => ({ ipcRenderer: transport }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('does not start cosmetic DOM changes without an explicitly enabled policy and cleans up once on opt-out', async () => {
  vi.resetModules();
  const { createYouTubeAdBlockPolicyGate } = await import('../../src/preload/page-preload');
  const cleanup = vi.fn();
  const start = vi.fn(() => cleanup);
  const apply = createYouTubeAdBlockPolicyGate(start);
  for (const policy of [false, undefined, null, 'true', 1]) apply(policy);
  expect(start).not.toHaveBeenCalled();
  apply(true); apply(true);
  expect(start).toHaveBeenCalledTimes(1);
  apply(false); apply(false);
  expect(cleanup).toHaveBeenCalledTimes(1);
  apply(true);
  expect(start).toHaveBeenCalledTimes(2);
});

it('respects the initial disabled YouTube policy, removes CSS/timer on live opt-out and restores player audio/rate', async () => {
  vi.resetModules(); vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown, policy: unknown) => void>();
  const styles = new Map<string, { id: string; textContent: string; remove: () => void }>();
  const observers: Array<{ disconnected: boolean }> = [];
  const playerVideo = { playbackRate: 1.25, muted: false, paused: false, duration: 40, currentTime: 0 };
  const player = { classList: { contains: (name: string) => name === 'ad-showing' }, querySelector: () => playerVideo };
  transport.invoke.mockResolvedValue(false);
  transport.on.mockImplementation((channel, listener) => listeners.set(channel, listener));
  vi.stubGlobal('window', { location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=fixture' }, addEventListener: vi.fn() });
  vi.stubGlobal('document', {
    readyState: 'complete', documentElement: {}, body: {}, activeElement: null,
    head: { appendChild: (element: { id: string; textContent: string; remove: () => void }) => styles.set(element.id, element) },
    getElementById: (id: string) => styles.get(id) || null,
    createElement: () => {
      const element = { id: '', textContent: '', remove: () => styles.delete(element.id) };
      return element;
    },
    querySelector: (selector: string) => selector === '#movie_player, .html5-video-player' ? player : selector === 'video' ? playerVideo : null,
    querySelectorAll: () => [], getElementsByTagName: () => [], addEventListener: vi.fn(),
  });
  vi.stubGlobal('MutationObserver', class {
    disconnected = false;
    constructor() { observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  });
  await import('../../src/preload/page-preload');
  await Promise.resolve();
  expect(transport.invoke).toHaveBeenCalledWith('page:get-adblock-policy');
  expect(styles.has('soul-yt-adblock-styles')).toBe(false);
  const baselineTimers = vi.getTimerCount();
  listeners.get('page:adblock-policy')?.({}, true);
  expect(styles.has('soul-yt-adblock-styles')).toBe(true);
  expect(vi.getTimerCount()).toBe(baselineTimers + 1);
  vi.advanceTimersByTime(150);
  expect(playerVideo).toMatchObject({ muted: true, playbackRate: 16 });
  listeners.get('page:adblock-policy')?.({}, false);
  expect(styles.has('soul-yt-adblock-styles')).toBe(false);
  expect(vi.getTimerCount()).toBe(baselineTimers);
  expect(playerVideo).toMatchObject({ muted: false, playbackRate: 1.25 });
  expect(observers.some((observer) => observer.disconnected)).toBe(true);
});

it('does not let a stale initial policy response re-enable a newer site opt-out', async () => {
  vi.resetModules(); vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown, policy: unknown) => void>();
  const styles = new Map<string, unknown>();
  let resolvePolicy!: (enabled: boolean) => void;
  transport.invoke.mockImplementation(() => new Promise<boolean>((resolve) => { resolvePolicy = resolve; }));
  transport.on.mockImplementation((channel, listener) => listeners.set(channel, listener));
  vi.stubGlobal('window', { location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/' }, addEventListener: vi.fn() });
  vi.stubGlobal('document', {
    readyState: 'complete', documentElement: {}, body: {}, activeElement: null,
    head: { appendChild: (style: { id: string }) => styles.set(style.id, style) },
    getElementById: (id: string) => styles.get(id) || null, createElement: () => ({ id: '', textContent: '' }),
    querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [], addEventListener: vi.fn(),
  });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  await import('../../src/preload/page-preload');
  listeners.get('page:adblock-policy')?.({}, false);
  resolvePolicy(true);
  await Promise.resolve();
  expect(styles.has('soul-yt-adblock-styles')).toBe(false);
});
