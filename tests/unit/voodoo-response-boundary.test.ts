import { describe, expect, it } from 'vitest';
import { readProviderText } from '../../src/main/services/VoodooProviderResponse';
import { AgentPlan } from '../../src/main/services/AgentWorkflow';

describe('AI provider response boundary', () => {
  it('cancels chunked oversized bodies even without Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode('12345678')); },
      cancel() { cancelled = true; },
    });
    await expect(readProviderText(new Response(stream), 12)).rejects.toThrow('размер');
    expect(cancelled).toBe(true);
  });
  it('rejects oversized declared bodies and preserves split UTF-8', async () => {
    await expect(readProviderText(new Response('small', { headers: { 'Content-Length': '100' } }), 12)).rejects.toThrow('размер');
    const bytes = new TextEncoder().encode('Привет');
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close();
    } });
    expect(await readProviderText(new Response(stream), 12)).toBe('Привет');
  });
  it('cannot use one result to claim completion of an entire multi-step plan', () => {
    const plan = new AgentPlan();
    const steps = ['Read source', 'Write report', 'Verify report'];
    plan.update({ steps, completed_steps: 0 }, 0);
    expect(() => plan.update({ steps, completed_steps: 3 }, 1)).toThrow('каждого');
    expect(plan.completed).toBe(0);
    plan.update({ steps, completed_steps: 2 }, 2);
    expect(plan.completed).toBe(2);
  });
});
