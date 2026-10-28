import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService } from '../../src/main/services/VoodooAiService';

const keys = ['sk-xt-FAKE-workflow-test-credential'];
const request = [{ id: 'workflow', role: 'user' as const, content: 'Найди сведения, сравни источники и сохрани отчёт.', timestamp: 1 }];
function call(name: string, args: Record<string, unknown>, id: string) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
function completion(message: Record<string, unknown>, finishReason = 'stop') {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: finishReason }] }) };
}
function plan(completed = 0, extra: Record<string, unknown> = {}) {
  return call('update_plan', { steps: ['Прочитать источник', 'Сохранить отчёт'], completed_steps: completed, ...extra }, `plan_${completed}`);
}
afterEach(() => vi.unstubAllGlobals());

describe('Voodoo complex workflows', () => {
  it('converts native tool history to ordinary text when an endpoint rejects tools', async () => {
    const sent: any[] = [];
    const executor = vi.fn().mockResolvedValue({ success: true, result: { text: 'KNOWN_SOURCE_EVIDENCE' } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (sent.length === 1) return completion({ tool_calls: [call('read_page', {}, 'read_1')] }, 'tool_calls');
      if (sent.length === 2) return { ok: false, status: 400, text: async () => 'tool/function protocol unsupported' };
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      expect(body.messages.some((m: any) => m.role === 'tool' || m.tool_calls || m.tool_call_id)).toBe(false);
      expect(JSON.stringify(body.messages)).toContain('KNOWN_SOURCE_EVIDENCE');
      return completion({ content: 'Источник прочитан.' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(sent).toHaveLength(3);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe('Источник прочитан.');
    expect(result.error).toBeUndefined();
  });

  it('never executes a mutation from a completion truncated by the provider', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true });
    const fetchMock = vi.fn().mockResolvedValue(completion({
      tool_calls: [call('create_file', { filename: 'report.txt', content: 'Looks complete but was truncated' }, 'write_truncated')],
    }, 'length'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    expect(result.error).toBeTruthy();
    expect(result.reply).not.toContain('Файл сохранён');
  });

  it('maintains an internal plan and continues after premature text until all steps are complete', async () => {
    const executor = vi.fn().mockImplementation(async (name: string) => ({
      success: true, result: name === 'read_page' ? { text: 'SOURCE_VALUE' } : { filename: 'report.txt' },
    }));
    const sent: any[] = [];
    const outputs = [
      completion({ tool_calls: [plan()] }, 'tool_calls'),
      completion({ content: 'Я подготовлю отчёт.' }),
      completion({ tool_calls: [call('read_page', {}, 'read_source'), plan(1)] }, 'tool_calls'),
      completion({ tool_calls: [call('create_file', { filename: 'report.txt', content: 'SOURCE_VALUE' }, 'save_report'), plan(2)] }, 'tool_calls'),
      completion({ content: 'Отчёт сохранён.' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      sent.push(JSON.parse(options.body));
      return outputs.shift() ?? completion({ content: 'Unexpected extra completion' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor.mock.calls.map(([name]) => name)).toEqual(['read_page', 'create_file']);
    expect(sent).toHaveLength(5);
    expect(result.reply).toBe('Отчёт сохранён.');
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(sent[2].messages)).toContain('Сохранить отчёт');
    expect(JSON.stringify(sent[3].messages)).toContain('SOURCE_VALUE');
  });

  it('bounds repeated premature final replies when the plan remains unfinished', async () => {
    const executor = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({ tool_calls: [plan()] }, 'tool_calls'))
      .mockResolvedValue(completion({ content: 'Всё готово.' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(result.error).toBeTruthy();
    expect(result.reply).not.toBe('Всё готово.');
  });

  it('restores prior execution evidence in the next user request without replaying mutations', async () => {
    const executor = vi.fn();
    let outgoing: any;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      outgoing = JSON.parse(options.body);
      return completion({ content: 'Файл уже сохранён, продолжаю сравнение.' });
    }));
    const history = [
      request[0],
      { id: 'previous', role: 'assistant' as const, content: 'Часть работы завершена.', timestamp: 2, executedActions: [
        { tool: 'create_file', args: { filename: 'previous.txt', content: 'PREVIOUS_OUTPUT_EVIDENCE' }, result: { path: '/documents/previous.txt', sizeBytes: 24 }, summary: 'Сохранён previous.txt' },
      ] },
      { id: 'next', role: 'user' as const, content: 'Продолжи, используя сохранённый файл.', timestamp: 3 },
    ];
    const result = await new VoodooAiService().chat(history, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    expect(JSON.stringify(outgoing.messages)).toContain('previous.txt');
    expect(JSON.stringify(outgoing.messages)).toContain('/documents/previous.txt');
    expect(outgoing.messages.filter((m: any) => m.role === 'system').every((m: any) => !m.content.includes('PREVIOUS_OUTPUT_EVIDENCE'))).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('uses enough output capacity and low temperature for tool arguments', async () => {
    let sent: any;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      sent = JSON.parse(options.body);
      return completion({ content: 'Готово.' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: vi.fn() });
    expect(result.error).toBeUndefined();
    expect(sent.temperature).toBeLessThanOrEqual(0.2);
    expect(sent.max_tokens).toBeGreaterThanOrEqual(4096);
  });
  it('keeps text-only fallback for all subsequent action rounds of the request', async () => {
    const sent: any[] = [];
    const executor = vi.fn().mockResolvedValue({ success: true, result: { text: 'OBSERVATION' } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (sent.length === 1) return { ok: false, status: 400, text: async () => 'tools unsupported' };
      if (sent.length === 2) return completion({ content: '```action\n{"tool":"read_page","args":{}}\n```' });
      if (sent.length === 3) return completion({ content: '```action\n{"tool":"list_tabs","args":{}}\n```' });
      return completion({ content: 'Оба шага выполнены.' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(sent).toHaveLength(4);
    expect(sent[0].tools).toBeDefined();
    expect(sent.slice(1).every(body => !body.tools && !body.tool_choice)).toBe(true);
    expect(sent.slice(1).every(body => body.messages.every((m: any) => m.role !== 'tool' && !m.tool_calls && !m.tool_call_id))).toBe(true);
    expect(executor.mock.calls.map(([name]) => name)).toEqual(['read_page', 'list_tabs']);
    expect(result.error).toBeUndefined();
  });

  it('blocks the third identical failed action even when argument key order changes', async () => {
    let round = 0;
    const executor = vi.fn().mockResolvedValue({ success: false, error: 'No such control' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      round++;
      return completion({ tool_calls: [call('click_element', round % 2 ? { selector: '#missing', tab_id: 'page' } : { tab_id: 'page', selector: '#missing' }, `failed_${round}`)] }, 'tool_calls');
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(round).toBe(4);
    expect(result.error).toBe('agent_stalled');
    expect(result.executedActions?.slice(2).every(action => action.error?.includes('заблокирован'))).toBe(true);
  });

  it('returns blocked plan details without pretending that the remaining work was completed', async () => {
    const executor = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(completion({ tool_calls: [plan(0, { blocked_reason: 'Источник требует входа пользователя' })] }, 'tool_calls'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBe('agent_blocked');
    expect(result.reply).toContain('Источник требует входа пользователя');
    expect(result.reply).toContain('Сохранить отчёт');
  });

  it('recovers after a truncated response and executes only the complete replacement command', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, result: { filename: 'good.txt' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({ tool_calls: [call('create_file', { filename: 'bad.txt', content: 'unfinished' }, 'bad')] }, 'length'))
      .mockResolvedValueOnce(completion({ tool_calls: [call('create_file', { filename: 'good.txt', content: 'complete' }, 'good')] }, 'tool_calls'))
      .mockResolvedValueOnce(completion({ content: 'Сохранён полный файл.' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor.mock.calls).toEqual([['create_file', { filename: 'good.txt', content: 'complete' }]]);
    expect(result.error).toBeUndefined();
    expect(result.reply).toBe('Сохранён полный файл.');
  });

  it('normalizes duplicate provider call identifiers without creating new collisions', async () => {
    const sent: any[] = [];
    const executor = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (sent.length === 1) return completion({ tool_calls: [
        call('list_tabs', {}, 'call_0_2_dup'), call('list_tabs', {}, 'dup'), call('list_tabs', {}, 'dup'),
      ] }, 'tool_calls');
      return completion({ content: 'Готово.' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    const assistant = sent[1].messages.find((m: any) => m.tool_calls);
    const ids = assistant.tool_calls.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(sent[1].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id)).toEqual(ids);
    expect(result.error).toBeUndefined();
  });

  it('compacts long observations as complete native protocol rounds with an execution ledger', async () => {
    const sent: any[] = [];
    const executor = vi.fn().mockResolvedValue({ success: true, result: { url: 'https://source.example', text: 'E'.repeat(22000) } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      sent.push(JSON.parse(options.body));
      return sent.length <= 18
        ? completion({ tool_calls: [call('read_page', { tab_id: `source_${sent.length}` }, `read_${sent.length}`)] }, 'tool_calls')
        : completion({ content: 'Восемнадцать источников прочитаны.' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(result.error).toBeUndefined();
    expect(executor).toHaveBeenCalledTimes(18);
    expect(sent.some(body => JSON.stringify(body.messages).includes('Журнал уже выполненных действий'))).toBe(true);
    for (const body of sent) {
      expect(JSON.stringify(body.messages).length).toBeLessThanOrEqual(112000);
      for (let i = 0; i < body.messages.length; i++) {
        const message = body.messages[i];
        if (message.tool_calls) {
          const replies = body.messages.slice(i + 1, i + 1 + message.tool_calls.length);
          expect(replies.map((m: any) => [m.role, m.tool_call_id])).toEqual(message.tool_calls.map((c: any) => ['tool', c.id]));
        }
        if (message.role === 'tool') {
          const preceding = body.messages.slice(0, i).reverse().find((m: any) => m.role !== 'tool');
          expect(preceding?.tool_calls.some((c: any) => c.id === message.tool_call_id)).toBe(true);
        }
      }
    }
  });

  it('rejects a plan containing object steps instead of strings and provides a recoverable observation', async () => {
    let outbound: any;
    const executor = vi.fn();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(completion({ tool_calls: [call('update_plan', { steps: [{ instruction: 'bad shape' }] }, 'bad_plan')] }, 'tool_calls'))
      .mockImplementationOnce(async (_url, options) => {
        outbound = JSON.parse(options.body);
        return completion({ content: 'Уточню план.' });
      }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).not.toHaveBeenCalled();
    const observation = outbound.messages.find((m: any) => m.role === 'tool');
    expect(JSON.parse(observation.content).success).toBe(false);
    expect(JSON.parse(observation.content).error).toBeTruthy();
    expect(result.executedActions?.[0].error).toBeTruthy();
    expect(result.reply).toBe('Уточню план.');
  });

  it('preserves continuation offsets and source links when a large page observation is shortened', async () => {
    let sent: any;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(completion({ tool_calls: [call('read_page', { start: 12000 }, 'chunk')] }, 'tool_calls'))
      .mockImplementationOnce(async (_url, options) => {
        sent = JSON.parse(options.body);
        return completion({ content: 'Нужно прочитать следующий фрагмент.' });
      }));
    const result = await new VoodooAiService().chat(request, {
      keys, toolExecutor: vi.fn().mockResolvedValue({ success: true, result: {
        text: 'R'.repeat(22000), start: 12000, next_start: 34000, total_length: 50000,
        links: [{ text: 'Primary source', href: 'https://source.example/report' }],
      } }),
    });
    expect(result.error).toBeUndefined();
    const observed = JSON.parse(sent.messages.find((m: any) => m.role === 'tool').content);
    expect(observed.success).toBe(true);
    expect(observed.result.truncated).toBe(true);
    expect(observed.result.next_start).toBe(12000 + observed.result.text.length);
    expect(observed.result.next_start).toBeLessThan(34000);
    expect(observed.result.total_length).toBe(50000);
    expect(observed.result.links[0].href).toBe('https://source.example/report');
  });

  it('does not reuse one successful action as evidence for completing multiple plan stages', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, result: { tabs: [] } });
    const outputs = [
      completion({ tool_calls: [plan(), call('list_tabs', {}, 'observe')] }, 'tool_calls'),
      completion({ tool_calls: [plan(1)] }, 'tool_calls'),
      completion({ tool_calls: [plan(2)] }, 'tool_calls'),
      completion({ tool_calls: [plan(1, { blocked_reason: 'Сохранение ещё не выполнено' })] }, 'tool_calls'),
    ];
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      sent.push(JSON.parse(options.body));
      return outputs.shift() ?? completion({ content: 'Unexpected completion' });
    }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.error).toBe('agent_blocked');
    const rejected = result.executedActions?.find(action => action.tool === 'update_plan' && action.args.completed_steps === 2);
    expect(rejected?.error).toBeTruthy();
    expect(result.reply).toContain('Сохранить отчёт');
    expect(sent).toHaveLength(4);
  });

  it('does not permit dropping unfinished stages from the original plan', async () => {
    const outputs = [
      completion({ tool_calls: [plan()] }, 'tool_calls'),
      completion({ tool_calls: [call('update_plan', { steps: ['Прочитать источник'], completed_steps: 0 }, 'drop_pending')] }, 'tool_calls'),
      completion({ tool_calls: [plan(0, { blocked_reason: 'Нужно уточнение пользователя' })] }, 'tool_calls'),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => outputs.shift() ?? completion({ content: 'Unexpected completion' })));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: vi.fn() });
    const rejected = result.executedActions?.find(action => action.args.steps?.length === 1);
    expect(rejected?.error).toBeTruthy();
    expect(result.error).toBe('agent_blocked');
    expect(result.reply).toContain('Прочитать источник');
    expect(result.reply).toContain('Сохранить отчёт');
  });

  it('allows a previously failed click after successful navigation changes the page state', async () => {
    let clicks = 0;
    const executor = vi.fn(async (name: string) => {
      if (name === 'click_element' && ++clicks <= 2) return { success: false, error: 'Not found' };
      return { success: true, result: { url: 'https://new.example' } };
    });
    const outputs = [
      completion({ tool_calls: [call('click_element', { selector: '#submit' }, 'click1')] }, 'tool_calls'),
      completion({ tool_calls: [call('click_element', { selector: '#submit' }, 'click2')] }, 'tool_calls'),
      completion({ tool_calls: [call('open_url', { url: 'https://new.example' }, 'navigate')] }, 'tool_calls'),
      completion({ tool_calls: [call('click_element', { selector: '#submit' }, 'click3')] }, 'tool_calls'),
      completion({ content: 'Кнопка нажата на новой странице.' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => outputs.shift() ?? completion({ content: 'Unexpected completion' })));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(clicks).toBe(3);
    expect(executor.mock.calls.map(([name]) => name)).toEqual(['click_element', 'click_element', 'open_url', 'click_element']);
    expect(result.executedActions?.at(-1).error).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('executes a successful duplicate click only once until a fresh observation is read', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, result: { text: 'Page after click' } });
    const outputs = [
      completion({ tool_calls: [call('click_element', { selector: '#submit' }, 'first'), call('click_element', { selector: '#submit' }, 'duplicate')] }, 'tool_calls'),
      completion({ tool_calls: [call('read_page', {}, 'inspect'), call('click_element', { selector: '#submit' }, 'after_inspection')] }, 'tool_calls'),
      completion({ content: 'Второй клик выполнен после проверки.' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => outputs.shift() ?? completion({ content: 'Unexpected completion' })));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(executor.mock.calls.map(([name]) => name)).toEqual(['click_element', 'read_page', 'click_element']);
    expect(result.executedActions?.[1].error).toBeTruthy();
    expect(result.executedActions?.at(-1).error).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('keeps valid complete observed URLs and pagination when a long page contains forty links', async () => {
    const links = Array.from({ length: 40 }, (_, index) => ({ title: `Source ${index}`, href: `https://source.example/${index}?token=${'v'.repeat(index % 5 === 0 ? 2300 : 900)}` }));
    let sent: any;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(completion({ tool_calls: [call('read_page', { start: 500 }, 'read_long_links')] }, 'tool_calls'))
      .mockImplementationOnce(async (_url, options) => {
        sent = JSON.parse(options.body);
        return completion({ content: 'Ссылки получены.' });
      }));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: vi.fn().mockResolvedValue({ success: true, result: {
      text: 'Q'.repeat(25000), start: 500, next_start: 25500, totalLength: 40000, links,
    } }) });
    expect(result.error).toBeUndefined();
    const observation = sent.messages.find((message: any) => message.role === 'tool').content;
    expect(observation.length).toBeLessThanOrEqual(16000);
    const data = JSON.parse(observation).result;
    expect(data.next_start).toBe(500 + data.text.length);
    expect(data.totalLength).toBe(40000);
    expect(data.links.length).toBeGreaterThan(0);
    expect(data.links_truncated).toBe(true);
    const actualHrefs = new Set(links.map(link => link.href));
    for (const link of data.links) {
      expect(actualHrefs.has(link.href)).toBe(true);
      expect(new URL(link.href).protocol).toBe('https:');
    }
  });

});
