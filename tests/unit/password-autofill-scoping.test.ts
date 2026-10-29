import { afterEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('electron', () => ({ ipcRenderer: { send, invoke } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

class MockElement {
  tagName = 'DIV';
  attributes = new Map<string, string>();
  className = '';
  parentElement: MockElement | null = null;
  form: any = null;

  getAttribute(name: string): string | null {
    if (this.attributes.has(name)) return this.attributes.get(name)!;
    if (name in this) {
      const val = (this as any)[name];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    return null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  closest(selector: string): any {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.includes('search') && (curr.className.includes('search') || curr.getAttribute('role') === 'search')) return curr;
      if (selector.includes('login') && curr.className.includes('login')) return curr;
      if (selector.includes('auth') && curr.className.includes('auth')) return curr;
      if (selector.includes('form') && (curr.tagName === 'FORM' || curr.getAttribute('role') === 'form')) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

class MockInput extends MockElement {
  tagName = 'INPUT';
  type = 'text';
  name = '';
  id = '';
  placeholder = '';
  value = '';
  role = '';
  autocomplete = '';
  isConnected = true;
  offsetWidth = 200;
  offsetHeight = 32;
  readOnly = false;
  disabled = false;
  getClientRects() { return [{}]; }
  getBoundingClientRect() {
    return { top: 100, bottom: 132, left: 50, right: 250, width: 200, height: 32 };
  }
  dispatchEvent(_event: any) { return true; }
}

class MockForm extends MockElement {
  tagName = 'FORM';
  inputs: MockInput[] = [];
  querySelectorAll(sel: string) {
    if (sel.includes('password')) return this.inputs.filter(i => i.type === 'password');
    return this.inputs;
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

describe('Password and login input scoping', () => {
  it('excludes search, chat, comment, promo and address inputs from credentials', async () => {
    vi.stubGlobal('HTMLInputElement', MockInput);
    vi.stubGlobal('HTMLElement', MockElement);
    vi.stubGlobal('window', {
      location: { origin: 'https://youtube.com', href: 'https://youtube.com', pathname: '/', hostname: 'youtube.com' },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: vi.fn(),
    });

    const { isExcludedInput, isLoginOrPasswordInput } = await import('../../src/preload/page-preload');

    // 1. Search inputs
    const ytSearch = new MockInput();
    ytSearch.name = 'search_query';
    ytSearch.placeholder = 'Поиск';
    expect(isExcludedInput(ytSearch as any)).toBe(true);
    expect(isLoginOrPasswordInput(ytSearch as any)).toBe(false);

    const typeSearch = new MockInput();
    typeSearch.type = 'search';
    expect(isExcludedInput(typeSearch as any)).toBe(true);
    expect(isLoginOrPasswordInput(typeSearch as any)).toBe(false);

    const roleSearch = new MockInput();
    roleSearch.setAttribute('role', 'searchbox');
    expect(isExcludedInput(roleSearch as any)).toBe(true);
    expect(isLoginOrPasswordInput(roleSearch as any)).toBe(false);

    // 2. Chat / comment inputs
    const chatInput = new MockInput();
    chatInput.placeholder = 'Напишите сообщение...';
    expect(isExcludedInput(chatInput as any)).toBe(true);
    expect(isLoginOrPasswordInput(chatInput as any)).toBe(false);

    const commentInput = new MockInput();
    commentInput.name = 'comment_body';
    expect(isExcludedInput(commentInput as any)).toBe(true);
    expect(isLoginOrPasswordInput(commentInput as any)).toBe(false);

    // 3. Promo code inputs
    const promoInput = new MockInput();
    promoInput.name = 'promocode';
    expect(isExcludedInput(promoInput as any)).toBe(true);
    expect(isLoginOrPasswordInput(promoInput as any)).toBe(false);

    // 4. Address inputs
    const addressInput = new MockInput();
    addressInput.name = 'shipping_address';
    expect(isExcludedInput(addressInput as any)).toBe(true);
    expect(isLoginOrPasswordInput(addressInput as any)).toBe(false);

    // 5. Unrelated generic text input without auth context
    const tagInput = new MockInput();
    tagInput.name = 'blog_tags';
    expect(isLoginOrPasswordInput(tagInput as any)).toBe(false);
  });

  it('correctly identifies authentic password and login inputs', async () => {
    vi.stubGlobal('HTMLInputElement', MockInput);
    vi.stubGlobal('HTMLFormElement', MockForm);
    vi.stubGlobal('HTMLElement', MockElement);
    vi.stubGlobal('window', {
      location: { origin: 'https://vk.com', href: 'https://vk.com/login', pathname: '/login', hostname: 'vk.com' },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: vi.fn(),
    });

    const { isExcludedInput, isLoginOrPasswordInput } = await import('../../src/preload/page-preload');

    // 1. Password input
    const passInput = new MockInput();
    passInput.type = 'password';
    passInput.name = 'password';
    expect(isExcludedInput(passInput as any)).toBe(false);
    expect(isLoginOrPasswordInput(passInput as any)).toBe(true);

    // 2. Form with username and password
    const form = new MockForm();
    const userInput = new MockInput();
    userInput.name = 'login';
    userInput.placeholder = 'Телефон или email';
    userInput.form = form;
    passInput.form = form;
    form.inputs = [userInput, passInput];

    expect(isExcludedInput(userInput as any)).toBe(false);
    expect(isLoginOrPasswordInput(userInput as any)).toBe(true);

    // 3. Explicit autocomplete="username"
    const standardUserInput = new MockInput();
    standardUserInput.setAttribute('autocomplete', 'username');
    expect(isExcludedInput(standardUserInput as any)).toBe(false);
    expect(isLoginOrPasswordInput(standardUserInput as any)).toBe(true);

    // 4. Two-step login username input on /login page
    const twoStepLogin = new MockInput();
    twoStepLogin.name = 'user_login';
    expect(isExcludedInput(twoStepLogin as any)).toBe(false);
    expect(isLoginOrPasswordInput(twoStepLogin as any)).toBe(true);
  });

  it('triggers autofill dropdown ONLY for auth inputs and dismisses on typing or Escape', async () => {
    vi.resetModules();
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const appendedElements: MockElement[] = [];

    const mockBody = new MockElement();
    mockBody.tagName = 'BODY';
    (mockBody as any).appendChild = (child: MockElement) => {
      appendedElements.push(child);
      (child as any).remove = () => {
        const idx = appendedElements.indexOf(child);
        if (idx !== -1) appendedElements.splice(idx, 1);
      };
      return child;
    };

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'page:get-autofill-credentials') {
        return [{ id: 'cred-1', username: 'testuser@vk.com', password: 'Secret123!' }];
      }
      return null;
    });

    vi.stubGlobal('HTMLInputElement', MockInput);
    vi.stubGlobal('HTMLFormElement', MockForm);
    vi.stubGlobal('HTMLElement', MockElement);
    vi.stubGlobal('HTMLDivElement', MockElement);
    vi.stubGlobal('window', {
      location: { origin: 'https://vk.com', href: 'https://vk.com/feed', pathname: '/feed', hostname: 'vk.com', protocol: 'https:' },
      addEventListener: (name: string, fn: (event: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      innerWidth: 1920,
      innerHeight: 1080,
    });
    vi.stubGlobal('document', {
      body: mockBody,
      documentElement: mockBody,
      readyState: 'complete',
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag: string) => {
        const el = new MockElement();
        el.tagName = tag.toUpperCase();
        (el as any).style = {};
        (el as any).appendChild = (c: MockElement) => {
          (el as any)._children = (el as any)._children || [];
          (el as any)._children.push(c);
          return c;
        };
        (el as any).addEventListener = vi.fn();
        return el;
      },
      addEventListener: vi.fn(),
    });

    await import('../../src/preload/page-preload');

    const focusinListeners = listeners.get('focusin') ?? [];
    const inputListeners = listeners.get('input') ?? [];
    const keydownListeners = listeners.get('keydown') ?? [];
    expect(focusinListeners.length).toBeGreaterThan(0);

    // 1. Focusing a search bar should NOT invoke credentials and NOT create a dropdown
    const searchInput = new MockInput();
    searchInput.name = 'search';
    searchInput.placeholder = 'Поиск по сайту';

    for (const fn of focusinListeners) {
      fn({ target: searchInput, composedPath: () => [searchInput] });
    }

    // Give any async calls a tick to complete
    await new Promise(r => setTimeout(r, 10));
    expect(appendedElements.length).toBe(0);
    expect(invoke).not.toHaveBeenCalledWith('page:get-autofill-credentials', expect.anything());

    // 2. Focusing a password input SHOULD invoke credentials and create a dropdown
    const passInput = new MockInput();
    passInput.type = 'password';

    for (const fn of focusinListeners) {
      fn({ target: passInput, composedPath: () => [passInput] });
    }

    await new Promise(r => setTimeout(r, 20));
    expect(appendedElements.length).toBe(1);
    expect(appendedElements[0].getAttribute('data-soulm8te-autofill')).toBe('true');

    // 3. Typing in active target input should immediately dismiss dropdown
    for (const fn of inputListeners) {
      fn({ isTrusted: true, target: passInput, composedPath: () => [passInput] });
    }
    expect(appendedElements.length).toBe(0);

    // 4. Focusing password input again recreates dropdown
    for (const fn of focusinListeners) {
      fn({ target: passInput, composedPath: () => [passInput] });
    }
    await new Promise(r => setTimeout(r, 20));
    expect(appendedElements.length).toBe(1);

    // 5. Pressing Escape dismisses dropdown
    for (const fn of keydownListeners) {
      fn({ key: 'Escape' });
    }
    expect(appendedElements.length).toBe(0);
  });
});
