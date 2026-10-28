# Отчет о тестировании и верификации Linuxsec

## 1. Сводка результатов тестирования

- **Дата тестирования**: 27 октября 2026 г.
- **Окружение**: Linux x86_64, Ubuntu Desktop, NetworkManager 1.54.3, WireGuard 1.0, OpenVPN 2.7.0, Go 1.26.8, Node.js 26.12.0.
- **Статус тестов**: Все 16 автоматизированных тестов успешно пройдены (100% Pass).
- **Сборка релизных пакетов**: Успешно собраны `linuxsec_1.0.0_amd64.deb` (101MB) и `Linuxsec-1.0.0.AppImage` (126MB).

---

## 2. Результаты автоматизированных тестовых наборов

### 2.1 Парсеры конфигураций (`tests/unit/parsers.test.ts`)
| Тест | Проверяемое поведение | Результат |
| :--- | :--- | :--- |
| `validates 32-byte base64 keys correctly` | Проверка валидности Base64 WireGuard ключей | **PASS** (3ms) |
| `successfully parses a valid WireGuard configuration` | Парсинг Interface, Peer, Endpoint, AllowedIPs, DNS, MTU | **PASS** (3ms) |
| `strictly rejects malicious hooks like PostUp and PreUp` | Блокировка попыток RCE через `PostUp`, `PreUp`, `PreDown` | **PASS** (1ms) |
| `successfully parses valid OpenVPN configuration` | Парсинг remote host, port, proto, certs | **PASS** (2ms) |
| `strictly rejects malicious execution directives` | Блокировка опасных директив `up`, `down`, `script-security` | **PASS** (1ms) |

### 2.2 Хранилище данных (`tests/unit/storage.test.ts`)
| Тест | Проверяемое поведение | Результат |
| :--- | :--- | :--- |
| `initializes with default settings` | Инициализация настроек по умолчанию (Kill Switch off, DNS leak on) | **PASS** (2ms) |
| `updates and persists settings atomically` | Атомарная запись через временный файл и чтение настроек | **PASS** (12ms) |
| `creates sample seed profile if empty` | Создание шаблона сервера при первом запуске | **PASS** (1ms) |
| `can save, update, toggle favorite and delete profiles` | Полный цикл CRUD для профилей серверов и сортировка избранных | **PASS** (3ms) |
| `records and retrieves session history` | Сохранение истории сессий (трафик, время, статус выхода) | **PASS** (1ms) |

### 2.3 Конечный автомат туннеля (`tests/unit/coordinator.test.ts`)
| Тест | Проверяемое поведение | Результат |
| :--- | :--- | :--- |
| `starts in disconnected state` | Начальное состояние `disconnected`, метрики равны 0 | **PASS** (1ms) |
| `transitions to connecting, then connected` | Переход в `connecting` и `connected` с фиксацией профиля | **PASS** (355ms) |
| `transitions to disconnecting and disconnected` | Корректное отключение, вызов деактивации NetworkManager | **PASS** (40ms) |
| `handles activation failure and transitions to error` | Обработка тайм-аута или ошибки активации с безопасной очисткой | **PASS** (1102ms) |

### 2.4 Реальная интеграция с NetworkManager (`tests/e2e/networkmanager-integration.test.ts`)
| Тест | Проверяемое поведение | Результат |
| :--- | :--- | :--- |
| `detects NetworkManager availability` | Проверка подключения к системному демону NetworkManager | **PASS** (24ms) |
| `imports, inspects, and safely deletes a WireGuard connection` | Генерация настоящих ключей `wg genkey`, импорт в ядро через NetworkManager, валидация параметров (`ipv4.dns-priority -50`, `ipv6.method disabled`), полное удаление профиля без остаточных файлов | **PASS** (333ms) |

---

## 3. Выявленные и устраненные проблемы в процессе разработки

### Проблема №1: Ограничение длины сетевого интерфейса в ядре Linux (`IFNAMSIZ`)
- **Симптом**: При первом запуске теста импорта в NetworkManager была получена ошибка:
  `Ошибка: сбой импорта: Имя файла конфигурации WireGuard должно представлять из себя действительное имя интерфейса, за которым следует ".conf"`.
- **Причина**: Первоначально генерировалось имя `linuxsec-int-test-wg.conf` (19 символов). В ядре Linux константа `IFNAMSIZ` равна 16 байт (максимальная длина имени интерфейса — 15 символов, плюс завершающий null-байт).
- **Решение**: Внедрена функция санации имени интерфейса: `lsec_${cleanId}` (длина строго до 14 символов, только алфавитно-цифровые символы). Тест повторно запущен и пройден на 100%.

### Проблема №2: Разделение прав доступа (Non-Root GUI)
- **Решение**: В `src/main/main.ts` внедрен запрет запуска Electron от root (UID 0). Все операции управления туннелями работают через авторизованный D-Bus NetworkManager, а операции межсетевого экрана (Kill Switch) — через изолированный демон `linuxsecd`.

### Проблема №3: Очистка временных файлов и секретов
- **Решение**: Все временные `.conf` и `.ovpn` файлы, создаваемые для передачи в NetworkManager, создаются с правами `0600` и немедленно удаляются блоком `finally` сразу после импорта.
