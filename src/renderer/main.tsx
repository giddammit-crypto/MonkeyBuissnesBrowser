import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  File,
  Film,
  FolderOpen,
  Globe2,
  History,
  Image,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Minus,
  MoreHorizontal,
  Music2,
  Pause,
  Pin,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Square,
  Star,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  BrowserSnapshot,
  DownloadEntry,
  ImportDataKind,
  ImportProfile,
  ImportReport,
  ImportFileKind,
  ImportFileReport,
} from "../shared/types";
import { getGoogleAuthNotice, getSiteKey } from "../shared/sitePolicy";
import { normalizeNewTabBackground } from "../shared/background";
import logoLight from "./assets/soul/logo-light.png";
import logoDark from "./assets/soul/logo-dark.png";
import portrait from "./assets/soul/portrait.webp";
import chloeWallpaper from "./assets/soul/chloe-wallpaper.webp";
import symbol from "./assets/soul/symbol.svg";
import "./styles.css";
import "./newtab-wallpaper.css";
import { userFacingError } from "./userFacingError";
const EntriesPanel = React.lazy(()=>import("./EntriesManager"));
const TabSearch = React.lazy(()=>import("./TabSearch"));
const PasswordManager = React.lazy(()=>import("./PasswordManager"));

type Panel = "home" | "bookmarks" | "history" | "downloads" | "settings";
type Toast = { tone: "error" | "success" | "info"; message: string };
// User wallpapers are kept in the trusted shell's local storage. Never load
// remote/CSS URLs, SVG or arbitrary files into the privileged browser shell.
const CUSTOM_WALLPAPER_KEY = "soul-m8te-custom-wallpaper-v1";
const CUSTOM_WALLPAPER_EVENT = "soul-m8te-wallpaper-changed";
function readCustomWallpaper(): string | null {
  try {
    const value = localStorage.getItem(CUSTOM_WALLPAPER_KEY);
    return value && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
  } catch { return null; }
}
function useCustomWallpaper(): [string | null, (data: string | null) => void] {
  const [image, setImage] = useState<string | null>(readCustomWallpaper);
  useEffect(() => {
    const changed = () => setImage(readCustomWallpaper());
    window.addEventListener(CUSTOM_WALLPAPER_EVENT, changed);
    return () => window.removeEventListener(CUSTOM_WALLPAPER_EVENT, changed);
  }, []);
  const save = (value: string | null) => {
    if (value === null) localStorage.removeItem(CUSTOM_WALLPAPER_KEY);
    else localStorage.setItem(CUSTOM_WALLPAPER_KEY, value);
    window.dispatchEvent(new Event(CUSTOM_WALLPAPER_EVENT));
  };
  return [image, save];
}
async function imageAsWallpaper(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Поддерживаются только PNG, JPEG и WebP.");
  if (file.size === 0 || file.size > 2_000_000)
    throw new Error("Изображение должно быть не больше 2 МБ.");
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(result))
    throw new Error("Недопустимый формат изображения.");
  await new Promise<void>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth <= 8192 && img.naturalHeight <= 8192
      ? resolve() : reject(new Error("Размер изображения превышает 8192 пикселей."));
    img.onerror = () => reject(new Error("Изображение повреждено."));
    img.src = result;
  });
  return result;
}
const quickLinks = [
  { label: "Почта", url: "https://mail.yandex.ru/" },
  { label: "Новости", url: "https://news.google.com/" },
  { label: "Видео", url: "https://www.youtube.com/" },
];
function Brand({ large = false }: { large?: boolean }): React.JSX.Element {
  return (
    <span className={`brand ${large ? "brand-large" : ""}`}>
      <img className="brand-on-light" src={logoLight} alt="SOUL-M8TE Browser" />
      <img className="brand-on-dark" src={logoDark} alt="SOUL-M8TE Browser" />
    </span>
  );
}
function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [panel, setPanel] = useState<Panel>("home");
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [popover, setPopover] = useState<"menu" | "protection" | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [authNoticeDismissed, setAuthNoticeDismissed] = useState(false);
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const previousTabId = useRef<string | undefined>(undefined);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const currentTab = snapshot?.tabs.find(
    (tab) => tab.id === snapshot.activeTabId,
  );
  const authNotice = getGoogleAuthNotice(currentTab?.url ?? "");
  useEffect(() => setAuthNoticeDismissed(false), [currentTab?.id, currentTab?.url]);
  const currentSite = getSiteKey(currentTab?.url ?? "");
  const sidebarCollapsed = snapshot?.settings.sidebarCollapsed ?? false;
  const showError = useCallback(
    (error: unknown) =>
      setToast({
        tone: "error",
        message: userFacingError(error),
      }),
    [],
  );
  const run = useCallback(
    (task: Promise<unknown>) => {
      void task.catch(showError);
    },
    [showError],
  );
  const openPanel = useCallback((next: Panel) => {
    setPanel(next);
    setPopover(null);
  }, []);

  useEffect(() => {
    let alive = true;
    run(
      window.browserApi.getSnapshot().then((next) => {
        if (alive) setSnapshot(next);
      }),
    );
    const remove = window.browserApi.onSnapshotChanged((next) => {
      if (alive) setSnapshot(next);
    });
    return () => {
      alive = false;
      remove();
    };
  }, [run]);
  useEffect(() => {
    const remove = window.browserApi.onTabEvent((event) => {
      if (event.type === "focus-address") {
        addressRef.current?.focus();
        addressRef.current?.select();
        return;
      }
      if (event.type === "show-tab-search") {
        setTabSearchOpen(true);
        setPopover(null);
        return;
      }
      if (event.type === "show-find") {
        setFindOpen(true);
        setPanel("home");
        setPopover(null);
        return;
      }
      if (event.type === "show-history") {
        openPanel("history");
        return;
      }
      if (event.type === "show-downloads") {
        openPanel("downloads");
        return;
      }
      if (event.type === "find-result") {
        setFindResult(event.message ?? "");
        return;
      }
      if (event.type === "navigation-error" || event.type === "renderer-gone")
        setToast({
          tone: "error",
          message:
            event.message ?? "Страница недоступна. Попробуйте обновить её.",
        });
      if (event.type === "download-started")
        setToast({ tone: "info", message: "Файл добавлен в загрузки." });
    });
    return remove;
  }, [openPanel]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!editingAddress)
      setAddress(currentTab?.isInternal ? "" : (currentTab?.url ?? ""));
  }, [currentTab?.id, currentTab?.url, currentTab?.isInternal, editingAddress]);
  useEffect(() => {
    const previous = previousTabId.current;
    if (previous && previous !== currentTab?.id) run(window.browserApi.stopFindInPage(previous));
    previousTabId.current = currentTab?.id;
    setEditingAddress(false);
    setAddress(currentTab?.isInternal ? "" : (currentTab?.url ?? ""));
    setFindText("");
    setFindResult("");
    setFindOpen(false);
    setPopover(null);
    setPanel("home");
  }, [currentTab?.id]);
  useEffect(() => {
    if (findOpen) findRef.current?.focus();
  }, [findOpen]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        snapshot?.settings.theme === "system" || !snapshot
          ? media.matches
            ? "dark"
            : "light"
          : snapshot.settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snapshot?.settings.theme]);
  useEffect(() => {
    document.documentElement.dataset.appearance = snapshot?.settings.appearancePreset ?? "classic";
    document.documentElement.dataset.accent = snapshot?.settings.accentColor ?? "blue";
    document.documentElement.style.setProperty("--wallpaper-dim", String((snapshot?.settings.wallpaperDim ?? 0) / 100));
  }, [snapshot?.settings.appearancePreset, snapshot?.settings.accentColor, snapshot?.settings.wallpaperDim]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const b = viewport.getBoundingClientRect();
      const hidden =
        panel !== "home" ||
        Boolean(popover) ||
        tabSearchOpen ||
        currentTab?.lifecycle === "crashed";
      run(
        window.browserApi.setChromeBounds(
          hidden
            ? { x: 0, y: 0, width: 0, height: 0 }
            : {
                x: b.left,
                y: b.top,
                width: b.width,
                height: Math.max(0, b.height - (toast ? 96 : 0)),
              },
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [
    panel,
    popover,
    tabSearchOpen,
    toast,
    sidebarCollapsed,
    findOpen,
    Boolean(snapshot),
    currentTab?.lifecycle,
    run,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || tabSearchOpen) return;
      setPopover(null);
      setToast(null);
      if (findOpen && currentTab) {
        setFindOpen(false);
        run(window.browserApi.stopFindInPage(currentTab.id));
      } else if (panel !== "home") setPanel("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentTab?.id, findOpen, panel, tabSearchOpen, run]);

  if (!snapshot)
    return (
      <div className="boot-screen">
        <img src={symbol} alt="" />
        <span>Запуск SOUL-M8TE…</span>
      </div>
    );
  const isPrivate = currentTab?.isPrivate ?? false;
  const bookmarked = snapshot.bookmarks.some(
    (bookmark) => bookmark.url === currentTab?.url,
  );
  const createTab = (privateMode = isPrivate) => {
    setPanel("home");
    setPopover(null);
    run(window.browserApi.createTab({ isPrivate: privateMode }));
  };
  const navigate = (value: string) => {
    if (!currentTab) return;
    setPanel("home");
    setPopover(null);
    setEditingAddress(false);
    run(window.browserApi.navigate(currentTab.id, value));
  };
  const action = (value: Parameters<typeof window.browserApi.tabAction>[1]) => {
    if (currentTab) run(window.browserApi.tabAction(currentTab.id, value));
  };
  const toggleSidebar = () =>
    run(
      window.browserApi.updateSettings({ sidebarCollapsed: !sidebarCollapsed }),
    );
  const find = (forward = true) => {
    if (currentTab && findText.trim())
      run(window.browserApi.findInPage(currentTab.id, findText, forward));
  };

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${findOpen ? "find-open" : ""} ${isPrivate ? "private-mode" : ""}`}
    >
      <div className="window-titlebar">
        <div className="title-brand">
          <img src={symbol} alt="" />
          <span>SOUL-M8TE</span>
          <span className="title-caption">Browser</span>
        </div>
        <div className="window-actions">
          <button
            title="Свернуть"
            aria-label="Свернуть"
            onClick={() => run(window.browserApi.minimizeWindow())}
          >
            <Minus size={16} />
          </button>
          <button
            title="Развернуть"
            aria-label="Развернуть"
            onClick={() => run(window.browserApi.toggleMaximizeWindow())}
          >
            <Square size={13} />
          </button>
          <button
            className="window-close"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={() => run(window.browserApi.closeWindow())}
          >
            <X size={17} />
          </button>
        </div>
      </div>
      <button className="tab-search-trigger icon-button" data-tab-search-trigger aria-label="Поиск по вкладкам" title="Поиск по вкладкам · Ctrl+Shift+A" onClick={() => { setTabSearchOpen(true); setPopover(null); }}><Search size={16}/></button>
      <TabStrip
        snapshot={snapshot}
        onActivate={(id) => {
          setPanel("home");
          run(window.browserApi.activateTab(id));
        }}
        onClose={(id) => run(window.browserApi.closeTab(id))}
        onCreate={() => createTab()}
      />
      <header className="toolbar">
        <div className="navigation-actions">
          <button
            className="icon-button"
            title="Назад · Alt+←"
            aria-label="Назад"
            disabled={!currentTab?.canGoBack}
            onClick={() =>
              currentTab && run(window.browserApi.goBack(currentTab.id))
            }
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="icon-button"
            title="Вперёд · Alt+→"
            aria-label="Вперёд"
            disabled={!currentTab?.canGoForward}
            onClick={() =>
              currentTab && run(window.browserApi.goForward(currentTab.id))
            }
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="icon-button"
            title={
              currentTab?.isLoading
                ? "Остановить загрузку"
                : "Обновить · Ctrl+R"
            }
            aria-label={currentTab?.isLoading ? "Остановить" : "Обновить"}
            onClick={() =>
              currentTab &&
              run(
                currentTab.isLoading
                  ? window.browserApi.stop(currentTab.id)
                  : window.browserApi.reload(currentTab.id),
              )
            }
          >
            {currentTab?.isLoading ? <X size={18} /> : <RefreshCw size={17} />}
          </button>
        </div>
        <form
          className={`omnibox ${isPrivate ? "omnibox-private" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <span
            className="omnibox-leading"
            title={
              isPrivate
                ? "Приватная вкладка"
                : currentTab?.url.startsWith("https:")
                  ? "Соединение HTTPS"
                  : "Адрес страницы"
            }
          >
            {isPrivate ? (
              <Shield size={16} />
            ) : currentTab?.url.startsWith("https:") ? (
              <LockKeyhole size={15} />
            ) : (
              <Search size={17} />
            )}
          </span>
          <input
            ref={addressRef}
            data-omnibox
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => setEditingAddress(true)}
            onBlur={() => setEditingAddress(false)}
            placeholder="Поиск или адрес страницы"
            aria-label="Адресная строка"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className={`icon-button bookmark-button ${bookmarked ? "active" : ""}`}
            disabled={currentTab?.isInternal}
            title={
              bookmarked
                ? "Удалить закладку · Ctrl+D"
                : "Добавить закладку · Ctrl+D"
            }
            aria-label={bookmarked ? "Удалить закладку" : "Добавить закладку"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              currentTab && run(window.browserApi.toggleBookmark(currentTab.id))
            }
          >
            <Star size={17} fill={bookmarked ? "currentColor" : "none"} />
          </button>
        </form>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="Загрузки · Ctrl+J"
            aria-label="Загрузки"
            onClick={() => openPanel("downloads")}
          >
            <Download size={18} />
          </button>
          <button
            className={`icon-button ${popover === "protection" ? "selected" : ""}`}
            title="Приватность и защита"
            aria-label="Приватность и защита"
            aria-expanded={popover === "protection"}
            onClick={() =>
              setPopover((value) =>
                value === "protection" ? null : "protection",
              )
            }
          >
            <Shield size={18} />
          </button>
          <button
            className={`mode-chip ${isPrivate ? "is-private" : ""}`}
            onClick={() => createTab(!isPrivate)}
            title={
              isPrivate
                ? "Открыть обычную вкладку"
                : "Открыть приватную вкладку"
            }
          >
            <span className="mode-dot" />
            {isPrivate ? "Приватная" : "Личная"}
          </button>
          <button
            className={`icon-button ${popover === "menu" ? "selected" : ""}`}
            title="Меню браузера"
            aria-label="Меню браузера"
            aria-expanded={popover === "menu"}
            onClick={() =>
              setPopover((value) => (value === "menu" ? null : "menu"))
            }
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
        {popover === "menu" && (
          <div
            className="toolbar-popover"
            role="dialog"
            aria-label="Меню браузера"
          >
            <div className="popover-heading">SOUL-M8TE</div>
            <MenuAction
              icon={<Plus size={16} />}
              label="Новая вкладка"
              detail="Ctrl+T"
              onClick={() => createTab()}
            />
            <MenuAction
              icon={<Shield size={16} />}
              label="Приватная вкладка"
              detail="Ctrl+Shift+P"
              onClick={() => createTab(true)}
            />
            <MenuAction
              icon={<RotateCcw size={16} />}
              label="Открыть закрытую вкладку"
              disabled={isPrivate}
              detail="Ctrl+Shift+T"
              onClick={() => {
                setPopover(null);
                run(window.browserApi.reopenClosedTab());
              }}
            />
            <div className="menu-divider" />
            <MenuAction
              icon={<Search size={16} />}
              label="Найти на странице"
              detail="Ctrl+F"
              disabled={currentTab?.isInternal}
              onClick={() => {
                setFindOpen(true);
                setPanel("home");
                setPopover(null);
              }}
            />
            <div className="zoom-controls">
              <span>Масштаб</span>
              <button
                aria-label="Уменьшить масштаб"
                onClick={() => action("zoom-out")}
              >
                <Minus size={15} />
              </button>
              <button
                className="zoom-reset"
                title="Сбросить масштаб"
                onClick={() => action("zoom-reset")}
              >
                {Math.round((currentTab?.zoomFactor ?? 1) * 100)}%
              </button>
              <button
                aria-label="Увеличить масштаб"
                onClick={() => action("zoom-in")}
              >
                <Plus size={15} />
              </button>
            </div>
            <MenuAction
              icon={<Pin size={16} />}
              label={
                currentTab?.isPinned ? "Открепить вкладку" : "Закрепить вкладку"
              }
              onClick={() => action("pin")}
            />
            <MenuAction
              icon={
                currentTab?.isMuted ? (
                  <VolumeX size={16} />
                ) : (
                  <Volume2 size={16} />
                )
              }
              label={currentTab?.isMuted ? "Включить звук" : "Выключить звук"}
              disabled={currentTab?.isInternal}
              onClick={() => action("mute")}
            />
            <MenuAction
              icon={<Plus size={16} />}
              label="Дублировать вкладку"
              onClick={() => {
                action("duplicate");
                setPopover(null);
              }}
            />
            <MenuAction
              icon={<Printer size={16} />}
              label="Печать страницы"
              detail="Ctrl+P"
              disabled={currentTab?.isInternal}
              onClick={() => {
                action("print");
                setPopover(null);
              }}
            />
            <MenuAction
              icon={<ExternalLink size={16} />}
              label="Открыть в системном браузере"
              disabled={currentTab?.isInternal}
              onClick={() => {
                setPopover(null);
                if (currentTab)
                  run(
                    window.browserApi.openCurrentPageExternally(currentTab.id),
                  );
              }}
            />
            <div className="menu-divider" />
            <MenuAction
              icon={<Menu size={16} />}
              label={sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"}
              onClick={toggleSidebar}
            />
            <MenuAction
              icon={<Settings size={16} />}
              label="Настройки"
              onClick={() => openPanel("settings")}
            />
          </div>
        )}
        {popover === "protection" && (
          <div
            className="toolbar-popover protection-popover"
            role="dialog"
            aria-label="Приватность и защита"
          >
            <div className="popover-heading">Приватность и защита</div>
            <div className="protection-summary">
              <Shield size={24} />
              <div>
                <strong>
                  {isPrivate ? "Приватная сессия" : "Обычный профиль"}
                </strong>
                <small>
                  {isPrivate
                    ? "История и временные данные удаляются после закрытия приватных вкладок."
                    : "История и данные сайтов сохраняются в вашем профиле."}
                </small>
              </div>
            </div>
            <div className="protection-line">
              <span>Блокировка рекламы</span>
              <strong>
                {snapshot.adBlock.enabled ? "Включена" : "Выключена"}
              </strong>
            </div>
            <div className="protection-line">
              <span>Заблокировано запросов</span>
              <strong>{snapshot.adBlock.blockedTotal}</strong>
            </div>
            {currentSite && (
              <div className="site-cookie-control">
                <strong>Cookies этого сайта</strong>
                <small className="site-key">{currentSite}</small>
                <label>
                  <span>Разрешить сторонние cookies</span>
                  <input
                    type="checkbox"
                    aria-label="Разрешить сторонние cookies для этого сайта"
                    checked={
                      !isPrivate &&
                      Boolean(
                        snapshot.settings.thirdPartyCookieExceptions?.includes(
                          currentSite,
                        ),
                      )
                    }
                    disabled={
                      isPrivate ||
                      snapshot.settings.blockThirdPartyCookies === false
                    }
                    onChange={(event) => {
                      if (currentTab)
                        run(
                          window.browserApi
                            .setSiteCookieException(
                              currentTab.id,
                              event.target.checked,
                            )
                            .then(() => {
                              setToast({
                                tone: "info",
                                message:
                                  "Настройка cookies сохранена. Обновите страницу, чтобы повторить вход.",
                              });
                            }),
                        );
                    }}
                  />
                </label>
                <small>
                  {isPrivate
                    ? "Исключения действуют только в обычном профиле. Приватная сессия сохраняет блокировку сторонних cookies."
                    : snapshot.settings.blockThirdPartyCookies === false
                      ? "Сторонние cookies уже разрешены общей настройкой обычного профиля."
                      : "Исключение применяется к этому сайту и его поддоменам только в обычном профиле. После изменения обновите страницу. Оно не отменяет ограничения входа Google."}
                </small>
                {!isPrivate &&
                  snapshot.settings.blockThirdPartyCookies !== false && (
                    <small className="google-cookie-compatibility-status">
                      {snapshot.settings.googleSignInCompatibility !== false
                        ? "Совместимость входа Google / YouTube включена: cookies между узлами входа разрешены. Для остальных сайтов действуют общие настройки и ваши исключения."
                        : "Совместимость входа Google / YouTube выключена. Для cookies действуют общие настройки и ваши исключения."}
                    </small>
                  )}
              </div>
            )}
            <p className="privacy-note">
              {snapshot.privacy?.proxy
                ? "Для приватных вкладок задан прокси. Проверьте внешний IP на доверенном сервисе."
                : "Приватный режим сам по себе не скрывает IP от сайтов и провайдера."}{" "}
              Файлы и закладки, сохранённые вами, остаются.
            </p>
            <button
              className="primary-button"
              onClick={() => openPanel("settings")}
            >
              Настройки защиты
            </button>
            {(snapshot.privacy?.privateTabCount ?? 0) > 0 && (
              <button
                className="plain-button"
                onClick={() => {
                  run(window.browserApi.closePrivateTabs());
                  setPopover(null);
                }}
              >
                Закрыть все приватные вкладки
              </button>
            )}
          </div>
        )}
      </header>
      {findOpen && (
        <form
          className="find-bar"
          onSubmit={(event) => {
            event.preventDefault();
            find();
          }}
        >
          <Search size={16} />
          <input
            ref={findRef}
            value={findText}
            onChange={(event) => {
              const text = event.target.value;
              setFindText(text);
              setFindResult("");
              if (currentTab) {
                if (text)
                  run(window.browserApi.findInPage(currentTab.id, text));
                else run(window.browserApi.stopFindInPage(currentTab.id));
              }
            }}
            placeholder="Найти на странице"
            aria-label="Найти на странице"
          />
          <span role="status">{findResult}</span>
          <button
            type="button"
            title="Предыдущее совпадение"
            aria-label="Предыдущее совпадение"
            onClick={() => find(false)}
          >
            <ChevronDown className="rotate" size={16} />
          </button>
          <button
            type="submit"
            title="Следующее совпадение"
            aria-label="Следующее совпадение"
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            aria-label="Закрыть поиск"
            onClick={() => {
              setFindOpen(false);
              if (currentTab)
                run(window.browserApi.stopFindInPage(currentTab.id));
            }}
          >
            <X size={16} />
          </button>
        </form>
      )}
      <aside className="sidebar">
        <div className="sidebar-top">
          <button
            className="sidebar-toggle icon-button"
            onClick={toggleSidebar}
            aria-label={
              sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"
            }
          >
            <Menu size={18} />
          </button>
          {!sidebarCollapsed && <span>Ваше пространство</span>}
        </div>
        <nav aria-label="Разделы браузера">
          <NavItem
            icon={<Globe2 size={18} />}
            label="Обзор"
            active={panel === "home"}
            collapsed={sidebarCollapsed}
            onClick={() => openPanel("home")}
          />
          <NavItem
            icon={<Bookmark size={18} />}
            label="Закладки"
            active={panel === "bookmarks"}
            collapsed={sidebarCollapsed}
            onClick={() => openPanel("bookmarks")}
          />
          <NavItem
            icon={<History size={18} />}
            label="История"
            active={panel === "history"}
            collapsed={sidebarCollapsed}
            onClick={() => openPanel("history")}
          />
          <NavItem
            icon={<Download size={18} />}
            label="Загрузки"
            active={panel === "downloads"}
            collapsed={sidebarCollapsed}
            onClick={() => openPanel("downloads")}
          />
        </nav>
        <div className="sidebar-divider" />
        {!sidebarCollapsed && <div className="sidebar-label">Пространства</div>}
        <div className="workspace-list">
          {snapshot.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className={`workspace-row ${workspace.id === currentTab?.workspaceId ? "active" : ""}`}
              title={workspace.name}
              onClick={() => {
                setPanel("home");
                run(window.browserApi.switchWorkspace(workspace.id));
              }}
            >
              <span
                className="workspace-dot"
                style={{ background: workspace.color }}
              />
              {!sidebarCollapsed && (
                <>
                  <span>
                    {workspace.name === "Personal" ? "Личное" : workspace.name}
                  </span>
                  <small>{workspace.tabIds.length}</small>
                </>
              )}
            </button>
          ))}
          {workspaceOpen && !sidebarCollapsed ? (
            <form
              className="workspace-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (workspaceName.trim())
                  run(
                    window.browserApi
                      .createWorkspace(workspaceName.trim())
                      .then(() => {
                        setWorkspaceName("");
                        setWorkspaceOpen(false);
                      }),
                  );
              }}
            >
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                aria-label="Название пространства"
                placeholder="Название"
                maxLength={40}
                autoFocus
              />
              <button aria-label="Создать пространство">
                <Plus size={16} />
              </button>
            </form>
          ) : (
            <button
              className="workspace-row new-space"
              title="Новое пространство"
              onClick={() => {
                if (sidebarCollapsed)
                  run(
                    window.browserApi.updateSettings({
                      sidebarCollapsed: false,
                    }),
                  );
                setWorkspaceOpen(true);
              }}
            >
              <Plus size={17} />
              {!sidebarCollapsed && <span>Добавить</span>}
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          {!sidebarCollapsed && (
            <div className="sidebar-brand-note">
              <span className="mode-dot" />
              Интернет. Без лишнего.
            </div>
          )}
          <NavItem
            icon={<Settings size={18} />}
            label="Настройки"
            active={panel === "settings"}
            collapsed={sidebarCollapsed}
            onClick={() => openPanel("settings")}
          />
        </div>
      </aside>
      <main className="content-area">
        {panel === "home" &&
          authNotice &&
          !authNoticeDismissed &&
          currentTab &&
          !currentTab.isInternal && (
            <section
              className="auth-help-banner"
              aria-label="Помощь со входом Google"
            >
              <LockKeyhole size={20} />
              <div>
                <strong>{authNotice.title}</strong>
                <p>{authNotice.message}</p>
              </div>
              <button
                className="plain-button"
                onClick={() =>
                  run(
                    window.browserApi.openCurrentPageExternally(currentTab.id),
                  )
                }
              >
                <ExternalLink size={16} /> Открыть в системном браузере
              </button>
              <button className="icon-button" aria-label="Скрыть помощь со входом Google" title="Скрыть помощь" onClick={() => setAuthNoticeDismissed(true)}><X size={16}/></button>
            </section>
          )}
        <div
          ref={viewportRef}
          className={`page-viewport ${panel !== "home" ? "panel-visible" : ""}`}
        >
          {panel === "home" && currentTab?.isInternal && (
            <NewTabPage
              snapshot={snapshot}
              privateMode={isPrivate}
              onSearch={navigate}
              onOpen={(url) => {
                setPanel("home");
                run(window.browserApi.createTab({ url, isPrivate }));
              }}
              onBookmarks={() => openPanel("bookmarks")}
              onSettings={() => openPanel("settings")}
            />
          )}
          {panel === "home" && currentTab?.lifecycle === "crashed" && (
            <EmptyState
              icon={<AlertTriangle size={28} />}
              title="Страница недоступна"
              description="Проверьте соединение и попробуйте обновить вкладку."
              action={
                <button
                  className="primary-button"
                  onClick={() => run(window.browserApi.reload(currentTab.id))}
                >
                  Повторить попытку
                </button>
              }
            />
          )}
          {panel === "bookmarks" && (
            <React.Suspense fallback={<p role="status">Открываем раздел…</p>}><EntriesPanel
              kind="bookmarks"
              snapshot={snapshot}
              onOpen={navigate}
            /></React.Suspense>
          )}
          {panel === "history" && (
            <React.Suspense fallback={<p role="status">Открываем раздел…</p>}><EntriesPanel
              kind="history"
              snapshot={snapshot}
              onOpen={navigate}
            /></React.Suspense>
          )}
          {panel === "downloads" && (
            <DownloadsPanel downloads={snapshot.downloads.filter(item=>Boolean(item.isPrivate)===isPrivate)} isPrivate={isPrivate} run={run} />
          )}
          {panel === "settings" && (
            <SettingsPanel
              snapshot={snapshot}
              run={run}
              onDone={() => openPanel("home")}
              onPasswordFeedback={(message,isError)=>setToast({tone:isError?"error":"success",message})}
              onBeforePasswordFill={async()=>{
                setPanel("home");setPopover(null);
                await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
                const b=viewportRef.current?.getBoundingClientRect();
                if(b) await window.browserApi.setChromeBounds({x:b.x,y:b.y,width:b.width,height:b.height});
              }}
            />
          )}
        </div>
      </main>
      {tabSearchOpen && <React.Suspense fallback={<div className="tab-search-backdrop"><p role="status">Открываем поиск по вкладкам…</p></div>}><TabSearch snapshot={snapshot} onActivate={async id=>{setPanel("home"); await window.browserApi.activateTab(id);}} onCloseTab={id=>window.browserApi.closeTab(id)} onDismiss={()=>setTabSearchOpen(false)} onError={showError}/></React.Suspense>}
      {popover && (
        <button
          className="popover-dismiss"
          aria-label="Закрыть меню"
          tabIndex={-1}
          onClick={() => setPopover(null)}
        />
      )}
      {toast && (
        <div
          className={`app-toast ${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>
            {toast.tone === "error" ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </span>
          <p>{toast.message}</p>
          <button
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function TabStrip({
  snapshot,
  onActivate,
  onClose,
  onCreate,
}: {
  snapshot: BrowserSnapshot;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const hasOverflow = overflow.left || overflow.right;
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const tabs = snapshot.tabs
    .filter((tab) => tab.workspaceId === active?.workspaceId)
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () =>
      setOverflow({
        left: list.scrollLeft > 2,
        right: list.scrollWidth - list.clientWidth - list.scrollLeft > 2,
      });
    list
      .querySelector<HTMLElement>(".tab-container.active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [snapshot.activeTabId, tabs.length]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(".tab-container.active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.activeTabId, hasOverflow]);
  const moveFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    // Manual tab activation keeps arrow-key navigation in the tab strip even
    // when the target is a native web page. Enter/Space activates the button.
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };
  return (
    <div className="tab-strip">
      {hasOverflow && (
        <button
          className="tab-scroll-button"
          disabled={!overflow.left}
          title="Предыдущие вкладки"
          aria-label="Прокрутить вкладки влево"
          onClick={() => listRef.current?.scrollBy({ left: -260 })}
        >
          <ArrowLeft size={15} />
        </button>
      )}
      <div
        className="tab-list"
        ref={listRef}
        role="tablist"
        aria-label="Вкладки"
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`tab-container ${tab.id === snapshot.activeTabId ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""} ${tab.isPinned ? "pinned-tab" : ""} ${tab.lifecycle === "hibernated" ? "sleeping-tab" : ""}`}
          >
            <button
              className="tab"
              role="tab"
              tabIndex={tab.id === snapshot.activeTabId ? 0 : -1}
              aria-selected={tab.id === snapshot.activeTabId}
              aria-label={tab.title || "Новая вкладка"}
              title={`${tab.title}${tab.isPrivate ? " · Приватная" : ""}${tab.isPinned ? " · Закреплена" : ""}${tab.lifecycle === "hibernated" ? " · Спит" : ""}`}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              <span className="tab-favicon">
                {tab.isLoading ? (
                  <LoaderCircle size={15} className="spin" />
                ) : tab.isPrivate ? (
                  <Shield size={15} />
                ) : tab.isInternal ? (
                  <img src={symbol} alt="" />
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <Globe2 size={15} />
                )}
              </span>
              <span className="tab-title">{tab.title || "Новая вкладка"}</span>
              {tab.isPinned && <Pin size={12} className="tab-state-icon" />}
              {tab.isMuted && <VolumeX size={13} className="tab-state-icon" />}
              {tab.lifecycle === "hibernated" && (
                <span className="sleep-indicator">Спит</span>
              )}
            </button>
            <button
              className="tab-close"
              aria-label={`Закрыть вкладку ${tab.title}`}
              title="Закрыть вкладку"
              onClick={() => onClose(tab.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {hasOverflow && (
        <button
          className="tab-scroll-button"
          disabled={!overflow.right}
          title="Следующие вкладки"
          aria-label="Прокрутить вкладки вправо"
          onClick={() => listRef.current?.scrollBy({ left: 260 })}
        >
          <ArrowRight size={15} />
        </button>
      )}
      <button
        className="new-tab-button"
        title="Новая вкладка · Ctrl+T"
        aria-label="Новая вкладка"
        onClick={onCreate}
      >
        <Plus size={19} />
      </button>
    </div>
  );
}
function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
function MenuAction({
  icon,
  label,
  detail,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button className="menu-action" onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
      {detail && <small>{detail}</small>}
    </button>
  );
}
function NewTabPage({
  snapshot,
  privateMode,
  onSearch,
  onOpen,
  onBookmarks,
  onSettings,
}: {
  snapshot: BrowserSnapshot;
  privateMode: boolean;
  onSearch: (value: string) => void;
  onOpen: (url: string) => void;
  onBookmarks: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  const hostname = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  const modifier = navigator.platform.toLowerCase().includes("mac")
    ? "⌘"
    : "Ctrl";
  const recent = privateMode ? [] : snapshot.history.slice(0, 3);
  const background = normalizeNewTabBackground(snapshot.settings.newTabBackground);
  const [customWallpaper] = useCustomWallpaper();
  return (
    <div className={`new-tab-page ${privateMode ? "private-newtab" : ""}`} data-new-tab-background={background} data-background={background}>
      {background === "portrait" && <div className="newtab-wallpaper" data-newtab-wallpaper aria-hidden="true"><img src={customWallpaper ?? chloeWallpaper} alt="" decoding="async" draggable={false} /></div>}
      <div className="newtab-topline">
        <span>
          {new Intl.DateTimeFormat("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date())}
        </span>
        <div className="newtab-top-actions">
          <span className="newtab-profile-label">
            {privateMode ? <Shield size={13} /> : <Globe2 size={13} />}{" "}
            {privateMode ? "Приватный просмотр" : "Личное пространство"}
          </span>
          <button
            onClick={onSettings}
            title="Настроить браузер"
            aria-label="Настроить браузер"
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
      <div className="newtab-center">
        <Brand large />
        <h1>
          {privateMode
            ? "Пространство только для вас."
            : "Интернет. Без лишнего."}
        </h1>
        <p className="newtab-subtitle">
          {privateMode
            ? snapshot.privacy?.proxy
              ? "Временная сессия. Для приватных вкладок настроен прокси."
              : "История не сохраняется. IP-адрес не скрывается."
            : "Открывайте новое. Возвращайтесь к важному."}
        </p>
        <form
          className="hero-search"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("query");
            if (input instanceof HTMLInputElement && input.value.trim())
              onSearch(input.value);
          }}
        >
          <Search size={21} />
          <input
            name="query"
            autoComplete="off"
            spellCheck={false}
            placeholder="Поиск или адрес страницы"
            aria-label="Поиск на новой вкладке"
          />
          <kbd aria-hidden="true">{modifier} L</kbd>
          <button type="submit" title="Открыть" aria-label="Искать">
            <ArrowRight size={20} />
          </button>
        </form>
        {!privateMode && (
          <div className="quick-links" aria-label="Быстрый доступ">
            {quickLinks.map((link, index) => (
              <button
                key={link.label}
                title={link.url}
                onClick={() => onOpen(link.url)}
              >
                <span className="quick-link-symbol">
                  {index === 0 ? (
                    <span className="mail-shortcut-symbol" aria-hidden="true">
                      @
                    </span>
                  ) : index === 1 ? (
                    <File size={20} />
                  ) : (
                    <Play size={20} />
                  )}
                </span>
                <span className="quick-link-label">{link.label}</span>
              </button>
            ))}
            <button onClick={onBookmarks}>
              <span className="quick-link-symbol">
                <Bookmark size={20} />
              </span>
              <span className="quick-link-label">Сохранённое</span>
            </button>
          </div>
        )}
        {privateMode ? (
          <section className="private-card" aria-label="О приватном режиме">
            <div className="private-card-heading">
              <Shield size={22} />
              <strong>Вы управляете своими данными</strong>
              <button className="text-button" onClick={onSettings}>
                Настроить <ChevronRight size={15} />
              </button>
            </div>
            <div className="privacy-facts">
              <div>
                <strong>Без истории</strong>
                <span>Посещения не записываются.</span>
              </div>
              <div>
                <strong>Временные cookies</strong>
                <span>Удалятся после закрытия всех приватных вкладок.</span>
              </div>
              <div>
                <strong>Вы решаете, что сохранить</strong>
                <span>Скачанные файлы и закладки остаются.</span>
              </div>
            </div>
            <p className="private-network-note">
              {snapshot.privacy?.proxy
                ? "Настроен прокси для приватных вкладок. Проверьте внешний IP на доверенном сервисе."
                : "IP-адрес виден сайтам и провайдеру. Этот режим не заменяет Tor или VPN."}
            </p>
          </section>
        ) : (
          <div className="newtab-workspace">
            <section className="newtab-saved">
              <div className="section-heading">
                <div>
                  <Bookmark size={16} />
                  <h2>Сохранённое</h2>
                  <span className="section-count">
                    {snapshot.bookmarks.length}
                  </span>
                </div>
                <button className="text-button" onClick={onBookmarks}>
                  Все закладки <ChevronRight size={15} />
                </button>
              </div>
              {snapshot.bookmarks.length > 0 ? (
                <div className="saved-grid">
                  {snapshot.bookmarks.slice(0, 4).map((bookmark) => (
                    <button
                      key={bookmark.id}
                      className="saved-card"
                      title={`${bookmark.title}\n${bookmark.url}`}
                      onClick={() => onOpen(bookmark.url)}
                    >
                      <span className="saved-site-icon">
                        <Globe2 size={17} />
                      </span>
                      <span>
                        <strong>{bookmark.title}</strong>
                        <small>{hostname(bookmark.url)}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="newtab-empty-saved">
                  <Star size={22} />
                  <strong>Важное всегда рядом</strong>
                  <p>Сохраняйте страницы звездой в адресной строке.</p>
                  <button className="text-button" onClick={onBookmarks}>
                    Открыть закладки <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </section>
            <section className="newtab-recent">
              <div className="section-heading">
                <div>
                  <History size={16} />
                  <h2>Недавно открывали</h2>
                </div>
                <span className="recent-local-note">На этом устройстве</span>
              </div>
              {recent.length > 0 ? (
                <div className="recent-page-list">
                  {recent.map((entry) => (
                    <button
                      className="recent-page-row"
                      key={entry.id}
                      title={`${entry.title}\n${entry.url}`}
                      onClick={() => onOpen(entry.url)}
                    >
                      <span className="recent-page-dot" />
                      <span>
                        <strong>{entry.title}</strong>
                        <small>{hostname(entry.url)}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="newtab-shortcut-list">
                  <p>Несколько полезных сочетаний</p>
                  <span>
                    Адресная строка <kbd>{modifier} L</kbd>
                  </span>
                  <span>
                    Новая вкладка <kbd>{modifier} T</kbd>
                  </span>
                  <span>
                    Найти на странице <kbd>{modifier} F</kbd>
                  </span>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
      <footer className="newtab-footer">
        <span>
          <span className="mode-dot" />
          {privateMode ? "Временная сессия" : "Ваш цифровой союзник"}
        </span>
        <span>SOUL-M8TE Browser</span>
      </footer>
    </div>
  );
}
function PanelHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}): React.JSX.Element {
  return (
    <div className="panel-header">
      <div className="panel-icon">{icon}</div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}
function DownloadsPanel({
  downloads,
  run,
  isPrivate,
}: {
  downloads: DownloadEntry[];
  isPrivate: boolean;
  run: (promise: Promise<unknown>) => void;
}): React.JSX.Element {
  const [query,setQuery]=useState("");
  const visible=downloads.filter(item=>`${item.filename} ${item.url}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const hasFinished=downloads.some(item=>!item.isLive && !["queued","progressing"].includes(item.state));
  return (
    <section className="utility-panel">
      <PanelHeader
        icon={<Download size={22} />}
        title="Загрузки"
        subtitle="Сохранённые файлы и текущие загрузки"
      />
      <div className="manager-filters"><label className="panel-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти файл" aria-label="Поиск в загрузках"/><span>{visible.length}</span></label><button className="plain-button" disabled={!hasFinished} title="Удаляет завершённые записи из списка; файлы остаются на диске" onClick={()=>run(window.browserApi.clearFinishedDownloads(isPrivate))}><Trash2 size={16}/>Очистить список</button></div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Download size={28} />}
          title={query.trim()?"Ничего не найдено":"Загрузок пока нет"}
          description={query.trim()?"Попробуйте другое название или адрес файла.":"Сохранённые файлы и их состояние появятся здесь."}
        />
      ) : (
        <div className="download-list">
          {visible.map((download) => {
            const active = download.isLive ||
              download.state === "queued" || download.state === "progressing";
            const resumable = download.isPaused || (download.state === "interrupted" && download.canResume);
            const percent =
              download.totalBytes > 0
                ? Math.min(
                    100,
                    Math.round(
                      (download.receivedBytes / download.totalBytes) * 100,
                    ),
                  )
                : null;
            const status = resumable
              ? "На паузе"
              : {
                  queued: "Подготовка…",
                  progressing: percent === null ? "Загрузка…" : `${percent}%`,
                  completed: "Сохранено",
                  cancelled: "Отменено",
                  interrupted: "Прервано",
                }[download.state];
            return (
              <article className="download-row" key={download.id}>
                <div className="download-preview">
                  {download.thumbnail ? (
                    <img src={download.thumbnail} alt="" />
                  ) : download.kind === "image" ? (
                    <Image size={23} />
                  ) : download.kind === "video" ? (
                    <Film size={23} />
                  ) : download.kind === "audio" ? (
                    <Music2 size={23} />
                  ) : (
                    <File size={23} />
                  )}
                </div>
                <div className="download-main">
                  <div className="download-title-line">
                    <strong>{download.filename}</strong>
                    {download.isPrivate && (
                      <span className="private-tag">
                        <Shield size={12} />
                        Приватная
                      </span>
                    )}
                  </div>
                  <div className="download-meta">
                    <span>{status}</span>
                    <span>
                      {formatBytes(download.receivedBytes)}
                      {download.totalBytes > 0
                        ? ` / ${formatBytes(download.totalBytes)}`
                        : ""}
                    </span>
                  </div>
                  {active && (
                    <div
                      className="download-progress"
                      role="progressbar"
                      aria-label="Загрузка файла"
                      aria-valuenow={percent ?? undefined}
                    >
                      <span style={{ width: `${percent ?? 12}%` }} />
                    </div>
                  )}
                  {download.error && (
                    <small className="download-error">{download.error}</small>
                  )}
                </div>
                <div className="download-actions">
                  {active && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={
                          resumable
                            ? "Продолжить загрузку"
                            : "Приостановить загрузку"
                        }
                        title={resumable ? "Продолжить" : "Пауза"}
                        onClick={() =>
                          run(
                            window.browserApi.controlDownload(
                              download.id,
                              resumable ? "resume" : "pause",
                            ),
                          )
                        }
                      >
                        {resumable ? (
                          <Play size={17} />
                        ) : (
                          <Pause size={17} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Отменить загрузку"
                        title="Отменить"
                        onClick={() =>
                          run(
                            window.browserApi.controlDownload(
                              download.id,
                              "cancel",
                            ),
                          )
                        }
                      >
                        <X size={17} />
                      </button>
                    </>
                  )}
                  {download.state === "completed" && (
                    <>
                      <button
                        className="icon-button"
                        aria-label="Открыть файл"
                        title="Открыть файл"
                        onClick={() =>
                          run(window.browserApi.openDownload(download.id))
                        }
                      >
                        <ExternalLink size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Показать в папке"
                        title="Показать в папке"
                        onClick={() =>
                          run(
                            window.browserApi.showDownloadInFolder(download.id),
                          )
                        }
                      >
                        <FolderOpen size={17} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
const importKinds: Array<{ value: ImportDataKind; label: string }> = [
  { value: "history", label: "История" },
  { value: "bookmarks", label: "Закладки" },
  { value: "cookies", label: "Cookies" },
  { value: "passwords", label: "Пароли" },
];

function ImportDataCard(): React.JSX.Element {
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<ImportDataKind[]>([
    "history",
    "bookmarks",
  ]);
  const [busy, setBusy] = useState<
    "discover" | "profile" | ImportFileKind | null
  >(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileReport, setFileReport] = useState<ImportFileReport | null>(null);

  const refreshProfiles = async () => {
    setBusy("discover");
    setMessage("");
    setError("");
    try {
      const next = await window.browserApi.discoverImportProfiles();
      setProfiles(next);
      setSelectedProfileId((current) =>
        next.some((profile) => profile.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
      if (next.length === 0)
        setMessage(
          "Профили не найдены. Можно импортировать закладки из HTML или пароли из CSV ниже.",
        );
    } catch (caught) {
      setError(
        userFacingError(caught, "Не удалось найти профили браузеров."),
      );
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    void refreshProfiles();
  }, []);

  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProfileId,
  );
  const effectiveKinds = selectedKinds.filter((kind) =>
    selectedProfile?.available.includes(kind),
  );
  const browserGroups = [
    ...new Set(profiles.map((profile) => profile.browserLabel)),
  ];
  const toggleKind = (kind: ImportDataKind) =>
    setSelectedKinds((current) =>
      current.includes(kind)
        ? current.filter((value) => value !== kind)
        : [...current, kind],
    );
  const importData = async () => {
    if (busy || !selectedProfile || effectiveKinds.length === 0) return;
    setBusy("profile");
    setMessage("");
    setError("");
    setReport(null);
    setFileReport(null);
    try {
      const next = await window.browserApi.importBrowserData({
        profileId: selectedProfile.id,
        data: effectiveKinds,
      });
      setReport(next);
      window.dispatchEvent(new Event("soul-passwords-changed"));
      setMessage(
        next.errors.length
          ? "Импорт завершён с ошибками. Проверьте результат ниже."
          : next.warnings.length
            ? "Импорт завершён. Есть замечания к отдельным записям."
            : "Импорт завершён.",
      );
    } catch (caught) {
      setError(
        userFacingError(caught, "Импорт не выполнен."),
      );
    } finally {
      setBusy(null);
    }
  };
  const importFile = async (kind: ImportFileKind) => {
    if (busy) return;
    setBusy(kind);
    setMessage("");
    setError("");
    setReport(null);
    setFileReport(null);
    try {
      const next = await window.browserApi.importBrowserFile(kind);
      if (next) {
        setFileReport(next);
      window.dispatchEvent(new Event("soul-passwords-changed"));
        setMessage(
          next.errors.length
            ? "Файл обработан с ошибками. Проверьте результат ниже."
            : "Файл обработан.",
        );
      } else setMessage("Выбор файла отменён. Данные не изменены.");
    } catch (caught) {
      setError(
        userFacingError(caught, "Не удалось импортировать файл."),
      );
    } finally {
      setBusy(null);
    }
  };
  const busyLabel =
    busy === "discover"
      ? "Ищем локальные профили…"
      : busy === "profile"
        ? "Читаем выбранные данные и сохраняем доступные записи…"
        : busy === "bookmarks"
          ? "Выберите HTML-файл. Затем проверим и импортируем закладки…"
          : "Выберите CSV-файл. Затем проверим записи и защищённое хранилище…";
  const warnings = report?.warnings ?? fileReport?.warnings ?? [];
  const errors = report?.errors ?? fileReport?.errors ?? [];

  return (
    <div className="import-card" aria-busy={Boolean(busy)}>
      <div className="import-card-heading">
        <div className="vpn-title">
          <Database size={21} />
          <span>
            <strong>Из другого браузера</strong>
            <small>
              Chrome, Яндекс Браузер, Firefox, Edge, Brave, Opera и Vivaldi.
              Данные обрабатываются локально.
            </small>
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="Обновить список профилей"
          title="Обновить список профилей"
          onClick={() => void refreshProfiles()}
          disabled={Boolean(busy)}
        >
          <RefreshCw size={16} className={busy === "discover" ? "spin" : ""} />
        </button>
      </div>
      <p className="import-guidance">
        Перед переносом закройте исходный браузер, чтобы его данные не менялись
        во время чтения. Существующие записи SOUL-M8TE сохраняются.
      </p>
      <div className="import-controls">
        <label className="import-field">
          <span>Профиль браузера</span>
          <select
            value={selectedProfileId}
            onChange={(event) => {
              setSelectedProfileId(event.target.value);
              setReport(null);
              setMessage("");
            }}
            disabled={Boolean(busy) || profiles.length === 0}
          >
            <option value="">
              {profiles.length === 0
                ? "Доступных профилей нет"
                : "Выберите профиль"}
            </option>
            {browserGroups.map((label) => (
              <optgroup key={label} label={label}>
                {profiles
                  .filter((profile) => profile.browserLabel === label)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.profileName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <fieldset className="import-field import-kinds">
          <legend>Что перенести</legend>
          <div className="import-checks">
            {importKinds.map((kind) => {
              const available =
                selectedProfile?.available.includes(kind.value) ?? false;
              return (
                <label
                  key={kind.value}
                  className={`import-check ${available ? "" : "unavailable"}`}
                  title={
                    available
                      ? kind.label
                      : "Эти данные не обнаружены в выбранном профиле"
                  }
                >
                  <input
                    type="checkbox"
                    checked={available && selectedKinds.includes(kind.value)}
                    onChange={() => toggleKind(kind.value)}
                    disabled={Boolean(busy) || !available}
                  />
                  <span>{kind.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      {selectedProfile && (
        <p className="import-source">
          Источник: <span>{selectedProfile.path}</span>
        </p>
      )}
      <div className="import-actions">
        <button
          className="primary-button"
          disabled={
            Boolean(busy) || !selectedProfile || effectiveKinds.length === 0
          }
          onClick={() => void importData()}
        >
          {busy === "profile" ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Database size={16} />
          )}
          {busy === "profile" ? "Переносим данные…" : "Импортировать выбранное"}
        </button>
        {selectedProfile && effectiveKinds.length === 0 && (
          <small>Выберите хотя бы один доступный тип данных.</small>
        )}
      </div>
      <div className="import-file-section">
        <div>
          <h4>Из файла экспорта</h4>
          <p>
            Подходит, если профиль не найден или браузер защищает свои данные.
          </p>
        </div>
        <div className="import-file-actions">
          <button
            className="plain-button"
            disabled={Boolean(busy)}
            onClick={() => void importFile("bookmarks")}
          >
            {busy === "bookmarks" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Bookmark size={16} />
            )}
            Закладки из HTML
          </button>
          <button
            className="plain-button"
            disabled={Boolean(busy)}
            onClick={() => void importFile("passwords")}
          >
            {busy === "passwords" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <KeyRound size={16} />
            )}
            Пароли из CSV
          </button>
        </div>
      </div>
      <div className="import-sensitive-note">
        <LockKeyhole size={17} />
        <div>
          <strong>CSV содержит пароли в открытом виде</strong>
          <p>
            Не отправляйте этот файл другим людям и не храните в общих папках.
            После переноса удалите ненужный CSV из места экспорта. SOUL-M8TE
            сохраняет пароли только при доступном системном шифровании.
            Автоматическое фоновое заполнение не поддерживается. Ручное заполнение доступно в разделе паролей после подтверждения.
          </p>
        </div>
      </div>
      <p className="import-compatibility-note">
        Cookies и защищённые пароли могут быть недоступны для переноса. Импорт
        cookies не гарантирует сохранение входа: сайт может потребовать
        повторную авторизацию, а Google — отклонить вход во встроенном браузере.
      </p>
      {busy && (
        <div className="import-progress" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>{busyLabel}</span>
        </div>
      )}
      {message && (
        <p className="setting-status" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="import-error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </p>
      )}
      {(report || fileReport) && (
        <section className="import-report" aria-label="Результат импорта">
          <strong>Результат импорта</strong>
          {report && (
            <>
              <p>{report.profileName}</p>
              <table className="import-result-table">
                <thead>
                  <tr>
                    <th>Данные</th>
                    <th>Добавлено</th>
                    <th>Пропущено</th>
                  </tr>
                </thead>
                <tbody>
                  {importKinds.map((kind) => (
                    <tr key={kind.value}>
                      <th>{kind.label}</th>
                      <td>{report.imported[kind.value]}</td>
                      <td>{report.skipped[kind.value]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {fileReport && (
            <div className="import-file-result">
              <span>
                {fileReport.kind === "bookmarks" ? "Закладки" : "Пароли"}
              </span>
              <span>
                Добавлено: <strong>{fileReport.imported}</strong>
              </span>
              <span>
                Пропущено: <strong>{fileReport.skipped}</strong>
              </span>
            </div>
          )}
          <small>
            «Добавлено» — только новые записи. В «Пропущено» входят дубли,
            неподдерживаемые или недоступные записи. Причины указаны в
            замечаниях.
          </small>
          {warnings.length > 0 && (
            <div className="import-report-notes">
              <strong>Замечания</strong>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {errors.length > 0 && (
            <div className="import-report-errors" role="alert">
              <strong>Не удалось перенести</strong>
              <ul>
                {errors.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SettingsPanel({
  snapshot,
  run,
  onDone,
  onBeforePasswordFill,
  onPasswordFeedback,
}: {
  snapshot: BrowserSnapshot;
  run: (promise: Promise<unknown>) => void;
  onDone: () => void;
  onBeforePasswordFill: () => Promise<void>;
  onPasswordFeedback: (message:string,isError?:boolean) => void;
}): React.JSX.Element {
  const [proxy, setProxy] = useState(snapshot.privacy?.proxy ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const settings = snapshot.settings;
  const [customWallpaper, saveCustomWallpaper] = useCustomWallpaper();
  const [wallpaperMessage, setWallpaperMessage] = useState("");
  const onWallpaperFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const wallpaper = await imageAsWallpaper(file);
      // Keep the previous wallpaper if either local storage or settings fail.
      // Storage is written first so a quota error cannot change browser settings.
      const previous = customWallpaper;
      saveCustomWallpaper(wallpaper);
      try {
        await window.browserApi.updateSettings({ newTabBackground: "portrait" });
      } catch (error) {
        try { saveCustomWallpaper(previous); } catch { /* Preserve original error. */ }
        throw error;
      }
      setWallpaperMessage("Собственные обои сохранены на этом устройстве.");
    } catch (error) {
      setWallpaperMessage(error instanceof DOMException && error.name === "QuotaExceededError" ? "Недостаточно места для обоев. Используйте файл меньшего размера." : error instanceof Error ? error.message : "Не удалось установить обои.");
    }
  };
  const workingSet = snapshot.performance
    ? Math.round(snapshot.performance.totalWorkingSet / 1024)
    : null;
  const update = (
    patch: Parameters<typeof window.browserApi.updateSettings>[0],
  ) => run(window.browserApi.updateSettings(patch));
  const clearData = async () => {
    setBusy(true);
    setStatus("");
    try {
      await window.browserApi.clearHistoryAndCookies();
      setStatus("История, cookies и данные сайтов очищены.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="utility-panel settings-panel">
      <div className="settings-heading">
        <PanelHeader
          icon={<Settings size={22} />}
          title="Настройки"
          subtitle="Управляйте браузером так, как удобно вам"
        />
        <button className="plain-button" onClick={onDone}>
          <X size={17} /> Закрыть
        </button>
      </div>
      <div className="settings-grid">
        <div className="settings-section">
          <h3>Основное</h3>
          <label className="setting-row">
            <span>
              <strong>Тема интерфейса</strong>
              <small>Спокойные светлая и тёмная темы.</small>
            </span>
            <select
              value={settings.theme}
              onChange={(event) =>
                update({
                  theme: event.target.value as "system" | "light" | "dark",
                })
              }
            >
              <option value="system">Как в системе</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Фон новой вкладки</strong>
              <small>Локальное изображение или однотонный фон.</small>
            </span>
            <select
              aria-label="Фон новой вкладки"
              value={settings.newTabBackground}
              onChange={event => update({ newTabBackground: normalizeNewTabBackground(event.target.value) })}
            >
              <option value="portrait">Девушка SOUL-M8TE</option>
              <option value="plain">Однотонный</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>Стиль оформления</strong><small>Отдельный стиль Detroit · Хлоя. Исходные светлая и тёмная темы не изменяются.</small></span>
            <select aria-label="Стиль оформления" value={settings.appearancePreset ?? "classic"} onChange={event => update({ appearancePreset: event.target.value as "classic" | "detroit" })}>
              <option value="classic">Классический SOUL-M8TE</option>
              <option value="detroit">Detroit · Хлоя</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>Акцентный цвет</strong><small>Отдельная персонализация; светлая и тёмная темы остаются прежними.</small></span>
            <select aria-label="Акцентный цвет" value={settings.accentColor ?? "blue"} onChange={event => update({ accentColor: event.target.value as "blue" | "teal" | "violet" | "rose" })}>
              <option value="blue">Классический синий</option>
              <option value="teal">Бирюзовый</option>
              <option value="violet">Фиолетовый</option>
              <option value="rose">Розовый</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>Затемнение обоев</strong><small>От 0% до 75%, влияет только на изображение новой вкладки.</small></span>
            <input aria-label="Затемнение обоев" type="range" min="0" max="75" step="5" value={settings.wallpaperDim ?? 0} onChange={event => update({ wallpaperDim: Number(event.target.value) })} />
            <output>{settings.wallpaperDim ?? 0}%</output>
          </label>
          <div className="setting-row custom-wallpaper-setting">
            <span>
              <strong>Собственные обои</strong>
              <small>Локальный PNG, JPEG или WebP до 2 МБ. Не отправляется в интернет.</small>
            </span>
            <div className="custom-wallpaper-controls">
              <label className="custom-wallpaper-upload">
                Выбрать файл
                <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Загрузить собственные обои" onChange={(event) => void onWallpaperFile(event)} />
              </label>
              {customWallpaper && <button type="button" className="plain-button" onClick={() => { saveCustomWallpaper(null); setWallpaperMessage("Возвращён стандартный портрет."); }}>Сбросить</button>}
            </div>
            {wallpaperMessage && <small role="status">{wallpaperMessage}</small>}
          </div>
          <label className="setting-row">
            <span>
              <strong>Поисковая система</strong>
              <small>Для адресной строки и новой вкладки.</small>
            </span>
            <select
              value={settings.searchEngine}
              onChange={(event) => update({ searchEngine: event.target.value })}
            >
              <option value="https://yandex.ru/search/?text=">Яндекс</option>
              <option value="https://www.google.com/search?q=">Google</option>
              <option value="https://duckduckgo.com/?q=">DuckDuckGo</option>
              <option value="https://www.bing.com/search?q=">Bing</option>
              {![
                "https://yandex.ru/search/?text=",
                "https://www.google.com/search?q=",
                "https://duckduckgo.com/?q=",
                "https://www.bing.com/search?q=",
              ].includes(settings.searchEngine) && (
                <option value={settings.searchEngine}>Другая система</option>
              )}
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Восстанавливать вкладки</strong>
              <small>Только обычные вкладки после перезапуска.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.restoreSession ?? true}
              onChange={(event) =>
                update({ restoreSession: event.target.checked })
              }
            />
          </label>
        </div>
        <div className="settings-section">
          <h3>Приватность и защита</h3>
          <label className="setting-row">
            <span>
              <strong>Блокировка рекламы</strong>
              <small>
                Базовые сетевые правила · заблокировано{" "}
                {snapshot.adBlock.blockedTotal} запросов.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.adBlockEnabled ?? true}
              onChange={(event) =>
                update({ adBlockEnabled: event.target.checked })
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Блокировать сторонние cookies</strong>
              <small>
                Учитываются ваши исключения и режим совместимости входа Google /
                YouTube.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.blockThirdPartyCookies ?? true}
              onChange={(event) =>
                update({ blockThirdPartyCookies: event.target.checked })
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Совместимость входа Google / YouTube</strong>
              <small>
                В обычном профиле разрешает cookies только между узлами входа
                Google и YouTube. После изменения обновите страницу. Настройка
                не отменяет ограничения Google для Electron.
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.googleSignInCompatibility ?? true}
              onChange={(event) =>
                update({ googleSignInCompatibility: event.target.checked })
              }
            />
          </label>
          <div className="cookie-exceptions-settings">
            <div className="small-heading">
              <Globe2 size={18} />
              <strong>Исключения для сторонних cookies</strong>
            </div>
            <p>
              Разрешения выдаются отдельным сайтам через значок защиты рядом с
              адресной строкой. Они действуют только в обычном профиле. После
              изменения обновите открытые страницы.
            </p>
            {(settings.thirdPartyCookieExceptions?.length ?? 0) === 0 ? (
              <small>Исключений пока нет.</small>
            ) : (
              <ul className="cookie-exception-list">
                {settings.thirdPartyCookieExceptions?.map((site) => (
                  <li key={site}>
                    <span>{site}</span>
                    <button
                      className="icon-button"
                      aria-label={`Удалить исключение ${site}`}
                      title="Удалить исключение"
                      onClick={() =>
                        update({
                          thirdPartyCookieExceptions:
                            settings.thirdPartyCookieExceptions?.filter(
                              (value) => value !== site,
                            ),
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="setting-row">
            <span>
              <strong>Очистить данные сайтов</strong>
              <small>
                История, cookies, хранилища и кэш обычного профиля. Вы выйдете
                из аккаунтов.
              </small>
            </span>
            <button
              className="plain-button"
              disabled={busy}
              onClick={() => run(clearData())}
            >
              <Trash2 size={16} />
              {busy ? "Очищаем…" : "Очистить"}
            </button>
          </div>
          {status && (
            <p className="setting-status" role="status">
              {status}
            </p>
          )}
          <div className="proxy-card">
            <div className="small-heading">
              <Shield size={19} />
              <strong>Прокси приватных вкладок</strong>
            </div>
            <p>
              Необязательный HTTP(S) или SOCKS5-прокси. Настройка действует до
              закрытия приложения. Введите адрес сервера без логина и пароля.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  window.browserApi
                    .setPrivateProxy(proxy)
                    .then(() =>
                      setStatus(
                        proxy.trim()
                          ? "Прокси применён к приватным вкладкам."
                          : "Приватные вкладки используют прямое соединение.",
                      ),
                    ),
                );
              }}
            >
              <input
                value={proxy}
                onChange={(event) => setProxy(event.target.value)}
                placeholder="socks5://127.0.0.1:9050"
                aria-label="Адрес прокси приватных вкладок"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="primary-button" type="submit">
                Применить
              </button>
            </form>
            <small>
              Пустой адрес — прямое соединение. Прокси не обеспечивает защиту от
              цифрового отпечатка и не является встроенным Tor. Приватный режим
              без прокси не скрывает IP.
            </small>
          </div>
        </div>
        <div className="settings-section">
          <h3>Производительность</h3>
          <label className="setting-row">
            <span>
              <strong>Усыплять фоновые вкладки</strong>
              <small>
                Не усыпляются вкладки со звуком, загрузками, несохранённым
                вводом и закреплённые вкладки.
              </small>
            </span>
            <select
              value={settings.sleepAfterMinutes}
              onChange={(event) =>
                update({
                  sleepAfterMinutes: Number(event.target.value) as
                    | 0
                    | 5
                    | 15
                    | 30
                    | 60,
                })
              }
            >
              <option value="0">Никогда</option>
              <option value="5">Через 5 минут</option>
              <option value="15">Через 15 минут</option>
              <option value="30">Через 30 минут</option>
              <option value="60">Через 1 час</option>
            </select>
          </label>
          <div className="setting-row">
            <span>
              <strong>Память и процессы</strong>
              <small>
                {workingSet === null
                  ? "Метрики собираются…"
                  : `${workingSet} МБ · ${snapshot.performance?.processCount ?? 0} процессов · вкладок: ${snapshot.tabs.length}`}
              </small>
            </span>
            <span className="live-label">
              <span className="mode-dot" />В реальном времени
            </span>
          </div>
        </div>
        <div className="settings-section"><h3>Пароли и вход на сайты</h3><React.Suspense fallback={<p role="status">Открываем менеджер паролей…</p>}><PasswordManager currentTab={snapshot.tabs.find(tab=>tab.id===snapshot.activeTabId)} onBeforeFill={onBeforePasswordFill} onFeedback={onPasswordFeedback}/></React.Suspense></div>
        <div className="settings-section import-section">
          <h3>Перенос данных</h3>
          <ImportDataCard />
        </div>
        <div className="settings-section">
          <h3>WireGuard</h3>
          <div className="vpn-title">
            <Shield size={21} />
            <span>
              <strong>
                {snapshot.vpn.configured
                  ? snapshot.vpn.profileName
                  : "Профиль не импортирован"}
              </strong>
              <small>Хранение и проверка конфигурации системного VPN.</small>
            </span>
          </div>
          {snapshot.vpn.configured && (
            <div className="vpn-details">
              <span>Сервер: {snapshot.vpn.endpoint ?? "Не указан"}</span>
              <span>Адреса: {snapshot.vpn.addresses.join(", ")}</span>
              <span>DNS: {snapshot.vpn.dns.join(", ") || "Не указан"}</span>
            </div>
          )}
          <p className="privacy-note">
            Приложение не запускает WireGuard-туннель. Подключение настраивается
            системным клиентом VPN. Импорт профиля не означает, что IP скрыт или
            VPN подключён.
          </p>
          <div className="vpn-actions">
            <button
              className="plain-button"
              onClick={() => run(window.browserApi.importVpnConfig())}
            >
              <Upload size={16} />
              {snapshot.vpn.configured
                ? "Заменить профиль"
                : "Импортировать .conf"}
            </button>
            {snapshot.vpn.configured && (
              <button
                className="plain-button"
                onClick={() => run(window.browserApi.clearVpnConfig())}
              >
                <Trash2 size={16} />
                Удалить
              </button>
            )}
          </div>
          {snapshot.vpn.errors.map((error) => (
            <p key={error} className="download-error">
              {error}
            </p>
          ))}
        </div>
        <div className="about-card">
          <img src={portrait} alt="Портретный знак SOUL-M8TE" />
          <div>
            <strong>SOUL-M8TE Browser</strong>
            <p>Ваш цифровой союзник.</p>
            <small>Интерфейс по SOUL-M8TE Brand Guidelines 1.0</small>
          </div>
        </div>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
