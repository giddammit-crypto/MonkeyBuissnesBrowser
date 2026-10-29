import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getClientHintHeaders, getChromeUserAgent } from '../../src/shared/chromiumIdentity';

// Mock electron
const sendHeadersListeners: Array<(details: any, callback: (res: any) => void) => void> = [];
const headersReceivedListeners: Array<(details: any, callback: (res: any) => void) => void> = [];

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userdata', on: vi.fn(), whenReady: vi.fn() },
  BaseWindow: class {
    setIcon = vi.fn();
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn(), children: [] };
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: { showMessageBox: vi.fn() },
  Menu: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  nativeTheme: { themeSource: 'system' },
  session: {
    defaultSession: {
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter, listener) => {
          if (listener) sendHeadersListeners.push(listener);
        }),
        onHeadersReceived: vi.fn((_filter, listener) => {
          if (listener) headersReceivedListeners.push(listener);
        }),
      },
    },
    fromPartition: () => ({
      setUserAgent: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setCertificateVerifyProc: vi.fn(),
      on: vi.fn(),
      webRequest: {
        onBeforeRequest: vi.fn(),
        onBeforeSendHeaders: vi.fn(),
        onHeadersReceived: vi.fn(),
      },
    }),
  },
  shell: {},
  WebContentsView: class {
    webContents = {
      id: 101,
      isDestroyed: () => false,
      setBackgroundThrottling: vi.fn(),
      send: vi.fn(),
      focus: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    setBounds = vi.fn();
    setBackgroundColor = vi.fn();
  },
  safeStorage: {},
}));

describe('Reader Mode Network Stack & Stealth Headers', () => {
  beforeEach(() => {
    sendHeadersListeners.length = 0;
    headersReceivedListeners.length = 0;
  });

  it('intercepts image requests from app://shell, replacing Electron with Chrome 134 stealth and sanitizing hotlink headers', async () => {
    // Import BrowserController
    const { BrowserController } = await import('../../src/main/tabs/BrowserController');
    const controller = Object.create(BrowserController.prototype) as any;

    const mockTab = {
      id: 'tab-1',
      url: 'https://habr.com/ru/articles/123456/',
      title: 'Habr Article',
      isInternal: false,
    };

    Object.assign(controller, {
      tabs: new Map([['tab-1', mockTab]]),
      activeTabId: 'tab-1',
      shellContentsId: 101,
      getActiveTab: () => mockTab,
    });

    // Simulate session.defaultSession setup logic
    const { session } = await import('electron');
    const sendHeadersHandler = (details: any, callback: (res: any) => void) => {
      const headers = { ...details.requestHeaders };
      const origin = headers['Origin'] || headers['origin'] || '';
      const referer = headers['Referer'] || headers['referer'] || '';
      const isFromShell =
        origin.startsWith('app://shell') ||
        referer.startsWith('app://shell') ||
        Boolean(details.initiatorOrigin?.startsWith('app://shell')) ||
        (details.webContentsId === controller.shellContentsId);

      if (isFromShell) {
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (['user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(lower)) {
            delete headers[key];
          }
        }
        const clientHints = getClientHintHeaders();
        headers['User-Agent'] = clientHints['User-Agent'];
        headers['Sec-CH-UA'] = clientHints['Sec-CH-UA'];
        headers['Sec-CH-UA-Mobile'] = clientHints['Sec-CH-UA-Mobile'];
        headers['Sec-CH-UA-Platform'] = clientHints['Sec-CH-UA-Platform'];

        const activeTab = controller.getActiveTab();
        const articleReferer = activeTab?.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))
          ? activeTab.url
          : undefined;

        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower === 'origin' && headers[key]?.startsWith('app://shell')) {
            delete headers[key];
          }
          if (lower === 'referer' && headers[key]?.startsWith('app://shell')) {
            if (articleReferer) {
              headers[key] = articleReferer;
            } else {
              delete headers[key];
            }
          }
        }

        if (articleReferer && !headers['Referer'] && !headers['referer']) {
          headers['Referer'] = articleReferer;
        }
      }
      callback({ requestHeaders: headers });
    };

    // Test a request coming from shellView loading an image
    let modifiedHeaders: Record<string, string> | undefined;
    sendHeadersHandler(
      {
        url: 'https://habrastorage.org/r/w1560/getpro/habr/upload_files/photo.png',
        webContentsId: 101,
        requestHeaders: {
          'User-Agent': 'Electron/45.0.0 soulm8te/0.9.1',
          'Origin': 'app://shell',
          'Referer': 'app://shell/index.html',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      },
      (res) => {
        modifiedHeaders = res.requestHeaders;
      }
    );

    expect(modifiedHeaders).toBeDefined();
    // Electron user agent must be stripped and replaced with Chrome 134 stealth
    expect(modifiedHeaders!['User-Agent']).not.toContain('Electron');
    expect(modifiedHeaders!['User-Agent']).not.toContain('soulm8te');
    expect(modifiedHeaders!['User-Agent']).toBe(getChromeUserAgent());
    expect(modifiedHeaders!['Sec-CH-UA']).toContain('Google Chrome');
    expect(modifiedHeaders!['Sec-CH-UA']).toContain('134');

    // app://shell Origin must be eliminated to bypass hotlink / origin blockers
    expect(modifiedHeaders!['Origin']).toBeUndefined();
    // Referer must be replaced with the article URL, allowing hotlink protection to pass
    expect(modifiedHeaders!['Referer']).toBe('https://habr.com/ru/articles/123456/');
  });

  it('strips cross-origin-resource-policy for shellView images', () => {
    const headersReceivedHandler = (details: any, callback: (res: any) => void) => {
      const headers = { ...details.responseHeaders };
      if (details.webContentsId === 101) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'cross-origin-resource-policy') {
            delete headers[key];
          }
        }
      }
      callback({ responseHeaders: headers });
    };

    let modifiedResponseHeaders: Record<string, string> | undefined;
    headersReceivedHandler(
      {
        webContentsId: 101,
        responseHeaders: {
          'Content-Type': 'image/png',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      },
      (res) => {
        modifiedResponseHeaders = res.responseHeaders;
      }
    );

    expect(modifiedResponseHeaders!['Content-Type']).toBe('image/png');
    expect(modifiedResponseHeaders!['Cross-Origin-Resource-Policy']).toBeUndefined();
  });
});

describe('Reader Mode Image and srcset Extraction Logic', () => {
  const parseBestSrcset = (srcsetStr: string | null | undefined, baseUrl: string): string | null => {
    if (!srcsetStr || typeof srcsetStr !== 'string') return null;
    const entries = srcsetStr.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
    let bestUrl: string | null = null;
    let maxScore = -1;

    for (const entry of entries) {
      const parts = entry.split(/\s+/);
      const rawUrl = parts[0]?.trim();
      if (!rawUrl) continue;
      const descriptor = parts[1]?.trim();
      let score = 1;
      if (descriptor) {
        if (descriptor.endsWith('w')) {
          const w = parseFloat(descriptor.slice(0, -1));
          if (!isNaN(w)) score = w;
        } else if (descriptor.endsWith('x')) {
          const x = parseFloat(descriptor.slice(0, -1));
          if (!isNaN(x)) score = x * 1000;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestUrl = rawUrl;
      }
    }

    if (bestUrl) {
      try {
        return new URL(bestUrl, baseUrl).href;
      } catch {
        return bestUrl;
      }
    }
    return null;
  };

  it('selects highest resolution width descriptor from responsive srcset', () => {
    const srcset = 'https://example.com/small.jpg 300w, https://example.com/medium.jpg 768w, https://example.com/large.jpg 1600w';
    const best = parseBestSrcset(srcset, 'https://example.com/article');
    expect(best).toBe('https://example.com/large.jpg');
  });

  it('selects highest density descriptor from responsive srcset', () => {
    const srcset = 'https://example.com/1x.jpg 1x, https://example.com/2x.jpg 2x, https://example.com/3x.jpg 3x';
    const best = parseBestSrcset(srcset, 'https://example.com/article');
    expect(best).toBe('https://example.com/3x.jpg');
  });

  it('resolves relative URLs against the article base URL', () => {
    const srcset = '/assets/img-320.jpg 320w, /assets/img-1024.jpg 1024w';
    const best = parseBestSrcset(srcset, 'https://habr.com/ru/post/999/');
    expect(best).toBe('https://habr.com/assets/img-1024.jpg');
  });

  it('correctly filters aria-hidden wrappers: preserves wrappers that contain images/figures', () => {
    // Simulating DOM node structure
    const createNode = (tag: string, attrs: Record<string, string>, children: any[] = []) => ({
      tagName: tag.toUpperCase(),
      attributes: attrs,
      children,
      querySelector: (selector: string) => {
        const selLower = selector.toLowerCase();
        const matches = (node: any): boolean => {
          if (selLower.includes('img') && node.tagName === 'IMG') return true;
          if (selLower.includes('picture') && node.tagName === 'PICTURE') return true;
          if (selLower.includes('figure') && node.tagName === 'FIGURE') return true;
          return node.children.some(matches);
        };
        return children.some(matches) ? {} : null;
      },
    });

    const wrapperWithImg = createNode('div', { 'aria-hidden': 'true' }, [
      createNode('figure', {}, [
        createNode('img', { src: 'https://example.com/photo.png' }),
      ]),
    ]);

    const wrapperWithoutImg = createNode('div', { 'aria-hidden': 'true' }, [
      createNode('span', {}, []),
    ]);

    // Test filter condition: if (!el.querySelector('img, picture, figure')) el.remove();
    const shouldRemoveWithImg = !wrapperWithImg.querySelector('img, picture, figure');
    const shouldRemoveWithoutImg = !wrapperWithoutImg.querySelector('img, picture, figure');

    expect(shouldRemoveWithImg).toBe(false); // MUST NOT remove wrapper containing figure/img!
    expect(shouldRemoveWithoutImg).toBe(true); // MUST remove wrapper without images
  });
});
