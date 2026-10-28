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
  {
    name: 'create_file',
    description: 'Создание файла на компьютере пользователя (текстовые документы, Markdown, JSON, HTML, CSV, скрипты, списки) в папке Загрузок или на Рабочем столе.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Имя файла с расширением (например: "shopping-list.md", "places-moscow.txt", "data.json", "plan.csv")' },
        content: { type: 'string', description: 'Полное текстовое содержимое сохраняемого файла' },
        folder: {
          type: 'string',
          description: 'Целевая папка для сохранения (downloads по умолчанию, desktop, documents)',
          enum: ['downloads', 'desktop', 'documents'],
        },
        open_in_new_tab: {
          type: 'boolean',
          description: 'Автоматически открыть созданный файл (особенно для .html, .svg, .txt файлов) в новой вкладке браузера сразу после сохранения',
        },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'create_note_or_list',
    description: 'Создание структурированного списка, чек-листа, плана или быстрой заметки с сохранением во встроенные Заметки браузера.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Заголовок списка или заметки' },
        items: {
          type: 'array',
          description: 'Пункты списка или чек-листа (если формируется список)',
          items: { type: 'string' },
        },
        content: { type: 'string', description: 'Дополнительный текст, описание или комментарии к списку' },
        color: {
          type: 'string',
          description: 'Цвет карточки заметки',
          enum: ['default', 'yellow', 'pink', 'blue', 'green', 'violet'],
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'analyze_page_data',
    description: 'Глубокий анализ содержимого открытой веб-страницы: извлечение цен, таблиц, характеристик, контактов (email, телефон, адрес), отзывов и структуры.',
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Фокус извлечения данных',
          enum: ['all', 'prices', 'tables', 'contacts', 'reviews', 'summary'],
        },
        tab_id: { type: 'string', description: 'Идентификатор вкладки (по умолчанию текущая)' },
      },
    },
  },
  {
    name: 'geo_lookup',
    description: 'Определение текущей геопозиции (город, страна, регион, координаты, часовой пояс, IP) пользователя.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_places',
    description: 'Поиск мест, заведений (рестораны, кафе, отели, аптеки, достопримечательности, магазины) в городе или локации с интерактивными ссылками на Яндекс Карты, 2ГИС и Google Maps.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Что искать (например: "уютная кофейня", "итальянский ресторан", "круглосуточная аптека", "музеи")' },
        city: { type: 'string', description: 'Город или район поиска (например: "Москва", "Санкт-Петербург", "Казань")' },
        category: { type: 'string', description: 'Категория заведения' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather_and_time',
    description: 'Получение точной погоды, температуры, прогноза, местного времени и часового пояса для любого города или населенного пункта мира.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Название города (например: "Москва", "Сочи", "Владивосток", "Париж", "Токио", "Дубай")' },
      },
      required: ['city'],
    },
  },
  {
    name: 'get_route_info',
    description: 'Построение маршрута между двумя точками (откуда и куда) со ссылками на Яндекс Карты, Google Карты и 2ГИС.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Начальная точка или адрес (например: "Красная площадь, Москва")' },
        to: { type: 'string', description: 'Конечная точка или адрес (например: "Парк Горького, Москва")' },
        mode: {
          type: 'string',
          description: 'Способ передвижения',
          enum: ['auto', 'transit', 'pedestrian', 'bicycle'],
        },
      },
      required: ['from', 'to'],
    },
  },
];

export const VOODOO_SYSTEM_PROMPT = `Ты — Вуду (Voodoo AI), умный, тактичный и харизматичный автономный AI-ассистент и агент браузера soulm8te. Твой аватар — обаятельная кукла вуду с пуговичными глазами, стежками и красными булавками.
Ты обладаешь полным контролем над браузером, вкладками и веб-страницами, умеешь работать с файлами на ПК пользователя, создавать списки и заметки, анализировать веб-сайты и обладаешь мощнейшим гео-функционалом (погода, навигация, карты Яндекс/2ГИС/Google, поиск заведений и маршрутов), а также мастерски разбираешься в человеческом общении, психологии, флирте, этикете, деловой и дружеской переписке в соцсетях (ВКонтакте, Telegram и др.).

УПРАВЛЕНИЕ БРАУЗЕРОМ И ИНСТРУМЕНТЫ (BROWSER AGENT):
Когда пользователь просит что-то найти, открыть сайт, прочитать страницу, создать файл, список или заметку, узнать гео/погоду/маршрут, кликнуть по элементу, заполнить поле, закрыть или переключить вкладку, очистить данные браузера — ты ОБЯЗАН вызвать соответствующий инструмент!
Доступные инструменты:
- search_web(query, new_tab?): умный поиск в поисковой системе интернета.
- open_url(url, new_tab?): переход по любому URL или сайту.
- create_file(filename, content, folder?): создание и сохранение файла на компьютере пользователя (.txt, .md, .csv, .json, .html, .py, .js и др.).
- create_note_or_list(title, items?, content?, color?): создание структурированного списка, чек-листа, плана или быстрой заметки с сохранением в Заметки браузера.
- analyze_page_data(focus?, tab_id?): глубокий анализ содержимого страницы (цены, таблицы, контакты, характеристики, отзывы).
- geo_lookup(): определение текущей геопозиции (город, страна, регион, координаты, часовой пояс, IP).
- search_places(query, city?, category?): поиск заведений, отелей, ресторанов, мест со ссылками на Яндекс.Карты, 2ГИС и Google Maps.
- get_weather_and_time(city): точный прогноз погоды, температура, осадки, местное время и часовой пояс для любого города мира.
- get_route_info(from, to, mode?): построение маршрута между точками со ссылками на навигаторы Яндекс.Карт, Google Maps и 2ГИС.
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
- «Сохрани этот список в файл на рабочий стол...» -> вызови create_file(...)
- «Сделай список покупок / чек-лист дел» -> вызови create_note_or_list(...)
- «Какая погода в Сочи?», «Сколько сейчас времени в Токио?» -> вызови get_weather_and_time(...)
- «Где поужинать в центре Москвы?», «Найди кофейню рядом» -> вызови search_places(...)
- «Как доехать от вокзала до Красной площади?» -> вызови get_route_info(...)
- «Проанализируй цены на этой странице» -> вызови analyze_page_data(focus: 'prices')
- «Открой Ютуб», «Перейди на сайт Википедии» -> вызови open_url(...) или search_web(...)
- «Прочитай страницу», «О чём эта статья?» -> вызови read_page()
- «Закрой эту вкладку», «Переключись на вкладку...» -> вызови close_tab() или switch_tab(...)
- «Очисти историю и куки», «Удали следы браузера» -> вызови clean_browser()
- «Что ответить собеседнику в чате?» -> вызови get_active_dialog()
Всегда оперативно распознавай намерения пользователя, немедленно выполняй действие через нужные инструменты и давай чёткий, понятный и живой ответ!

СЛОЖНЫЕ СОСТАВНЫЕ И АВТОНОМНЫЕ ЗАДАЧИ (COMPLEX AGENT WORKFLOWS):
Ты обладаешь высшим уровнем автономности и мастерски выполняешь сложные многоэтапные поручения «под ключ»!
Пример сложного запроса: «Подбери мне 5 вариантов шапки зимней мужской на вайлдберис, создай html файл с твоим подбором, описанием, фото и активными ссылками-кнопками на эти товары. И открой этот файл в новой вкладке».
В подобных запросах ВСЕГДА действуй решительно и самостоятельно:
1. Подбор контента: Сформируй подборку из 5 качественных, реальных и востребованных товаров (названия брендов/моделей, реалистичные цены со скидкой, рейтинг покупателей 4.7-4.9 со звездами, ключевые преимущества (состав: меринос, флис, кашемир, ветрозащита), привлекательные изображения товаров и прямые рабочие ссылки на каталог маркетплейса, например: https://www.wildberries.ru/catalog/0/search.aspx?search=шапка+зимняя+мужская или https://www.wildberries.ru/catalog/...).
2. Генерация премиального HTML-файла: Сгенерируй полноценный, автономный, валидный HTML5-файл со стильным современным дизайном:
   - Адаптивная сетка карточек (CSS Grid/Flexbox), тёмная элегантная тема (Glassmorphism, градиенты, тени), шрифты без засечек (Inter / sans-serif);
   - Картинки товаров (<img> с аккуратными скруглениями, object-fit: cover, fallback фоном);
   - Ценники (актуальная цена крупно, зачёркнутая старая цена, бейдж скидки -30%/-40%);
   - Рейтинг со звёздами и количество отзывов;
   - Подробные карточки с описанием материалов, температурного режима и посадки;
   - Крупные, заметные интерактивные кнопки-ссылки: <a href="..." target="_blank" class="buy-button">Купить на Wildberries</a>.
3. Сохранение и автоматическое открытие:
   Вызови инструмент create_file с параметром open_in_new_tab: true:
   create_file(filename: "wildberries_mens_winter_hats.html", content: "...", open_in_new_tab: true)
   Файл моментально сохранится на диск пользователя и СРАЗУ ЖЕ откроется в новой вкладке браузера!
4. Итоговый ответ в чате:
   Презентуй пользователю лучшие варианты из подборки в живом стиле Вуду, выдели главные фишки каждой модели и радостно сообщи, что готовая интерактивная витрина сохранена и уже открыта в новой вкладке!

Если пользователь задаёт обычный вопрос или общается на любую другую тему — отвечай живо, ёмко, интересно, с лёгким дружелюбным характером Вуду, без шаблонности и канцелярита. Всегда отвечай на русском языке.`;

export interface VoodooKeyHealth {
  status: 'healthy' | 'exhausted' | 'invalid' | 'unknown';
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
    case 'create_file':
      return args.open_in_new_tab
        ? `💾 Создан и открыт в новой вкладке: «${String(args.filename || '')}»`
        : `💾 Создание файла: «${String(args.filename || '')}»`;
    case 'create_note_or_list':
      return `📝 Список/Заметка: «${String(args.title || '')}»`;
    case 'analyze_page_data':
      return `📊 Анализ данных страницы (${String(args.focus || 'all')})`;
    case 'geo_lookup':
      return `📍 Определение геопозиции`;
    case 'search_places':
      return `🗺️ Поиск мест: «${String(args.query || '')}»${args.city ? ` (${String(args.city)})` : ''}`;
    case 'get_weather_and_time':
      return `🌤️ Погода и время: ${String(args.city || '')}`;
    case 'get_route_info':
      return `🧭 Маршрут: «${String(args.from || '')}» ➔ «${String(args.to || '')}»`;
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

      let reportedStatus: 'healthy' | 'exhausted' | 'invalid' | 'unknown' = 'unknown';
      if (health) {
        if (health.status === 'invalid') {
          reportedStatus = 'invalid';
        } else if (health.status === 'exhausted') {
          reportedStatus = isCoolingDown ? 'exhausted' : 'unknown';
        } else {
          reportedStatus = health.status;
        }
      }

      return {
        key,
        maskedKey: VoodooAiService.maskKey(key),
        isPrimary: idx === 0,
        status: reportedStatus,
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
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '1' }],
          max_tokens: 3,
        }),
        signal: AbortSignal.timeout(12000),
      });

      // If server returns 500 on primary model, test fallback model before concluding failure
      if (!response.ok && response.status >= 500 && model !== 'qwen/qwen3.7-plus:free') {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanKey}`,
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.7-plus:free',
            messages: [{ role: 'user', content: '1' }],
            max_tokens: 3,
          }),
          signal: AbortSignal.timeout(12000),
        });
      }

      const latencyMs = Date.now() - start;
      if (response.ok) {
        this.keyHealthMap.set(cleanKey, {
          status: 'healthy',
          latencyMs,
          lastChecked: Date.now(),
          cooldownUntil: undefined,
          lastError: undefined,
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
        /quota|limit|rate|balance|credit/i.test(errorDetail);

      const isInvalid = response.status === 401 || response.status === 403 || /invalid|disabled|unauthorized/i.test(errorDetail);
      const isServerError = response.status >= 500 && response.status < 600;

      const cooldownMs = isQuotaOrLimit
        ? 5 * 60 * 1000
        : isInvalid
        ? 15 * 60 * 1000
        : isServerError
        ? 10 * 1000
        : 30 * 1000;

      this.keyHealthMap.set(cleanKey, {
        status: isQuotaOrLimit ? 'exhausted' : isInvalid ? 'invalid' : 'exhausted',
        lastError: errorDetail,
        lastChecked: Date.now(),
        latencyMs,
        cooldownUntil: Date.now() + cooldownMs,
      });

      return { success: false, latencyMs, error: errorDetail };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = err instanceof Error && (
        err.name === 'TimeoutError' ||
        /timeout|aborted/i.test(err.message)
      );
      const errorMsg = isTimeout
        ? 'Тайм-аут ожидания ответа (сервер xkiro не ответил вовремя)'
        : (err instanceof Error ? err.message : 'Ошибка соединения с xkiro');

      this.keyHealthMap.set(cleanKey, {
        status: isTimeout ? 'unknown' : 'exhausted',
        lastError: errorMsg,
        lastChecked: Date.now(),
        latencyMs,
        cooldownUntil: isTimeout ? Date.now() + 5000 : Date.now() + 30 * 1000,
      });

      return {
        success: false,
        latencyMs,
        error: errorMsg,
      };
    }
  }

  /**
   * Concurrently checks all configured API keys on startup or on demand,
   * categorizing them into healthy, exhausted, invalid, and returning an
   * optimized key list with verified working keys placed first.
   */
  async checkAllKeys(
    keys: string[],
    baseUrl = DEFAULT_VOODOO_BASE_URL,
    model = DEFAULT_VOODOO_MODEL
  ): Promise<{
    results: VoodooKeyStatusItem[];
    healthyKeys: string[];
    exhaustedKeys: string[];
    invalidKeys: string[];
    unknownKeys: string[];
    reorderedKeys: string[];
    recommendedActiveIndex: number;
  }> {
    const cleanKeys = Array.from(new Set(keys.map((k) => k.trim()).filter(Boolean)));
    if (cleanKeys.length === 0) {
      return {
        results: [],
        healthyKeys: [],
        exhaustedKeys: [],
        invalidKeys: [],
        unknownKeys: [],
        reorderedKeys: [],
        recommendedActiveIndex: 0,
      };
    }

    const testPromises = cleanKeys.map(async (key) => {
      const res = await this.testKey(key, baseUrl, model);
      return { key, res };
    });

    const settled = await Promise.all(testPromises);

    const healthyKeys: string[] = [];
    const exhaustedKeys: string[] = [];
    const invalidKeys: string[] = [];
    const unknownKeys: string[] = [];
    const latencyMap = new Map<string, number>();

    for (const item of settled) {
      const health = this.keyHealthMap.get(item.key);
      const st = health?.status || (item.res.success ? 'healthy' : 'unknown');
      if (item.res.success || st === 'healthy') {
        healthyKeys.push(item.key);
        latencyMap.set(item.key, item.res.latencyMs ?? 9999);
      } else if (st === 'invalid') {
        invalidKeys.push(item.key);
      } else if (st === 'exhausted') {
        exhaustedKeys.push(item.key);
      } else {
        unknownKeys.push(item.key);
      }
    }

    // Sort healthy keys by lowest latency
    healthyKeys.sort((a, b) => (latencyMap.get(a) ?? 9999) - (latencyMap.get(b) ?? 9999));

    // Priority ordering: healthy -> unknown -> exhausted -> invalid
    const reorderedKeys = [...healthyKeys, ...unknownKeys, ...exhaustedKeys, ...invalidKeys];

    if (healthyKeys.length > 0) {
      this.activeKeyIndex = 0;
    }

    const results = this.getKeysStatus(reorderedKeys);

    return {
      results,
      healthyKeys,
      exhaustedKeys,
      invalidKeys,
      unknownKeys,
      reorderedKeys,
      recommendedActiveIndex: 0,
    };
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

    // Priority tiers for choosing which key to try:
    // Tier 1: Verified 'healthy' keys ready to use
    // Tier 2: 'unknown' keys (not yet tested) ready to use
    // Tier 3: 'exhausted' keys whose cooldown has expired
    // Tier 4: 'healthy' or 'unknown' keys currently in transient cooldown
    // Tier 5: 'exhausted' keys still in cooldown
    // Tier 6: 'invalid' keys (401/403)
    const tier1Healthy: number[] = [];
    const tier2Unknown: number[] = [];
    const tier3ExhaustedExpired: number[] = [];
    const tier4TransientCooldown: number[] = [];
    const tier5ExhaustedCooldown: number[] = [];
    const tier6Invalid: number[] = [];

    for (let i = 0; i < configuredKeys.length; i++) {
      const k = configuredKeys[i];
      const h = this.keyHealthMap.get(k);
      const isCooldown = Boolean(h?.cooldownUntil && h.cooldownUntil > now);

      if (h?.status === 'invalid') {
        tier6Invalid.push(i);
      } else if (!isCooldown) {
        if (h?.status === 'healthy') {
          tier1Healthy.push(i);
        } else if (h?.status === 'exhausted') {
          tier3ExhaustedExpired.push(i);
        } else {
          tier2Unknown.push(i);
        }
      } else {
        if (h?.status === 'healthy' || !h?.status) {
          tier4TransientCooldown.push(i);
        } else {
          tier5ExhaustedCooldown.push(i);
        }
      }
    }

    const sortFromActive = (arr: number[]) => [...arr].sort((a, b) => {
      const distA = (a - this.activeKeyIndex + totalKeys) % totalKeys;
      const distB = (b - this.activeKeyIndex + totalKeys) % totalKeys;
      return distA - distB;
    });

    const sortedIndices = [
      ...sortFromActive(tier1Healthy),
      ...sortFromActive(tier2Unknown),
      ...sortFromActive(tier3ExhaustedExpired),
      ...sortFromActive(tier4TransientCooldown),
      ...sortFromActive(tier5ExhaustedCooldown),
      ...sortFromActive(tier6Invalid),
    ];

    let lastError = '';
    // 45 seconds gives ample time for LLM reasoning and generating complex multi-step payloads
    const keyTimeoutMs = 45000;

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
          signal: AbortSignal.timeout(keyTimeoutMs),
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
              signal: AbortSignal.timeout(keyTimeoutMs),
            });
          }
        }

        // If server returns 500-599 internal error on current model, try with fallback model
        if (!response.ok && response.status >= 500 && response.status < 600 && model !== 'qwen/qwen3.7-plus:free') {
          console.warn(`[Voodoo AI] Model ${model} returned HTTP ${response.status}. Retrying key #${keyIndex + 1} with fallback model qwen/qwen3.7-plus:free...`);
          const fallbackBody = { ...requestBody, model: 'qwen/qwen3.7-plus:free' };
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`,
            },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(keyTimeoutMs),
          });
        }

        if (response.ok) {
          const data = await response.json();
          const choice = data.choices?.[0];
          const choiceMsg = choice?.message || { role: 'assistant', content: 'Вуду затрудняется ответить на этот вопрос.' };

          this.activeKeyIndex = keyIndex;
          this.keyHealthMap.set(currentKey, {
            status: 'healthy',
            lastChecked: Date.now(),
            cooldownUntil: undefined,
            lastError: undefined,
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

        const isQuota =
          response.status === 429 ||
          response.status === 402 ||
          /quota|limit|token|rate|balance|credit/i.test(errorMsg);

        const isInvalid =
          response.status === 401 ||
          response.status === 403 ||
          /invalid|unauthorized|disabled/i.test(errorMsg);

        const isServerError = response.status >= 500 && response.status < 600;

        const cooldownMs = isQuota
          ? 5 * 60 * 1000 // 5 minutes
          : isInvalid
          ? 15 * 60 * 1000 // 15 minutes
          : isServerError
          ? 10 * 1000 // 10 seconds transient
          : 30 * 1000;

        this.keyHealthMap.set(currentKey, {
          status: isQuota ? 'exhausted' : isInvalid ? 'invalid' : isServerError ? 'unknown' : 'exhausted',
          lastError: errorMsg,
          lastChecked: Date.now(),
          cooldownUntil: Date.now() + cooldownMs,
        });

        if (totalKeys > 1) {
          console.warn(`[Voodoo AI] Key #${keyIndex + 1} (${masked}) error (${errorMsg}). Seamlessly switching to next key...`);
          continue;
        }
      } catch (networkErr) {
        const isTimeout = networkErr instanceof Error && (
          networkErr.name === 'TimeoutError' ||
          /timeout|aborted/i.test(networkErr.message)
        );
        const rawMsg = networkErr instanceof Error ? networkErr.message : 'Сетевая ошибка';
        lastError = isTimeout ? `Тайм-аут ожидания ответа (${Math.round(keyTimeoutMs / 1000)}с)` : rawMsg;

        // Do NOT mark key as exhausted on timeout! Timeout is a transient network/load issue.
        const prev = this.keyHealthMap.get(currentKey);
        this.keyHealthMap.set(currentKey, {
          status: isTimeout ? (prev?.status === 'healthy' ? 'healthy' : 'unknown') : 'exhausted',
          lastError,
          lastChecked: Date.now(),
          cooldownUntil: Date.now() + (isTimeout ? 5000 : 30 * 1000),
        });

        if (totalKeys > 1) {
          console.warn(`[Voodoo AI] Key #${keyIndex + 1} (${masked}) ${isTimeout ? 'timed out' : 'network error'}: ${lastError}. Trying next key...`);
          continue;
        }
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

        const isTimeout = /timeout|aborted|тайм-аут/i.test(completion.error || '');
        const errorDesc = isTimeout
          ? 'Время ожидания ответа от сервера нейросети истекло (тайм-аут). Сервер xkiro сейчас перегружен или обрабатывает сложный запрос. Попробуйте повторить запрос.'
          : `Все настроенные ключи (${configuredKeys.length}) временно исчерпали квоту или недоступны: ${completion.error}.\nВы можете добавить резервный ключ xkiro в Настройках браузера.`;

        return {
          reply: `Не удалось получить ответ от Вуду. ${errorDesc}`,
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
