import { describe, expect, it, vi } from 'vitest';
import { VoodooAiService, DEFAULT_VOODOO_KEYS, DEFAULT_VOODOO_MODEL, VOODOO_SYSTEM_PROMPT } from '../../src/main/services/VoodooAiService';

describe('VoodooAiService', () => {
  it('correctly masks API keys for privacy and UI display', () => {
    const key = 'sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0';
    const masked = VoodooAiService.maskKey(key);
    expect(masked.startsWith('sk-xt-632c')).toBe(true);
    expect(masked.endsWith('dca0')).toBe(true);
    expect(masked.includes('•')).toBe(true);
    expect(masked).not.toContain('df73e5cc');

    expect(VoodooAiService.maskKey('')).toBe('••••••••');
    expect(VoodooAiService.maskKey('short')).toBe('••••••••');
  });

  it('extracts suggested replies in various bullet and quote formats', () => {
    const sampleVoodooReply = `
Собеседник явно флиртует и проверяет твою реакцию! Не тушуйся, держи баланс между лёгкой иронией и дружелюбием.

Вот что можно ответить:
• [С юмором] «Да ладно, неужели ты правда так думаешь? 😄»
• [Тёплый] «Было бы здорово увидеться на выходных!»
• [Чёткий] «Договорились, буду вовремя.»
• [Дипломатичный] «Интересная мысль, дай мне немного времени подумать над этим.»
`;

    const suggestions = VoodooAiService.extractSuggestedReplies(sampleVoodooReply);
    expect(suggestions.length).toBe(4);
    expect(suggestions[0]).toBe('Да ладно, неужели ты правда так думаешь? 😄');
    expect(suggestions[1]).toBe('Было бы здорово увидеться на выходных!');
    expect(suggestions[2]).toBe('Договорились, буду вовремя.');
    expect(suggestions[3]).toBe('Интересная мысль, дай мне немного времени подумать над этим.');
  });

  it('transparently rotates keys when a quota or rate limit is hit', async () => {
    const service = new VoodooAiService();
    const key1 = 'sk-xt-key1-exhausted';
    const key2 = 'sk-xt-key2-working';

    let fetchCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      fetchCount++;
      const authHeader = options.headers?.Authorization || '';

      if (authHeader.includes('sk-xt-key1-exhausted')) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: 'Rate limit / quota exceeded' } }),
        };
      }

      if (authHeader.includes('sk-xt-key2-working')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '• [С юмором] «Конечно, без проблем!»',
                },
              },
            ],
          }),
        };
      }

      return { ok: false, status: 500, text: async () => 'Server error' };
    });

    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await service.chat(
        [{ id: '1', role: 'user', content: 'Привет', timestamp: Date.now() }],
        {
          keys: [key1, key2],
          model: DEFAULT_VOODOO_MODEL,
        }
      );

      // Verify that two fetch attempts were made (key1 failed -> rotated to key2)
      expect(fetchCount).toBe(2);
      expect(response.reply).toBe('• [С юмором] «Конечно, без проблем!»');
      expect(response.suggestedReplies).toContain('Конечно, без проблем!');
      expect(response.keyIndexUsed).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tests API key and measures latency', async () => {
    const service = new VoodooAiService();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await service.testKey('sk-valid-key');
      expect(res.success).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('includes VK active dialogue instructions in system prompt', () => {
    const service = new VoodooAiService();
    expect(service).toBeDefined();
    expect(VOODOO_SYSTEM_PROMPT).toContain('Вуду');
    expect(VOODOO_SYSTEM_PROMPT).toContain('ВКонтакте');
  });

  it('tracks health status, status items, and cooldowns', async () => {
    const service = new VoodooAiService();
    const key1 = 'sk-xt-test-exhausted-key';
    const key2 = 'sk-xt-test-valid-key';

    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      const auth = options.headers?.Authorization || '';
      if (auth.includes('exhausted')) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: 'Quota exceeded' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const testRes1 = await service.testKey(key1);
      expect(testRes1.success).toBe(false);
      expect(testRes1.error).toContain('Quota exceeded');

      const testRes2 = await service.testKey(key2);
      expect(testRes2.success).toBe(true);

      const statuses = service.getKeysStatus([key1, key2]);
      expect(statuses.length).toBe(2);
      expect(statuses[0].isPrimary).toBe(true);
      expect(statuses[0].status).toBe('exhausted');
      expect(statuses[0].cooldownRemainingMs).toBeGreaterThan(0);
      expect(statuses[1].isPrimary).toBe(false);
      expect(statuses[1].status).toBe('healthy');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('checkAllKeys checks all keys in parallel and reorders working keys to index 0', async () => {
    const service = new VoodooAiService();
    const deadKey1 = 'sk-xt-dead-key-invalid';
    const deadKey2 = 'sk-xt-dead-key-exhausted';
    const fastWorkingKey = 'sk-xt-working-fast';

    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      const auth = options.headers?.Authorization || '';
      if (auth.includes('invalid')) {
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'Invalid API Key' } }),
        };
      }
      if (auth.includes('exhausted')) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: 'Quota exhausted' } }),
        };
      }
      if (auth.includes('working')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '1' } }] }),
        };
      }
      return { ok: false, status: 500, text: async () => 'Server error' };
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await service.checkAllKeys([deadKey1, deadKey2, fastWorkingKey]);

      expect(result.healthyKeys).toContain(fastWorkingKey);
      expect(result.invalidKeys).toContain(deadKey1);
      expect(result.exhaustedKeys).toContain(deadKey2);

      // The working key MUST be promoted to index 0!
      expect(result.reorderedKeys[0]).toBe(fastWorkingKey);
      expect(result.results[0].key).toBe(fastWorkingKey);
      expect(result.results[0].isPrimary).toBe(true);
      expect(result.results[0].status).toBe('healthy');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executeChatCompletion does not mark healthy key as permanently exhausted on timeout', async () => {
    const service = new VoodooAiService();
    const timeoutKey = 'sk-xt-timeout-key';
    const backupKey = 'sk-xt-backup-working-key';

    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      const auth = options.headers?.Authorization || '';
      if (auth.includes('timeout-key')) {
        const timeoutErr = new Error('The operation was aborted due to timeout.');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Ответ от резервного ключа' } }] }),
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await service.chat(
        [{ id: '1', role: 'user', content: 'Привет', timestamp: Date.now() }],
        { keys: [timeoutKey, backupKey] }
      );

      expect(res.reply).toBe('Ответ от резервного ключа');

      // Key status should NOT be 'exhausted'
      const statuses = service.getKeysStatus([timeoutKey, backupKey]);
      expect(statuses[0].status).not.toBe('exhausted');
      expect(statuses[0].lastError).toContain('Тайм-аут');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
