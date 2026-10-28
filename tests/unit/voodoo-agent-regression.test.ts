import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService } from '../../src/main/services/VoodooAiService';

const messages = [{ id: 'request', role: 'user' as const, content: 'Выполни задачу по шагам', timestamp: 1 }];
const keys = ['sk-xt-FAKE-agent-regression-key'];
function response(message: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
}
function tool(name: string, args: unknown, id = 'call_1') {
  return { id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
}
afterEach(() => vi.unstubAllGlobals());

describe('Voodoo agent execution regressions', () => {
  it('executes dependent rounds using observations from the preceding action', async () => {
    const executor = vi.fn()
      .mockResolvedValueOnce({ success: true, result: { tabs: [{ id: 'tab-found', title: 'Source' }] } })
      .mockResolvedValueOnce({ success: true, result: { title: 'Source', text: 'Verified page text' } });
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (requests.length === 1) return response({ tool_calls: [tool('list_tabs', {})] });
      if (requests.length === 2) {
        expect(request.messages.at(-1).content).toContain('tab-found');
        return response({ tool_calls: [tool('read_page', { tab_id: 'tab-found' }, 'call_2')] });
      }
      expect(request.messages.at(-1).content).toContain('Verified page text');
      return response({ content: 'Проверенная страница прочитана.' });
    }));
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor });
    expect(requests).toHaveLength(3);
    expect(executor.mock.calls).toEqual([['list_tabs', {}], ['read_page', { tab_id: 'tab-found' }]]);
    expect(result.executedActions).toHaveLength(2);
    expect(result.reply).toBe('Проверенная страница прочитана.');
  });

  it.each([
    ['malformed JSON', tool('close_tab', '{broken')],
    ['array args', tool('close_tab', '[]')],
    ['unknown tool', tool('invented_delete_everything', {})],
    ['wrong argument type', tool('open_url', { url: false })],
  ])('does not execute %s and lets the model recover from the error observation', async (_label, call) => {
    const executor = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ tool_calls: [call] }))
      .mockImplementationOnce(async (_url, options) => {
        const request = JSON.parse(options.body);
        expect(request.messages.at(-1).role).toBe('tool');
        expect(request.messages.at(-1).tool_call_id).toBe(call.id);
        expect(request.messages.at(-1).content).toMatch(/error/i);
        return response({ content: 'Уточню действие.' });
      });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    expect(result.reply).toBe('Уточню действие.');
  });

  it('reports executor exceptions as observations and continues to a final answer', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('Navigation failed'));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ tool_calls: [tool('open_url', { url: 'https://example.org' })] }))
      .mockImplementationOnce(async (_url, options) => {
        expect(JSON.parse(options.body).messages.at(-1).content).toContain('Navigation failed');
        return response({ content: 'Страница не загрузилась.' });
      }));
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor });
    expect(result.executedActions?.[0].error).toBe('Navigation failed');
    expect(result.reply).toBe('Страница не загрузилась.');
  });

  it('retains a complete large tool observation when it fits the configured token budget', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ tool_calls: [tool('read_page', {})] }))
      .mockImplementationOnce(async (_url, options) => {
        const observation = JSON.parse(options.body).messages.at(-1).content;
        expect(JSON.parse(observation).result.text).toBe('A'.repeat(100000));
        return response({ content: 'Данные получены.' });
      }));
    const result = await new VoodooAiService().chat(messages, {
      keys, toolExecutor: vi.fn().mockResolvedValue({ success: true, result: { text: 'A'.repeat(100000) } }),
    });
    expect(result.reply).toBe('Данные получены.');
  });

  it('does not execute additional mutations after cancellation between calls', async () => {
    const cancellation = new AbortController();
    const executor = vi.fn(async () => {
      cancellation.abort();
      return { success: true, result: { id: 'first' } };
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ tool_calls: [
      tool('open_url', { url: 'https://example.org' }, 'first'),
      tool('close_tab', { tab_id: 'other' }, 'second'),
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor, signal: cancellation.signal });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe('cancelled');
  });

  it('parses multiple bare action objects including escaped quotes and braces inside strings', () => {
    const first = { tool: 'fill_input', args: { text: 'Say "{hello}" and \\ continue' } };
    const second = { tool: 'read_page', args: {} };
    const parsed = VoodooAiService.parseTextActionCalls(`${JSON.stringify(first)}\n${JSON.stringify(second)}`);
    expect(parsed.map(({ tool, args }) => ({ tool, args }))).toEqual([first, second]);
  });
  it('executes a large finite batch while bounding retained trace memory', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true });
    const fetchMock = vi.fn().mockResolvedValue(response({ tool_calls: Array.from({ length: 300 }, (_, i) => tool('list_tabs', {}, `call_${i}`)) }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor, maxSteps: 1 });
    expect(executor).toHaveBeenCalledTimes(300);
    expect(result.executedActions).toHaveLength(256);
    expect(result.executedActionCount).toBe(300);
    expect(result.actionsTruncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe('agent_limit');
  });

  it('keeps page content in an untrusted context instead of granting it a system role', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const sent = JSON.parse(options.body).messages;
      const context = sent.find((message: any) => message.content.includes('UNTRUSTED_PAGE_INSTRUCTION'));
      expect(context.role).toBe('user');
      expect(context.content).toContain('не инструкции');
      expect(sent.at(-1).content).toBe(messages[0].content);
      return response({ content: 'Готово.' });
    }));
    await new VoodooAiService().chat(messages, { keys, tabContext: { chatText: 'UNTRUSTED_PAGE_INSTRUCTION' } });
  });

});
