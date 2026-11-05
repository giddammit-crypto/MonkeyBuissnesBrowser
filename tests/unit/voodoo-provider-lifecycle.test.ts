import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService } from '../../src/main/services/VoodooAiService';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../../src/main/services/VoodooProviderResponse';

const keys = ['sk-xt-FAKE-provider-lifecycle'];
const messages = [{ id: 'request', role: 'user' as const, content: 'Привет', timestamp: 1 }];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function interruptedBody(error: Error) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(error); } }));
}

describe('provider body lifecycle', () => {
  it.each([
    ['body timeout', new DOMException('The operation was aborted', 'AbortError'), /Тайм-аут/],
    ['dropped connection', new TypeError('terminated'), /terminated/],
  ])('applies transport cooldown after %s following HTTP 200', async (_label, error, expected) => {
    const transport = vi.fn().mockResolvedValue(interruptedBody(error));
    vi.stubGlobal('fetch', transport);
    const service = new VoodooAiService();
    const result = await service.chat(messages, { keys });
    expect(result.error).toMatch(expected);
    expect(result.error).not.toBe('invalid_completion');
    expect(service.getKeysStatus(keys)[0]).toMatchObject({ status: 'unknown', lastError: result.error });
    expect(service.getKeysStatus(keys)[0].cooldownRemainingMs).toBeGreaterThan(0);
    await service.chat(messages, { keys });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed and oversized completions as protocol failures', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response('{broken json'))
      .mockResolvedValueOnce(new Response('small', { headers: { 'content-length': String(MAX_PROVIDER_RESPONSE_BYTES + 1) } }));
    vi.stubGlobal('fetch', transport);
    const service = new VoodooAiService();
    expect((await service.chat(messages, { keys })).error).toBe('invalid_completion');
    expect((await service.chat(messages, { keys })).error).toBe('invalid_completion');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(service.getKeysStatus(keys)[0].cooldownRemainingMs).toBeUndefined();
  });

  it('reports user cancellation during response-body reading without penalizing the key', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(stream) {
        controller.abort();
        stream.error(new DOMException('The operation was aborted', 'AbortError'));
      },
    }))));
    const service = new VoodooAiService();
    const result = await service.chat(messages, { keys, signal: controller.signal });
    expect(result.error).toBe('cancelled');
    expect(service.getKeysStatus(keys)[0].lastChecked).toBeUndefined();
  });

  it('measures key latency through the full completion body rather than just HTTP headers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let releaseBody!: (body: string) => void;
    const body = new Promise<string>(resolve => { releaseBody = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: () => body })));
    const service = new VoodooAiService();
    const pending = service.testKey(keys[0]);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(750);
    releaseBody(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    expect(await pending).toMatchObject({ success: true, latencyMs: 750 });
    expect(service.getKeysStatus(keys)[0].latencyMs).toBe(750);
  });
});
