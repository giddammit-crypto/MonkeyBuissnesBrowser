import { afterEach, expect, it, vi } from 'vitest';
import { declaredModelContext, VoodooModelCatalog } from '../../src/main/services/VoodooModelCatalog';

afterEach(() => vi.unstubAllGlobals());

it('uses explicit matching model context metadata, never a name or output-token limit', () => {
  expect(declaredModelContext({ data: [{ id: 'model', context_length: 32768 }] }, 'model')).toBe(32768);
  expect(declaredModelContext({ models: [{ id: 'model', limits: { context_window: 128000 } }] }, 'model')).toBe(128000);
  expect(declaredModelContext({ data: [{ id: 'model-600k', max_tokens: 600000 }] }, 'model-600k')).toBeUndefined();
  expect(declaredModelContext({ data: [{ id: 'other', context_length: 600000 }] }, 'model')).toBeUndefined();
});

it('coalesces concurrent catalog requests, caches limits and rejects redirects', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model', context_length: 128000 }] })));
  vi.stubGlobal('fetch', fetchMock);
  const catalog = new VoodooModelCatalog();
  await Promise.all([catalog.warm('https://example.test/v1', 'model', 'fake-test-key'), catalog.warm('https://example.test/v1', 'model', 'fake-test-key')]);
  await catalog.warm('https://example.test/v1', 'model', 'fake-test-key');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/v1/models');
  expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  expect(catalog.getLimit('https://example.test/v1', 'model')).toBe(128000);
  catalog.dispose();
});

it('does not send credentials to insecure or credential-bearing endpoint URLs', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const catalog = new VoodooModelCatalog();
  for (const base of ['http://example.test/v1', 'https://user:secret@example.test/v1', 'https://example.test/v1?token=x', 'bad-url']) {
    await catalog.warm(base, 'model', 'fake-key');
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('bounds catalog response size and caches unsupported metadata without retry storms', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
  vi.stubGlobal('fetch', fetchMock);
  const catalog = new VoodooModelCatalog();
  await catalog.warm('https://example.test/v1', 'model', 'fake-key');
  await catalog.warm('https://example.test/v1', 'model', 'fake-key');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(catalog.getLimit('https://example.test/v1', 'model')).toBeUndefined();
});

it('aborts background catalog work on browser shutdown and never starts it again', async () => {
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal;
    options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const catalog = new VoodooModelCatalog();
  const pending = catalog.warm('https://example.test/v1', 'model', 'fake-key');
  catalog.dispose();
  await pending;
  expect(requestSignal?.aborted).toBe(true);
  await catalog.warm('https://example.test/v1', 'model', 'fake-key');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
