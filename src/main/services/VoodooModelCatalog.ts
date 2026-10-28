const TTL_MS = 30 * 60_000;
const MAX_CATALOG_BYTES = 1024 * 1024;

function catalogEndpoint(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) return;
    return `${url.href.replace(/\/+$/, '')}/models`;
  } catch { return; }
}

/** Only explicit provider metadata is a limit; model names never imply a capacity. */
export function declaredModelContext(data: unknown, model: string): number | undefined {
  if (!data || typeof data !== 'object') return;
  const catalog = data as { data?: unknown; models?: unknown };
  const entries = Array.isArray(catalog.data) ? catalog.data : Array.isArray(catalog.models) ? catalog.models : [];
  const entry = entries.find(item => item && typeof item === 'object' && item.id === model);
  if (!entry) return;
  for (const value of [entry.context_length, entry.context_window, entry.max_model_len, entry.limits?.context_window]) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  }
}

export class VoodooModelCatalog {
  private readonly cache = new Map<string, { expires: number; limit?: number }>();
  private readonly pending = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private disposed = false;

  getLimit(baseUrl: string, model: string): number | undefined {
    const key = `${catalogEndpoint(baseUrl)}\n${model}`;
    const record = this.cache.get(key);
    if (!record || record.expires <= Date.now()) return;
    return record.limit;
  }

  /** Background-only: never add a catalog round trip to time-to-first-completion. */
  warm(baseUrl: string, model: string, apiKey: string): Promise<void> {
    const endpoint = catalogEndpoint(baseUrl);
    if (!endpoint || !apiKey || this.disposed) return Promise.resolve();
    const key = `${endpoint}\n${model}`;
    const existing = this.cache.get(key);
    if (existing && existing.expires > Date.now()) return Promise.resolve();
    const pending = this.pending.get(key);
    if (pending) return pending.promise;
    if (this.pending.size >= 4) return Promise.resolve();
    const controller = new AbortController();
    const promise = this.fetch(endpoint, model, apiKey, controller.signal).then(limit => {
      if (this.disposed) return;
      while (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { limit, expires: Date.now() + (limit ? TTL_MS : 5 * 60_000) });
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, { controller, promise });
    return promise;
  }

  private async fetch(endpoint: string, model: string, apiKey: string, signal: AbortSignal): Promise<number | undefined> {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
      if (!response.ok) { await response.body?.cancel(); return; }
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_CATALOG_BYTES) { await reader.cancel(); return; }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      return declaredModelContext(JSON.parse(text), model);
    } catch { return; }
  }

  dispose(): void {
    this.disposed = true;
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
    this.cache.clear();
  }
}
