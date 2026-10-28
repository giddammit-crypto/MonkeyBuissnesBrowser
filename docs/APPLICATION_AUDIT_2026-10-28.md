# Аудит приложения и расширение браузерных функций

Дата: 28 октября 2026 года. Исходная ревизия этого этапа: `aa162aa`.

## Область и границы выводов

Проверен связанный код браузера: оболочка, вкладки и native views, permissions, загрузки, импортер, пароли, заметки, storage, локальные расширения, прокси и агент Вуду. Это инженерный аудит исходников и проверяемых сценариев, не внешняя сертификация безопасности и не гарантия совместимости всех сайтов. Визуальные выводы по дизайну без screenshot evidence здесь не делаются.

Названия Chrome/Edge/Firefox используются для сравнения документированных пользовательских возможностей. Они не означают, что приложение получило весь функционал или ту же защищенность этих браузеров. Связанные исторические отчеты остаются в `VOODOO_AUDIT_2026-10-28.md`, `VOODOO_WORKFLOWS_AUDIT_2026-10-28.md`, `PERFORMANCE_AND_FEATURE_AUDIT_2026-10-28.md`; их старые исправления не выдаются за новые результаты этого этапа.

## Сравнение с официальной документацией

Сведения сверены 28 октября 2026 года по первичным страницам производителей; доступность функций может зависеть от версии и платформы.

| Возможность | Документированный пример | Применение здесь / граница |
|---|---|---|
| Две страницы одновременно | [Chrome split view](https://support.google.com/chrome/answer/16971124?hl=en), [Edge split screen](https://www.microsoft.com/en-us/edge/features/split-screen) описывают две страницы в одном окне и действия с активной стороной | Native split view добавляется для сравнения страниц. Это две реальные WebContentsView, а не iframe. Поведение разных экранов/сайтов/native fullscreen проверяется отдельно |
| Перенос закладок между браузерами | [Chrome export](https://support.google.com/chrome/answer/96816?hl=en), [Firefox HTML export](https://support.mozilla.org/en-US/kb/export-firefox-bookmarks-to-backup-or-transfer) используют HTML для переноса | Добавляется Netscape-compatible HTML export существующих закладок; это перенос, не cloud sync и не полный backup профиля |
| Группы вкладок | [Firefox tab groups](https://support.mozilla.org/en-US/kb/tab-groups), [Chrome tab management](https://support.google.com/chrome/answer/2391819?hl=en) документируют организацию вкладок | Рабочие пространства soulm8te уже существуют, но не равны всему поведению сохраненных/синхронизированных tab groups этих браузеров |
| Фоновые вкладки и память | [Edge sleeping tabs](https://www.microsoft.com/en-us/edge/features/sleeping-tabs) различает freezing и discard с перезагрузкой | Наш hibernation уничтожает WebContents и требует загрузки страницы при возврате. Нельзя описывать его как идентичную бесшовную заморозку Edge |

Это выбор проверяемых и полезных направлений. Сравнение не является обещанием реализовать все функции каждой перечисленной страницы.

## Инвентаризация текущего приложения: 27 групп

Обозначения: **код** — путь UI/IPC/backend присутствует и проверен чтением; **частично** — существенные ограничения реализации или платформы; runtime результат подтверждается только разделом проверок ниже.

| № | Группа | Подтвержденные возможности | Статус / важная граница |
|---|---|---|---|
| 1 | Вкладки | Create/close/reopen, navigation, pin/mute, duplicate, reorder, search, контекстные команды | Код; HTTP(S), native lifecycle; split добавляется этим этапом; расширенные bulk-команды не добавлены |
| 2 | Workspaces / session | Переключение задач, сохранение обычной сессии, восстановление metadata | Код; не облачная синхронизация и не полные tab groups Chrome/Firefox |
| 3 | Приватное окно/вкладки | Отдельный временный session partition, очистка после закрытия последней private tab | Код; не анонимность и не системный VPN |
| 4 | Omnibox / search | URL normalization, поисковая система, suggestions | Код; небезопасные схемы/URL userinfo блокируются |
| 5 | History / bookmarks | Списки, поиск, редактирование/удаление, импорт, новый HTML export | Код; формат URL закладок HTTP(S), ограниченный локальный store |
| 6 | AdBlock | Native webRequest cancel, host/path rules, исключения, bounded counters | Код; собственный базовый фильтр, не полный EasyList/uBlock engine |
| 7 | Extensions | Установка распакованных папок, manifest validation, restore/remove | Частично; Electron API subset, без полной Web Store/CRX/MV3 гарантии, без file access/private extensions |
| 8 | Browsec / Smart Rules | PAC routing, выбор страны, исключения, WebRTC policy, health probes | Частично; настройка прокси не доказывает актуальную доступность/внешний IP/анонимность |
| 9 | WireGuard | Конфигурация, парсер, валидация, safeStorage | Частично; **системный туннель и kill switch отсутствуют** |
| 10 | Privacy / permissions | Dashboard, third-party cookies, per-site notification и AdBlock controls | Код; media/geolocation permissions зависят от OS/site; stale async grant проверяется этим этапом |
| 11 | Импорт профилей | История/закладки/cookies/passwords нескольких Chromium-браузеров и Firefox | Частично; ОС/keyring/формат шифрования и partitioned data ограничивают перенос |
| 12 | Импорт файлов | HTML bookmarks, CSV passwords, encoding и row/size validation | Код; CSV plaintext; исходник не удаляется автоматически |
| 13 | Password manager | OS encryption, summaries, save/reveal/delete, exact-origin autofill с подтверждением | Код при доступном keyring; без cloud vault; strict read сохраняет поврежденный vault |
| 14 | Notes | CRUD, search, pin/colors, создание из страницы | Код; plaintext profile JSON, bounded entries/текст |
| 15 | Reader | Извлечение isolated world, allowlist sanitization, fonts/theme | Код; не универсальное извлечение и не обход paywall |
| 16 | Downloads | Progress, pause/resume/cancel/retry, открыть/показать/удалить/drag, persistence | Код; зависит от сервера; private retry не должен менять privacy partition |
| 17 | Media downloader | Detected streams, кнопки сайтов, локальный yt-dlp и cookie export | Частично; нужны local tools/формат/вход; DRM и произвольные сайты не гарантируются |
| 18 | PiP / fullscreen | Native и mini PiP, layout/HUD, медиа controls | Код; ОС/window manager и native fullscreen требуют runtime проверки |
| 19 | Click & Clean | Cache/cookies/storage/history/auth/DNS/password presets | Код; оценка освобожденных байт, не forensic secure erase |
| 20 | Memory / Task Manager | Native process metrics, hibernation, safety guards, CPU/memory view | Код; process memory не равна точной per-tab RAM; завершение процесса ограничивается браузером |
| 21 | Вуду workflows | План, tool results, validation, progress/cancel, no-progress guards | Код; без default лимита числа шагов, но finite context/provider resources; no durable resume engine |
| 22 | Вуду DOM | Read/pagination/links, click/fill/keys/script, tab navigation | Код; основной документ, сложные iframe/shadow/native dialogs могут требовать человека |
| 23 | Вуду files | UTF-8 read/write/list в трех пользовательских папках | Код; flat names, size/link guards; не произвольный диск и не shell |
| 24 | Вуду xkiro / voice | Key normalization/cooldowns/failover, STT, context budget до250000, metadata discovery | Default и максимум250000 по последнему указанию пользователя; прежние600k/256k настройки мигрируют вниз. Реальная модель должна поддерживать budget; token estimator приблизительный; ключи ИИ пока plaintext settings |
| 25 | Вуду geo/maps/weather | Доступные погодные данные и подготовленные map/route links | Частично; не проверенный каталог мест/рейтинг/маршрутный движок |
| 26 | UI / QR / print / zoom / Google account | Themes/wallpapers, QR, shortcuts, native print/zoom, account menu/detection | Код; account menu не независимая OAuth/cloud-sync platform; print не полноценный PDF editor |
| 27 | Sync / auto updates | Ограничения описаны в PLATFORM_FEATURE_STATUS | **Не реализованы** cloud sync и безопасные подписанные auto updates |

## Новые находки этого этапа

Ниже описано поведение **базовой ревизии `aa162aa`**. Статус исправления добавляется по результату интегрированного diff; это не список давно исправленных ошибок Вуду.

| ID | Приоритет | Подтверждение / механизм | Действие |
|---|---|---|---|
| APP-01 | Высокий | `BrowserController.killProcess(pid)` после обхода вкладок вызывал generic `process.kill(pid)`, без проверки списка процессов браузера/положительного integer | Исправлено: app metrics whitelist, защита main/shell/assistant, positive safe integer; вкладки завершаются native crash API, только разрешенные GPU/utility достигают OS signal |
| APP-02 | Высокий | `getCookieArgsForUrl` писал Netscape cookie jar в общий temp через writeFileSync без mode/flag. На типичном umask получался readable-by-others файл с session cookies | Исправлено: отдельный `MediaCookieFile`, каталог0700, файл0600/exclusive, cleanup при завершении/ошибке/закрытии; сохранен host-only/domain scope, исключены поля с разделителями/контрольными символами |
| APP-03 | Высокий | `retryDownload` выбирал текущую активную вкладку/обычный browserSession вместо исходного `entry.isPrivate` | Исправлен выбор source session при retry; завершенная private session не дает обычного fallback. После async подготовки cookies проверяется disposed/session identity; поздний spawn отменяется, cookie jar очищается |
| APP-04 | Средний | Dialog media/geolocation после ответа проверял только `!contents.isDestroyed()`, но не смену документа/origin во время ожидания | Добавлен `PermissionRequestGuard`: requesting frame/document/top URL, navigation/crash/destroy invalidation; callback однократный, listeners снимаются, grant отменяется для устаревшего контекста |
| APP-05 | Средний | yt-dlp `stderrText += chunk` без верхнего предела | Исправлено: сохраняются последние65536 символов диагностики вместо неограниченного накопления |
| APP-06 | Средний, осталось | Native image thumbnail декодирует весь скачанный файл синхронно до resize; startup запускает много missing thumbnails | Следующий этап: queue/size budget/async decode. Нет утверждения об обнаруженном RCE; это риск resource exhaustion |
| APP-07 | Средний | Extensions remove/save failure могли рассинхронизировать native runtime и durable registry | Исправлены unload failure/registration rollback: уже работавший instance не выгружается при сбое повторной регистрации, неудавшийся rollback остается видимым; empty version отклоняется. Добавлены пять регрессий |
| APP-08 | Средний | Компактный agent ledger мог обрезать URL/путь, а пустой completion после действий не имел отдельного terminal error | Идентификатор сохраняется целиком в отдельном бюджете либо явно помечается опущенным; пустой/некорректный completion становится ошибкой. Сокращенный retry ceiling не сохраняется как установленная модельная capacity без успешного подтверждения |

Дополнительные protocol regressions: reasoning-only/пустой ответ не подменяется приватным reasoning; обрезанный ответ не исполняет инструменты; malformed200/invalid JSON становится `invalid_completion` без ошибочного cooldown исправного ключа. Семь новых protocol тестов входят в итоговый прогон. Само наличие `update_plan` не доказывает выполнение задачи — нужны результаты инструментов.

## Новые функции этого этапа

В этом этапе реализованы и проверены две функции: native split view и HTML export закладок. Расширенные bulk-команды вкладок отложены; они не входят в заявленные изменения.

- Split view должен одновременно показывать две реальные страницы, не смешивать private/обычный режим или рабочие пространства, сохранять корректный active tab, возвращать обычный layout при закрытии/переключении/Reader/PiP/fullscreen.
- HTML export должен escaping-обрабатывать названия и URL, сохранять UTF-8 и HTTP(S) bookmarks, не экспортировать cookies/пароли; отмена Save dialog не должна создавать файл. Round trip проверяется нашим HTML importer; внешние браузеры требуют отдельного запуска.

Экспорт реализован отдельным `BookmarkExportService`: native Save dialog, Netscape HTML, только URL/title/createdAt; размер списка свыше5000 дает ошибку вместо скрытого усечения. Запись использует временный файл0600, fsync, rename и cleanup. Семь целевых тестов проверяют importer round trip, escaping, filtering, limit, cancel и сохранение старого файла при ошибке rename. Это подтверждение локального формата и атомарности, не runtime запуск Chrome/Firefox.

В реализации split view разрешены **две обычные веб-вкладки одного workspace**; приватные, internal, crashed, Reader и PiP состояния отклоняются. Узкая область страницы использует вертикальное размещение, широкая — стороны; ratio ограничен25–75%. Фокус второй стороны меняет active tab, обе видимые страницы защищены от автоматического hibernation. Закрытие/смена workspace/несовместимый режим должны очищать split. Геометрия и lifecycle проверяются отдельными fixtures; это не заявление о визуальном аудите всех разрешений экрана.

## Последнее уточнение: контекст250000 и скорость

По последнему указанию пользователя **250000 — одновременно default и максимальный локальный контекстный бюджет**. Вариант600000 убирается из текущего UI, сохраненные прежние600000/256000 нормализуются до250000. Исторические отчеты описывают предыдущие этапы; их упоминания600k не являются текущей настройкой продукта. Предел провайдера может быть ниже250000; оценка токенов остается приближенной и включает schema/framing/ответ.

Снятие стандартного лимита количества шагов сохраняется: остановка по отмене, ошибке, blocked plan и отсутствию прогресса остается, но нет прежнего общего default24/48 execution ceiling. Размер хранимого trace и контекст — отдельные ресурсные ограничения.

Оптимизации hash/cache касаются повторной CPU работы при построении/оценке контекста. Они не являются измерением скорости реального xkiro/API и не позволяют обещать процент уменьшения сетевой задержки. Внешнее время ответа зависит от провайдера, модели, сети и нагрузки.

В реализации immutable tool schema сериализуется один раз на запрос и повторно используется для HTTP/accounting; большая observation хешируется один раз вместо двух. Целевой локальный benchmark разработчика (медиана5 прогонов ×160 операций, payload510000 символов): hash537,14→256,32мс; budget scan680,18→557,01мс при одинаковой оценке токенов. Эти цифры описывают только синтетические CPU операции данного окружения. Пять новых250k/speed регрессий и связанные файлы дали46 целевых PASS; это не заменяет итоговый общий test run.

## Оставшиеся ограничения после аудита

PAC сейчас содержит `DIRECT` fallback и возвращает DIRECT при отсутствии доступного proxy. Это политика fail-open, **не kill switch**. Health CONNECT probe не является подтверждением TLS identity; неизвестные серверы требуют отдельного unknown state. Эти ограничения нельзя скрывать словами «полная VPN защита».

Полные notes/download thumbnails/history остаются в snapshot payload; JSON/SQLite операции импортера могут задерживать main thread. Дополнительная partition/permission и extension совместимость требует native tests. Загрузчик yt-dlp по-прежнему зависит от внешних компонентов и сайтов; наличие команды не доказывает успешное скачивание каждого видео. Нет заявлений о полном устранении всех дефектов, полной browser parity или измеренном ускорении всего приложения.

Реальный xkiro, реальный запрос на250000 токенов, живые proxy, Web Store расширения, native GUI всех ОС, DRM/captcha/WebAuthn и подписанные установщики не считаются проверенными без отдельного результата.

## Итоговые проверки

Итоговые результаты интегратора на текущей рабочей версии:

| Команда / сценарий | Результат | Что подтверждено и что не проверялось |
|---|---|---|
| `npm run check` | **PASS: 53 файла / 454 теста**, main/renderer typecheck, release assets | Включены новые split/export, process/privacy retry, cookie/permission, extension lifecycle, protocol и250k/speed регрессии |
| `npm run build` | **PASS** | Полная сборка main и renderer |
| `npm run test:e2e:features`: split | **PASS: 5 групп** | Настоящий Electron, две native страницы; fixed-position anchors, реальное переключение фокуса второй стороны, закрытие primary и layout/lifecycle. Не все ОС и сайты |
| `npm run test:e2e:features`: bookmarks | **PASS: 3 группы** | Реальный UI/IPC export, созданный HTML файл и importer round trip. Native file picker подменен тестовым выбором; внешние Chrome/Firefox не запускались |
| `npm run test:e2e:voodoo` | **PASS: 4 группы** | Локальный deterministic provider, actual IPC и DOM, отмена; UI250000 с metadata provider600000 дает effective250000, отдельный выбор128000. Это fixture metadata, не проверка живого xkiro |
| Прежний полный native suite | **PASS: 17 scripts** до последних250000/anchor изменений | Измененные части отдельно повторно проверены финальными feature/Voodoo smoke выше; не утверждается полный повтор всех17 после последнего изменения |

Числа404/407 и старые smoke в предыдущих документах относятся к историческим этапам. Текущий аудит опирается на454 интегрированных теста и перечисленные повторные native проверки. Нет заявлений о полной совместимости Chrome/Edge/Firefox, всех сайтах, живом VPN/xkiro или фактическом запросе на250000 токенов.
