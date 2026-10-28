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

it('intercepts ctrl/meta + wheel to trigger zoom-in and zoom-out IPC', async () => {
  vi.resetModules();
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
  });
  await import('../../src/preload/page-preload');
  const wheelListeners = listeners.get('wheel') ?? [];
  expect(wheelListeners.length).toBeGreaterThan(0);

  // Normal wheel without modifier
  const normalEvent = { ctrlKey: false, metaKey: false, deltaY: -100, preventDefault: vi.fn() };
  for (const listener of wheelListeners) listener(normalEvent);
  expect(normalEvent.preventDefault).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalledWith('page:zoom-wheel', expect.anything());

  // Ctrl + Wheel Up (deltaY < 0, forward) -> zoom-in
  const zoomInEvent = { ctrlKey: true, metaKey: false, deltaY: -120, preventDefault: vi.fn() };
  for (const listener of wheelListeners) listener(zoomInEvent);
  expect(zoomInEvent.preventDefault).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('page:zoom-wheel', { direction: 'zoom-in' });

  // Cmd/Meta + Wheel Down (deltaY > 0, backward) -> zoom-out
  const zoomOutEvent = { ctrlKey: false, metaKey: true, deltaY: 100, preventDefault: vi.fn() };
  for (const listener of wheelListeners) listener(zoomOutEvent);
  expect(zoomOutEvent.preventDefault).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('page:zoom-wheel', { direction: 'zoom-out' });
});

it('captures password form submissions on submit, click and Enter keydown', async () => {
  vi.resetModules();
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  class FakeNode {
    compareDocumentPosition(other: FakeNode): number {
      return (this as unknown as { _order: number })._order < (other as unknown as { _order: number })._order
        ? 2 // DOCUMENT_POSITION_PRECEDING for other relative to this
        : 4;
    }
  }

  class FakeElement extends FakeNode {
    attributes = new Map<string, string>();
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }
    closest(_selector: string): any {
      return null;
    }
  }

  class FakeInput extends FakeElement {
    type = 'text';
    value = '';
    isConnected = true;
    offsetWidth = 150;
    offsetHeight = 32;
    getClientRects() {
      return [{}];
    }
  }

  class FakeForm extends FakeElement {
    inputs: FakeInput[] = [];
    querySelectorAll(selector: string): FakeInput[] {
      if (selector === 'input[type="password"]') {
        return this.inputs.filter(i => i.type === 'password');
      }
      return this.inputs;
    }
    querySelector(selector: string): FakeInput | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }

  vi.stubGlobal('Node', { DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4 });
  vi.stubGlobal('HTMLInputElement', FakeInput);
  vi.stubGlobal('HTMLFormElement', FakeForm);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('window', {
    location: {
      origin: 'https://login.example.org',
      href: 'https://login.example.org/signin',
      protocol: 'https:',
      hostname: 'login.example.org',
    },
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  });
  vi.stubGlobal('document', {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  });

  await import('../../src/preload/page-preload');

  // Case 1: Standard form submission with username and password
  const form = new FakeForm();
  const userInput = new FakeInput();
  userInput._order = 1;
  userInput.setAttribute('name', 'user_email');
  userInput.value = 'alice@example.com';
  userInput.closest = (s: string) => (s === 'form' ? form : null);

  const passInput = new FakeInput();
  passInput._order = 2;
  passInput.type = 'password';
  passInput.value = 'SecretPass123!';
  passInput.closest = (s: string) => (s === 'form' ? form : null);

  form.inputs = [userInput, passInput];

  // Submit event on window
  const submitListeners = listeners.get('submit') ?? [];
  expect(submitListeners.length).toBeGreaterThan(0);
  for (const listener of submitListeners) {
    listener({ target: form });
  }

  expect(send).toHaveBeenCalledWith('page:password-form-submitted', {
    origin: 'https://login.example.org',
    url: 'https://login.example.org/signin',
    username: 'alice@example.com',
    password: 'SecretPass123!',
  });

  // Case 2: Enter key in password field with new credentials
  passInput.value = 'UpdatedPass456!';
  const keydownListeners = listeners.get('keydown') ?? [];
  for (const listener of keydownListeners) {
    listener({ key: 'Enter', target: passInput, composedPath: () => [passInput] });
  }

  expect(send).toHaveBeenCalledWith('page:password-form-submitted', {
    origin: 'https://login.example.org',
    url: 'https://login.example.org/signin',
    username: 'alice@example.com',
    password: 'UpdatedPass456!',
  });
});


