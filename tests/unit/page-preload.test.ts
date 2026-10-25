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
