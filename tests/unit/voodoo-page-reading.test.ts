import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/path', on: vi.fn(), whenReady: vi.fn() },
  BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, nativeTheme: {},
  session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn() }) },
  shell: {}, WebContentsView: class {}, safeStorage: {},
}));

import { BrowserController } from '../../src/main/tabs/BrowserController';

function reader(text: string, hrefs: Array<{ href: string; title: string }> = [], options: { sensitive?: boolean; fail?: boolean; noBody?: boolean } = {}) {
  const removed = new Set<string>();
  const clone = {
    get textContent() {
      return text + (options.sensitive && !removed.has('textarea') ? ' SECRET_DRAFT' : '')
        + (options.sensitive && !removed.has('input') ? ' SECRET_PASSWORD' : '')
        + (options.sensitive && !removed.has('[contenteditable="true"]') ? ' SECRET_COMPOSER' : '');
    },
    querySelectorAll: (selector: string) => [{ remove: () => removed.add(selector) }],
  };
  const document = {
    title: 'Search results',
    baseURI: 'https://example.com/search/',
    body: options.noBody ? null : { cloneNode: () => { if (options.fail) throw new Error('DOM read failed'); return clone; } },
    querySelectorAll: (selector: string) => selector === 'a[href]' ? hrefs.map(link => ({
      textContent: link.title,
      getAttribute: (name: string) => name === 'href' ? link.href : null,
    })) : [{ textContent: 'Results' }],
  };
  const contents = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    executeJavaScript: vi.fn((code: string) => Promise.resolve(runInNewContext(code, {
      document, location: { href: 'https://example.com/search/' }, URL,
    }))),
  };
  const controller = Object.create(BrowserController.prototype) as BrowserController;
  Object.assign(controller, {
    activeTabId: 'tab',
    tabs: new Map([['tab', { id: 'tab', title: document.title, isInternal: false, view: { webContents: contents } }]]),
  });
  return { read: (args = {}) => controller.executeVoodooTool('read_page', args), removed };
}

describe('Voodoo read_page navigation evidence', () => {
  it('returns contiguous pages with an explicit continuation offset through the end', async () => {
    const { read } = reader('Alpha Beta Gamma Delta');
    const first = await read({ max_length: 10 });
    expect(first.success).toBe(true);
    expect(first.result).toMatchObject({ text: 'Alpha Beta', start: 0, totalLength: 22, next_start: 10, truncated: true });
    const second = await read({ max_length: 10, start: 10 });
    expect(second.result).toMatchObject({ text: ' Gamma Del', start: 10, next_start: 20, truncated: true });
    const last = await read({ max_length: 10, start: 20 });
    expect(last.result).toMatchObject({ text: 'ta', start: 20, next_start: null, truncated: false });
  });

  it('normalizes whitespace before calculating offsets and clamps offsets and page size', async () => {
    const { read } = reader('  Alpha\n   Beta  ');
    expect((await read({ start: -9, max_length: 0.5 })).result).toMatchObject({ text: 'A', start: 0, next_start: 1, totalLength: 10 });
    expect((await read({ start: 100 })).result).toMatchObject({ text: '', start: 10, next_start: null, truncated: false });
    expect((await read({ start: Number.POSITIVE_INFINITY })).result).toMatchObject({ start: 0 });
    const long = reader('x'.repeat(60000));
    expect((await long.read({ max_length: 100000 })).result).toMatchObject({ text: 'x'.repeat(50000), next_start: 50000, truncated: true });
  });

  it('returns absolute distinct HTTP links and titles, capped at 40', async () => {
    const hrefs = [
      { href: 'javascript:alert(1)', title: 'bad' },
      { href: 'file:///private.txt', title: 'private' },
      { href: 'mailto:person@example.com', title: 'mail' },
      { href: '../article', title: '  Read\n article  ' },
      { href: 'https://example.com/article', title: 'duplicate' },
      ...Array.from({ length: 45 }, (_, i) => ({ href: `https://news.example/${i}`, title: `Story ${i}` })),
    ];
    const { read } = reader('results', hrefs);
    const result = (await read()).result as any;
    expect(result.links).toHaveLength(40);
    expect(result.links[0]).toEqual({ title: 'Read article', href: 'https://example.com/article' });
    expect(result.links.every((link: any) => /^https?:/.test(link.href))).toBe(true);
  });

  it('removes form and composer values before extracting text', async () => {
    const { read, removed } = reader('Public page', [], { sensitive: true });
    expect((await read()).result).toMatchObject({ text: 'Public page' });
    expect(removed.has('input')).toBe(true);
    expect(removed.has('textarea')).toBe(true);
    expect(removed.has('select')).toBe(true);
    expect(removed.has('[contenteditable="true"]')).toBe(true);
  });

  it('reports page script errors as failures', async () => {
    const { read } = reader('', [], { fail: true });
    const result = await read();
    expect(result.success).toBe(false);
    expect(result.error).toContain('DOM read failed');
  });

  it('returns a consistent empty page when body is unavailable', async () => {
    const { read } = reader('', [], { noBody: true });
    expect((await read()).result).toMatchObject({ text: '', totalLength: 0, start: 0, next_start: null, truncated: false, links: [] });
  });
});
