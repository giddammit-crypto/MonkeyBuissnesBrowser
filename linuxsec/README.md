# Linuxsec — Advanced Native VPN Client for Linux

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Tests: 16/16 Passed](https://img.shields.io/badge/Tests-16%20Passed-emerald.svg)](tests/)
[![Linux: Ubuntu | Debian | Mint | Fedora](https://img.shields.io/badge/Linux-Ubuntu%20%7C%20Debian%20%7C%20Mint%20%7C%20Fedora-orange.svg)](docs/INSTALL.md)

**Linuxsec** — это полноценное, самостоятельное десктопное VPN-приложение для Linux с открытой архитектурой, не требующее обязательной регистрации, создания учетной записи или сторонних платных подписок. Приложение обеспечивает надежное управление системными туннелями WireGuard и OpenVPN на уровне ядра Linux, комплексную защиту от утечек DNS и IPv6, аппаратный Kill Switch через `nftables`, мониторинг трафика в реальном времени и детальную диагностику сетевого стека.

---

## 🌟 Ключевые возможности

1. **Подключение в один клик**: Крупная анимированная кнопка (60 FPS) с индикатором статуса туннеля (Disconnected, Connecting, Connected, Reconnecting, Disconnecting, Error).
2. **Поддержка WireGuard и OpenVPN**: Полноценная интеграция с нативными модулями ядра Linux и NetworkManager D-Bus.
3. **Импорт стандартных конфигураций**: Загрузка любых файлов `.conf` (WireGuard) и `.ovpn` (OpenVPN).
4. **Управление серверами**: Добавление, редактирование, удаление, добавление в избранное и сортировка.
5. **Тестирование задержки (Ping)**: Автоматическое и ручное измерение задержки (RTT ms) до всех настроенных серверов.
6. **Отображение реального внешнего IP**: Запрос к независимым сервисам до и после подключения с индикацией смены IP, провайдера (ISP) и страны.
7. **Аппаратный Kill Switch**: Блокировка любого трафика вне туннеля через `nftables`/`iptables` при непредвиденном обрыве связи.
8. **Защита от утечек DNS (DNS Leak Protection)**: Принудительный отрицательный приоритет (`-50`) в `systemd-resolved` и изоляция запросов.
9. **Защита от утечек IPv6**: Автоматическое отключение и изоляция незашифрованных маршрутов IPv6.
10. **Пользовательские DNS**: Поддержка Cloudflare (1.1.1.1), Quad9 (9.9.9.9), Google (8.8.8.8), AdGuard (94.140.14.14) или любого собственного DNS.
11. **Мониторинг трафика в реальном времени**: Живой график скорости входящего/исходящего трафика (B/s, KB/s, MB/s) и счетчики переданных байт из `/sys/class/net`.
12. **Встроенный диагностический аудит**: Проверка доступности шлюза, скорости разрешения DNS, статуса туннельного интерфейса, сокрытия IP и защиты IPv6.
13. **Безопасная архитектура без root в GUI**: Приложение запускается от обычного пользователя; привилегированные операции выполняются через минимальный daemon `linuxsecd` на Go.
14. **Системный трей**: Иконка в области уведомлений со сменой цветов по статусу, быстрое переключение, контекстное меню.
15. **Автозапуск и автоподключение**: Интеграция с XDG Autostart (`~/.config/autostart/linuxsec.desktop`).
16. **Современный UI**: Тёмная и светлая темы, типографика Inter, стеклянный интерфейс (Glassmorphism), адаптивность.

---

## 🚀 Быстрый запуск

### Запуск через AppImage (без установки):
```bash
chmod +x release/Linuxsec-1.0.0.AppImage
./release/Linuxsec-1.0.0.AppImage
```

### Установка пакета .deb (Ubuntu/Debian/Mint):
```bash
sudo dpkg -i release/linuxsec_1.0.0_amd64.deb
```

### Разработка и сборка из исходников:
```bash
# Сборка демона, main process и renderer
npm run build

# Запуск приложения
npm start

# Запуск тестов
npm test
```

---

## 📂 Структура проекта

```text
linuxsec/
├── daemon/                    # Привилегированный root-демон (linuxsecd) на Go
│   └── cmd/main.go            # nftables Kill Switch, IPv6 lock, UNIX-сокет
├── src/
│   ├── main/                  # Electron Main Process (TypeScript)
│   │   ├── main.ts            # Точка входа, жизненный цикл, CSP
│   │   ├── ipc/               # Обработчики IPC
│   │   ├── vpn/               # Сетевой движок VPN
│   │   │   ├── VpnCoordinator.ts        # Конечный автомат состояний
│   │   │   ├── NetworkManagerBackend.ts # NetworkManager D-Bus / nmcli
│   │   │   ├── DaemonBackend.ts         # Клиент для linuxsecd
│   │   │   ├── WireGuardParser.ts       # Парсер .conf с защитой от инъекций
│   │   │   ├── OpenVpnParser.ts         # Парсер .ovpn с защитой от инъекций
│   │   │   ├── PublicIpService.ts       # Реальное определение внешнего IP
│   │   │   ├── PingService.ts           # Измерение задержки RTT
│   │   │   ├── TrafficMonitor.ts        # Опрос счетчиков /sys/class/net
│   │   │   └── DiagnosticEngine.ts      # Сетевой аудит и тесты
│   │   ├── storage/           # Атомарное хранилище настроек, профилей и истории
│   │   └── system/            # Интеграция с треем и автозапуском
│   ├── preload/               # Изолированный contextBridge
│   ├── renderer/              # Пользовательский интерфейс (React 19 + Vite)
│   │   └── src/components/    # Экраны Home, Servers, Stats, Diagnostics, Security, Settings
│   └── shared/                # Общие интерфейсы типов и каналов IPC
├── packaging/                 # Файлы сборки дистрибутивов
│   ├── debian/                # postinst, prerm, зависимости
│   ├── systemd/               # linuxsecd.service
│   ├── polkit/                # org.linuxsec.policy
│   └── icons/                 # Иконки приложения (от 16x16 до 512x512)
├── tests/                     # Автоматизированные тесты
│   ├── unit/                  # Юнит-тесты парсеров, хранилища, автомата
│   └── e2e/                   # Интеграционные тесты с NetworkManager
├── docs/                      # Документация проекта
│   ├── ARCHITECTURE.md        # Архитектура и сетевая схема
│   ├── INSTALL.md             # Инструкция по установке
│   ├── SECURITY.md            # Модель безопасности и защита от угроз
│   └── TEST_REPORT.md         # Отчет о тестировании и верификации
├── electron-builder.yml       # Конфигурация сборки DEB, RPM, AppImage
└── package.json
```

---

## 🔒 Безопасность

Подробное описание модели безопасности, изоляции песочницы, фильтрации директив и аудита кода приведено в [docs/SECURITY.md](docs/SECURITY.md).
