import { afterEach, describe, expect, it, vi } from 'vitest';
import * as workflow from '../../src/main/services/AgentWorkflow';
import { VoodooAiService, VOODOO_BROWSER_TOOLS } from '../../src/main/services/VoodooAiService';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, requestedContextWindow } from '../../src/shared/voodooContext';

const keys = ['sk-xt-FAKE-budget-speed-key'];
const request = [{ id: 'request', role: 'user' as const, content: 'Read source evidence and report the result.', timestamp: 1 }];
const complete = (message: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) });
const read = (id: string) => complete({ content: null, tool_calls: [{ id, type: 'function', function: { name: 'read_page', arguments: '{}' } }] });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('250000 context budget and local request efficiency', () => {
  it('defaults to 250000 and clamps stored legacy 600000 values through the shared helper', () => {
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(250000);
    for (const value of [undefined, Number.NaN, Infinity, 600000, 900000]) expect(requestedContextWindow(value)).toBe(250000);
    expect(requestedContextWindow(128000)).toBe(128000);
    expect(requestedContextWindow(100)).toBe(8192);
  });

  it('keeps budget estimates identical with a cached immutable tool schema', () => {
    const prepared = workflow.prepareToolSchema(VOODOO_BROWSER_TOOLS);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.tools)).toBe(true);
    for (const content of ['a', 'aa', 'aaa', 'Ж漢字😀', 'Evidence'.repeat(20000)]) {
      const messages = [{ role: 'system', content: 'Rules' }, { role: 'user', content }];
      for (const outputTokens of [0, 4096]) {
        const normal = workflow.estimateRequestTokens(messages, { tools: prepared.tools, outputTokens });
        const cached = workflow.estimateRequestTokens(messages, { tools: prepared.tools, preparedTools: prepared, outputTokens });
        expect(cached).toBe(normal);
        expect(workflow.estimateRequestTokens(messages, { tools: prepared.tools, preparedTools: prepared, outputTokens, textOnly: true }))
          .toBe(workflow.estimateRequestTokens(messages, { tools: prepared.tools, outputTokens, textOnly: true }));
      }
    }
    const local = structuredClone(VOODOO_BROWSER_TOOLS);
    const snapshot = workflow.prepareToolSchema(local);
    const savedDescription = (snapshot.tools[0] as any).function.description;
    local[0].description = 'Changed after preparing the request';
    expect((snapshot.tools[0] as any).function.description).toBe(savedDescription);
  });

  it('uses the configured 250000 ceiling even when a legacy caller requests 600000', async () => {
    const fetchMock = vi.fn().mockResolvedValue(complete({ content: 'Done.' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, contextWindowTokens: 600000 });
    expect(result.contextUsage?.requestedWindowTokens).toBe(250000);
    expect(result.contextUsage?.effectiveWindowTokens).toBe(250000);
    expect(result.contextUsage?.estimateOnly).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects an oversized original request intact instead of silently truncating it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat([{ ...request[0], content: 'A'.repeat(1000000) + 'KEEP_ORIGINAL_GOAL' }], { keys, contextWindowTokens: 600000 });
    expect(result.error).toBe('context_limit');
    expect(result.reply).toContain('250000');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hashes each large read observation once and preserves request/tool semantics', async () => {
    const hashSpy = vi.spyOn(workflow, 'canonicalCall');
    const outgoing: any[] = [];
    const outputs = [read('first'), read('second'), complete({ content: 'Evidence collected.' })];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
      outgoing.push(JSON.parse(options.body));
      return outputs.shift()!;
    }));
    const content = 'SOURCE_DATA'.repeat(18000);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: vi.fn().mockResolvedValue({ success: true, result: { text: content, url: 'https://example.org/evidence' } }) });
    expect(result.error).toBeUndefined();
    expect(result.reply).toBe('Evidence collected.');
    expect(hashSpy.mock.calls.filter(([name]) => name === 'observation')).toHaveLength(2);
    expect(outgoing).toHaveLength(3);
    for (const body of outgoing) {
      expect(body.tools).toHaveLength(VOODOO_BROWSER_TOOLS.length);
      expect(workflow.estimateRequestTokens(body.messages, { tools: body.tools, outputTokens: body.max_tokens })).toBeLessThanOrEqual(250000);
    }
    expect(JSON.stringify(outgoing[2].messages)).toContain(content);
    expect(result.executedActionCount).toBe(2);
  });
});
