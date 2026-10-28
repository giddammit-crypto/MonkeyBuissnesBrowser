import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService } from '../../src/main/services/VoodooAiService';
import { actionEvidence, workflowContext } from '../../src/main/services/AgentWorkflow';

const keys = ['sk-xt-FAKE-audit-key'];
const request = [{ id: 'audit', role: 'user' as const, content: 'ORIGINAL_GOAL_SAVE_REPORT', timestamp: 1 }];
const completion = (message: Record<string, unknown>, finish_reason = 'stop') => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason }] }) });
afterEach(() => vi.unstubAllGlobals());

describe('Voodoo protocol audit regressions', () => {
  it('reports an empty completion as an error instead of successful completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ content: '   ' })));
    const result = await new VoodooAiService().chat(request, { keys });
    expect(result.error).toBe('empty_response');
    expect(result.reply).not.toBe('   ');
  });

  it('does not expose private reasoning or silently finish on a reasoning-only response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({ role: 'assistant', content: null, reasoning_content: 'PRIVATE_REASONING' })));
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: vi.fn() });
    expect(result.error).toBe('empty_response');
    expect(result.reply).not.toContain('PRIVATE_REASONING');
  });

  it('retries a length-truncated reasoning-only response without executing tools', async () => {
    const executor = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(completion({ role: 'assistant', content: null, reasoning_content: 'PRIVATE_REASONING' }, 'length'))
      .mockResolvedValueOnce(completion({ content: 'Ответ после продолжения.' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new VoodooAiService().chat(request, { keys, toolExecutor: executor });
    expect(result.error).toBeUndefined();
    expect(result.reply).toBe('Ответ после продолжения.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executor).not.toHaveBeenCalled();
  });

  it('does not turn malformed successful payloads into API key cooldowns', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [] }) })
      .mockResolvedValueOnce(completion({ content: 'Следующий ответ получен.' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new VoodooAiService();
    const failed = await service.chat(request, { keys });
    expect(failed.error).toBe('invalid_completion');
    const next = await service.chat(request, { keys });
    expect(next.error).toBeUndefined();
    expect(next.reply).toBe('Следующий ответ получен.');
  });

  it('retains complete source identifiers even after compacting long file content', () => {
    const filePath = '/documents/' + 'segment/'.repeat(90) + 'report.md';
    const url = 'https://example.org/source?value=' + 'z'.repeat(900);
    const evidence = JSON.parse(actionEvidence({ tool: 'create_file', args: { content: 'BODY'.repeat(10000) }, result: { content: 'RESULT'.repeat(10000), filePath, url, tabId: 'tab-unique-identifier' }, summary: 'Saved' }));
    expect(evidence.result.filePath).toBe(filePath);
    expect(evidence.result.url).toBe(url);
    expect(evidence.result.tabId).toBe('tab-unique-identifier');
    expect(JSON.stringify(evidence).length).toBeLessThan(30000);
  });

  it('does not cache a guessed smaller provider window after failed recovery', async () => {
    let lastBody: any;
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(async (_url, options: any) => {
      lastBody = JSON.parse(options.body);
      if (fetchMock.mock.calls.length === 1) return { ok: false, status: 400, text: async () => 'context_length_exceeded' };
      if (fetchMock.mock.calls.length === 2) return { ok: false, status: 503, text: async () => 'Temporary backend failure' };
      return completion({ content: 'Большой запрос принят.' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new VoodooAiService();
    const initial = [{ ...request[0], id: 'old', content: 'H'.repeat(120000) }, { ...request[0], role: 'assistant' as const, id: 'ack', content: 'Acknowledged.' }, ...request];
    const failed = await service.chat(initial, { keys });
    expect(failed.error).toBe('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const content = 'A'.repeat(150000) + 'ORIGINAL_GOAL_AFTER_FAILED_RECOVERY';
    const result = await service.chat([{ ...request[0], content }], { keys, contextWindowTokens: 600000 });
    expect(result.error).toBeUndefined();
    expect(lastBody.messages.some((m: any) => m.content === content)).toBe(true);
  });

  it('preserves the original request through repeated whole-round context reductions', () => {
    const original = { role: 'user', content: 'ORIGINAL_GOAL_SAVE_REPORT' };
    let messages: Array<Record<string, unknown>> = [{ role: 'system', content: 'Rules' }, original];
    let runStart = messages.length;
    for (let step = 0; step < 10; step++) {
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `call_${step}`, type: 'function', function: { name: 'read_page', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: `call_${step}`, name: 'read_page', content: 'OBSERVATION'.repeat(1000) });
      const retained = workflowContext(messages, runStart, [], { windowTokens: 9000 });
      const prefix = new Set(messages.slice(0, runStart));
      const boundary = retained.findIndex(message => !prefix.has(message));
      runStart = boundary < 0 ? retained.length : boundary;
      messages = retained;
      expect(messages).toContain(original);
      for (let index = 0; index < messages.length; index++) {
        if (messages[index].role === 'tool') expect(messages[index - 1].role).toBe('assistant');
      }
    }
  });
});
