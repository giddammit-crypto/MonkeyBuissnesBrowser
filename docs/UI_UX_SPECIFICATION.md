# Спецификация UI/UX и дизайн-система: Новые возможности soulm8te

> **Статус**: Готово к реализации  
> **Автор**: Ведущий дизайнер приложений (Lead UI/UX Designer)  
> **Целевая аудитория**: Ведущий программист, Frontend / Electron-разработчики  
> **Стиль**: Detroit: CyberLife / Минимализм / Google Chrome & Яндекс.Браузер Pro  

---

## 1. Концепция и философия дизайна

Интерфейс **soulm8te** строится на принципах эргономики современных браузеров первого эшелона (Google Chrome, Яндекс.Браузер, Safari) в сочетании с индустриальной, выверенной эстетикой Detroit (RK800 / CyberLife):
- **Сдержанная элегантность**: Отсутствие кричащих «кислотных» градиентов; ставка на микроконтрасты, идеальную типографику (Montserrat + Inter) и выверенные поля.
- **Информационная чистота**: Вторичные элементы не отвлекают от контента, но появляются в нужный момент (адаптивные чипы действий в омнибоксе при обнаружении видео/статьи).
- **Мгновенный визуальный отклик**: Анимации длительностью 120–200 мс с кривой `cubic-bezier(0.16, 1, 0.3, 1)`, тактильный hover-эффект, световые индикаторы статусов.

---

## 2. Цветовые токены и дизайн-переменные (Design Tokens)

Все компоненты используют общую систему CSS-переменных темы soulm8te с поддержкой Light, Dark, Graphite и Incognito (Private):

```css
/* Базовые токены soulm8te (Light / Dark / Sepia / Accent) */
:root {
  --signal-blue: #8cbce8;
  --signal-blue-dark: #4078a7;
  --signal-glow: rgba(140, 188, 232, 0.35);
  --cyber-red: #ef4444;
  --cyber-green: #10b981;
  --cyber-amber: #f59e0b;
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 9999px;
  --shadow-floating: 0 16px 40px rgba(0, 0, 0, 0.22), 0 0 0 1px var(--border);
  --shadow-popover: 0 12px 32px rgba(15, 23, 42, 0.18), 0 0 0 1px var(--border);
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Специфические токены тем Режима Чтения */
[data-reader-theme="light"] {
  --reader-bg: #ffffff;
  --reader-text: #1f2937;
  --reader-text-muted: #6b7280;
  --reader-surface: #f9fafb;
  --reader-border: #e5e7eb;
  --reader-accent: #35678f;
  --reader-link: #1d4ed8;
  --reader-code-bg: #f3f4f6;
}

[data-reader-theme="sepia"] {
  --reader-bg: #f7f1e5;
  --reader-text: #3c3226;
  --reader-text-muted: #7d6b56;
  --reader-surface: #efe7d7;
  --reader-border: #e0d4be;
  --reader-accent: #8b5e34;
  --reader-link: #87501a;
  --reader-code-bg: #eadecc;
}

[data-reader-theme="dark"] {
  --reader-bg: #14171c;
  --reader-text: #e2e8f0;
  --reader-text-muted: #94a3b8;
  --reader-surface: #1e232b;
  --reader-border: #2e3642;
  --reader-accent: #8cbce8;
  --reader-link: #93c5fd;
  --reader-code-bg: #1a1e24;
}
```

---

## 3. Компонент 1: Кнопки действий страницы в Омнибоксе (Omnibox Page Actions)

### 3.1. Архитектура и расположение
Кнопки располагаются в правой части адресной строки (перед кнопкой закладок `bookmark-button`), формируя аккуратный блок `.omnibox-page-actions`:

```
+------------------------------------------------------------------------------------------------+
| (i) https://habr.com/ru/articles/850123/        [BookOpen] [QrCode] [PiP] [MP4/MP3] [*]  (X)  |
+------------------------------------------------------------------------------------------------+
```

### 3.2. Состояния и поведение кнопок
1. **Режим чтения (`BookOpen`)**:
   - **Условие показа**: Страница содержит длинный текстовый контент (статья, новость, документация) либо любая внешняя страница `http(s)://`.
   - **Всплывающая подсказка**: `Режим чтения · Ctrl+Alt+R`
   - **Активное состояние**: При активном режиме чтения кнопка подсвечивается акцентным фоном `var(--accent-soft)` и текстом `var(--accent)`.
2. **QR-код страницы (`QrCode`)**:
   - **Условие показа**: Все внешние веб-страницы (не пустые и не внутренние `soul://`).
   - **Всплывающая подсказка**: `QR-код страницы · Перенести на смартфон`
   - **Клик**: Переключает всплывающее окно QR-кода.
3. **Выносное видео PiP (`PictureInPicture2`)**:
   - **Условие показа**: На текущей активной вкладке обнаружен тег `<video>`.
   - **Всплывающая подсказка**: `Смотреть в отдельном окне (PiP)`
   - **Индикация активности**: Если видео уже вынесено в PiP, кнопка имеет мерцающую синюю точку-индикатор.

### 3.3. CSS стили кнопок в Омнибоксе
```css
/* Блок действий страницы в Омнибоксе */
.omnibox-page-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 4px;
  flex-shrink: 0;
}

.omnibox-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.16s var(--ease-smooth);
  position: relative;
}

.omnibox-action-btn:hover {
  background: var(--surface-subtle);
  color: var(--text);
  border-color: var(--border);
  transform: translateY(-1px);
}

.omnibox-action-btn:active {
  transform: translateY(0);
}

.omnibox-action-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(140, 188, 232, 0.4);
  box-shadow: 0 0 8px var(--signal-glow);
}

/* Точка активности Picture-in-Picture */
.omnibox-action-btn.pip-active::after {
  content: "";
  position: absolute;
  top: 5px;
  right: 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--signal-blue);
  box-shadow: 0 0 6px var(--signal-blue);
  animation: pip-pulse 2s infinite ease-in-out;
}

@keyframes pip-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
```

---

## 4. Компонент 2: Вьювер Режима Чтения (Reader View)

### 4.1. Архитектура экрана
Режим чтения отображается в виде чистого, независимого полноэкранного оверлея поверх веб-контента активной вкладки, не нарушая работу верхнего тулбара браузера.

```
+------------------------------------------------------------------------------------------+
|  [<= Назад]   [Шрифт: Inter v]  [A- 18px A+]  [Светлая/Сепия/Темная]  [> Озвучить]   [X] | <- Плавающий тулбар
+------------------------------------------------------------------------------------------+
|                                                                                          |
|                       habr.com · 25 октября 2026 · ⏱ 5 мин чтения                         |
|                                                                                          |
|             # Новая эра автономных интерфейсов в Chromium                                |
|                                                                                          |
|        Современные браузерные движки достигли максимального уровня...                    |
|        (Ширина полосы текста ровно 740px, интервал 1.72, приятные отступы)               |
|                                                                                          |
+------------------------------------------------------------------------------------------+
```

### 4.2. Элементы плавающей панели управления (Reader Toolbar)
1. **Гарнитура (Font Family)**:
   - `Sans` (Inter, системный гротеск — современный, чистый)
   - `Serif` (Georgia / Merriweather — классический книжный стиль)
   - `Mono` (JetBrains Mono — для технической литературы)
2. **Размер шрифта**:
   - Кнопка `A-` (уменьшить на 1px, минимум 13px)
   - Индикатор размера: `18 px` (значение по умолчанию)
   - Кнопка `A+` (увеличить на 1px, максимум 26px)
3. **Темы оформления (Color Themes)**:
   - Три круглых переключателя с мягкой обводкой:
     * **Светлая**: фон `#fff`, текст `#1f2937`
     * **Сепия**: фон `#f7f1e5`, текст `#3c3226`
     * **Тёмная**: фон `#14171c`, текст `#e2e8f0`
4. **Синтез речи (Text-to-Speech / Озвучить)**:
   - Кнопка с иконками `Play` / `Pause` / `Volume2`.
   - При воспроизведении: мягкая пульсирующая волна эквалайзера и индикатор текущего прогресса.
   - Скорость воспроизведения: переключатель `1x`, `1.25x`, `1.5x`.
5. **Выход**:
   - Кнопка `X` или клавиша `Escape` плавно закрывает режим чтения, возвращая пользователя к оригинальному виду страницы со сохранением позиции скролла.

### 4.3. CSS стили Режима Чтения
```css
/* Оверлей режима чтения */
.reader-overlay {
  position: absolute;
  inset: 0;
  z-index: 80;
  overflow-y: auto;
  background: var(--reader-bg);
  color: var(--reader-text);
  transition: background 0.25s ease, color 0.25s ease;
  scroll-behavior: smooth;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}

/* Плавающая панель управления */
.reader-toolbar {
  position: sticky;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: var(--reader-surface);
  border: 1px solid var(--reader-border);
  border-radius: var(--radius-pill);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(12px);
  max-width: calc(100% - 32px);
  margin: 0 auto;
}

.reader-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.reader-toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--reader-border);
}

.reader-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  color: var(--reader-text-muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.reader-tool-btn:hover {
  background: var(--reader-border);
  color: var(--reader-text);
}

.reader-tool-btn.active {
  background: var(--reader-accent);
  color: #ffffff;
}

/* Селектор тем оформления */
.reader-theme-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reader-theme-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.reader-theme-dot:hover {
  transform: scale(1.15);
}

.reader-theme-dot.selected {
  border-color: var(--reader-accent);
  transform: scale(1.1);
  box-shadow: 0 0 0 2px var(--reader-surface);
}

.reader-theme-dot.light { background: #ffffff; box-shadow: inset 0 0 0 1px #d1d5db; }
.reader-theme-dot.sepia { background: #f7f1e5; box-shadow: inset 0 0 0 1px #d6c7b2; }
.reader-theme-dot.dark { background: #14171c; box-shadow: inset 0 0 0 1px #374151; }

/* Статья и контентная область */
.reader-container {
  max-width: 740px;
  margin: 48px auto 96px;
  padding: 0 24px;
  line-height: 1.72;
}

.reader-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--reader-text-muted);
}

.reader-domain-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 11px;
}

.reader-title {
  font-size: 36px;
  line-height: 1.22;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 24px 0;
  color: var(--reader-text);
}

.reader-body {
  font-size: var(--reader-font-size, 18px);
}

.reader-body p {
  margin: 0 0 1.6em 0;
}

.reader-body img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  margin: 24px 0;
  display: block;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
}

.reader-body blockquote {
  margin: 28px 0;
  padding: 12px 24px;
  border-left: 3px solid var(--reader-accent);
  background: var(--reader-surface);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-style: italic;
  color: var(--reader-text-muted);
}

.reader-body pre {
  background: var(--reader-code-bg);
  padding: 16px 20px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.9em;
  border: 1px solid var(--reader-border);
}
```

---

## 5. Компонент 3: Всплывающее окно QR-кода (QR Code Popover)

### 5.1. Эргономика и юзабилити
- Окно позиционируется ровно под кнопкой QR в омнибоксе (с элегантной стрелочкой-указателем).
- QR-код отображается на высококонтрастной белой подложке со скругленными уголками (даже в темной теме, чтобы камеры телефонов читали код за 0.1 секунды).
- Превью открытой страницы отображает фавиконку, обрезанный заголовок и домен.
- Кнопка «Копировать ссылку» имеет мгновенную обратную связь (иконка галочки и надпись «Скопировано!» на 2 секунды).
- Предусмотрена кнопка быстрого сохранения QR-кода в формате PNG/SVG.

```
       /\  (Стрелочка к омнибоксу)
+------------------------------------+
| [QrCode] QR-код страницы       (X) |
|                                    |
| [Favicon] Заголовок страницы...    |
|           habr.com                 |
|                                    |
|       +--------------------+       |
|       | ################## |       |
|       | ##  ##########  ## |       |
|       | ##  ##########  ## |       |
|       | ################## |       |
|       +--------------------+       |
|                                    |
| [https://habr.com/ru/articl...]    |
| [  Копировать ссылку  ] [Сохранить]|
|                                    |
| * Наведите камеру смартфона для    |
|   мгновенного перехода             |
+------------------------------------+
```

### 5.2. CSS стили Всплывающего окна QR-кода
```css
.qr-popover {
  position: absolute;
  top: 48px;
  right: 60px;
  width: 310px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-popover);
  padding: 16px;
  z-index: 120;
  animation: popover-fade-in 0.18s var(--ease-spring);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Стрелочка-указатель */
.qr-popover::before {
  content: "";
  position: absolute;
  top: -6px;
  right: 28px;
  width: 12px;
  height: 12px;
  background: var(--surface);
  border-left: 1px solid var(--border-strong);
  border-top: 1px solid var(--border-strong);
  transform: rotate(45deg);
}

.qr-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.qr-popover-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.qr-page-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.qr-page-preview-text {
  min-width: 0;
  flex: 1;
}

.qr-page-preview-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qr-page-preview-domain {
  font-size: 11px;
  color: var(--text-secondary);
}

/* Контейнер QR-кода */
.qr-code-canvas-box {
  display: grid;
  place-items: center;
  background: #ffffff;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
}

.qr-code-canvas-box svg,
.qr-code-canvas-box canvas {
  width: 180px;
  height: 180px;
  display: block;
}

.qr-actions {
  display: flex;
  gap: 8px;
}

.qr-btn-primary {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}

.qr-btn-primary:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.qr-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
}

.qr-btn-secondary:hover {
  background: var(--border);
  color: var(--text);
}

.qr-footnote {
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
}
```

---

## 6. Компонент 4: Раздел «Быстрые заметки» в боковой панели (Sidebar Quick Notes)

### 6.1. UX-сценарий использования
1. Пользователь читает документацию или исследует сайт.
2. Открывает боковую панель «Быстрые заметки» (по иконке `StickyNote` в боковом меню или хоткеем `Ctrl+Shift+N`).
3. Нажимает **«+ Новая заметка»**: создается заметка с автоматической привязкой текущего URL и заголовка страницы.
4. Текст заметки мгновенно сохраняется в локальное хранилище (`BrowserStores` / SQLite / JSON Store).
5. Поиск и фильтрация: возможность отобразить заметки только для текущего домена/страницы.

```
+-------------------------------------------------------+
| [StickyNote] Быстрые заметки                  [+ Новый] |
+-------------------------------------------------------+
| [ Поиск в заметках...                              ]  |
| [Все (5)]  [Текущий сайт: github.com (2)]             |
+-------------------------------------------------------+
| * Заметка 1                            14:20, Сегодня |
|   Полезный сниппет для настройки Chromium IPC...      |
|   [Ссылка: github.com/electron]                       |
|-------------------------------------------------------|
| * Заметка 2                                   24 окт  |
|   Купить билеты на конференцию...                     |
+-------------------------------------------------------+
| Редактор:                                             |
| [Заголовок заметки..................................] |
| [Текст заметки (поддержка чекбоксов - [x]).........]  |
|                                                       |
| [Привязать текущую страницу]          [Сохранено v]   |
+-------------------------------------------------------+
```

### 6.2. CSS стили Панели Быстрых Заметок
```css
/* Выдвижная боковая панель заметок */
.notes-drawer {
  position: absolute;
  top: 40px;
  bottom: 0;
  left: var(--sidebar-width);
  width: 340px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
  z-index: 60;
  display: flex;
  flex-direction: column;
  animation: drawer-slide-in 0.2s var(--ease-spring);
}

@keyframes drawer-slide-in {
  from { transform: translateX(-16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.notes-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: Montserrat, sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.notes-search-box {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notes-search-input {
  width: 100%;
  height: 32px;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  font-size: 12px;
  color: var(--text);
}

.notes-search-input:focus {
  border-color: var(--signal-blue);
  box-shadow: 0 0 0 2px var(--signal-glow);
}

.notes-filter-pills {
  display: flex;
  gap: 6px;
}

.notes-filter-pill {
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 500;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer;
}

.notes-filter-pill.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(140, 188, 232, 0.4);
}

/* Список карточек заметок */
.notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-card {
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--canvas);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}

.note-card:hover {
  background: var(--surface-subtle);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.note-card.active {
  border-color: var(--signal-blue);
  background: var(--surface);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--signal-blue);
}

.note-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.note-card-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}

.note-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.note-card-url {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Редактор активной заметки */
.note-editor-pane {
  border-top: 1px solid var(--border);
  padding: 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.note-input-title {
  font-size: 14px;
  font-weight: 600;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 4px 0;
  color: var(--text);
}

.note-textarea-content {
  width: 100%;
  min-height: 110px;
  background: transparent;
  border: none;
  resize: vertical;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  font-family: inherit;
}
```

---

## 7. Компонент 5: Индикаторы звука и кликабельный Mute на вкладках (Audio & Mute)

### 7.1. Проектирование эргономики звуковых индикаторов
Вкладки со звуком имеют два состояния:
1. **Звучит (`audible`)**: отображается стилизованный анимированный эквалайзер из 3-х вертикальных столбиков (в стиле Яндекс.Браузера и Google Chrome), плавно пульсирующих с фазовым сдвигом.
2. **Заглушено (`muted`)**: отображается иконка динамика с перечеркивающей косой чертой (`VolumeX`) в предупреждающем красном цвете `#ef4444`.

### 7.2. Разрешение конфликтов кликов (UX Click Affordance)
- **Изоляция клика**: Клик по звуковой иконке (`.tab-audio-button`) вызывает `event.stopPropagation()`, заглушая или включая звук на вкладке, **не меняя активную вкладку** (пользователь может легко выключить неожиданно орущую фоновую вкладку, не отвлекаясь от текущей работы).
- **Hover-трансформация**: При наведении курсора на эквалайзер он мгновенно превращается в кнопку-динамик с подсказкой «Отключить звук на вкладке».
- **Сжатый режим вкладок (Overflow / 20+ вкладок)**: При критическом сужении вкладки (ширина < 80px) приоритет сохранения отдается:
  1. Фавиконке
  2. Индикатору звука (мута)
  3. Крестику закрытия (крестик скрывается при ширине < 50px, заменяясь на средний клик колесиком).

### 7.3. CSS анимация эквалайзера и Mute
```css
/* Кнопка звука / Mute на вкладке */
.tab-audio-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  background: transparent;
  border: none;
  transition: all 0.15s ease;
  z-index: 5;
  margin-left: auto;
  margin-right: 2px;
}

.tab-audio-button:hover {
  background: var(--border);
  transform: scale(1.1);
}

/* Анимированный эквалайзер воспроизведения */
.tab-equalizer {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  width: 14px;
  height: 12px;
}

.tab-equalizer-bar {
  flex: 1;
  background: var(--signal-blue);
  border-radius: 1px;
  animation: eq-bounce 1.2s infinite ease-in-out;
}

.tab-equalizer-bar:nth-child(1) { height: 40%; animation-delay: 0s; }
.tab-equalizer-bar:nth-child(2) { height: 90%; animation-delay: 0.2s; }
.tab-equalizer-bar:nth-child(3) { height: 60%; animation-delay: 0.4s; }

@keyframes eq-bounce {
  0%, 100% { height: 30%; }
  50% { height: 100%; }
}

.tab-audio-button.muted {
  color: var(--cyber-red);
}

.tab-audio-button.muted:hover {
  color: #dc2626;
  background: rgba(239, 68, 68, 0.12);
}
```

---

## 8. Архитектурная карта компонентов для Ведущего программиста

| Компонент | Расположение файла | Зависимости | Хоткей |
|---|---|---|---|
| **ReaderModeView** | `src/renderer/ReaderModeView.tsx` | `@mozilla/readability`, `lucide-react` | `Ctrl+Alt+R` |
| **QrCodePopover** | `src/renderer/QrCodePopover.tsx` | `qrcode` / SVG renderer, `lucide-react` | — |
| **SidebarQuickNotes** | `src/renderer/SidebarQuickNotes.tsx` | `lucide-react`, `BrowserStores.notes` | `Ctrl+Shift+N` |
| **OmniboxPageActions** | Интеграция в `src/renderer/main.tsx` | `lucide-react` | — |
| **TabAudioButton** | Интеграция в `src/renderer/main.tsx` | `lucide-react`, `tabAction(id, "mute")` | `Ctrl+M` (mute tab) |

---

## 9. Чек-лист соответствия качеству (QA Criteria)
1. **Контрастность**: Все текстовые стили в темах Light, Sepia и Dark соответствуют стандарту WCAG AAA (минимальный контраст 7:1 для основного текста).
2. **Плавность 60 FPS**: Все микро-анимации используют исключительно аппаратное ускорение GPU (`transform`, `opacity`).
3. **Безопасность фокуса**: Корректный фокус по `Tab` и `focus-visible` с неоновым контуром `2px solid var(--accent)`.
4. **Адаптивность**: При сжатии окна браузера тулбары и поповеры аккуратно адаптируются без выпадения за экран.
