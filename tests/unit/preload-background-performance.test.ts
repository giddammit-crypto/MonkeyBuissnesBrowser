import { afterEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcRenderer: { send: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('suspends hidden DOM polling and resumes it without disabling playback events', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const listeners = new Map<string, Array<(event?: unknown) => void>>();
  const windowListeners = new Map<string, Array<() => void>>();
  const observers: Array<() => void> = [];
  const querySelectorAll = vi.fn(() => []);
  const documentMock = {
    hidden: false, readyState: 'complete', documentElement: {}, body: {}, activeElement: null,
    querySelectorAll, querySelector: () => null, getElementsByTagName: () => [],
    addEventListener: (name: string, listener: (event?: unknown) => void) => listeners.set(name, [...(listeners.get(name) || []), listener]),
  };
  vi.stubGlobal('window', { location: { hostname: 'example.test', href: 'https://example.test/' },
    addEventListener: (name: string, listener: () => void) => windowListeners.set(name, [...(windowListeners.get(name) || []), listener]) });
  vi.stubGlobal('document', documentMock);
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} });
  await import('../../src/preload/page-preload');
  querySelectorAll.mockClear();
  documentMock.hidden = true;
  listeners.get('visibilitychange')?.forEach(callback => callback());
  for (let i = 0; i < 100; i++) observers.forEach(callback => callback());
  vi.advanceTimersByTime(10000);
  expect(querySelectorAll).not.toHaveBeenCalled();
  // Media playback still gets an immediate presence check while hidden.
  listeners.get('playing')?.forEach(callback => callback());
  expect(querySelectorAll).toHaveBeenCalledWith('video');
  querySelectorAll.mockClear();
  documentMock.hidden = false;
  listeners.get('visibilitychange')?.forEach(callback => callback());
  vi.advanceTimersByTime(250);
  expect(querySelectorAll).toHaveBeenCalledWith('video');
  querySelectorAll.mockClear();
  windowListeners.get('pagehide')?.forEach(callback => callback());
  vi.advanceTimersByTime(10000);
  expect(querySelectorAll).not.toHaveBeenCalled();
  windowListeners.get('pageshow')?.forEach(callback => callback());
  vi.advanceTimersByTime(250);
  expect(querySelectorAll).toHaveBeenCalledWith('video');
});
