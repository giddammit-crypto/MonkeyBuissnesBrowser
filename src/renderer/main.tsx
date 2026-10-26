import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  User,
  LogIn,
  LogOut,
  VenetianMask,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  BrowsecCountry,
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
import { getOmniboxSuggestions } from "../shared/omniboxSuggestions";
import logoLight from "./assets/soul/logo-light.png";
import logoDark from "./assets/soul/logo-dark.png";
import portrait from "./assets/soul/portrait.webp";
import chloeWallpaper from "./assets/soul/chloe-wallpaper.webp";
import cyberpinkWallpaper from "./assets/soul/cyberpink-wallpaper.webp";
import cyberpinkFujiWallpaper from "./assets/soul/cyberpink-fuji-wallpaper.webp";
import cyberButterflyWallpaper from "./assets/soul/cyber-butterfly-wallpaper.jpg";
import tokyoNightWallpaper from "./assets/soul/tokyo-night-wallpaper.jpg";
import celestialPalaceWallpaper from "./assets/soul/celestial-palace-wallpaper.jpg";
import chloeIcon from "./assets/soul/chloe-icon-512.png";
import symbol from "./assets/soul/symbol.svg";
import "./styles.css";
import "./newtab-wallpaper.css";
import { userFacingError } from "./userFacingError";
import BrowsecModal from "./BrowsecModal";
import GoogleAccountPopover from "./GoogleAccountPopover";
import TabSearch from "./TabSearch";
import SiteFavicon from "./SiteFavicon";
const EntriesPanel = React.lazy(()=>import("./EntriesManager"));
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
    return value && value.length <= 3_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
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
    if (value !== null && (value.length > 3_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value))) throw new Error("Недопустимые данные обоев.");
    if (value === null) localStorage.removeItem(CUSTOM_WALLPAPER_KEY);
    else localStorage.setItem(CUSTOM_WALLPAPER_KEY, value);
    window.dispatchEvent(new Event(CUSTOM_WALLPAPER_EVENT));
  };
  return [image, save];
}
async function imageAsWallpaper(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Поддерживаются только PNG, JPEG и WebP.");
  if (!file.size || file.size > 20_000_000)
    throw new Error("Изображение должно быть не больше 20 МБ.");
  const blobUrl = URL.createObjectURL(file);
  try {
    const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Изображение повреждено."));
      image.src = blobUrl;
    });
    if (!photo.naturalWidth || !photo.naturalHeight || photo.naturalWidth > 12000 || photo.naturalHeight > 12000)
      throw new Error("Неподдерживаемое разрешение изображения.");
    const scale = Math.min(1, 2560 / photo.naturalWidth, 1600 / photo.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить изображение.");
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.74, 0.6]) {
      const compressed = canvas.toDataURL("image/webp", quality);
      if (compressed.startsWith("data:image/webp;base64,") && compressed.length <= 3_000_000)
        return compressed;
    }
    throw new Error("Не удалось сжать обои. Выберите изображение меньшего разрешения.");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const quickLinks = [
  { label: "Почта", url: "https://mail.yandex.ru/" },
  { label: "Новости", url: "https://news.google.com/" },
  { label: "Видео", url: "https://www.youtube.com/" },
];
function Brand({ large = false }: { large?: boolean }): React.JSX.Element {
  return (
    <span className={`brand ${large ? "brand-large" : ""}`}>
      <img className="brand-on-light" src={logoLight} alt="soulm8te Browser" />
      <img className="brand-on-dark" src={logoDark} alt="soulm8te Browser" />
    </span>
  );
}
function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [panel, setPanel] = useState<Panel>("home");
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [popover, setPopover] = useState<"menu" | "protection" | "browsec" | "google-account" | null>(null);
  const [browsecCountries, setBrowsecCountries] = useState<BrowsecCountry[]>([]);
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
  const canDownloadVideo = Boolean(currentTab?.canDownloadMedia);
  const authNotice = getGoogleAuthNotice(currentTab?.url ?? "");
  useEffect(() => setAuthNoticeDismissed(false), [currentTab?.id, currentTab?.url]);
  const currentSite = getSiteKey(currentTab?.url ?? "");
  const sidebarCollapsed = snapshot?.settings.sidebarCollapsed ?? false;
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const omniboxSuggestions = useMemo(() => {
    if (!editingAddress || !address.trim()) return [];
    return getOmniboxSuggestions(address, {
      history: snapshot?.history,
      bookmarks: snapshot?.bookmarks,
      searchEngineUrl: snapshot?.settings?.searchEngine,
      maxResults: 7,
    });
  }, [editingAddress, address, snapshot?.history, snapshot?.bookmarks, snapshot?.settings?.searchEngine]);

  useEffect(() => {
    void window.browserApi.getBrowsecCountries().then(setBrowsecCountries).catch(console.error);
    const unsub = window.browserApi.onBrowsecSnapshot?.((browsecState) => {
      setSnapshot((prev) => (prev ? { ...prev, browsec: browsecState } : prev));
    });
    return unsub;
  }, []);

  const currentBrowsecCountry = useMemo(() => {
    const code = snapshot?.browsec?.country || snapshot?.browsec?.selectedCountry || "nl";
    return browsecCountries.find((c) => c.code === code) || browsecCountries[0];
  }, [browsecCountries, snapshot?.browsec]);

  const activeDownloads = useMemo(() => {
    return snapshot?.downloads.filter(
      (item) => item.isLive || item.state === "progressing" || item.state === "queued",
    ) ?? [];
  }, [snapshot?.downloads]);
  const isDownloading = activeDownloads.length > 0;
  const downloadProgress = useMemo(() => {
    if (!isDownloading) return 0;
    const itemsWithTotal = activeDownloads.filter((d) => d.totalBytes > 0);
    if (itemsWithTotal.length === 0) return 0;
    const total = itemsWithTotal.reduce((sum, d) => sum + d.totalBytes, 0);
    const received = itemsWithTotal.reduce((sum, d) => sum + d.receivedBytes, 0);
    return Math.min(100, Math.round((received / total) * 100));
  }, [activeDownloads, isDownloading]);
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
    const bg = snapshot?.settings.newTabBackground ?? "portrait";
    let appearance = snapshot?.settings.appearancePreset ?? "classic";
    if (bg === "cyberpink") {
      appearance = "cyberpink";
    } else if (bg === "cyberpink-fuji") {
      appearance = "cyberpink-fuji";
    } else if (bg === "cyber-butterfly") {
      appearance = "cyber-butterfly";
    } else if (bg === "tokyo-night") {
      appearance = "tokyo-night";
    } else if (bg === "celestial-palace") {
      appearance = "celestial-palace";
    } else if (bg === "portrait" && appearance === "classic") {
      appearance = "detroit";
    }

    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.wallpaper = bg;
    document.documentElement.dataset.accent = snapshot?.settings.accentColor ?? (
      bg === "cyberpink" || appearance === "cyberpink"
        ? "pink"
        : bg === "cyberpink-fuji" || appearance === "cyberpink-fuji" || bg === "cyber-butterfly" || appearance === "cyber-butterfly"
          ? "violet"
          : bg === "celestial-palace" || appearance === "celestial-palace"
            ? "teal"
            : "blue"
    );
    document.documentElement.style.setProperty("--wallpaper-dim", String((snapshot?.settings.wallpaperDim ?? 0) / 100));
  }, [snapshot?.settings.appearancePreset, snapshot?.settings.newTabBackground, snapshot?.settings.accentColor, snapshot?.settings.wallpaperDim]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const b = viewport.getBoundingClientRect();
      const hidden =
        panel !== "home" ||
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
    toast,
    sidebarCollapsed,
    findOpen,
    Boolean(snapshot),
    currentTab?.lifecycle,
    run,
  ]);
  useEffect(() => {
    const isPopoverOpen = Boolean(popover) || tabSearchOpen;
    void window.browserApi.setPopoverOpen(isPopoverOpen);
  }, [popover, tabSearchOpen]);
  const isPrivate = currentTab?.isPrivate ?? false;
  const bookmarked = snapshot?.bookmarks.some(
    (bookmark) => bookmark.url === currentTab?.url,
  ) ?? false;
  const createTab = (privateMode = isPrivate, url?: string) => {
    setPanel("home");
    setPopover(null);
    run(window.browserApi.createTab({ isPrivate: privateMode, url }));
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape") {
        if (tabSearchOpen) return;
        setPopover(null);
        setToast(null);
        if (findOpen && currentTab) {
          setFindOpen(false);
          run(window.browserApi.stopFindInPage(currentTab.id));
        } else if (panel !== "home") setPanel("home");
        return;
      }

      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement;

      // Google Chrome keyboard shortcuts
      if (modifier && event.shiftKey && (key === "n" || key === "p")) {
        event.preventDefault();
        createTab(true);
      } else if (modifier && event.shiftKey && key === "t") {
        event.preventDefault();
        setPopover(null);
        run(window.browserApi.reopenClosedTab());
      } else if (modifier && key === "t") {
        event.preventDefault();
        createTab();
      } else if (modifier && key === "w") {
        event.preventDefault();
        if (currentTab) run(window.browserApi.closeTab(currentTab.id));
      } else if (modifier && key === "h") {
        event.preventDefault();
        openPanel("history");
      } else if (modifier && key === "j") {
        event.preventDefault();
        openPanel("downloads");
      } else if (modifier && key === "d" && !isInputFocused) {
        event.preventDefault();
        if (currentTab) run(window.browserApi.toggleBookmark(currentTab.id));
      } else if (modifier && key === "f" && !isInputFocused) {
        event.preventDefault();
        setFindOpen(true);
        setPanel("home");
        setPopover(null);
      } else if ((modifier && key === "r") || key === "f5") {
        event.preventDefault();
        if (currentTab) run(window.browserApi.reload(currentTab.id));
      } else if (modifier && (key === "+" || key === "=")) {
        event.preventDefault();
        if (currentTab) action("zoom-in");
      } else if (modifier && key === "-") {
        event.preventDefault();
        if (currentTab) action("zoom-out");
      } else if (modifier && key === "0") {
        event.preventDefault();
        if (currentTab) action("zoom-reset");
      } else if ((modifier && key === "l") || key === "f6") {
        event.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      } else if (modifier && !event.shiftKey && !event.altKey && /^[1-9]$/.test(key) && snapshot) {
        event.preventDefault();
        const visible = snapshot.tabs
          .filter((entry) => entry.workspaceId === (currentTab?.workspaceId ?? "personal") && entry.isPrivate === isPrivate)
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
        const selected = visible[key === "9" ? visible.length - 1 : Number(key) - 1];
        if (selected) run(window.browserApi.activateTab(selected.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentTab, findOpen, panel, tabSearchOpen, isPrivate, snapshot, run, openPanel]);

  if (!snapshot)
    return (
      <div className="boot-screen">
        <img src={symbol} alt="" />
        <span>Запуск soulm8te…</span>
      </div>
    );

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${findOpen ? "find-open" : ""} ${isPrivate ? "private-mode" : ""}`}
    >
      <div className="window-titlebar">
        <div className="title-brand">
          <img className="title-brand-icon" src={chloeIcon} alt="soulm8te" />
          <span>soulm8te</span>
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
      <TabStrip
        snapshot={snapshot}
        tabSearchOpen={tabSearchOpen}
        onToggleSearch={() => {
          setTabSearchOpen((open) => !open);
          setPopover(null);
        }}
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
          {isPrivate && (
            <span className="omnibox-incognito-badge" title="Приватный режим инкогнито">
              <VenetianMask size={13} />
              <span>Инкогнито</span>
            </span>
          )}
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
            onChange={(event) => {
              setAddress(event.target.value);
              setSelectedSuggestionIndex(-1);
            }}
            onFocus={() => {
              setEditingAddress(true);
              setSelectedSuggestionIndex(-1);
            }}
            onBlur={() => {
              setTimeout(() => setEditingAddress(false), 140);
            }}
            onKeyDown={(event) => {
              if (omniboxSuggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedSuggestionIndex((prev) => (prev + 1) % omniboxSuggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedSuggestionIndex((prev) => (prev <= 0 ? omniboxSuggestions.length - 1 : prev - 1));
                  return;
                }
                if (event.key === "Escape") {
                  setEditingAddress(false);
                  setSelectedSuggestionIndex(-1);
                  return;
                }
                if (event.key === "Enter") {
                  if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < omniboxSuggestions.length) {
                    event.preventDefault();
                    const target = omniboxSuggestions[selectedSuggestionIndex];
                    navigate(target.url);
                    setEditingAddress(false);
                    setSelectedSuggestionIndex(-1);
                    return;
                  }
                }
              }
            }}
            placeholder="Поиск или адрес страницы"
            aria-label="Адресная строка"
            spellCheck={false}
            autoComplete="off"
          />
          {Math.round((currentTab?.zoomFactor ?? 1) * 100) !== 100 && (
            <button
              type="button"
              className="omnibox-zoom-badge"
              title="Сбросить масштаб (100%) · Ctrl+0"
              aria-label={`Масштаб ${Math.round((currentTab?.zoomFactor ?? 1) * 100)}%. Нажмите для сброса`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => action("zoom-reset")}
            >
              <ZoomIn size={13} />
              <span>{Math.round((currentTab?.zoomFactor ?? 1) * 100)}%</span>
            </button>
          )}
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
          {editingAddress && omniboxSuggestions.length > 0 && (
            <div className="omnibox-suggestions-dropdown" role="listbox">
              {omniboxSuggestions.map((item, index) => (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={index === selectedSuggestionIndex}
                  className={`omnibox-suggestion-item ${index === selectedSuggestionIndex ? "selected" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    navigate(item.url);
                    setEditingAddress(false);
                    setSelectedSuggestionIndex(-1);
                  }}
                >
                  <span className="omnibox-suggestion-icon">
                    {item.kind === "popular" ? (
                      <Globe2 size={16} />
                    ) : item.kind === "bookmark" ? (
                      <Star size={16} fill="currentColor" />
                    ) : item.kind === "history" ? (
                      <History size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                  </span>
                  <span className="omnibox-suggestion-title">{item.title}</span>
                  <span className="omnibox-suggestion-domain">{item.domain}</span>
                  <span className={`omnibox-suggestion-badge badge-${item.kind}`}>{item.badge}</span>
                </div>
              ))}
            </div>
          )}
        </form>
        <div className="toolbar-actions">
          <button
            className={`icon-button download-header-btn ${canDownloadVideo ? "has-video-available" : ""}`}
            title={canDownloadVideo ? "Доступно видео для скачивания с текущего сайта!" : "Загрузки · Ctrl+J"}
            aria-label="Загрузки"
            onClick={() => openPanel("downloads")}
          >
            <Download size={18} />
            {canDownloadVideo && (
              <span className="download-video-badge" title="Видео готово к скачиванию">
                <CheckCircle2 size={11} strokeWidth={2.8} />
              </span>
            )}
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
            className={`browsec-toolbar-btn ${snapshot.browsec?.enabled ? "is-active" : ""} ${popover === "browsec" ? "selected" : ""}`}
            title={`soulm8te VPN · ${currentBrowsecCountry?.name || "Локация"} (${snapshot.browsec?.enabled ? "ВКЛ" : "ВЫКЛ"})`}
            aria-label="soulm8te VPN"
            aria-expanded={popover === "browsec"}
            onClick={() =>
              setPopover((value) => (value === "browsec" ? null : "browsec"))
            }
          >
            <span className="browsec-btn-shield">
              <Shield size={15} fill={snapshot.browsec?.enabled ? "currentColor" : "none"} />
            </span>
            <span className="browsec-btn-flag">{currentBrowsecCountry?.flag || "🇳🇱"}</span>
            <span className="browsec-btn-status">
              {snapshot.browsec?.enabled ? "ON" : "OFF"}
            </span>
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
            className={`google-account-toolbar-btn ${snapshot.activeGoogleAccount ? "has-account" : ""} ${popover === "google-account" ? "selected" : ""}`}
            title={snapshot.activeGoogleAccount ? `Google: ${snapshot.activeGoogleAccount.name || snapshot.activeGoogleAccount.email}` : "Войти через Google"}
            aria-label="Аккаунт Google"
            aria-expanded={popover === "google-account"}
            onClick={() => setPopover((val) => val === "google-account" ? null : "google-account")}
          >
            {snapshot.activeGoogleAccount?.avatar ? (
              <img src={snapshot.activeGoogleAccount.avatar} alt="" className="google-avatar-img" />
            ) : (
              <svg className="google-g-icon" viewBox="0 0 24 24" width="16" height="16">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
            )}
            <span className="google-btn-label">
              {snapshot.activeGoogleAccount ? (snapshot.activeGoogleAccount.name ? snapshot.activeGoogleAccount.name.split(' ')[0] : snapshot.activeGoogleAccount.email.split('@')[0]) : "Google"}
            </span>
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
            <div className="popover-heading">soulm8te</div>
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
        {popover === "browsec" && (
          <BrowsecModal
            state={snapshot.browsec}
            countries={browsecCountries}
            onUpdate={async (patch) => {
              const updated = await window.browserApi.updateBrowsec(patch);
              setSnapshot((prev) => (prev ? { ...prev, browsec: updated } : prev));
            }}
            onClose={() => setPopover(null)}
          />
        )}
        {popover === "google-account" && (
          <GoogleAccountPopover
            snapshot={snapshot}
            onClose={() => setPopover(null)}
            onCreateTab={(url) => {
              createTab(false, url);
              setPopover(null);
            }}
          />
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
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            hasVideoBadge={canDownloadVideo}
          />
        </nav>
        <div className="sidebar-divider" />
        {!sidebarCollapsed && <div className="sidebar-label">Пространства</div>}
        <div className="workspace-list">
          {snapshot.workspaces.map((workspace) => (
            <div
              key={workspace.id}
              role="button"
              tabIndex={0}
              className={`workspace-row ${workspace.id === (currentTab?.workspaceId ?? "personal") ? "active" : ""}`}
              title={snapshot.workspaces.length > 1 ? `${workspace.name} (ПКМ — удалить)` : workspace.name}
              onClick={() => {
                setPanel("home");
                run(window.browserApi.switchWorkspace(workspace.id));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (snapshot.workspaces.length > 1) {
                  run(window.browserApi.deleteWorkspace(workspace.id));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPanel("home");
                  run(window.browserApi.switchWorkspace(workspace.id));
                }
              }}
            >
              <span
                className="workspace-dot"
                style={{ background: workspace.color }}
              />
              {!sidebarCollapsed && (
                <>
                  <span className="workspace-name">
                    {workspace.name === "Personal" ? "Личное" : workspace.name}
                  </span>
                  <small>{workspace.tabIds.length}</small>
                  {snapshot.workspaces.length > 1 && (
                    <button
                      type="button"
                      className="workspace-delete-btn"
                      title={`Удалить пространство «${workspace.name}»`}
                      aria-label={`Удалить пространство ${workspace.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        run(window.browserApi.deleteWorkspace(workspace.id));
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
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
            <DownloadsPanel
              downloads={snapshot.downloads.filter((item) => Boolean(item.isPrivate) === isPrivate)}
              isPrivate={isPrivate}
              run={run}
              currentTabUrl={currentTab?.url}
              currentTabTitle={currentTab?.title}
              canDownloadVideo={canDownloadVideo}
            />
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
      {tabSearchOpen && snapshot && (
        <TabSearch
          snapshot={snapshot}
          onActivate={async (id) => {
            setPanel("home");
            await window.browserApi.activateTab(id);
          }}
          onCloseTab={(id) => window.browserApi.closeTab(id)}
          onDismiss={() => setTabSearchOpen(false)}
          onError={showError}
        />
      )}
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
  tabSearchOpen,
  onToggleSearch,
  onActivate,
  onClose,
  onCreate,
}: {
  snapshot: BrowserSnapshot;
  tabSearchOpen?: boolean;
  onToggleSearch?: () => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const hasOverflow = overflow.left || overflow.right;
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const tabs = snapshot.tabs
    .filter((tab) => tab.workspaceId === active?.workspaceId)
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
  const unpinnedCount = tabs.filter((t) => !t.isPinned).length;
  const dynamicTabWidth = unpinnedCount <= 10 ? 212 : Math.max(38, Math.round(212 - (unpinnedCount - 10) * 7.5));
  const dynamicActiveTabWidth = unpinnedCount <= 10 ? 240 : Math.max(48, Math.round(240 - (unpinnedCount - 10) * 8.5));
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
      setOverflow((prev) => {
        const nextLeft = prev.left ? list.scrollLeft > 4 : list.scrollLeft > 14;
        const remainingRight = maxScroll - list.scrollLeft;
        const nextRight = prev.right ? remainingRight > 4 : remainingRight > 14;
        if (prev.left === nextLeft && prev.right === nextRight) return prev;
        return { left: nextLeft, right: nextRight };
      });
    };
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
        style={{
          "--tab-dynamic-width": `${dynamicTabWidth}px`,
          "--tab-active-width": `${dynamicActiveTabWidth}px`,
        } as React.CSSProperties}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            data-private={tab.isPrivate ? "true" : undefined}
            draggable={!tab.isPinned}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", tab.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggingId(tab.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (dragOverId !== tab.id) setDragOverId(tab.id);
            }}
            onDragLeave={() => {
              if (dragOverId === tab.id) setDragOverId(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
              setDraggingId(null);
              setDragOverId(null);
              if (sourceId && sourceId !== tab.id) {
                void window.browserApi.reorderTab(sourceId, tab.id).catch(console.error);
              }
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
            }}
            onContextMenu={(event) => { event.preventDefault(); void window.browserApi.showTabMenu(tab.id).catch(console.error); }}
            className={`tab-container ${tab.id === snapshot.activeTabId ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""} ${tab.isPinned ? "pinned-tab" : ""} ${tab.lifecycle === "hibernated" ? "sleeping-tab" : ""} ${draggingId === tab.id ? "dragging-tab" : ""} ${dragOverId === tab.id && draggingId !== tab.id ? "drag-over-tab" : ""}`}
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
                  <span className="tab-private-badge">
                    <VenetianMask size={14} />
                  </span>
                ) : tab.isInternal ? (
                  <img src={chloeIcon} alt="" className="tab-internal-icon" />
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <Globe2 size={15} />
                )}
              </span>
              <span className="tab-title">{tab.title || "Новая вкладка"}</span>
              {tab.isPinned && <Pin size={12} className="tab-state-icon" />}
              {(tab.isAudible || tab.isMuted) && (
                <button
                  type="button"
                  className={`tab-audio-button ${tab.isMuted ? "muted" : "audible"}`}
                  title={tab.isMuted ? "Включить звук на вкладке" : "Отключить звук на вкладке"}
                  aria-label={tab.isMuted ? "Включить звук" : "Отключить звук"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void window.browserApi.tabAction(tab.id, "mute").catch(console.error);
                  }}
                >
                  {tab.isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
              )}
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
      <div className="tab-strip-end-actions">
        <button
          className="new-tab-button"
          title="Новая вкладка · Ctrl+T"
          aria-label="Новая вкладка"
          onClick={onCreate}
        >
          <Plus size={19} />
        </button>
        {onToggleSearch && (
          <button
            className={`tab-search-trigger icon-button ${tabSearchOpen ? "selected" : ""}`}
            data-tab-search-trigger
            aria-label="Поиск по вкладкам"
            title="Поиск по вкладкам · Ctrl+Shift+A"
            onClick={onToggleSearch}
          >
            <Search size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  isDownloading,
  downloadProgress,
  hasVideoBadge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  isDownloading?: boolean;
  downloadProgress?: number;
  hasVideoBadge?: boolean;
}): React.JSX.Element {
  return (
    <button
      className={`nav-item ${active ? "active" : ""} ${isDownloading ? "is-downloading" : ""}`}
      title={collapsed ? (isDownloading && downloadProgress ? `${label} (${downloadProgress}%)` : label) : undefined}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="nav-icon" style={{ position: "relative" }}>
        {icon}
        {hasVideoBadge && (
          <span className="nav-video-badge" title="Видео готово к скачиванию">
            <CheckCircle2 size={11} strokeWidth={2.8} />
          </span>
        )}
      </span>
      {!collapsed && <span>{label}</span>}
      {!collapsed && isDownloading && (
        <span className="sidebar-dl-badge">
          {downloadProgress && downloadProgress > 0 ? `${downloadProgress}%` : "↓"}
        </span>
      )}
      {isDownloading && (
        <div className="sidebar-dl-bar">
          <div
            className="sidebar-dl-fill"
            style={{ width: `${Math.max(8, downloadProgress ?? 20)}%` }}
          />
        </div>
      )}
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
      {background !== "plain" && (
        <div className="newtab-wallpaper" data-newtab-wallpaper aria-hidden="true">
          <img
            src={
              customWallpaper ??
              (background === "cyber-butterfly" || (background === "portrait" && snapshot.settings.appearancePreset === "cyber-butterfly")
                ? cyberButterflyWallpaper
                : background === "tokyo-night" || (background === "portrait" && snapshot.settings.appearancePreset === "tokyo-night")
                  ? tokyoNightWallpaper
                  : background === "celestial-palace" || (background === "portrait" && snapshot.settings.appearancePreset === "celestial-palace")
                    ? celestialPalaceWallpaper
                    : background === "cyberpink" || (background === "portrait" && snapshot.settings.appearancePreset === "cyberpink")
                      ? cyberpinkWallpaper
                      : background === "cyberpink-fuji" || (background === "portrait" && snapshot.settings.appearancePreset === "cyberpink-fuji")
                        ? cyberpinkFujiWallpaper
                        : chloeWallpaper)
            }
            alt=""
            decoding="async"
            draggable={false}
          />
        </div>
      )}
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
            {quickLinks.map((link) => (
              <button
                key={link.label}
                title={link.url}
                onClick={() => onOpen(link.url)}
              >
                <span className="quick-link-symbol">
                  <SiteFavicon url={link.url} size={20} />
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
                        <SiteFavicon url={bookmark.url} favicon={bookmark.favicon} size={18} />
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
                      <span className="recent-page-icon">
                        <SiteFavicon url={entry.url} favicon={(entry as any).favicon} size={16} />
                      </span>
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
        <span>soulm8te Browser</span>
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
  currentTabUrl,
  currentTabTitle,
  canDownloadVideo,
}: {
  downloads: DownloadEntry[];
  isPrivate: boolean;
  run: (promise: Promise<unknown>) => void;
  currentTabUrl?: string;
  currentTabTitle?: string;
  canDownloadVideo?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const visible = downloads.filter((item) =>
    `${item.filename} ${item.url}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const hasFinished = downloads.some(
    (item) => !item.isLive && !["queued", "progressing"].includes(item.state),
  );
  return (
    <section className="utility-panel">
      <PanelHeader
        icon={<Download size={22} />}
        title="Загрузки"
        subtitle="Сохранённые файлы и текущие загрузки"
      />
      {canDownloadVideo && currentTabUrl && (
        <div className="download-media-banner">
          <div className="download-media-banner-info">
            <CheckCircle2 size={22} className="media-ready-icon" />
            <div>
              <strong>Доступно видео для скачивания</strong>
              <p>{currentTabTitle || currentTabUrl}</p>
            </div>
          </div>
          <div className="download-media-banner-actions">
            <button
              className="google-btn-primary"
              style={{ width: "auto", padding: "0 14px", height: "32px", fontSize: "12px" }}
              onClick={() => {
                void window.browserApi.downloadMediaUrl(currentTabUrl, undefined, false);
              }}
            >
              <Download size={14} />
              Скачать MP4
            </button>
            <button
              className="google-btn-secondary"
              style={{ width: "auto", padding: "0 12px", height: "32px", fontSize: "12px" }}
              onClick={() => {
                void window.browserApi.downloadMediaUrl(currentTabUrl, undefined, true);
              }}
            >
              <Music2 size={14} />
              Аудио MP3
            </button>
          </div>
        </div>
      )}
      <div className="manager-filters">
        <label className="panel-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти файл"
            aria-label="Поиск в загрузках"
          />
          <span>{visible.length}</span>
        </label>
        <button
          className="plain-button"
          disabled={!hasFinished}
          title="Удаляет завершённые записи из списка; файлы остаются на диске"
          onClick={() => run(window.browserApi.clearFinishedDownloads(isPrivate))}
        >
          <Trash2 size={16} />
          Очистить список
        </button>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Download size={28} />}
          title={query.trim() ? "Ничего не найдено" : "Загрузок пока нет"}
          description={
            query.trim()
              ? "Попробуйте другое название или адрес файла."
              : "Сохранённые файлы и их состояние появятся здесь."
          }
        />
      ) : (
        <div className="download-list">
          {visible.map((download) => {
            const active =
              download.isLive ||
              download.state === "queued" ||
              download.state === "progressing";
            const resumable =
              download.isPaused ||
              (download.state === "interrupted" && download.canResume);
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
                      {download.state === "completed"
                        ? formatBytes(
                            Math.max(
                              download.totalBytes || 0,
                              download.receivedBytes || 0,
                            ),
                          )
                        : download.totalBytes > 0
                          ? `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`
                          : formatBytes(download.receivedBytes)}
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
                      <button
                        className="icon-button danger-hover"
                        aria-label="Удалить загрузку"
                        title="Удалить"
                        onClick={() =>
                          run(window.browserApi.deleteDownload(download.id, false))
                        }
                      >
                        <Trash2 size={17} />
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
                      <button
                        className="icon-button danger-hover"
                        aria-label="Удалить запись"
                        title="Удалить из списка"
                        onClick={() =>
                          run(window.browserApi.deleteDownload(download.id, false))
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </>
                  )}
                  {!active && download.state !== "completed" && (
                    <button
                      className="icon-button danger-hover"
                      aria-label="Удалить запись"
                      title="Удалить из списка"
                      onClick={() =>
                        run(window.browserApi.deleteDownload(download.id, false))
                      }
                    >
                      <Trash2 size={17} />
                    </button>
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
        во время чтения. Существующие записи soulm8te сохраняются.
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
            После переноса удалите ненужный CSV из места экспорта. soulm8te
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
  const [installedExtensions, setInstalledExtensions] = useState<Array<{ id: string; name: string; version: string; directory: string }>>([]);
  const [extensionError, setExtensionError] = useState("");
  const refreshExtensions = useCallback(async () => {
    setInstalledExtensions(await window.browserApi.listLocalExtensions());
  }, []);
  useEffect(() => { void refreshExtensions().catch(() => undefined); }, [refreshExtensions]);
  const installExtension = async () => {
    try {
      setExtensionError("");
      await window.browserApi.installLocalExtension();
      await refreshExtensions();
    } catch (error) { setExtensionError(userFacingError(error)); }
  };
  const removeExtension = async (id: string) => {
    try {
      await window.browserApi.removeLocalExtension(id);
      await refreshExtensions();
    } catch (error) { setExtensionError(userFacingError(error)); }
  };
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
              <small>Локальное изображение или однотонный фон. Тема браузера автоматически подстраивается под цвета обоев.</small>
            </span>
            <select
              aria-label="Фон новой вкладки"
              value={settings.newTabBackground}
              onChange={event => {
                const bg = normalizeNewTabBackground(event.target.value);
                if (bg === "cyber-butterfly") {
                  update({ newTabBackground: bg, appearancePreset: "cyber-butterfly", accentColor: "violet" });
                } else if (bg === "tokyo-night") {
                  update({ newTabBackground: bg, appearancePreset: "tokyo-night", accentColor: "blue" });
                } else if (bg === "celestial-palace") {
                  update({ newTabBackground: bg, appearancePreset: "celestial-palace", accentColor: "teal" });
                } else if (bg === "cyberpink") {
                  update({ newTabBackground: bg, appearancePreset: "cyberpink", accentColor: "pink" });
                } else if (bg === "cyberpink-fuji") {
                  update({ newTabBackground: bg, appearancePreset: "cyberpink-fuji", accentColor: "violet" });
                } else if (bg === "portrait") {
                  update({ newTabBackground: bg, appearancePreset: "detroit", accentColor: "blue" });
                } else {
                  update({ newTabBackground: bg, appearancePreset: "classic" });
                }
              }}
            >
              <option value="portrait">Фирменный портрет / Detroit</option>
              <option value="cyber-butterfly">Кибер-бабочки (Неон)</option>
              <option value="tokyo-night">Ночной Токио (Cyber Blue)</option>
              <option value="celestial-palace">Белый дворец (Небесный бирюзовый)</option>
              <option value="cyberpink">Cyberpunk · Терминал</option>
              <option value="cyberpink-fuji">Cyberpunk · Фудзи</option>
              <option value="plain">Однотонный</option>
            </select>
          </label>
          <div className="setting-row">
            <span>
              <strong>Установленная версия</strong>
              <small>Если здесь нет новых настроек, запущена старая сборка. После обновления GitHub приложение нужно пересобрать и переустановить.</small>
            </span>
            <strong>soulm8te 0.5.0</strong>
          </div>
          <label className="setting-row">
            <span><strong>Стиль оформления</strong><small>Отдельный стиль Detroit · Хлоя или Cyberpunk. Исходные темы не изменяются.</small></span>
            <select
              aria-label="Стиль оформления"
              value={settings.appearancePreset ?? "classic"}
              onChange={event => {
                const val = event.target.value as "classic" | "detroit" | "cyberpink" | "cyberpink-fuji" | "cyber-butterfly" | "tokyo-night" | "celestial-palace";
                if (val === "cyber-butterfly") {
                  update({ appearancePreset: "cyber-butterfly", accentColor: "violet", newTabBackground: "cyber-butterfly" });
                } else if (val === "tokyo-night") {
                  update({ appearancePreset: "tokyo-night", accentColor: "blue", newTabBackground: "tokyo-night" });
                } else if (val === "celestial-palace") {
                  update({ appearancePreset: "celestial-palace", accentColor: "teal", newTabBackground: "celestial-palace" });
                } else if (val === "cyberpink") {
                  update({ appearancePreset: "cyberpink", accentColor: "pink", newTabBackground: "cyberpink" });
                } else if (val === "cyberpink-fuji") {
                  update({ appearancePreset: "cyberpink-fuji", accentColor: "violet", newTabBackground: "cyberpink-fuji" });
                } else if (val === "detroit") {
                  update({ appearancePreset: "detroit", accentColor: "blue", newTabBackground: "portrait" });
                } else {
                  update({ appearancePreset: "classic", newTabBackground: "plain" });
                }
              }}
            >
              <option value="classic">Классический soulm8te</option>
              <option value="detroit">Detroit · Хлоя</option>
              <option value="cyber-butterfly">Кибер-бабочки</option>
              <option value="tokyo-night">Ночной Токио</option>
              <option value="celestial-palace">Белый дворец</option>
              <option value="cyberpink">Cyberpunk · Неон</option>
              <option value="cyberpink-fuji">Cyberpunk · Фудзи</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>Акцентный цвет</strong><small>Отдельная персонализация; светлая и тёмная темы остаются прежними.</small></span>
            <select aria-label="Акцентный цвет" value={settings.accentColor ?? "blue"} onChange={event => update({ accentColor: event.target.value as "blue" | "teal" | "violet" | "rose" | "pink" })}>
              <option value="blue">Классический синий</option>
              <option value="teal">Бирюзовый</option>
              <option value="violet">Фиолетовый</option>
              <option value="rose">Розовый</option>
              <option value="pink">Розовый / Неон</option>
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
          <div className="setting-row custom-wallpaper-setting">
            <span>
              <strong>Локальные расширения</strong>
              <small>Поддерживаются только совместимые распакованные расширения. Не устанавливайте непроверенный код.</small>
            </span>
            <button className="plain-button" onClick={() => void installExtension()}>Установить из папки</button>
            {installedExtensions.length > 0 && <div className="extension-list">{installedExtensions.map(item =>
              <div key={item.id} className="extension-entry">
                <span>{item.name} · {item.version}</span>
                <button type="button" className="plain-button" onClick={() => void removeExtension(item.id)}>Удалить</button>
              </div>
            )}</div>}
            {extensionError && <small role="alert">{extensionError}</small>}
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
          <div className="about-icon-wrapper">
            <img className="about-brand-icon" src={chloeIcon} alt="soulm8te" />
            <span className="about-led-indicator" title="Detroit Android LED status: active" />
          </div>
          <div>
            <strong>soulm8te Browser</strong>
            <p>Ваш цифровой союзник · Detroit: Become Human</p>
            <small>Интерфейс по soulm8te Brand Guidelines 1.0 · Версия 0.5.0</small>
          </div>
        </div>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
