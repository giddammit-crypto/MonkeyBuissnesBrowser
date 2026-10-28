# Модель безопасности и защиты от угроз Linuxsec

## 1. Разделение привилегий (Privilege Separation)

### 1.1 Запрет root для графической оболочки (GUI)
- В `src/main/main.ts` реализована жесткая проверка UID: если приложение запускается от пользователя root (UID 0), приложение немедленно аварийно завершает работу с выводом ошибки в stderr.
- Весь рендеринг, Chromium, Node.js рантайм и обработка пользовательского интерфейса работают в контексте непривилегированного пользователя.

### 1.2 Привилегированный компонент (Root Helper)
- Любые операции, требующие привилегий `CAP_NET_ADMIN` (модификация таблиц nftables/iptables для Kill Switch и управление IPv6 sysctl), изолированы в минимальном бинарном демоне `linuxsecd` (написанном на языке Go).
- Демон принимает команды только через локальный UNIX-сокет `/run/linuxsec/daemon.sock` и проверяет валидность всех аргументов (интерфейс, IP-адрес) по строгим регулярным выражениям, предотвращая инъекции параметров командной строки.

---

## 2. Изоляция контекста и защита от XSS / RCE

### 2.1 Конфигурация WebPreferences
```ts
webPreferences: {
  preload: path.join(__dirname, '../preload/preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
}
```
- **Context Isolation (`true`)**: Код renderer работает в изолированном контексте и не имеет прямого доступа к объектам Node.js или Electron main process.
- **Node Integration (`false`)**: Глобальные модули Node (`fs`, `child_process`, `net`) недоступны в браузере.
- **Песочница (`sandbox: true`)**: Процесс рендерера запускается в ограниченной системной песочнице Chromium.

### 2.2 Content Security Policy (CSP)
Строгая политика CSP применяется ко всем сетевым запросам рендерера:
```http
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://api.ipify.org https://ipapi.co https://icanhazip.com;
```
Любые попытки загрузки внешних скриптов, удаленного кода или подключения к неразрешенным доменам блокируются движком Chromium.

---

## 3. Защита от инъекций в конфигурационных файлах (.conf / .ovpn)

Злоумышленник может попытаться распространить вредоносный файл конфигурации VPN, содержащий скрытые команды шелла (`rm -rf /`, `curl | sh`, и т.д.).

### 3.1 Фильтрация WireGuard
Парсер `WireGuardParser.ts` анализирует синтаксис INI и блокирует директивы выполнения скриптов:
- Запрещены: `PreUp`, `PostUp`, `PreDown`, `PostDown`, `Table`, `FwMark`.
- При обнаружении любой из этих директив парсер выбрасывает `WireGuardParserError` с отказом в импорте.
- Валидация криптографических ключей: приватные и публичные ключи проверяются на соответствие 32-байтному Base64 формату (`/^[A-Za-z0-9+/]{43}=$/`).

### 3.2 Фильтрация OpenVPN
Парсер `OpenVpnParser.ts` проверяет все директивы и блокирует потенциально опасные команды:
- Запрещены: `up`, `down`, `route-up`, `route-pre-down`, `client-connect`, `client-disconnect`, `learn-address`, `auth-user-pass-verify`, `tls-verify`, `ipchange`, `script-security`, `plugin`.
- Запрет внешних плагинов исключает загрузку сторонних динамических библиотек (`.so`).

---

## 4. Защита от утечек трафика (Leak Protection)

1. **DNS Leak Protection**:
   - Приоритет DNS в NetworkManager устанавливается в `-50` (`ipv4.dns-priority`), что заставляет `systemd-resolved` направлять 100% запросов через туннель.
   - Межсетевой экран блокирует исходящие пакеты UDP на 53 порт мимо туннельного интерфейса при активном Kill Switch.
2. **IPv6 Leak Protection**:
   - На туннельном подключении задается `ipv6.method disabled`.
   - Демон отключает глобальный IPv6 autoconf через sysctl на время сессии.
3. **Kill Switch**:
   - Политика `OUTPUT drop` в таблице `inet linuxsec_ks` с разрешением только туннельных интерфейсов и endpoint IP.

---

## 5. Корректное восстановление при аварийных сбоях

- Зарегистрированы системные ловушки сигналов: `SIGINT`, `SIGTERM`, `SIGHUP`.
- При выходе из приложения или падении процесса:
  - Правила `nftables`/`iptables` очищаются (`flush table inet linuxsec_ks`).
  - Временные сетевые профили NetworkManager удаляются.
  - Параметры IPv6 восстанавливаются в исходное состояние.
