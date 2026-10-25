# MonkeyBuissnesBrowser

MonkeyBuissnesBrowser — Linux-first Electron browser foundation with a real Chromium tab surface, secure shell/remote-content separation, persistent history/bookmarks/settings, deterministic local ad-block interception, resource metrics, and a WireGuard configuration validator.

Проект намеренно не маскирует незавершённые системные возможности: VPN-туннель, kill switch, DNS/WebRTC leak protection и release signing требуют платформенных нативных компонентов и живой тестовой конфигурации. В интерфейсе такие состояния явно помечены как «не настроено» или «не активировано».

## Стек

- Electron `45.0.0` / Chromium tab surface через `BaseWindow` + `WebContentsView`
- TypeScript `7.0.2` в strict mode
- React `19.3.1` + Vite `8.3.5`
- JSON persistence behind stores (history, bookmarks, settings, workspaces); SQLite can be introduced without changing renderer contracts
- Vitest for deterministic unit tests
- electron-builder for package artifacts
- Lucide React icons and a tokenized CSS design system

## Быстрый запуск

Требуется Node `>=22.12.0` и npm.

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

`npm start` запускает собранное приложение. В Linux/Wayland приложение использует текущий desktop display; native window coordinates не используются для layout.

## Полезные команды

```bash
npm run dev             # build + launch
npm run typecheck       # main/preload/renderer TypeScript checks
npm run lint            # project lint alias to the typecheck gate
npm test                # unit suite
npm run package         # unpacked electron-builder artifact
npm run dist:linux      # AppImage + DEB on Linux
```

Для визуальной проверки shell без запуска Electron можно поднять Vite preview:

```bash
npm run build:renderer
npx vite --host 127.0.0.1 --port 5173
```

Затем открыть `/preview.html`. Preview — только визуальный smoke surface; фактическая навигация и вкладки работают в Electron через main process.

## Реализовано сейчас

- Реальное нативное окно Electron, кастомный titlebar и layout по референсу.
- Настоящий `WebContentsView` для HTTP/HTTPS страниц; запрещены iframe и BrowserView как основная поверхность.
- Несколько вкладок: создание, переключение, закрытие, активный loading/title/favicon, back/forward/reload/stop.
- Omnibox с URL/search parsing и блокировкой `javascript:`, `data:`, `file:` и других неподдерживаемых схем.
- Управление popup `target=_blank` через внутренние вкладки.
- Session permission policy deny-by-default.
- Centralized download interception с save dialog, progress и финальным состоянием.
- Persistent history/bookmarks/settings/workspaces в userData с atomic JSON writes.
- Private tab session на непостоянной partition; история private-вкладок не записывается.
- Анонимная/приватная вкладка с очисткой cookies/site data при закрытии, ограничением WebRTC и явным предупреждением, что IP не скрывается без Tor/VPN.
- Рабочие пространства с переключением вкладок и актуальным количеством вкладок.
- Уведомления об ошибках навигации/рендерера, контекстное меню с базовыми действиями редактирования и открытием/показом скачанных файлов.
- Реальный request interception engine с базовыми host/path правилами и фактическими counters. Это не заявляется как полноценный EasyList/EasyPrivacy coverage.
- Реальный process metrics sampler через `app.getAppMetrics()` и системную доступную память.
- WireGuard config parser, который отвергает malformed configs и executable hooks; privileged tunnel backend пока намеренно не включён.
- VPN settings panel с импортом `.conf`, проверкой CIDR/MTU/Endpoint/hooks, redacted metadata, удалением профиля и сохранением конфигурации только через OS-backed `safeStorage`, когда он доступен.
- Светлая/тёмная/system тема, responsive layout, keyboard focus states и reduced-motion.

## Архитектура

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- `src/main` — окно, вкладки, IPC, sessions, persistence.
- `src/preload` — typed allowlisted bridge только для trusted shell.
- `src/renderer` — browser chrome и стартовая страница.
- `src/services/adblock` — единый request interceptor на session.
- `src/services/memory` — process metrics и eligibility rules.
- `src/services/vpn` — parser/validation boundary без фиктивного connect.
- `src/shared` — типы и pure omnibox logic.

## VPN status

Нативный WireGuard backend не отмечен как готовый. Требования и следующий безопасный шаг описаны в [docs/VPN.md](docs/VPN.md). Для реального tunnel нужны privileged helpers/Windows service/macOS Network Extension, peer credentials, secure keychain и platform-specific integration tests.

## Ограничения

- AdBlock использует небольшой встроенный базовый набор правил; EasyList/EasyPrivacy update pipeline ещё не подключён.
- MemoryManager пока собирает реальные process metrics и ведёт lifecycle registry; automatic hard hibernation с восстановлением navigation history ещё не включён в UI.
- VPN handshake, routes, DNS, IPv6, WebRTC, kill switch и public-IP checks не тестировались и не выдаются за PASS.
- Windows/macOS installers и code signing не проверены на их native runners.
- Настоящая сетевая anonymity/Tor-маршрутизация отсутствует: приватный режим не скрывает IP и не является VPN.
- JSON persistence выбрана как переносимый первый слой; SQLite/keychain migration требует отдельного native dependency review.
