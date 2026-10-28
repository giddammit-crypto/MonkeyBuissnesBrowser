import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService, VOODOO_BROWSER_TOOLS } from '../../src/main/services/VoodooAiService';
import { estimateRequestTokens, estimateTokens, requestedContextWindow, workflowContext } from '../../src/main/services/AgentWorkflow';

const keys = ['sk-xt-FAKE-context-primary', 'sk-xt-FAKE-context-backup'];
const messages = [{ id: 'request', role: 'user' as const, content: 'Continue the research and preserve the evidence.', timestamp: 1 }];
const ok = (content = 'Complete.') => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
const rejected = (status: number, message: string) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }), headers: { get: () => null } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Voodoo context capacity and request efficiency', () => {
  it('defaults to a 600000 token local budget and bounds invalid configuration', () => {
    expect(requestedContextWindow()).toBe(600000);
    expect(requestedContextWindow(Number.NaN)).toBe(600000);
    expect(requestedContextWindow(900000)).toBe(600000);
    expect(requestedContextWindow(100)).toBeGreaterThanOrEqual(8192);
  });

  it('preserves more than 110000 characters of history when it fits the token budget', () => {
    const history = [
      { role: 'system', content: 'System rules stay intact.' },
      { role: 'user', content: 'BEGIN_LARGE_HISTORY' + 'A'.repeat(150000) + 'END_LARGE_HISTORY' },
      { role: 'assistant', content: 'Acknowledged.' },
      { role: 'user', content: 'Continue from the original data.' },
    ];
    expect(estimateRequestTokens(history, { tools: VOODOO_BROWSER_TOOLS })).toBeLessThan(600000);
    const actual = workflowContext(history, history.length, [], { windowTokens: 600000, tools: VOODOO_BROWSER_TOOLS });
    expect(actual).toEqual(history);
  });

  it('includes tools, system content, output reserve and checkpoint messages in budget accounting', () => {
    const system = [{ role: 'system', content: 'RULE'.repeat(1000) }, { role: 'user', content: 'Task' }];
    const tools = [{ type: 'function', function: { name: 'large_schema', description: 'D'.repeat(20000) } }];
    const checkpoint = [{ role: 'user', content: 'CHECKPOINT'.repeat(500) }];
    const plain = estimateRequestTokens(system, { outputTokens: 0 });
    const withTools = estimateRequestTokens(system, { tools, outputTokens: 0 });
    const withOutput = estimateRequestTokens(system, { tools, outputTokens: 4096 });
    expect(withTools).toBeGreaterThan(plain + 6000);
    expect(withOutput - withTools).toBe(4096);
    expect(estimateRequestTokens([...system, ...checkpoint], { tools, outputTokens: 4096 })).toBeGreaterThan(withOutput);
    expect(() => workflowContext(system, system.length, [], { windowTokens: withOutput - 1, tools, outputTokens: 4096 })).toThrow('context_limit');
    expect(() => workflowContext(system, system.length, [], { windowTokens: withOutput + 100, tools, outputTokens: 4096, extraMessages: checkpoint })).toThrow('context_limit');
  });

  it('evicts complete old native rounds under a small budget and preserves the current request', () => {
    const prefix = [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'ORIGINAL_CURRENT_REQUEST' }];
    const rounds = Array.from({ length: 8 }, (_, index) => [
      { role: 'assistant', content: null, tool_calls: [{ id: `call_${index}`, type: 'function', function: { name: 'read_page', arguments: '{}' } }] },
      { role: 'tool', name: 'read_page', tool_call_id: `call_${index}`, content: 'R'.repeat(10000) },
    ]).flat();
    const history = [...prefix, ...rounds];
    const actual = workflowContext(history, prefix.length, [], { windowTokens: 8192 });
    expect(actual.length).toBeLessThan(history.length);
    expect(actual.slice(0, prefix.length)).toEqual(prefix);
    expect(estimateRequestTokens(actual)).toBeLessThanOrEqual(8192);
    for (let i = 0; i < actual.length; i++) {
      const message = actual[i] as any;
      if (message.tool_calls) expect(actual[i + 1]).toMatchObject({ role: 'tool', tool_call_id: message.tool_calls[0].id });
      if (message.role === 'tool') expect((actual[i - 1] as any).tool_calls[0].id).toBe(message.tool_call_id);
    }
  });

  it('counts non-ASCII input conservatively instead of assuming English character ratios', () => {
    expect(estimateTokens('Ж'.repeat(10000))).toBeGreaterThanOrEqual(10000);
    expect(estimateTokens('A'.repeat(10000))).toBeGreaterThanOrEqual(3333);
    expect(estimateTokens('Ж'.repeat(10000))).toBeGreaterThan(estimateTokens('A'.repeat(10000)));
  });

  it('sends large initial user content intact within the configured 600000 context', async () => {
    const input = 'BEGIN_LONG_REQUEST' + 'W'.repeat(150000) + 'END_LONG_REQUEST';
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      requests.push(JSON.parse(options.body));
      return ok();
    }));
    const result = await new VoodooAiService().chat([{ ...messages[0], content: input }], { keys, contextWindowTokens: 600000, toolExecutor: vi.fn() });
    expect(result.error).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0].messages.some((message: any) => message.content === input)).toBe(true);
  });

  it('retries provider context overflow only once and never rotates through all keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rejected(400, 'maximum context length exceeded: input tokens exceed context window'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: vi.fn() });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.error).toBe('context_limit');
    const auths = fetchMock.mock.calls.map(([_url, options]) => options.headers.Authorization);
    expect(new Set(auths).size).toBe(1);
  });

  it('does not rotate keys or models for a deterministic invalid request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rejected(400, 'Unsupported parameter: response_format'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, model: 'chosen/model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('chosen/model');
  });

  it('caches tools capability across chats on the same endpoint and model', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return requests.length === 1 ? rejected(400, 'tools function calls unsupported') : ok();
    }));
    const service = new VoodooAiService();
    expect((await service.chat(messages, { keys, toolExecutor: vi.fn() })).error).toBeUndefined();
    expect((await service.chat(messages, { keys, toolExecutor: vi.fn() })).error).toBeUndefined();
    expect(requests).toHaveLength(3);
    expect(requests[0].tools).toBeDefined();
    expect(requests[1].tools).toBeUndefined();
    expect(requests[2].tools).toBeUndefined();
  });

  it('keeps a user-selected model when the server is temporarily unavailable', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      requests.push(JSON.parse(options.body));
      return rejected(503, 'Temporarily unavailable');
    }));
    const result = await new VoodooAiService().chat(messages, { keys: [keys[0]], model: 'chosen/model' });
    expect(result.error).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(requests.every(body => body.model === 'chosen/model')).toBe(true);
  });
  it('reduces the actual retained context after provider overflow before one recovery attempt', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? rejected(400, 'context length exceeded') : ok('Recovered after context reduction.');
    }));
    const history = [
      { ...messages[0], id: 'old', content: 'OLD_TURN_START' + 'K'.repeat(150000) },
      { ...messages[0], id: 'old_reply', role: 'assistant' as const, content: 'Old answer' },
      { ...messages[0], id: 'latest', content: 'CURRENT_REQUEST_MUST_REMAIN' },
    ];
    const result = await new VoodooAiService().chat(history, { keys, contextWindowTokens: 600000, toolExecutor: vi.fn() });
    expect(result.error).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages).length).toBeLessThan(JSON.stringify(requests[0].messages).length);
    expect(JSON.stringify(requests[1].messages)).toContain('CURRENT_REQUEST_MUST_REMAIN');
    expect(new Set(requests.map((body: any) => body.model)).size).toBe(1);
  });

  it('scopes a cached text-only capability to the selected model and expires it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T20:00:00Z'));
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return requests.length === 1 ? rejected(400, 'tool calls unsupported') : ok();
    }));
    const service = new VoodooAiService();
    await service.chat(messages, { keys, model: 'model/a', toolExecutor: vi.fn() });
    await service.chat(messages, { keys, model: 'model/a', toolExecutor: vi.fn() });
    await service.chat(messages, { keys, model: 'model/b', toolExecutor: vi.fn() });
    vi.setSystemTime(new Date('2026-10-28T20:11:00Z'));
    await service.chat(messages, { keys, model: 'model/a', toolExecutor: vi.fn() });
    expect(requests).toHaveLength(5);
    expect(requests[2].tools).toBeUndefined();
    expect(requests[3].tools).toBeDefined();
    expect(requests[4].tools).toBeDefined();
  });

  it('finishes a progressing workflow beyond one hundred rounds without an implicit step limit', async () => {
    let round = 0;
    const executor = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ success: true, result: { text: `Verified ${args.tab_id}` } }));
    const fetchMock = vi.fn(async () => {
      round++;
      if (round > 120) return ok('All 120 sources processed.');
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: {
        tool_calls: [{ id: `read_${round}`, type: 'function', function: { name: 'read_page', arguments: JSON.stringify({ tab_id: `source_${round}` }) } }],
      } }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(messages, { keys, toolExecutor: executor });
    expect(result.error).toBeUndefined();
    expect(result.reply).toBe('All 120 sources processed.');
    expect(executor).toHaveBeenCalledTimes(120);
    expect(fetchMock).toHaveBeenCalledTimes(121);
    expect(result.executedActionCount).toBe(120);
  });

});
