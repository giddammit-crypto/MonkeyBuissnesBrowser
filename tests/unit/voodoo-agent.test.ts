import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/path', on: vi.fn(), whenReady: vi.fn() },
  BaseWindow: class {},
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  Menu: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  nativeTheme: {},
  session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn() }) },
  shell: {},
  WebContentsView: class {},
  safeStorage: {},
}));

import { BrowserController } from '../../src/main/tabs/BrowserController';
import {
  VoodooAiService,
  VOODOO_BROWSER_TOOLS,
  VOODOO_SYSTEM_PROMPT,
  formatDefaultActionSummary,
} from '../../src/main/services/VoodooAiService';

describe('Voodoo Browser Agent Tools', () => {
  it('defines browser agent tools with valid schema', () => {
    const requiredTools = [
      'search_web',
      'open_url',
      'list_tabs',
      'switch_tab',
      'close_tab',
      'read_page',
      'get_page_elements',
      'click_element',
      'fill_input',
      'scroll_page',
      'execute_script',
      'get_active_dialog',
      'clean_browser',
      'create_file',
      'create_note_or_list',
      'analyze_page_data',
      'geo_lookup',
      'search_places',
      'get_weather_and_time',
      'get_route_info',
    ];

    expect(VOODOO_BROWSER_TOOLS.length).toBeGreaterThanOrEqual(20);
    for (const toolName of requiredTools) {
      const toolDef = VOODOO_BROWSER_TOOLS.find((t) => t.name === toolName);
      expect(toolDef, `Tool definition for ${toolName} should exist`).toBeDefined();
      expect(toolDef?.description.length).toBeGreaterThan(10);
      expect(toolDef?.parameters.type).toBe('object');
      expect(toolDef?.parameters.properties).toBeDefined();
    }
  });

  it('includes autonomous browser agent instructions in system prompt', () => {
    expect(VOODOO_SYSTEM_PROMPT).toContain('BROWSER AGENT');
    expect(VOODOO_SYSTEM_PROMPT).toContain('search_web');
    expect(VOODOO_SYSTEM_PROMPT).toContain('open_url');
    expect(VOODOO_SYSTEM_PROMPT).toContain('click_element');
    expect(VOODOO_SYSTEM_PROMPT).toContain('read_page');
    expect(VOODOO_SYSTEM_PROMPT).toContain('clean_browser');
    expect(VOODOO_SYSTEM_PROMPT).toContain('```action');
  });

  it('parses text action calls and cleans action blocks from text', () => {
    const sampleText = `
Сейчас я найду нужную страницу!
\`\`\`action
{"tool": "open_url", "args": {"url": "https://github.com", "new_tab": true}}
\`\`\`
Подожди немного.
`;

    const parsed = VoodooAiService.parseTextActionCalls(sampleText);
    expect(parsed.length).toBe(1);
    expect(parsed[0].tool).toBe('open_url');
    expect(parsed[0].args.url).toBe('https://github.com');
    expect(parsed[0].args.new_tab).toBe(true);

    const cleaned = VoodooAiService.cleanActionBlocks(sampleText);
    expect(cleaned).not.toContain('```action');
    expect(cleaned).toContain('Сейчас я найду нужную страницу!');
    expect(cleaned).toContain('Подожди немного.');
  });

  it('formats readable default action summaries', () => {
    const summarySearch = formatDefaultActionSummary('search_web', { query: 'новости технологий' }, true);
    expect(summarySearch).toContain('Поиск: «новости технологий»');

    const summaryOpen = formatDefaultActionSummary('open_url', { url: 'https://vk.com' }, true);
    expect(summaryOpen).toContain('https://vk.com');

    const summaryTabs = formatDefaultActionSummary('list_tabs', {}, true);
    expect(summaryTabs).toContain('Список вкладок');
  });

  it('executes agent loop via native OpenAI tool_calls format', async () => {
    const service = new VoodooAiService();
    const executedTools: Array<{ tool: string; args: Record<string, unknown> }> = [];

    const mockToolExecutor = vi.fn().mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      executedTools.push({ tool, args });
      if (tool === 'search_web') {
        return {
          success: true,
          result: { url: 'https://google.com/search?q=space', count: 5 },
          summary: `🔍 Поиск: «${args.query}»`,
        };
      }
      return { success: true };
    });

    let fetchStep = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      fetchStep++;
      const body = JSON.parse(options.body);

      // Step 1: Model returns tool_call
      if (fetchStep === 1) {
        expect(body.tools).toBeDefined();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_123',
                      type: 'function',
                      function: {
                        name: 'search_web',
                        arguments: JSON.stringify({ query: 'новости космоса' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }

      // Step 2: Model receives tool result observation and returns final reply
      if (fetchStep === 2) {
        const lastMessage = body.messages[body.messages.length - 1];
        expect(lastMessage.role).toBe('tool');
        expect(lastMessage.tool_call_id).toBe('call_123');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Я нашёл свежие новости космоса! SpaceX успешно запустила ракету.',
                },
              },
            ],
          }),
        };
      }

      return { ok: false, status: 500 };
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await service.chat(
        [{ id: '1', role: 'user', content: 'Найди новости космоса', timestamp: Date.now() }],
        {
          keys: ['sk-xt-test-key-1234567890'],
          toolExecutor: mockToolExecutor,
        }
      );

      expect(fetchStep).toBe(2);
      expect(mockToolExecutor).toHaveBeenCalledTimes(1);
      expect(executedTools[0].tool).toBe('search_web');
      expect(executedTools[0].args.query).toBe('новости космоса');

      expect(response.executedActions).toBeDefined();
      expect(response.executedActions?.length).toBe(1);
      expect(response.executedActions?.[0].tool).toBe('search_web');
      expect(response.executedActions?.[0].summary).toBe('🔍 Поиск: «новости космоса»');
      expect(response.reply).toBe('Я нашёл свежие новости космоса! SpaceX успешно запустила ракету.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executes agent loop via text action block format (```action ... ```)', async () => {
    const service = new VoodooAiService();
    const mockToolExecutor = vi.fn().mockResolvedValue({
      success: true,
      result: { tabs: [{ id: 'tab-1', title: 'GitHub', url: 'https://github.com' }] },
      summary: '📑 Список вкладок (1)',
    });

    let fetchStep = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      fetchStep++;
      const body = JSON.parse(options.body);

      // Step 1: Model outputs ```action ... ``` block
      if (fetchStep === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: `Сейчас я проверю твои вкладки.\n\`\`\`action\n{"tool": "list_tabs", "args": {}}\n\`\`\``,
                },
              },
            ],
          }),
        };
      }

      // Step 2: Model sees observation and outputs final answer
      if (fetchStep === 2) {
        const lastMessage = body.messages[body.messages.length - 1];
        expect(lastMessage.content).toContain('[Результат list_tabs]');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'У тебя открыта 1 вкладка: GitHub (https://github.com).',
                },
              },
            ],
          }),
        };
      }

      return { ok: false, status: 500 };
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await service.chat(
        [{ id: '1', role: 'user', content: 'Какие вкладки открыты?', timestamp: Date.now() }],
        {
          keys: ['sk-xt-test-key-1234567890'],
          toolExecutor: mockToolExecutor,
        }
      );

      expect(fetchStep).toBe(2);
      expect(mockToolExecutor).toHaveBeenCalledWith('list_tabs', {});
      expect(response.executedActions?.length).toBe(1);
      expect(response.executedActions?.[0].tool).toBe('list_tabs');
      expect(response.executedActions?.[0].summary).toBe('📑 Список вкладок (1)');
      expect(response.reply).toBe('У тебя открыта 1 вкладка: GitHub (https://github.com).');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns truthful partial results when the configured step budget is exhausted', async () => {
    const service = new VoodooAiService();
    const mockToolExecutor = vi.fn().mockResolvedValue({
      success: true,
      result: { ok: true },
      summary: '📜 Прокрутка вниз',
    });

    let fetchCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: `call_${fetchCalls}`,
                    type: 'function',
                    function: {
                      name: 'scroll_page',
                      arguments: JSON.stringify({ direction: 'down' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await service.chat(
        [{ id: '1', role: 'user', content: 'Листай дальше', timestamp: Date.now() }],
        {
          keys: ['sk-xt-test-key-1234567890'],
          toolExecutor: mockToolExecutor,
          maxSteps: 12,
        }
      );

      expect(fetchCalls).toBe(12);
      expect(mockToolExecutor).toHaveBeenCalledTimes(12);
      expect(response.executedActions?.length).toBe(12);
      expect(response.error).toBe('agent_limit');
      expect(response.reply).not.toContain('Я выполнил запрошенные действия в браузере:');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles tool execution failures gracefully without throwing', async () => {
    const service = new VoodooAiService();
    const mockToolExecutor = vi.fn().mockResolvedValue({
      success: false,
      error: 'Элемент не найден',
      summary: '❌ Не удалось кликнуть по «Войти»',
    });

    let fetchStep = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      fetchStep++;
      if (fetchStep === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_click',
                      type: 'function',
                      function: {
                        name: 'click_element',
                        arguments: JSON.stringify({ text: 'Войти' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'К сожалению, кнопка «Войти» не найдена на текущей странице.',
              },
            },
          ],
        }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await service.chat(
        [{ id: '1', role: 'user', content: 'Нажми кнопку Войти', timestamp: Date.now() }],
        {
          keys: ['sk-xt-test-key-1234567890'],
          toolExecutor: mockToolExecutor,
        }
      );

      expect(response.executedActions?.length).toBe(1);
      expect(response.executedActions?.[0].error).toBe('Элемент не найден');
      expect(response.executedActions?.[0].summary).toBe('❌ Не удалось кликнуть по «Войти»');
      expect(response.reply).toBe('К сожалению, кнопка «Войти» не найдена на текущей странице.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('BrowserController.executeVoodooTool', () => {
  function createTestController() {
    const executedJsCalls: string[] = [];
    const webContents = {
      isDestroyed: () => false,
      focus: vi.fn(),
      executeJavaScript: vi.fn().mockImplementation(async (code: string) => {
        executedJsCalls.push(code);
        if (code.includes('removeSelectors')) {
          return { title: 'Test Page', url: 'https://test.com', headings: ['Hello'], text: 'Page text content' };
        }
        if (code.includes('buttons')) {
          return [{ category: 'button', tag: 'button', text: 'Submit', selector: '#submit' }];
        }
        if (code.includes('target.click()')) {
          return { success: true, tag: 'button', text: 'Submit' };
        }
        if (code.includes('target.form')) {
          return { success: true, tag: 'input', placeholder: 'Search...' };
        }
        if (code.includes('window.scrollBy')) {
          return true;
        }
        return 'custom script output';
      }),
    };

    const tab = {
      id: 'tab-active',
      title: 'Current Tab',
      url: 'https://test.com',
      isPinned: false,
      isInternal: false,
      view: { webContents },
    };

    const controller = Object.create(BrowserController.prototype) as any;
    const tabsMap = new Map([['tab-active', tab]]);
    let currentSettings = { searchEngine: 'https://www.google.com/search?q=%s', voodooBubbleVisible: true, voodooEnabled: true };
    const stores = {
      settings: {
        get: () => currentSettings,
        set: (next: any) => { currentSettings = next; },
      },
    };

    Object.assign(controller, {
      tabs: tabsMap,
      activeTabId: 'tab-active',
      stores,
      emitSnapshot: vi.fn(),
      refreshVoodooBounds: vi.fn(),
      ensureVoodooOnTop: vi.fn(),
      createTab: vi.fn().mockImplementation(async (opts: any) => {
        const newTab = { id: 'new-tab-id', title: 'New Tab', url: opts.url, view: { webContents } };
        tabsMap.set(newTab.id, newTab);
        return newTab;
      }),
      navigate: vi.fn().mockResolvedValue(undefined),
      activateTab: vi.fn().mockImplementation((id: string) => {
        controller.activeTabId = id;
      }),
      closeTab: vi.fn().mockImplementation((id: string) => {
        tabsMap.delete(id);
      }),
      executeClean: vi.fn().mockResolvedValue({
        success: true,
        freedBytesEstimate: 10485760,
        freedFormatted: '10 МБ',
        clearedTargets: ['cache', 'history'],
        durationMs: 45,
        metricsAfter: {},
      }),
      extractActiveTabChatContext: vi.fn().mockResolvedValue({
        text: '[Alice]: Hi!\n[Bob]: Hello!',
        source: 'vk_dialog',
        count: 2,
      }),
    });

    return { controller, tab, webContents, executedJsCalls, tabsMap, stores };
  }

  it('handles search_web tool in current and new tab', async () => {
    const { controller } = createTestController();

    const currentTabRes = await controller.executeVoodooTool('search_web', { query: 'TypeScript tutorial', new_tab: false });
    expect(currentTabRes.success).toBe(true);
    expect(currentTabRes.summary).toContain('TypeScript tutorial');
    expect(controller.navigate).toHaveBeenCalledWith('tab-active', expect.stringContaining('TypeScript'));

    const newTabRes = await controller.executeVoodooTool('search_web', { query: 'Electron docs', new_tab: true });
    expect(newTabRes.success).toBe(true);
    expect(newTabRes.summary).toContain('(новая вкладка)');
    expect(controller.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, url: expect.stringContaining('Electron') }));
  });

  it('handles open_url tool', async () => {
    const { controller } = createTestController();

    const res = await controller.executeVoodooTool('open_url', { url: 'github.com', new_tab: true });
    expect(res.success).toBe(true);
    expect(res.summary).toContain('https://github.com');
    expect(controller.createTab).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('https://github.com'), active: true }));
  });

  it('handles list_tabs, switch_tab, and close_tab', async () => {
    const { controller, tabsMap } = createTestController();

    const listRes = await controller.executeVoodooTool('list_tabs', {});
    expect(listRes.success).toBe(true);
    expect((listRes.result as any).tabs.length).toBe(1);

    // Add a second tab
    tabsMap.set('tab-2', { id: 'tab-2', title: 'Second Tab', url: 'https://example.com' } as any);

    const switchRes = await controller.executeVoodooTool('switch_tab', { tab_id: 'tab-2' });
    expect(switchRes.success).toBe(true);
    expect(controller.activateTab).toHaveBeenCalledWith('tab-2');

    const closeRes = await controller.executeVoodooTool('close_tab', { tab_id: 'tab-2' });
    expect(closeRes.success).toBe(true);
    expect(controller.closeTab).toHaveBeenCalledWith('tab-2');
  });

  it('handles read_page and get_page_elements', async () => {
    const { controller, webContents } = createTestController();

    const readRes = await controller.executeVoodooTool('read_page', { tab_id: 'tab-active' });
    expect(readRes.success).toBe(true);
    expect(readRes.summary).toContain('Прочитана страница');
    expect(webContents.executeJavaScript).toHaveBeenCalled();

    const elemRes = await controller.executeVoodooTool('get_page_elements', { type: 'buttons' });
    expect(elemRes.success).toBe(true);
    expect(elemRes.summary).toContain('Найдено 1');
  });

  it('handles click_element, fill_input, scroll_page, and execute_script', async () => {
    const { controller } = createTestController();

    const clickRes = await controller.executeVoodooTool('click_element', { text: 'Submit' });
    expect(clickRes.success).toBe(true);
    expect(clickRes.summary).toContain('Клик по элементу');

    const fillRes = await controller.executeVoodooTool('fill_input', { text: 'Hello World', submit: true });
    expect(fillRes.success).toBe(true);
    expect(fillRes.summary).toContain('Введён текст');

    const scrollRes = await controller.executeVoodooTool('scroll_page', { direction: 'down', amount: 300 });
    expect(scrollRes.success).toBe(true);
    expect(scrollRes.summary).toContain('Прокрутка страницы вниз');

    const scriptRes = await controller.executeVoodooTool('execute_script', { code: 'document.title' });
    expect(scriptRes.success).toBe(true);
    expect(scriptRes.summary).toContain('Выполнен скрипт');
  });

  it('handles get_active_dialog and clean_browser', async () => {
    const { controller } = createTestController();

    const dialogRes = await controller.executeVoodooTool('get_active_dialog', {});
    expect(dialogRes.success).toBe(true);
    expect(dialogRes.summary).toContain('сообщений: 2');

    const cleanRes = await controller.executeVoodooTool('clean_browser', { preset: 'quick' });
    expect(cleanRes.success).toBe(true);
    expect(cleanRes.summary).toContain('Click & Clean (quick)');
    expect(controller.executeClean).toHaveBeenCalled();
  });

  it('returns failure for unknown tools', async () => {
    const { controller } = createTestController();

    const unknownRes = await controller.executeVoodooTool('unsupported_magic_tool', {});
    expect(unknownRes.success).toBe(false);
    expect(unknownRes.error).toContain('Неизвестный инструмент');
  });

  it('ensures bubble is visible and view is raised on top when Voodoo is minimized/closed', () => {
    const { controller, stores } = createTestController();
    stores.settings.set({ ...stores.settings.get(), voodooBubbleVisible: false });

    controller.setVoodooOpen(false);

    expect(stores.settings.get().voodooBubbleVisible).toBe(true);
    expect(typeof (controller as any).ensureVoodooOnTop).toBe('function');
  });

  function runDomTool(controller: any, webContents: any, tool: string, args: Record<string, unknown>, document: any, extras: Record<string, unknown> = {}) {
    const getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    webContents.executeJavaScript.mockImplementation(async (code: string) => runInNewContext(code, {
      document, window: { getComputedStyle, ...extras }, getComputedStyle,
      Event: class { constructor(public type: string) {} },
      KeyboardEvent: class { constructor(public type: string) {} },
      CSS: { escape: (value: string) => value.replace(/:/g, '\\:') },
    }));
    return controller.executeVoodooTool(tool, args);
  }

  it('does not overwrite an unrelated input when an explicit target is missing', async () => {
    const { controller, webContents } = createTestController();
    const input = { value: 'keep me', focus: vi.fn() };
    const querySelectorAll = vi.fn().mockReturnValue([input]);
    const result = await runDomTool(controller, webContents, 'fill_input', { selector: '#missing', text: 'overwrite' }, {
      querySelector: () => null, querySelectorAll,
    });
    expect(result.success).toBe(false);
    expect(input.value).toBe('keep me');
    expect(input.focus).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it('uses the textarea setter and submits its native form exactly once', async () => {
    const { controller, webContents } = createTestController();
    const requestSubmit = vi.fn();
    const dispatchEvent = vi.fn();
    class Input {
      set value(_: string) { throw new Error('Illegal invocation: input setter used for textarea'); }
    }
    class Textarea {
      tagName = 'TEXTAREA';
      disabled = false;
      readOnly = false;
      isContentEditable = false;
      stored = '';
      getBoundingClientRect = () => ({ width: 100, height: 20 });
      form = { requestSubmit };
      focus = vi.fn();
      dispatchEvent = dispatchEvent;
      set value(text: string) { this.stored = text; }
    }
    const textarea = new Textarea();
    const result = await runDomTool(controller, webContents, 'fill_input', { selector: '#message', text: 'Привет', submit: true }, {
      querySelector: () => textarea,
    }, { HTMLTextAreaElement: Textarea, HTMLInputElement: Input });
    expect(result.success).toBe(true);
    expect(textarea.stored).toBe('Привет');
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(['input', 'change']);
  });

  it('refuses to edit read-only controls', async () => {
    const { controller, webContents } = createTestController();
    const target = { tagName: 'INPUT', readOnly: true, value: 'original', focus: vi.fn() };
    const result = await runDomTool(controller, webContents, 'fill_input', { selector: '#readonly', text: 'changed' }, {
      querySelector: () => target,
    });
    expect(result.success).toBe(false);
    expect(target.value).toBe('original');
    expect(target.focus).not.toHaveBeenCalled();
  });

  it('does not click disabled controls', async () => {
    const { controller, webContents } = createTestController();
    const target = { disabled: true, click: vi.fn() };
    const result = await runDomTool(controller, webContents, 'click_element', { selector: '#disabled' }, {
      querySelector: () => target,
    });
    expect(result.success).toBe(false);
    expect(target.click).not.toHaveBeenCalled();
  });

  it('redacts password values in observed page elements and escapes selectors', async () => {
    const { controller, webContents } = createTestController();
    const input = {
      id: 'login:password', tagName: 'INPUT', type: 'password', value: 'never-expose-this',
      name: 'password', placeholder: 'Password',
      getBoundingClientRect: () => ({ width: 100, height: 20 }),
      getAttribute: () => null,
    };
    const result = await runDomTool(controller, webContents, 'get_page_elements', { type: 'inputs' }, {
      querySelectorAll: () => [input],
    });
    expect(result.success).toBe(true);
    expect(result.result.elements).toHaveLength(1);
    expect(result.result.elements[0].currentValue).toBe('[скрыто]');
    expect(result.result.elements[0].selector).toBe('#login\\:password');
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
  });

  it.each(['file:///etc/passwd', '/etc/passwd', 'javascript:alert(1)', 'definitely not a URL'])('rejects unsupported navigation target %s without opening a tab', async (url) => {
    const { controller } = createTestController();
    const result = await controller.executeVoodooTool('open_url', { url, new_tab: true });
    expect(result.success).toBe(false);
    expect(controller.createTab).not.toHaveBeenCalled();
    expect(controller.navigate).not.toHaveBeenCalled();
  });

  it('reports location lookup failure without substituting a fabricated city', async () => {
    const { controller } = createTestController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    try {
      const result = await controller.executeVoodooTool('geo_lookup', {});
      expect(result.success).toBe(false);
      expect(result.result.city).toBeUndefined();
      expect(result.summary).not.toContain('Москва');
    } finally { vi.unstubAllGlobals(); }
  });

  it('reports weather lookup failure without inventing current conditions', async () => {
    const { controller } = createTestController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    try {
      const result = await controller.executeVoodooTool('get_weather_and_time', { city: 'Владимир' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.result.temperatureC).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps Chromium certificate verification for issuers claiming to be trusted brands', () => {
    const { controller } = createTestController();
    const setCertificateVerifyProc = vi.fn();
    const targetSession = {
      setUserAgent: vi.fn(), setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(),
      setCertificateVerifyProc, on: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
    };
    Object.assign(controller, {
      adBlock: { engine: { setEnabled: vi.fn() } },
      browsec: { applyWebRtcPolicyToSession: vi.fn() },
      notificationPermissions: new Map(), sessionDownloadHandlers: new Map(),
    });
    controller.configureSession(targetSession);
    const verify = setCertificateVerifyProc.mock.calls[0][0];
    for (const issuerName of ['Google Trust Services', 'Cloudflare', 'Amazon', 'Untrusted CA']) {
      const callback = vi.fn();
      verify({ hostname: 'attacker.example', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID', certificate: { issuerName } }, callback);
      expect(callback).toHaveBeenCalledWith(-3);
    }
  });

});
