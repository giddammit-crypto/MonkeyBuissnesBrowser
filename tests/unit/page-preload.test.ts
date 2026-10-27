import { afterEach, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ ipcRenderer: { send } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('keeps unsaved input protected when a trusted SPA submit leaves the document in place', async () => {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  class Input {}
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
  });
  await import('../../src/preload/page-preload');
  for (const listener of listeners.get('input') ?? []) listener({ isTrusted: true, target: new Input() });
  expect(send).toHaveBeenCalledWith('page:form-state', true);
  // A valid submit can be cancelled by an SPA handler or fail on the server.
  for (const listener of listeners.get('submit') ?? []) listener({ isTrusted: true, defaultPrevented: true });
  expect(send).not.toHaveBeenCalledWith('page:form-state', false);
});

it.each(['input', 'change'])('protects unsaved select controls through %s including shadow DOM retargeting', async (eventName) => {
  vi.resetModules();
  const listeners = new Map<string, (event: unknown) => void>();
  class Select {}
  vi.stubGlobal('HTMLSelectElement', Select);
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('window', { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) });
  await import('../../src/preload/page-preload');
  const target = new Select();
  listeners.get(eventName)?.({ isTrusted: false, target });
  expect(send).not.toHaveBeenCalled();
  listeners.get(eventName)?.({ isTrusted: true, target: {}, composedPath: () => [target] });
  expect(send).toHaveBeenCalledExactlyOnceWith('page:form-state', true);
  listeners.get(eventName)?.({ isTrusted: true, target });
  expect(send).toHaveBeenCalledTimes(1);
});

it('coalesces mutation storms and avoids video DOM walks on ordinary key presses', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown) => void>();
  const observers: Array<() => void> = [];
  const querySelectorAll = vi.fn(() => []);
  vi.stubGlobal('window', { location: { hostname: 'example.test', href: 'https://example.test/' }, addEventListener: vi.fn() });
  vi.stubGlobal('document', {
    readyState: 'complete', documentElement: {}, body: {}, activeElement: null,
    querySelectorAll, querySelector: () => null, getElementsByTagName: () => [],
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
  });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {}
  });
  try {
    await import('../../src/preload/page-preload');
    querySelectorAll.mockClear();
    for (let i = 0; i < 100; i++) observers.forEach(callback => callback());
    expect(querySelectorAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(querySelectorAll.mock.calls).toEqual([['video'], ['*']]);
    querySelectorAll.mockClear();
    listeners.get('keydown')?.({ key: 'a' });
    listeners.get('keydown')?.({ key: ']', isComposing: true });
    listeners.get('keydown')?.({ key: ']', defaultPrevented: true });
    expect(querySelectorAll).not.toHaveBeenCalled();
    listeners.get('keydown')?.({ key: ']' });
    expect(querySelectorAll.mock.calls).toEqual([['video'], ['*']]);
  } finally { vi.useRealTimers(); }
});
