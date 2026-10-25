# Архитектура SOUL-M8TE

## Process boundaries

```text
BaseWindow
├── trusted chrome WebContentsView
│   └── shell-preload -> typed browserApi -> fixed IPC channels
└── one untrusted WebContentsView per browser tab
    └── no Node integration, sandbox, context isolation, webSecurity
```

The main process owns tab state, navigation, sessions, downloads, permissions, persistence, and native integration boundaries. The React renderer is a view of main-process state; it does not create WebContents, approve permissions, or run shell commands.

## Trusted shell

The local shell is served by the `app://shell/index.html` protocol handler. The handler resolves paths under the packaged renderer directory and rejects traversal. The shell preload exposes only fixed methods such as `browser:create-tab`, `browser:navigate`, `browser:back`, and `window:close`.

The main process checks the shell `WebContentsView` id, its main frame and the exact `app://shell/index.html` URL before accepting privileged IPC. Remote pages receive no application bridge.

## Tabs and navigation

`BrowserController` keeps a `Map<tabId, TabRecord>`. A tab can be an internal new-tab surface or an actual `WebContentsView`. `http:` and `https:` are the supported web navigation schemes. Native popups also support an initial `about:blank` document that can later navigate to a supported web URL; they retain opener/postMessage semantics and the originating session. Popup requests become controlled tabs; unsupported protocols are denied, while only `mailto:`, `tel:` and `webcal:` may be passed to `shell.openExternal`.

Every remote tab gets:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

The browser chrome rectangle is measured in the trusted renderer and passed to main. Main sets native view bounds; this avoids using absolute desktop coordinates and works with the Wayland limitations observed on the development host.

## Persistence

`JsonStore` writes through a temporary file followed by rename. History, bookmarks, settings, and workspaces are stored under Electron `userData/browser-data`. The store boundary is intentionally isolated so a later SQLite migration does not change IPC or React contracts.

## Real vs not claimed

- Download progress comes from `DownloadItem` events.
- AdBlock counters come from the actual `session.webRequest` cancellation callback.
- Process metrics come from `app.getAppMetrics()` and are process-level, not exact per-tab memory.
- Private tabs share one temporary in-memory partition and clear its site data when the last private tab closes. They set WebRTC to `disable_non_proxied_udp`; this is local privacy, not Tor/VPN anonymity.
- VPN has no connected state until a privileged backend reports one. The current implementation stops at safe config parsing and validation.
