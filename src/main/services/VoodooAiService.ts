import type {
  VoodooActionExecution,
  VoodooChatMessage,
  VoodooChatResponse,
  VoodooToolDefinition,
} from '../../shared/types';

export const DEFAULT_VOODOO_KEYS = ['sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0'];
export const DEFAULT_VOODOO_MODEL = 'qwen/qwen3.8-max:free';
export const DEFAULT_VOODOO_BASE_URL = 'https://api.xkiro.com/v1';

export const VOODOO_BROWSER_TOOLS: VoodooToolDefinition[] = [
  {
    name: 'search_web',
    description: 'Поиск через поисковую систему интернета в активной или новой вкладке.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос (например: "новости науки", "погода в Москве")' },
        new_tab: { type: 'boolean', description: 'Открыть результат поиска в новой вкладке (true) или в текущей (false)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_url',
    description: 'Переход по указанному URL или сайту в активной или новой вкладке.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL или адрес сайта (например: "https://wikipedia.org", "github.com")' },
        new_tab: { type: 'boolean', description: 'Открыть в новой вкладке (true) или в текущей (false)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_tabs',
    description: 'Получение списка всех открытых вкладок браузера (id, заголовок, URL, активна ли).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'switch_tab',
    description: 'Переключение на указанную вкладку по её ID.',
    parameters: {
      type: 'object',
      properties: {
        tab_id: { type: 'string', description: 'Идентификатор вкладки для переключения' },
      },
      required: ['tab_id'],
    },
  },
  {
    name: 'close_tab',
    description: 'Закрытие вкладки по её ID (если не указан ID — закрывается текущая активная вкладка).',
    parameters: {
      type: 'object',
      properties: {
        tab_id: { type: 'string', description: 'Идентификатор закрываемой вкладки (необязательно)' },
      },
    },
  },
  {
    name: 'read_page',
    description: 'Считывание текстового содержимого, заголовков и структуры страницы для анализа.',
    parameters: {
      type: 'object',
      properties: {
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
        max_length: { type: 'number', description: 'Максимальная длина текста в символах (по умолчанию 4000)' },
      },
    },
  },
  {
    name: 'get_page_elements',
    description: 'Поиск интерактивных элементов на странице: кнопок, ссылок, полей ввода.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Тип элементов для поиска',
          enum: ['all', 'links', 'buttons', 'inputs'],
        },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
    },
  },
  {
    name: 'click_element',
    description: 'Клик по кнопке, ссылке или элементу страницы по видимому тексту или CSS-селектору.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Видимый текст на элементе или кнопке (например "Войти", "Купить")' },
        selector: { type: 'string', description: 'CSS-селектор элемента (например "button.submit", "#login-btn")' },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
    },
  },
  {
    name: 'fill_input',
    description: 'Ввод текста в поле формы или поиска на сайте с опциональной отправкой формы (Enter).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Текст для ввода' },
        selector: { type: 'string', description: 'CSS-селектор поля ввода' },
        placeholder: { type: 'string', description: 'Текст плейсхолдера поля для поиска' },
        submit: { type: 'boolean', description: 'Отправить форму после ввода (нажать Enter или кнопку Submit)' },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'scroll_page',
    description: 'Прокрутка страницы вверх, вниз, в начало или в конец.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'Направление прокрутки',
          enum: ['up', 'down', 'top', 'bottom'],
        },
        amount: { type: 'number', description: 'Количество пикселей для прокрутки (по умолчанию 500)' },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'execute_script',
    description: 'Выполнение произвольного JavaScript кода на странице с возвратом результата.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript-код для выполнения' },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_active_dialog',
    description: 'Извлечение последних сообщений активного чата в мессенджерах или соцсетях (ВКонтакте, Telegram, WhatsApp).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'clean_browser',
    description: 'Запуск экспресс-очистки Click & Clean (очистка кэша, куки, истории, вкладок).',
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          description: 'Пресет очистки: quick (быстрая), post-payment (после оплаты), kiosk (режим киоска)',
          enum: ['quick', 'post-payment', 'kiosk'],
        },
      },
    },
  },
];

export const VOODOO_SYSTEM_PROMPT = `Ты — Вуду (Voodoo AI), умный, тактичный и харизматичный автономный AI-ассистент и агент браузера soulm8te. Твой аватар — обаятельная кукла вуду с пуговичными глазами, стежками и красными булавками.
Ты обладаешь полным контролем над браузером, вкладками и веб-страницами, а также мастерски разбираешься в человеческом общении, психологии, флирте, этикете, деловой и дружеской переписке в соцсетях (ВКонтакте, Telegram и др.).

УПРАВЛЕНИЕ БРАУЗЕРОМ И ИНСТРУМЕНТЫ (BROWSER AGENT):
Когда пользователь просит что-то найти, открыть сайт, прочитать страницу, кликнуть по элементу, заполнить поле, закрыть или переключить вкладку, очистить данные браузера — ты ОБЯЗАН вызвать соответствующий инструмент!
Доступные инструменты:
- search_web(query, new_tab?): поиск в поисковой системе интернета.
- open_url(url, new_tab?): переход по любому URL или сайту.
- list_tabs(): получение списка всех открытых вкладок.
- switch_tab(tab_id): переключение на конкретную вкладку по её ID.
- close_tab(tab_id?): закрытие вкладки (по умолчанию текущей).
- read_page(tab_id?, max_length?): чтение текста и заголовков открытой страницы.
- get_page_elements(type?, tab_id?): поиск интерактивных элементов (кнопок, ссылок, полей).
- click_element(text?, selector?, tab_id?): клик по элементу или кнопке по тексту или селектору.
- fill_input(text, selector?, placeholder?, submit?, tab_id?): ввод текста в поле формы/поиска.
- scroll_page(direction, amount?, tab_id?): прокрутка ('up' | 'down' | 'top' | 'bottom').
- execute_script(code, tab_id?): выполнение JavaScript на странице.
- get_active_dialog(): извлечение последних сообщений активного чата соцсетей (ВК, Telegram, WhatsApp).
- clean_browser(preset?): экспресс-очистка Click & Clean ('quick' | 'post-payment' | 'kiosk').

ФОРМАТ ВЫЗОВА ИНСТРУМЕНТОВ:
Ты можешь вызывать инструменты через нативный механизм tool_calls (OpenAI format), либо с помощью блока action в тексте:
\`\`\`action
{"tool": "имя_инструмента", "args": {"параметр": "значение"}}
\`\`\`
После выполнения инструмента ты получишь результат и сможешь сформулировать ответ пользователю.

ГОЛОСОВЫЕ КОМАНДЫ (STT):
Пользователь может отправлять голосовые команды через встроенный микрофон и систему распознавания речи (Speech-to-Text).
Голосовые команды звучат естественно и разговорно:
- «Найди в интернете новости...», «Поищи рецепт...» -> вызови search_web(query: ...)
- «Открой Ютуб», «Перейди на сайт Википедии» -> вызови open_url(...) или search_web(...)
- «Прочитай страницу», «О чём эта статья?» -> вызови read_page()
- «Закрой эту вкладку», «Переключись на вкладку...» -> вызови close_tab() или switch_tab(...)
- «Очисти историю и куки», «Удали следы браузера» -> вызови clean_browser()
- «Что ответить собеседнику в чате?» -> вызови get_active_dialog()
Всегда оперативно распознавай намерения пользователя, немедленно выполняй действие через нужные инструменты и давай чёткий, понятный и живой ответ!

АНАЛИЗ ДИАЛОГОВ И ПЕРЕПИСКИ:
Когда пользователь просит проанализировать диалог или текст:
1. Кратко (в 1-3 предложениях) опиши суть ситуации, настроение собеседника и скрытый подтекст.
2. Сформулируй 3-4 готовых, живых варианта ответа в разных тональностях:
   • [С юмором / Остроумный] — лёгкий, остроумный или с ноткой доброй иронии / флирта (если уместно).
   • [Дружеский / Тёплый] — естественный, открытый и поддерживающий диалог.
   • [Чёткий / По делу] — лаконичный, уверенный и конкретный.
   • [Вежливый / Дипломатичный] — мягкий и тактичный ответ.
3. Форматируй список строго с маркером «• [Название] «Текст»», чтобы пользователь мог легко скопировать нужный вариант в один клик.

Если пользователь задаёт обычный вопрос или общается на любую другую тему — отвечай живо, ёмко, интересно, с лёгким дружелюбным характером Вуду, без шаблонности и канцелярита. Всегда отвечай на русском языке.`;

export interface VoodooKeyHealth {
  status: 'healthy' | 'exhausted' | 'invalid';
  lastError?: string;
  lastChecked?: number;
  latencyMs?: number;
  cooldownUntil?: number;
}

export interface VoodooKeyStatusItem {
  key: string;
  maskedKey: string;
  isPrimary: boolean;
  status: 'healthy' | 'exhausted' | 'invalid' | 'unknown';
  lastError?: string;
  lastChecked?: number;
  latencyMs?: number;
  cooldownRemainingMs?: number;
}

export type VoodooToolExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<{ success: boolean; result?: unknown; error?: string; summary?: string }>;

export function formatDefaultActionSummary(tool: string, args: Record<string, unknown>, success = true): string {
  const icon = success ? '✅' : '❌';
  switch (tool) {
    case 'search_web':
      return `🔍 Поиск: «${String(args.query || '')}»`;
    case 'open_url':
      return `🌐 Переход: ${String(args.url || '')}`;
    case 'list_tabs':
      return `📑 Список вкладок браузера`;
    case 'switch_tab':
      return `📑 Переключение вкладки: ${String(args.tab_id || '')}`;
    case 'close_tab':
      return `❌ Закрытие вкладки ${String(args.tab_id || '')}`;
    case 'read_page':
      return `📄 Чтение страницы`;
    case 'get_page_elements':
      return `🔍 Поиск элементов страницы (${String(args.type || 'all')})`;
    case 'click_element':
      return `🖱️ Клик по «${String(args.text || args.selector || 'элементу')}»`;
    case 'fill_input':
      return `✏️ Ввод текста в поле`;
    case 'scroll_page':
      return `📜 Прокрутка (${String(args.direction || 'down')})`;
    case 'execute_script':
      return `⚡ Выполнение скрипта на странице`;
    case 'get_active_dialog':
      return `💬 Извлечение активного диалога`;
    case 'clean_browser':
      return `🧹 Экспресс-очистка (${String(args.preset || 'quick')})`;
    default:
      return `${icon} Действие: ${tool}`;
  }
}

export class VoodooAiService {
  private activeKeyIndex = 0;
  private keyHealthMap = new Map<string, VoodooKeyHealth>();

  constructor() {}

  /**
   * Masks API key for safe display in UI or logs: sk-xt-632c•••••••••••••••••••••••••••••••••••••dca0
   */
  static maskKey(key: string): string {
    if (!key || key.length < 12) return '••••••••';
    const prefix = key.slice(0, 10);
    const suffix = key.slice(-4);
    return `${prefix}${'•'.repeat(Math.max(4, key.length - 14))}${suffix}`;
  }

  /**
   * Extracts individual suggested replies from Voodoo's text response.
   */
  static extractSuggestedReplies(text: string): string[] {
    const suggestions: string[] = [];
    const lines = text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = line.match(/^(?:•|\*|-|\d+[.)])\s*(?:\[[^\]]+\]|\([^)]+\))?\s*["«“](.+?)["»”]$/) ||
                    line.match(/^(?:•|\*|-|\d+[.)])\s*\[([^\]]+)\]\s*(.+)$/);
      if (match) {
        const candidate = (match[2] ? match[2] : match[1]).replace(/^["«“]|["»”]$/g, '').trim();
        if (candidate.length > 2 && candidate.length < 600 && !suggestions.includes(candidate)) {
          suggestions.push(candidate);
        }
      }
    }
    return suggestions.slice(0, 5);
  }

  /**
   * Parses text action blocks ```action {"tool": "...", "args": {...}} ``` or JSON blocks.
   */
  static parseTextActionCalls(text: string): Array<{ tool: string; args: Record<string, unknown>; rawBlock: string }> {
    if (!text) return [];
    const actions: Array<{ tool: string; args: Record<string, unknown>; rawBlock: string }> = [];

    // 1. Matches ```action ... ``` or ```json ... ``` containing "tool"
    const codeBlockRegex = /```(?:action|json)?\s*(\{[\s\S]*?"tool"\s*:[\s\S]*?\})\s*```/gi;
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed && typeof parsed.tool === 'string') {
          actions.push({
            tool: parsed.tool,
            args: (parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)) ? parsed.args : {},
            rawBlock: match[0],
          });
        }
      } catch {}
    }

    // 2. If no fenced blocks found, check if plain JSON {"tool": "...", "args": {...}} is in text
    if (actions.length === 0) {
      const rawJsonRegex = /\{[\s\r\n]*"tool"[\s\r\n]*:[\s\r\n]*"([^"]+)"[\s\S]*?\}/g;
      while ((match = rawJsonRegex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(match[0]);
          if (parsed && typeof parsed.tool === 'string') {
            actions.push({
              tool: parsed.tool,
              args: (parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)) ? parsed.args : {},
              rawBlock: match[0],
            });
          }
        } catch {}
      }
    }

    return actions;
  }

  /**
   * Cleans action blocks from assistant reply text for user presentation.
   */
  static cleanActionBlocks(text: string): string {
    if (!text) return '';
    return text
      .replace(/```(?:action|json)?\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}\s*```/gi, '')
      .trim();
  }

  /**
   * Returns current health status for each configured key.
   */
  getKeysStatus(keys: string[]): VoodooKeyStatusItem[] {
    const cleanKeys = keys.map((k) => k.trim()).filter(Boolean);
    const now = Date.now();
    return cleanKeys.map((key, idx) => {
      const health = this.keyHealthMap.get(key);
      const isCoolingDown = health?.cooldownUntil ? health.cooldownUntil > now : false;
      const cooldownRemainingMs = isCoolingDown && health?.cooldownUntil ? health.cooldownUntil - now : undefined;

      return {
        key,
        maskedKey: VoodooAiService.maskKey(key),
        isPrimary: idx === 0,
        status: health ? (isCoolingDown ? 'exhausted' : health.status) : 'unknown',
        lastError: health?.lastError,
        lastChecked: health?.lastChecked,
        latencyMs: health?.latencyMs,
        cooldownRemainingMs,
      };
    });
  }

  /**
   * Tests a specific API key against xkiro endpoint.
   */
  async testKey(
    key: string,
    baseUrl = DEFAULT_VOODOO_BASE_URL,
    model = DEFAULT_VOODOO_MODEL
  ): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const cleanKey = key.trim();
    if (!cleanKey) return { success: false, error: 'Ключ не может быть пустым' };

    const start = Date.now();
    try {
      const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Привет' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(12000),
      });

      const latencyMs = Date.now() - start;
      if (response.ok) {
        this.keyHealthMap.set(cleanKey, {
          status: 'healthy',
          latencyMs,
          lastChecked: Date.now(),
        });
        return { success: true, latencyMs };
      }

      const bodyText = await response.text();
      let errorDetail = `Ошибка HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed.error?.message) errorDetail = parsed.error.message;
      } catch {}

      const isQuotaOrLimit =
        response.status === 429 ||
        response.status === 402 ||
        response.status === 403 ||
        /quota|limit|rate|balance|credit/i.test(errorDetail);

      const isInvalid = response.status === 401 || /invalid|disabled|unauthorized/i.test(errorDetail);

      this.keyHealthMap.set(cleanKey, {
        status: isQuotaOrLimit ? 'exhausted' : isInvalid ? 'invalid' : 'exhausted',
        lastError: errorDetail,
        lastChecked: Date.now(),
        latencyMs,
        cooldownUntil: isQuotaOrLimit ? Date.now() + 5 * 60 * 1000 : undefined,
      });

      return { success: false, latencyMs, error: errorDetail };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : 'Ошибка соединения с xkiro';
      this.keyHealthMap.set(cleanKey, {
        status: 'exhausted',
        lastError: errorMsg,
        lastChecked: Date.now(),
        latencyMs,
        cooldownUntil: Date.now() + 60 * 1000,
      });
      return {
        success: false,
        latencyMs,
        error: errorMsg,
      };
    }
  }

  /**
   * Internal chat completion dispatcher with key rotation failover.
   */
  private async executeChatCompletion(
    apiMessages: Array<Record<string, unknown>>,
    tools: VoodooToolDefinition[] | undefined,
    configuredKeys: string[],
    baseUrl: string,
    model: string
  ): Promise<{
    success: boolean;
    message?: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    keyIndexUsed?: number;
    activeKeyMasked?: string;
    error?: string;
  }> {
    const totalKeys = configuredKeys.length;
    const now = Date.now();

    const availableKeyIndices: number[] = [];
    for (let i = 0; i < configuredKeys.length; i++) {
      const k = configuredKeys[i];
      const h = this.keyHealthMap.get(k);
      if (!h || !h.cooldownUntil || h.cooldownUntil <= now) {
        availableKeyIndices.push(i);
      }
    }

    const indicesToTry = availableKeyIndices.length > 0
      ? availableKeyIndices
      : configuredKeys.map((_, i) => i);

    const sortedIndices = [...indicesToTry].sort((a, b) => {
      const distA = (a - this.activeKeyIndex + totalKeys) % totalKeys;
      const distB = (b - this.activeKeyIndex + totalKeys) % totalKeys;
      return distA - distB;
    });

    let lastError = '';

    for (const keyIndex of sortedIndices) {
      const currentKey = configuredKeys[keyIndex];
      const masked = VoodooAiService.maskKey(currentKey);

      const requestBody: Record<string, unknown> = {
        model,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1500,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        requestBody.tool_choice = 'auto';
      }

      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30000),
        });

        // If endpoint rejects tools parameter (some models or proxies return 400 for tools)
        if (!response.ok && response.status === 400 && requestBody.tools) {
          const bodyText = await response.text();
          if (/tool|function/i.test(bodyText)) {
            delete requestBody.tools;
            delete requestBody.tool_choice;
            response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentKey}`,
              },
              body: JSON.stringify(requestBody),
              signal: AbortSignal.timeout(30000),
            });
          }
        }

        if (response.ok) {
          const data = await response.json();
          const choice = data.choices?.[0];
          const choiceMsg = choice?.message || { role: 'assistant', content: 'Вуду затрудняется ответить на этот вопрос.' };

          this.activeKeyIndex = keyIndex;
          this.keyHealthMap.set(currentKey, {
            status: 'healthy',
            lastChecked: Date.now(),
          });

          return {
            success: true,
            message: choiceMsg,
            keyIndexUsed: keyIndex,
            activeKeyMasked: masked,
          };
        }

        const bodyText = await response.text();
        let errorMsg = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(bodyText);
          if (parsed.error?.message) errorMsg = parsed.error.message;
        } catch {}

        lastError = errorMsg;

        const isQuotaOrLimitError =
          response.status === 429 ||
          response.status === 401 ||
          response.status === 402 ||
          response.status === 403 ||
          /quota|limit|token|rate|balance|credit|unauthorized|disabled/i.test(errorMsg);

        this.keyHealthMap.set(currentKey, {
          status: isQuotaOrLimitError ? 'exhausted' : 'invalid',
          lastError: errorMsg,
          lastChecked: Date.now(),
          cooldownUntil: isQuotaOrLimitError ? Date.now() + 5 * 60 * 1000 : undefined,
        });

        if (isQuotaOrLimitError && totalKeys > 1) {
          console.warn(`[Voodoo AI] Key #${keyIndex + 1} (${masked}) hit quota/limit (${errorMsg}). Transparently switching to next key...`);
          continue;
        }
      } catch (networkErr) {
        lastError = networkErr instanceof Error ? networkErr.message : 'Сетевая ошибка';
        this.keyHealthMap.set(currentKey, {
          status: 'exhausted',
          lastError,
          lastChecked: Date.now(),
          cooldownUntil: Date.now() + 60 * 1000,
        });
      }
    }

    return {
      success: false,
      error: lastError,
    };
  }

  /**
   * Sends chat prompt to xkiro with autonomous agent loop (up to 5 steps) and tool calling.
   */
  async chat(
    messages: VoodooChatMessage[],
    options: {
      keys?: string[];
      model?: string;
      baseUrl?: string;
      tabContext?: { url?: string; title?: string; chatText?: string };
      toolExecutor?: VoodooToolExecutor;
    } = {}
  ): Promise<VoodooChatResponse> {
    const configuredKeys = (options.keys && options.keys.length > 0)
      ? options.keys.map((k) => k.trim()).filter(Boolean)
      : DEFAULT_VOODOO_KEYS;

    const baseUrl = (options.baseUrl && options.baseUrl.trim()) ? options.baseUrl.trim() : DEFAULT_VOODOO_BASE_URL;
    const model = (options.model && options.model.trim()) ? options.model.trim() : DEFAULT_VOODOO_MODEL;

    if (configuredKeys.length === 0) {
      return {
        reply: 'Не настроен ни один API-ключ xkiro. Пожалуйста, добавьте ключ в Настройках браузера (раздел «AI-Ассистент Вуду»).',
        error: 'no_keys',
      };
    }

    // Build initial payload messages including system prompt and page context if available
    const apiMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: VOODOO_SYSTEM_PROMPT },
    ];

    if (options.tabContext && (options.tabContext.chatText || options.tabContext.title)) {
      let ctx = '--- КОНТЕКСТ АКТИВНОЙ ВКЛАДКИ ---\n';
      if (options.tabContext.title) ctx += `Страница: ${options.tabContext.title}\n`;
      if (options.tabContext.url) ctx += `URL: ${options.tabContext.url}\n`;
      if (options.tabContext.chatText) {
        ctx += `\nСодержимое / последние сообщения диалога:\n${options.tabContext.chatText.slice(0, 6000)}\n`;
      }
      ctx += '-----------------------------------';
      apiMessages.push({ role: 'system', content: ctx });
    }

    for (const msg of messages) {
      apiMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }

    const executedActions: VoodooActionExecution[] = [];
    let lastKeyIndexUsed: number | undefined;
    let lastActiveKeyMasked: string | undefined;
    let finalReply = '';

    const maxSteps = options.toolExecutor ? 5 : 1;

    for (let step = 0; step < maxSteps; step++) {
      const completion = await this.executeChatCompletion(
        apiMessages,
        options.toolExecutor ? VOODOO_BROWSER_TOOLS : undefined,
        configuredKeys,
        baseUrl,
        model
      );

      if (!completion.success || !completion.message) {
        if (executedActions.length > 0) {
          return {
            reply: `Действия агента:\n${executedActions.map((a) => `• ${a.summary}`).join('\n')}\n\nОднако возникла ошибка связи с моделью: ${completion.error}`,
            executedActions,
            error: completion.error,
            keyIndexUsed: lastKeyIndexUsed,
            activeKeyMasked: lastActiveKeyMasked,
          };
        }
        return {
          reply: `Не удалось получить ответ от Вуду. Все настроенные ключи (${configuredKeys.length}) временно исчерпали квоту или недоступны: ${completion.error}.\nВы можете добавить резервный ключ xkiro в Настройках браузера.`,
          error: completion.error,
        };
      }

      lastKeyIndexUsed = completion.keyIndexUsed;
      lastActiveKeyMasked = completion.activeKeyMasked;
      const msg = completion.message;
      const rawContent = msg.content || '';

      const nativeToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
        ? msg.tool_calls
        : [];

      const textActions = (nativeToolCalls.length === 0 && options.toolExecutor)
        ? VoodooAiService.parseTextActionCalls(rawContent)
        : [];

      // If neither native tool_calls nor text action calls are present, model produced final response
      if (nativeToolCalls.length === 0 && textActions.length === 0) {
        finalReply = rawContent;
        break;
      }

      if (!options.toolExecutor) {
        finalReply = rawContent;
        break;
      }

      // Handle Native tool_calls (OpenAI format)
      if (nativeToolCalls.length > 0) {
        apiMessages.push({
          role: 'assistant',
          content: rawContent || '',
          tool_calls: nativeToolCalls,
        });

        for (const tc of nativeToolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {}

          let execRes: { success: boolean; result?: unknown; error?: string; summary?: string };
          try {
            execRes = await options.toolExecutor(tc.function.name, args);
          } catch (err) {
            const errStr = err instanceof Error ? err.message : String(err);
            execRes = { success: false, error: errStr };
          }

          const actionExec: VoodooActionExecution = {
            tool: tc.function.name,
            args,
            result: execRes.result,
            error: execRes.error,
            summary: execRes.summary || formatDefaultActionSummary(tc.function.name, args, execRes.success),
          };
          executedActions.push(actionExec);

          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(
              execRes.result !== undefined
                ? execRes.result
                : (execRes.error ? { error: execRes.error } : { success: execRes.success })
            ),
          });
        }
      } else if (textActions.length > 0) {
        // Handle Text Action Blocks (```action {"tool": "...", "args": {...}} ```)
        apiMessages.push({
          role: 'assistant',
          content: rawContent,
        });

        const observationLines: string[] = [];
        for (const act of textActions) {
          let execRes: { success: boolean; result?: unknown; error?: string; summary?: string };
          try {
            execRes = await options.toolExecutor(act.tool, act.args);
          } catch (err) {
            const errStr = err instanceof Error ? err.message : String(err);
            execRes = { success: false, error: errStr };
          }

          const actionExec: VoodooActionExecution = {
            tool: act.tool,
            args: act.args,
            result: execRes.result,
            error: execRes.error,
            summary: execRes.summary || formatDefaultActionSummary(act.tool, act.args, execRes.success),
          };
          executedActions.push(actionExec);

          const resultStr = JSON.stringify(
            execRes.result !== undefined
              ? execRes.result
              : (execRes.error ? { error: execRes.error } : { success: execRes.success })
          );
          observationLines.push(`[Результат ${act.tool}]: ${resultStr}`);
        }

        apiMessages.push({
          role: 'user',
          content: `Результаты действий агента:\n${observationLines.join('\n')}\nСформулируй теперь понятный ответ для пользователя на основе этих данных.`,
        });
      }
    }

    const cleanedReply = VoodooAiService.cleanActionBlocks(finalReply);
    const reply = cleanedReply || (executedActions.length > 0
      ? `Я выполнил запрошенные действия в браузере:\n${executedActions.map((a) => `• ${a.summary}`).join('\n')}`
      : 'Вуду затрудняется ответить на этот вопрос.');

    const suggestedReplies = VoodooAiService.extractSuggestedReplies(reply);

    return {
      reply,
      suggestedReplies: suggestedReplies.length > 0 ? suggestedReplies : undefined,
      keyIndexUsed: lastKeyIndexUsed,
      activeKeyMasked: lastActiveKeyMasked,
      executedActions: executedActions.length > 0 ? executedActions : undefined,
    };
  }
}
