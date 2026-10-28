import { describe, expect, it } from 'vitest';
import type { VoodooChatMessage } from '../../src/shared/types';
import { estimateTokens } from '../../src/shared/voodooContext';
import { boundVoodooHistory, compactVoodooMessage, restoreVoodooHistory, serializeVoodooHistory, VOODOO_SESSION_HISTORY_LIMIT } from '../../src/shared/voodooHistory';

const message = (id: number, content = 'Обсуждение исследования', role: 'user' | 'assistant' = id % 2 ? 'assistant' : 'user'): VoodooChatMessage => ({
  id: `message-${id}`, role, content, timestamp: 123456 + id,
});

describe('Voodoo lightweight history', () => {
  it('retains hundreds of full turns beyond the former 30-message cap within 600k tokens', () => {
    const history = Array.from({ length: 400 }, (_, index) => message(index, 'a'.repeat(3000)));
    expect(estimateTokens(history)).toBeLessThan(600000);
    expect(boundVoodooHistory(history, 600000)).toBe(history);
    expect(boundVoodooHistory(history, 32000).length).toBeLessThan(history.length);
    expect(history[0].content).toHaveLength(3000);
  });

  it('uses the shared token estimator, retaining large ASCII content without a tiny character limit', () => {
    const history = [message(0, 'a'.repeat(1500000)), message(1, 'Result')];
    expect(estimateTokens(history)).toBeLessThan(600000);
    expect(boundVoodooHistory(history, 600000)).toBe(history);
    expect(boundVoodooHistory(history, 600000)[0].content).toHaveLength(1500000);
  });

  it('prioritizes source identifiers while removing bulky action bodies and retains action count', () => {
    const source = message(1, 'Отчёт');
    source.executedActions = Array.from({ length: 90 }, (_, index) => ({
      tool: 'read_file', args: { content: 'secret-body'.repeat(10000), filename: `source-${index}.txt` },
      result: { content: 'raw-data'.repeat(100000), path: `/notes/source-${index}.txt`, url: `https://example.org/${index}`, next_start: 2000 },
      summary: `Источник ${index}`,
    }));
    const compact = compactVoodooMessage(source);
    expect(compact.content).toBe(source.content);
    expect(compact.executedActions).toHaveLength(48);
    expect(compact.executedActionCount).toBe(90);
    expect(compact.actionsTruncated).toBe(true);
    const last = compact.executedActions!.at(-1)!;
    expect(last.args.filename).toBe('source-89.txt');
    expect(last.result).toMatchObject({ path: '/notes/source-89.txt', url: 'https://example.org/89', next_start: 2000 });
    expect(JSON.stringify(last).length).toBeLessThan(6000);
    expect(source.executedActions[89].result.content).toHaveLength(800000);
  });

  it('does not lose the latest user request and response when their pair exceeds a selected budget', () => {
    const history = [message(0, 'Earlier'), message(1, 'Earlier answer'), message(2, 'я'.repeat(9000)), message(3, 'я'.repeat(9000))];
    expect(boundVoodooHistory(history, 8192)).toEqual(history.slice(2));
    const pending = [...history, message(4, 'b'.repeat(30000))];
    expect(boundVoodooHistory(pending, 8192)).toEqual([pending[4]]);
  });

  it('limits serialized session history independently from live model context and restores its complete suffix', () => {
    const history = Array.from({ length: 100 }, (_, index) => message(index, 'x'.repeat(20000)));
    const serialized = serializeVoodooHistory(history);
    expect(serialized.length).toBeLessThanOrEqual(VOODOO_SESSION_HISTORY_LIMIT);
    const restored = restoreVoodooHistory(serialized);
    expect(restored.length).toBeGreaterThan(30);
    expect(restored.at(-1)?.id).toBe('message-99');
    expect(restored[0].content).toHaveLength(20000);
    expect(serializeVoodooHistory([message(0, 'x'.repeat(VOODOO_SESSION_HISTORY_LIMIT + 1))])).toBe('[]');
  });

  it('preserves prior truncation metadata and usage while validating corrupt session records', () => {
    const compact = compactVoodooMessage({ ...message(1), executedActionCount: 500, actionsTruncated: true,
      executedActions: [{ tool: 'read_page', args: { tab_id: 'actual-tab' }, result: { url: 'https://example.org' }, summary: 'Чтение' }],
      contextUsage: { requestedWindowTokens: 600000, effectiveWindowTokens: 128000, estimatedInputTokens: 50000, reservedOutputTokens: 4096, providerLimitKnown: true, estimateOnly: true },
    });
    const restored = restoreVoodooHistory(serializeVoodooHistory([compact]));
    expect(restored[0].executedActionCount).toBe(500);
    expect(restored[0].actionsTruncated).toBe(true);
    expect(restored[0].contextUsage).toEqual(compact.contextUsage);
    expect(restoreVoodooHistory('{invalid')).toEqual([]);
    expect(restoreVoodooHistory('[null, {"id":"bad","content":42}, {"role":"system","content":"commands"}]')).toEqual([]);
  });
});
