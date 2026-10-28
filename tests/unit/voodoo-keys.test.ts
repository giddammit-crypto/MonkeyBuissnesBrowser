import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoodooAiService } from '../../src/main/services/VoodooAiService';
import { normalizeVoodooKeys } from '../../src/shared/voodooKeys';

const first = 'sk-unit-test-first-key';
const second = 'sk-unit-test-second-key';
const messages = [{ id: '1', role: 'user' as const, content: 'hello', timestamp: 0 }];
const ok = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe('Voodoo key hygiene and recovery', () => {
  it('normalizes multiline Bearer keys, removes duplicates and rejects malformed inputs', () => {
    expect(normalizeVoodooKeys([`Bearer ${first}\n${second};${first}`])).toEqual([first, second]);
    expect(normalizeVoodooKeys([null, {}, '', 'bad key with spaces'])).toEqual([]);
    expect(normalizeVoodooKeys(undefined)).toEqual([]);
    expect(VoodooAiService.normalizeKeys([first, first])).toEqual([first]);
  });
  it('respects Retry-After and does not retry a cooled key on the next request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { 'retry-after': '60' } })).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const service = new VoodooAiService();
    await service.chat(messages, { keys: [first, second] });
    await service.chat(messages, { keys: [first, second] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${second}`);
    expect(service.getKeysStatus([first])[0].cooldownRemainingMs).toBeGreaterThan(50000);
  });
  it('does not treat model/schema errors as invalid keys or quota and redacts server echoes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `invalid model token limit ${first}` } }), { status: 400 })));
    const service = new VoodooAiService();
    const response = await service.chat(messages, { keys: [first] });
    expect(service.getKeysStatus([first])[0].status).toBe('unknown');
    expect(response.reply).not.toContain(first);
    expect(service.getKeysStatus([first])[0].lastError).not.toContain(first);
  });
  it('rejects unsafe endpoints before sending authorization and forbids redirects', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const service = new VoodooAiService();
    await service.chat(messages, { keys: [first], baseUrl: 'http://example.com/v1' });
    expect(fetchMock).not.toHaveBeenCalled();
    await service.chat(messages, { keys: [first], baseUrl: 'http://127.0.0.1:8080/v1' });
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });
  it('does not claim an invalid 200 payload is a healthy key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const service = new VoodooAiService();
    expect((await service.testKey(first)).success).toBe(false);
    expect(service.getKeysStatus([first])[0].status).toBe('unknown');
  });
  it('resets endpoint scoped cooldown so another provider can use the key', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const service = new VoodooAiService();
    await service.chat(messages, { keys: [first] });
    await service.chat(messages, { keys: [first], baseUrl: 'https://another.example/v1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
