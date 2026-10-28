# Аудит функций, памяти и производительности soulm8te

> Исторический отчет ревизии aa162aa. В текущем обновлении бюджет Вуду снижен до 250 000 токенов; актуальные функции и результаты — в [аудите приложения](APPLICATION_AUDIT_2026-10-28.md).

Дата: 28 октября 2026 года. База текущего этапа: `fdec06a`.

## Что проверялось

Под «плагинами» здесь понимаются встроенные модули браузера и установленные через его менеджер локальные Electron extensions. Это не аудит плагинов ChatGPT и не проверка серверов внешних поставщиков. Проверен код `src/main`, `src/services`, `src/preload`, `src/shared` и связанный renderer; изучены интерфейсы IPC, lifecycle, хранение, тяжелые операции и тестовые сценарии.

**Код подтвержден** означает наличие связанного UI/IPC/backend пути, а не гарантию работы на любом сайте. **Частично** означает объективное ограничение платформы/реализации. **Runtime** считается проверенным только при фактическом успешном запуске соответствующего сценария; наличие файла теста само по себе не означает, что он пройден в этой сессии.

## Инвентаризация встроенных возможностей

| Модуль / функция | Что подтверждено кодом | Статус и пределы | Тестовые точки |
|---|---|---|---|
| Вкладки, история навигации, pin/mute/duplicate, reorder, поиск вкладок | `BrowserController`, shell IPC и TabSearch; native WebContentsView | Реализовано. Hibernation уничтожает страницу, metadata сохраняется; возврат перезагружает сайт | lifecycle, navigation, popup, tab-search, session-budget |
| Рабочие пространства и восстановление сессии | BrowserStores, buildStoredSession; debounce сохранения | Реализовано для обычных вкладок; приватная история/сессия не переносится на диск | persistence, session-budget |
| Приватная сессия | Временный partition, отдельные data/adblock, очистка после последней приватной вкладки | Локальная приватность; не анонимность, не системный VPN и не локальная обработка ИИ | site-policy, session-budget |
| Поиск/omnibox, suggestions, bookmarks, history | Нормализация URL и input intent, менеджеры записей | Реализовано; HTTP(S), запрет userinfo и опасных схем; история/закладки ограничены | omnibox, import, manager smoke |
| AdBlock | Реальное cancel в webRequest; host/path rules; исключения сайтов; счетчики | Простой собственный фильтр, не полная реализация uBlock/EasyList и не гарантия блокировки всей рекламы | adblock, site-policy |
| Локальные расширения | Manifest v2/v3, native loadExtension, remove/restore, подтверждение, `allowFileAccess:false` | Только распакованные папки и поддерживаемое Electron подмножество API. Нет полной Chrome Web Store/CRX совместимости или автообновления | Нужны native fixtures для конкретного расширения |
| Browsec / proxy / Smart Rules | PAC, выбор страны, WebRTC policy, настройки, проверки доступности серверов | Прокси браузерных запросов; не системный туннель. Enabled — настройка маршрута, не измеренное подтверждение внешнего IP/анонимности | browsec, vpn-health |
| WireGuard | Парсинг, валидация, безопасное сохранение конфигурации через ОС | **Частично:** импорт и configured state; реального привилегированного туннеля, kill switch и системной маршрутизации нет | vpn-config |
| Privacy dashboard, cookies, permissions, notifications | Session policies, исключения, permission handlers, состояния панели | Реализовано локально. Разрешение пользователем не доказывает, что сайт поддерживает запрос/отображение | site-policy, notifications |
| Импорт браузеров | Chrome/Yandex/Firefox/Edge/Brave/Opera/Vivaldi discovery; history/bookmarks/cookies/passwords, SQLite snapshot, OS keyring | Частично по ОС/профилю/версии шифрования. Partitioned/container cookies пропускаются; закрытый или несовместимый vault может потребовать CSV | browser-importer, chromium-identity, import-parsers |
| Импорт HTML/CSV | Чтение export файла, кодировка, ограничение размера, дедупликация | Реализовано. CSV паролей — plaintext источник; исходник не удаляется автоматически | import-parsers, browser-importer |
| Пароли | safeStorage, защита от basic_text Linux, origin-scoped autofill, reveal/delete/save | Реализовано при доступном keyring. Нет обещания end-to-end cloud vault; HTTP origins не получают HTTPS autofill | password-store, autofill, save-password UI |
| Notes | CRUD, pin/colors/search, заметка из вкладки | Реализовано; до 500 заметок, до 50000 символов каждая; plaintext JSON профиля | notes/reader, note-mutations |
| Reader | Извлечение статьи isolated world, HTML allowlist, тема/шрифт | Реализовано для поддерживаемого DOM. Не универсальный extractor и не обход paywall; внешние изображения могут запрашиваться отдельно | reader-security, notes-and-reader |
| Обычные загрузки | DownloadItem progress, pause/resume/cancel/retry, open/show/delete/drag, persistence | Реализовано; возобновление зависит от сервера/DownloadItem, приватные записи не сохраняются | downloads/media, manager smoke |
| Видео/аудио загрузчик | Определение media, кнопки поддерживаемых сайтов, yt-dlp subprocess, cookies временного файла | Частично: зависит от локального yt-dlp/ffmpeg, сайта, авторизации и доступности формата; DRM/все сайты не гарантируются | media, youtube-cookies |
| PiP, fullscreen, медиа controls | Native/mini PiP, layout/HUD, fullscreen state | Реализовано; native поведение зависит от ОС/window manager | pip/media smoke; headless fullscreen ограничен |
| Click & Clean | Cache/cookies/storage/history/passwords/DNS/auth/closed tabs presets и реальный backend | Реализовано как очистка выбранных данных; freed bytes — оценка, не forensic secure erase | click-and-clean-backend, UI |
| Task Manager / memory | app.getAppMetrics, OS memory, hibernate protections | Process-level метрики; shared renderer нельзя точно разделить по вкладкам. Native GC/RSS не гарантирует немедленный возврат всей RAM | memory, task-manager, memory-release |
| Вуду: цепочки действий | План, tool/schema validation, результаты, повторные попытки, context budget, cancel, progress | Нет стандартного потолка 24 итерации/48 действий: выполнение продолжается до результата, отмены или ошибки; сохранены no-progress guards. `maxSteps` доступен только как явная опция вызывающего кода. Нет durable resume engine после перезапуска; зависит от endpoint/model | workflows, agent-regression, voodoo smoke |
| Вуду: страницы/DOM | Read pagination, links, clicks/fill/keys/script/history/tab actions | Основной документ; закрытый shadow DOM, cross-origin iframe, CAPTCHA, системные диалоги могут требовать человека | page-reading, VM DOM, real Electron fixture |
| Вуду: файлы | UTF-8 read/write/list в Downloads/Desktop/Documents, size/path/link controls | Ограниченное flat file API, не доступ ко всему диску и не shell execution | voodoo-files |
| Вуду: xkiro и voice | Нормализация ключей, health/cooldown/failover, STT/микрофонный UI | Стартовая платная completion-проверка каждого ключа убрана: реальные запросы и явная ручная проверка. Внешние квоты и модельные возможности подтверждаются отдельно. Ключи ИИ пока не отдельный encrypted vault | voodoo-keys, voice-stt |
| Вуду: гео/погода/карты | Доступные внешние погодные данные и подготовленные links | Частично. Карты/маршруты — ссылки, не проверенный каталог мест/расстояний | agent/weather regression |
| Внешний вид, wallpaper, QR, find/print/zoom/hotkeys | UI, shared QR/zoom/helpers, native actions | Реализовано; PDF печать определяется native print flow, не отдельным редактором PDF | background, qrCode, hotkeys, manager-ui |
| Google account UI | Детектирование/выбор/открытие Google signin URLs и cookies общего браузерного профиля | Не полноценная собственная OAuth identity platform и не независимые контейнеры всех аккаунтов | login-import, youtube-cookies |
| Синхронизация и автообновления | Ограничения явно описаны в PLATFORM_FEATURE_STATUS | **Не реализовано:** cloud sync и безопасные подписанные автообновления | Не объявляются работающими |

## Реальные находки производительности и надежности

| Приоритет | Находка и источник | Практический эффект | Статус текущего этапа |
|---|---|---|---|
| Высокий | `PasswordStore.save()` использовал `read(false)` | При поврежденном/недоступном vault чтение возвращало пустой массив; последующая запись одного нового пароля могла уничтожить прежний vault | Заменено на strict `read(true)`; ошибка отменяет save вместо замены данных |
| Высокий | `FilterEngine.blockedByHost` рос без предела; `stats()` создавал полный object на каждом snapshot | Много уникальных заблокированных поддоменов увеличивало RAM и стоимость IPC до закрытия браузера | Счетчики host ограничены 1024; общий blockedTotal сохранен. Добавлены ограниченный cache исключений и индекс host rules |
| Высокий | Health probe мог не завершиться после clean socket close, ожидал статус по одному TCP chunk, принимал любое `200` substring | Зависшие проверки, ложное health state, лишние соединения | Добавлены hard deadline, обработка clean close, ограниченный header buffer и строгий HTTP 200 status; destroy отменяет pending probes |
| Средний | BrowsecService startup timer не сохранялся и продолжал работать после destroy | Сокеты, запись health и callbacks после закрытия владельца | Timer отслеживается и очищается; disposed guard блокирует поздние обновления |
| Средний | Одновременное автоматическое усыпление всех idle tabs | Всплеск teardown и reload нагрузки, конкурирующие проходы | Один sweep одновременно, oldest eligible first, не более одного discard за период; автоматическое усыпление приватных вкладок исключено |
| Средний | Native tab callbacks удерживали closures и могли менять tab state после detach | Stale lifecycle/media и удержание ссылок после teardown | Учет owned listeners, снятие callbacks и сброс transient state при detach |
| Средний | Несколько потребителей подряд вызывали native process metrics | Повторная OS/IPC работа без значимо новых данных | Кэш sample на одну секунду; force остается для явного измерения |
| Средний | Extension manifest проверял размер после полного readFile | Ограничение 1 МиБ не ограничивало начальную allocation | Добавлено ограниченное чтение через descriptor/stat; лимит проверяется до полного parse |
| Средний | Сериализация полных tool results и повторное хранение больших тел в UI history | RAM/storage/IPC рост на длинных задачах | Вводится bounded history и компактное evidence; source paths/IDs сохраняются перед телами. Детали окончательных лимитов — в разделе контекста |
| Осталось | `getSnapshot()` включает полные notes, downloads/thumbnail, history и settings; dispatch coalesced, но payload полный | 500×50000 символов notes могут давать десятки МБ копируемых данных; два UI WebContents увеличивают цену | Нужны lazy/detail IPC либо patch snapshots с ревизиями. Нельзя объявлять snapshot transport оптимальным |
| Осталось | JsonStore и часть импортера используют sync JSON/SQLite/copy операций в main | Большой профиль/импорт/notes save может задержать UI | Для следующего этапа: worker I/O/SQLite, очередь записей, bounded startup reads. Текущий atomic write защищает целостность, а не latency |
| Средний | Fallback `getDirectorySize()` рекурсивно обходил диск синхронно; нативное значение 0 ошибочно считалось отсутствием результата | Открытие storage/cleanup панели могло блокировать main на большом cache | Обход переведен на async `fs.promises.opendir`; штатный нулевой размер больше не запускает fallback. Большой обход все еще занимает время и требует дальнейших deadline/cache при необходимости |
| Средний / частично | Page preload содержал polling/DOM scans и observers в скрытых документах | Дополнительная CPU работа на сложных/скрытых страницах | Добавлен visibility/pagehide-aware scheduler для декоративного discovery, reader/account/injection polling; account IPC дедуплицируется, YouTube observer throttled. Playback/capture checks остаются активными. Iframe policy и реальные сложные сайты требуют отдельной проверки |
| Средний | Конструктор BrowserController добавлял два `ipcMain.on` handler без явного снятия в dispose | При пересоздании окна возможны retained controller и дубли событий | Добавлены отслеживаемые remover callbacks, снятие при dispose и проверка trusted page |
| Осталось | Загрузчик включает `--remote-components ejs:github` | Внешняя runtime code dependency yt-dlp, задержки и supply-chain зависимость | Требуется отдельное решение: локально установленная зависимость либо явная политика обновления/пользовательский выбор |
| Осталось | Browsec health трактует отсутствие записи в deadServers как healthy; probe использует `rejectUnauthorized:false` | Неизмеренный сервер может выглядеть доступным, а CONNECT reachability не доказывает TLS identity или приватность трафика | Нужны отдельные `unknown`/`checkedAt`/`reachable` статусы и проверка маршрута внешним endpoint. Не выдавать зеленый health за security certification |

Статус фиксирует реально видимые изменения рабочего дерева. Итоговые проверки ниже должны подтверждать интегрированную версию; каждая строка не является отдельным обещанием измеренного ускорения.

## Контекст 600000 токенов: что это означает

600000 — локальный верхний бюджет управления запросом, не способ увеличить контекст модели xkiro. Endpoint должен реально поддерживать такой размер. Код не может гарантировать принятие 600000 токенов внешним провайдером или отсутствие оплаты/latency на этом объеме.

Оценка должна учитывать сообщения, schema инструментов, JSON framing, checkpoint плана и резерв ответа. Без tokenizer конкретной модели оценка приблизительная; кириллица и сложные structured данные могут кодироваться иначе. Превышение провайдерского лимита должно возвращаться честной ошибкой, не успешным ответом.

Полный capacity не следует отправлять при каждом простом вопросе. Цель — сохранить относящиеся к задаче оригинальные сообщения, недавние complete tool rounds и компактный execution ledger; удалять старые полные turns при необходимости, не разрывать assistant tool_calls/tool results пары и не пересылать повторно весь файл без необходимости. Лимит контекста, лимит одного файла, длина одной tool observation и размер sessionStorage истории — разные ограничения.

В настройках появился выбор локального бюджета. Реализация дополнительно запрашивает `/models` в фоне: только явные metadata выбранной модели могут уменьшить бюджет; имя модели не используется как доказательство capacity. Каталог имеет ограниченное чтение до 1 МиБ, deadline, cache и ограничение числа параллельных запросов. Такая metadata не заменяет проверку реального запроса: провайдер может менять модель/тариф/квоты, а первый запрос может пройти до завершения фонового discovery. История чата хранит компактные результаты действий и ограничена общим размером; большие тела не должны удерживаться в нескольких копиях без необходимости.

При ошибке размера контекста допускается одна адаптивная попытка с уменьшенным бюджетом и сохранением последнего запроса/целых tool rounds. Это рабочий retry ceiling, а не установленная характеристика модели. Неявное переключение на другую модель удалено: ее контракт и доступный контекст могли отличаться.

По запросу пользователя стандартный лимит числа шагов снят. Это не означает бесконечное накопление трассировки: сервис хранит компактные последние 256 действий, UI — последние 48, а общий счетчик показывает фактическое количество. Эти пределы относятся к хранимым деталям, а не прекращают выполнение задачи. Повторные ошибки, отсутствие прогресса, отмена и отказ провайдера по-прежнему завершают запрос с явной причиной.

## Проверки и измерения

Подтвержденные интегратором результаты текущего этапа:

| Проверка | Результат | Область доказательства |
|---|---|---|
| `npm run check` | PASS: 46 test files / 404 tests, typecheck и release assets | Включены новые resource/lifecycle/password preservation/context/history/catalog/preload regression tests |
| `npm run build` | PASS | Main и renderer собираются |
| Native Electron Voodoo smoke | PASS: 4 группы | Настоящие IPC, DOM и локальный deterministic API; многошаговое выполнение, отмена, metadata, UI выбора и фактическое применение бюджетов 600000/128000. Не живой xkiro |
| Native memory-release smoke | PASS: 6 native pages → 0; процессов 11 → 5 | Реальное уничтожение WebContents при сохраненных metadata вкладок. RSS недоступен: `/proc` процессов не читался, значение null; процент экономии RAM не вычисляется |
| General Electron smoke | PASS: 10 сценариев, uncaughtShellErrors=[] | Навигация, история, приватные popup/cookies, загрузки/пауза/отмена, восстановление после renderer crash и рестарт. Native fullscreen пропущен в headless |
| Session budget smoke | PASS: 2 группы | Ограничение/жизненный цикл native страниц и восстановление |
| Media smoke | PASS: 2 группы | Fixture media сценарии; не совместимость всех streaming сайтов |
| Reader security smoke | PASS: 2 группы | Изоляция/sanitization fixture; не универсальный article extraction |
| Синтетический AdBlock benchmark | 402,9 мс → 86,5 мс в одном сравнении, около 4,7× | Только тот же набор синтетических URL в данном окружении. Не измеряет время загрузки сайта, браузера или весь CPU budget |

Повторные main build и Voodoo smoke с metadata fixture и UI проверками бюджета 600000/128000 прошли. Дополнительно пройден manager-ui-regression: менеджеры, поиск и адаптация настроек/вкладок на размерах 360–1920 px; это не полный визуальный аудит всех экранов. Ранее существовавшие тесты и старые прогоны не выдаются за дополнительные проверки новой версии.

Для сравнения памяти требуется одинаковый профиль, количество/тип вкладок, версия Electron, ОС и момент замера. RSS нескольких процессов может содержать shared memory; метрика процесса не равна точной памяти каждой вкладки. Уничтожение WebContents подтверждает освобождение страницы, но процент снижения RSS может меняться между прогонами. Значения «ускорено в N раз» допустимы только из воспроизводимого before/after benchmark.

Не проверено этим code review: доступность живых proxy/xkiro endpoint, реальные 600000-token запросы, все расширения Chrome, сайты со сложной авторизацией/DRM, native GUI всех ОС, подпись и выпуск установщика. Функции с внешними зависимостями должны оставаться явно частичными, пока это не проверено отдельно.
