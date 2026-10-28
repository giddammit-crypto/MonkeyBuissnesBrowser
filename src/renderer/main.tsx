import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
  Bookmark,
  BookOpen,
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
  PictureInPicture2,
  Pin,
  Play,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Trash2,
  Upload,
  User,
  LogIn,
  LogOut,
  VenetianMask,
  Volume2,
  VolumeX,
  X,
  Zap,
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
  PrivacyDashboardSnapshot,
  SavePasswordOffer,
  ImportedPasswordSummary,
} from "../shared/types";
import { getGoogleAuthNotice, getSiteKey, normalizePermissionOrigin, normalizeSiteKey } from "../shared/sitePolicy";
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
import "./privacy-dashboard.css";
import "./task-manager.css";
import { userFacingError } from "./userFacingError";
import BrowsecModal from "./BrowsecModal";
import GoogleAccountPopover from "./GoogleAccountPopover";
import DownloadsPopover from "./DownloadsPopover";
import TabSearch from "./TabSearch";
import SiteFavicon from "./SiteFavicon";
import SiteErrorPage from "./SiteErrorPage";
import PrivacyDashboard from "./PrivacyDashboard";
import TaskManagerModal from "./TaskManagerModal";
import ClickAndCleanModal from "./ClickAndCleanModal";
import SavePasswordPrompt from "./SavePasswordPrompt";
import { QrCodePopover } from "./QrCodePopover";
import { ReaderView } from "./ReaderView";
import { QuickNotesDrawer } from "./QuickNotesDrawer";
import VoodooChatBubble from "./VoodooChatBubble";
import voodooAvatar from "./assets/voodoo-256.png";
const EntriesPanel = React.lazy(()=>import("./EntriesManager"));
const PasswordManager = React.lazy(()=>import("./PasswordManager"));

type Panel = "home" | "bookmarks" | "history" | "downloads" | "privacy" | "settings";
type Toast = { tone: "error" | "success" | "info"; message: string };
// User wallpapers are kept in the trusted shell's IndexedDB. Never load
// remote/CSS URLs, SVG or arbitrary files into the privileged browser shell.
const CUSTOM_WALLPAPER_KEY = "soul-m8te-custom-wallpaper-v1";
const CUSTOM_WALLPAPER_EVENT = "soul-m8te-wallpaper-changed";
const CUSTOM_WALLPAPER_DB = "soulm8te-custom-wallpaper-v2";
const CUSTOM_WALLPAPER_STORE = "wallpaper";
const CUSTOM_WALLPAPER_RECORD = "current";
const MAX_CUSTOM_WALLPAPER_BYTES = 20 * 1024 * 1024;
type CustomWallpaperSource = Blob | string;

function readLegacyCustomWallpaper(): string | null {
  try {
    const value = localStorage.getItem(CUSTOM_WALLPAPER_KEY);
    return value && value.length <= 3_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
  } catch { return null; }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть хранилище обоев."));
  });
}

function openWallpaperDatabase(): Promise<IDBDatabase> {
  if (!window.indexedDB) throw new Error("Хранилище обоев недоступно в этом профиле.");
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(CUSTOM_WALLPAPER_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CUSTOM_WALLPAPER_STORE)) {
        request.result.createObjectStore(CUSTOM_WALLPAPER_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть хранилище обоев."));
  });
}

async function readStoredWallpaper(): Promise<Blob | null> {
  try {
    const database = await openWallpaperDatabase();
    try {
      const value = await idbRequest(database.transaction(CUSTOM_WALLPAPER_STORE, "readonly").objectStore(CUSTOM_WALLPAPER_STORE).get(CUSTOM_WALLPAPER_RECORD));
      return value instanceof Blob && value.size > 0 && value.size <= MAX_CUSTOM_WALLPAPER_BYTES ? value : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

async function writeStoredWallpaper(value: Blob | null): Promise<void> {
  const database = await openWallpaperDatabase();
  try {
    const transaction = database.transaction(CUSTOM_WALLPAPER_STORE, "readwrite");
    const store = transaction.objectStore(CUSTOM_WALLPAPER_STORE);
    if (value) store.put(value, CUSTOM_WALLPAPER_RECORD);
    else store.delete(CUSTOM_WALLPAPER_RECORD);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось сохранить обои."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Не удалось сохранить обои."));
    });
  } finally {
    database.close();
  }
}

async function sourceToWallpaperBlob(source: CustomWallpaperSource): Promise<Blob> {
  if (source instanceof Blob) return source;
  if (!source.startsWith("blob:") && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(source)) {
    throw new Error("Недопустимые данные обоев.");
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error("Не удалось прочитать обои.");
  return response.blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать обои."));
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать обои."));
    reader.readAsDataURL(blob);
  });
}

async function loadCustomWallpaper(): Promise<Blob | null> {
  const stored = await readStoredWallpaper();
  if (stored) return stored;
  const legacy = readLegacyCustomWallpaper();
  if (!legacy) return null;
  try {
    const migrated = await sourceToWallpaperBlob(legacy);
    if (migrated.size <= MAX_CUSTOM_WALLPAPER_BYTES) {
      await writeStoredWallpaper(migrated);
      localStorage.removeItem(CUSTOM_WALLPAPER_KEY);
      return migrated;
    }
  } catch { /* Ignore an invalid legacy value and fall back to the bundled wallpaper. */ }
  return null;
}

function useCustomWallpaper(): [string | null, (data: CustomWallpaperSource | null) => Promise<void>] {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const apply = async () => {
      const blob = await loadCustomWallpaper();
      if (disposed) return;
      const dataUrl = blob ? await blobToDataUrl(blob) : null;
      if (disposed) return;
      setImage(dataUrl);
    };
    const changed = () => { void apply(); };
    void apply();
    window.addEventListener(CUSTOM_WALLPAPER_EVENT, changed);
    return () => {
      disposed = true;
      window.removeEventListener(CUSTOM_WALLPAPER_EVENT, changed);
    };
  }, []);
  const save = async (value: CustomWallpaperSource | null) => {
    if (value === null) {
      await writeStoredWallpaper(null);
      localStorage.removeItem(CUSTOM_WALLPAPER_KEY);
    } else {
      const blob = await sourceToWallpaperBlob(value);
      if (!blob.size || blob.size > MAX_CUSTOM_WALLPAPER_BYTES) throw new Error("Изображение должно быть не больше 20 МБ.");
      await writeStoredWallpaper(blob);
      localStorage.removeItem(CUSTOM_WALLPAPER_KEY);
    }
    window.dispatchEvent(new Event(CUSTOM_WALLPAPER_EVENT));
  };
  return [image, save];
}

function imageTypeForFile(file: globalThis.File): string | null {
  const type = file.type.toLowerCase();
  if (["image/png", "image/jpeg", "image/webp"].includes(type)) return type;
  const extension = file.name.toLowerCase().split(".").pop();
  return extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : null;
}

async function imageAsWallpaper(file: globalThis.File): Promise<Blob> {
  const imageType = imageTypeForFile(file);
  if (!imageType)
    throw new Error("Поддерживаются только PNG, JPEG и WebP.");
  if (!file.size || file.size > MAX_CUSTOM_WALLPAPER_BYTES)
    throw new Error("Изображение должно быть не больше 20 МБ.");
  const sourceFile = file.type === imageType ? file : new globalThis.File([file], file.name, { type: imageType, lastModified: file.lastModified });
  let source: CanvasImageSource;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let releaseSource: () => void = () => {};
  try {
    try {
      const bitmap = await createImageBitmap(sourceFile);
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      releaseSource = () => bitmap.close();
    } catch {
      const blobUrl = URL.createObjectURL(sourceFile);
      const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Не удалось прочитать изображение. Проверьте, что файл не повреждён и имеет формат PNG, JPEG или WebP."));
        image.src = blobUrl;
      });
      source = photo;
      sourceWidth = photo.naturalWidth;
      sourceHeight = photo.naturalHeight;
      releaseSource = () => URL.revokeObjectURL(blobUrl);
    }
    if (!sourceWidth || !sourceHeight || sourceWidth > 12000 || sourceHeight > 12000)
      throw new Error("Неподдерживаемое разрешение изображения.");
    const scale = Math.min(1, 2560 / sourceWidth, 1600 / sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить изображение.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const toBlob = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const quality of [0.92, 0.84, 0.72, 0.58]) {
        const compressed = await toBlob(type, quality);
        if (compressed && compressed.size <= MAX_CUSTOM_WALLPAPER_BYTES) return compressed;
      }
    }
    throw new Error("Не удалось подготовить обои до 20 МБ. Выберите изображение меньшего разрешения.");
  } finally {
    releaseSource();
  }
}

const DEFAULT_STARTER_BOOKMARKS = [
  { id: "starter-yandex", title: "Яндекс", url: "https://ya.ru/" },
  { id: "starter-google", title: "Google", url: "https://www.google.com/" },
  { id: "starter-youtube", title: "YouTube", url: "https://www.youtube.com/" },
  { id: "starter-vk", title: "ВКонтакте", url: "https://vk.com/" },
  { id: "starter-mail", title: "Почта", url: "https://mail.yandex.ru/" },
  { id: "starter-github", title: "GitHub", url: "https://github.com/" },
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
  const [customWallpaper] = useCustomWallpaper();
  const [panel, setPanel] = useState<Panel>("home");
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [popover, setPopover] = useState<"menu" | "protection" | "browsec" | "google-account" | "downloads" | "qrcode" | null>(null);
  const [notesDrawerOpen, setNotesDrawerOpen] = useState(false);
  const [browsecCountries, setBrowsecCountries] = useState<BrowsecCountry[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [authNoticeDismissed, setAuthNoticeDismissed] = useState(false);
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [taskManagerOpen, setTaskManagerOpen] = useState(false);
  const [clickCleanOpen, setClickCleanOpen] = useState(false);
  const [voodooOpen, setVoodooOpen] = useState(false);
  const [pendingPasswordOffer, setPendingPasswordOffer] = useState<SavePasswordOffer | null>(null);
  const [siteCredentials, setSiteCredentials] = useState<ImportedPasswordSummary[]>([]);
  const previousTabId = useRef<string | undefined>(undefined);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [privacyDashboard, setPrivacyDashboard] = useState<PrivacyDashboardSnapshot | null>(null);
  const [privacyDashboardLoading, setPrivacyDashboardLoading] = useState(false);
  const [privacyDashboardError, setPrivacyDashboardError] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const originalAddressRef = useRef<string>("");
  const suggestionsListRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [optimisticTabId, setOptimisticTabId] = useState<string | null>(null);
  useEffect(() => {
    // An older activation response must not cancel a newer tab selection.
    if (optimisticTabId && (snapshot?.activeTabId === optimisticTabId ||
      !snapshot?.tabs.some((tab) => tab.id === optimisticTabId))) {
      setOptimisticTabId(null);
    }
  }, [snapshot?.activeTabId, snapshot?.tabs, optimisticTabId]);
  const effectiveSnapshot = useMemo(() => {
    if (!snapshot || !optimisticTabId) return snapshot;
    return { ...snapshot, activeTabId: optimisticTabId };
  }, [snapshot, optimisticTabId]);
  const currentTab = (optimisticTabId ? snapshot?.tabs.find((t) => t.id === optimisticTabId) : null) ?? snapshot?.tabs.find(
    (tab) => tab.id === snapshot.activeTabId,
  );
  const canDownloadVideo = Boolean(currentTab?.canDownloadMedia);
  const hasActiveDownloads = Boolean(
    snapshot?.downloads?.some(
      (d) => d.state === "progressing" || d.state === "queued" || d.isPaused,
    ),
  );
  const authNotice = getGoogleAuthNotice(currentTab?.url ?? "");
  useEffect(() => setAuthNoticeDismissed(false), [currentTab?.id, currentTab?.url]);
  const currentSite = getSiteKey(currentTab?.url ?? "");
  const currentOrigin = normalizePermissionOrigin(currentTab?.url ?? "");
  const currentDomain = normalizeSiteKey(currentTab?.url ?? "");
  const currentNotificationPermission = currentOrigin
    ? snapshot?.notificationPermissions?.find((entry) => entry.origin === currentOrigin)?.decision
    : undefined;
  const isAdBlockDisabledOnCurrentSite = Boolean(
    currentDomain &&
      snapshot?.settings.adBlockExceptions?.some((exc) => normalizeSiteKey(exc) === currentDomain)
  );
  const sidebarCollapsed = snapshot?.settings.sidebarCollapsed ?? false;
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [omniboxQuery, setOmniboxQuery] = useState("");
  const omniboxSuggestions = useMemo(() => {
    if (!editingAddress || !omniboxQuery.trim()) return [];
    return getOmniboxSuggestions(omniboxQuery, {
      history: snapshot?.history,
      bookmarks: snapshot?.bookmarks,
      searchEngineUrl: snapshot?.settings?.searchEngine,
      maxResults: 7,
    });
  }, [editingAddress, omniboxQuery, snapshot?.history, snapshot?.bookmarks, snapshot?.settings?.searchEngine]);

  useEffect(() => {
    if (selectedSuggestionIndex >= 0 && suggestionsListRef.current) {
      const el = suggestionsListRef.current.children[selectedSuggestionIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedSuggestionIndex]);

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
  const refreshPrivacyDashboard = useCallback(async () => {
    setPrivacyDashboardLoading(true);
    setPrivacyDashboardError("");
    try {
      const next = await window.browserApi.getPrivacyDashboard(currentTab?.id);
      setPrivacyDashboard(next);
    } catch (error) {
      setPrivacyDashboardError(userFacingError(error));
    } finally {
      setPrivacyDashboardLoading(false);
    }
  }, [currentTab?.id]);

  useEffect(() => {
    if (panel !== "privacy") return;
    void refreshPrivacyDashboard();
  }, [panel, refreshPrivacyDashboard]);

  const openPanel = useCallback((next: Panel) => {
    setPanel((current) => (current === next && next !== "home" ? "home" : next));
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
      if (event.type === "toggle-task-manager") {
        setTaskManagerOpen((prev) => !prev);
        setPopover(null);
        return;
      }
      if (event.type === "password-save-prompt" && event.data) {
        setPendingPasswordOffer(event.data as SavePasswordOffer);
        return;
      }
      if (event.type === "passwords-changed" && currentTab?.url) {
        try {
          const u = new URL(currentTab.url);
          window.browserApi.getSavedCredentialsForOrigin(u.origin)
            .then((creds) => setSiteCredentials(creds || []))
            .catch(() => setSiteCredentials([]));
        } catch {}
        return;
      }
      if (event.type === "toggle-click-and-clean") {
        setClickCleanOpen((prev) => !prev);
        setPopover(null);
        return;
      }
      if (event.type === "voodoo-set-open") {
        setVoodooOpen(event.message === "true");
        return;
      }
      if (event.type === "voodoo-analyze-text") {
        setVoodooOpen(true);
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
    });
    return remove;
  }, [openPanel]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!editingAddress) {
      const url = currentTab?.isInternal ? "" : (currentTab?.url ?? "");
      setAddress(url);
      originalAddressRef.current = url;
    }
  }, [currentTab?.id, currentTab?.url, currentTab?.isInternal, editingAddress]);
  useEffect(() => {
    if (!currentTab || currentTab.isPrivate || currentTab.isInternal || !currentTab.url) {
      setSiteCredentials([]);
      return;
    }
    try {
      const u = new URL(currentTab.url);
      if (u.protocol === "https:" || u.protocol === "http:") {
        window.browserApi.getSavedCredentialsForOrigin(u.origin)
          .then((creds) => setSiteCredentials(creds || []))
          .catch(() => setSiteCredentials([]));
      } else {
        setSiteCredentials([]);
      }
    } catch {
      setSiteCredentials([]);
    }
  }, [currentTab?.id, currentTab?.url, currentTab?.isPrivate, currentTab?.isInternal]);
  useEffect(() => {
    const previous = previousTabId.current;
    if (previous && previous !== currentTab?.id) run(window.browserApi.stopFindInPage(previous));
    previousTabId.current = currentTab?.id;
    setEditingAddress(false);
    const url = currentTab?.isInternal ? "" : (currentTab?.url ?? "");
    setAddress(url);
    originalAddressRef.current = url;
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
    let frame = 0;
    let previousBounds = "";
    const drawer = notesDrawerOpen ? document.querySelector<HTMLElement>(".notes-drawer") : null;
    const update = () => {
      frame = 0;
      const b = viewport.getBoundingClientRect();
      const hidden = panel !== "home";
      // The notes drawer is capped to the viewport on narrow windows. Never
      // leave a native page underneath its controls or invent a minimum width.
      const drawerWidth = drawer?.getBoundingClientRect().width ?? 0;
      const effectiveWidth = Math.max(0, b.width - drawerWidth);
      const boundsKey = `${hidden}:${b.left}:${b.top}:${effectiveWidth}:${b.height}`;
      if (boundsKey === previousBounds) return;
      previousBounds = boundsKey;
      run(
        window.browserApi.setChromeBounds(
          hidden
            ? { x: 0, y: 0, width: 0, height: 0 }
            : {
                x: b.left,
                y: b.top,
                width: effectiveWidth,
                height: b.height,
              },
        ),
      );
    };
    update();
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(viewport);
    if (drawer) observer.observe(drawer);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    panel,
    notesDrawerOpen,
    currentTab?.id,
    currentTab?.isInternal,
    currentTab?.url,
    currentTab?.lifecycle,
    snapshot?.activeTabId,
  ]);
  const isPopoverOpen = Boolean(popover) || tabSearchOpen || editingAddress || taskManagerOpen || notesDrawerOpen;
  const hasActiveWebPage = panel === "home" && Boolean(currentTab && !currentTab.isInternal && currentTab.lifecycle !== "crashed");
  useEffect(() => {
    void window.browserApi.setPopoverOpen(isPopoverOpen || panel !== "home");
  }, [isPopoverOpen, panel]);
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

      // Shift + Escape: Task Manager
      if (event.shiftKey && (event.key === "Escape" || key === "escape")) {
        event.preventDefault();
        setTaskManagerOpen((prev) => !prev);
        return;
      }

      if (event.key === "Escape") {
        if (clickCleanOpen) {
          setClickCleanOpen(false);
          return;
        }
        if (taskManagerOpen) {
          setTaskManagerOpen(false);
          return;
        }
        if (tabSearchOpen) return;
        setPopover(null);
        setToast(null);
        if (findOpen && currentTab) {
          setFindOpen(false);
          run(window.browserApi.stopFindInPage(currentTab.id));
        } else if (panel !== "home") {
          setPanel("home");
        } else if (snapshot?.isFullScreen) {
          run(window.browserApi.toggleFullScreen());
        }
        return;
      }

      // Fullscreen: F11
      if (key === "f11") {
        event.preventDefault();
        run(window.browserApi.toggleFullScreen());
        return;
      }

      // DevTools: F12 or Ctrl+Shift+I
      if (key === "f12" || (modifier && event.shiftKey && key === "i")) {
        event.preventDefault();
        run(window.browserApi.toggleDevTools());
        return;
      }

      // Ctrl+Tab and Ctrl+Shift+Tab: switch tabs cyclically within current workspace
      if (modifier && key === "tab") {
        event.preventDefault();
        if (snapshot) {
          const visible = snapshot.tabs
            .filter((entry) => entry.workspaceId === (currentTab?.workspaceId ?? "personal") && entry.isPrivate === isPrivate)
            .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
          if (visible.length > 1) {
            const currentIdx = visible.findIndex((t) => t.id === currentTab?.id);
            const delta = event.shiftKey ? -1 : 1;
            const nextIdx = (currentIdx + delta + visible.length) % visible.length;
            const nextTab = visible[nextIdx];
            if (nextTab) {
              setOptimisticTabId(nextTab.id);
              run(window.browserApi.activateTab(nextTab.id).catch((error) => {
                setOptimisticTabId((pending) => pending === nextTab.id ? null : pending);
                throw error;
              }));
            }
          }
        }
        return;
      }

      // Hard reload: Ctrl+Shift+R / Ctrl+F5 / Shift+F5
      const isHardReload =
        (modifier && event.shiftKey && key === "r") ||
        (modifier && key === "f5") ||
        (event.shiftKey && key === "f5");

      if (isHardReload) {
        event.preventDefault();
        if (currentTab) run(window.browserApi.reload(currentTab.id, true));
        return;
      }

      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement;

      // Google Chrome keyboard shortcuts
      if (modifier && event.shiftKey && (key === "delete" || key === "del" || key === "backspace")) {
        event.preventDefault();
        setClickCleanOpen((val) => !val);
        setPopover(null);
        return;
      } else if (modifier && event.shiftKey && key === "v") {
        event.preventDefault();
        const next = !voodooOpen;
        setVoodooOpen(next);
        void window.browserApi.setVoodooOpen(next);
        return;
      } else if (modifier && event.shiftKey && (key === "n" || key === "p")) {
        event.preventDefault();
        createTab(true);
      } else if (modifier && !event.shiftKey && key === "p") {
        event.preventDefault();
        action("print");
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
      } else if (modifier && event.altKey && key === "r") {
        event.preventDefault();
        if (currentTab && !currentTab.isInternal) {
          run(window.browserApi.toggleReaderMode(currentTab.id));
        }
      } else if (modifier && event.altKey && key === "n") {
        event.preventDefault();
        setNotesDrawerOpen((val) => !val);
      } else if ((modifier && !event.altKey && key === "r") || key === "f5") {
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
  }, [currentTab, findOpen, panel, tabSearchOpen, taskManagerOpen, clickCleanOpen, voodooOpen, isPrivate, snapshot, run, openPanel, action]);

  // Google Chrome Ctrl + Wheel zoom support on shell / viewport
  useEffect(() => {
    const onWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (currentTab) {
          // deltaY < 0: away from user (от себя) -> zoom-in
          // deltaY > 0: towards user (на себя) -> zoom-out
          action(e.deltaY < 0 ? "zoom-in" : "zoom-out");
        }
      }
    };
    window.addEventListener("wheel", onWheelZoom, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheelZoom, { capture: true });
  }, [currentTab, action]);

  if (!snapshot)
    return (
      <div className="boot-screen">
        <img src={symbol} alt="" />
        <span>Запуск soulm8te…</span>
      </div>
    );

  const wallpaperBackground = normalizeNewTabBackground(snapshot?.settings.newTabBackground);
  const appearancePreset = snapshot?.settings.appearancePreset ?? "classic";
  const wallpaperSrc = customWallpaper ?? (
    wallpaperBackground === "cyber-butterfly" || (wallpaperBackground === "portrait" && appearancePreset === "cyber-butterfly")
      ? cyberButterflyWallpaper
      : wallpaperBackground === "tokyo-night" || (wallpaperBackground === "portrait" && appearancePreset === "tokyo-night")
        ? tokyoNightWallpaper
        : wallpaperBackground === "celestial-palace" || (wallpaperBackground === "portrait" && appearancePreset === "celestial-palace")
          ? celestialPalaceWallpaper
          : wallpaperBackground === "cyberpink" || (wallpaperBackground === "portrait" && appearancePreset === "cyberpink")
            ? cyberpinkWallpaper
            : wallpaperBackground === "cyberpink-fuji" || (wallpaperBackground === "portrait" && appearancePreset === "cyberpink-fuji")
              ? cyberpinkFujiWallpaper
              : chloeWallpaper
  );

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${findOpen ? "find-open" : ""} ${isPrivate ? "private-mode" : ""} ${isPopoverOpen ? "popover-open" : ""} ${isPopoverOpen && hasActiveWebPage ? "popover-with-webpage" : ""} ${snapshot.isFullScreen ? "is-fullscreen" : ""}`}
    >
      {snapshot.isFullScreen && (currentTab?.isInternal || panel !== "home") && (
        <div className="fullscreen-hud" role="status" aria-live="polite">
          <span>Полноэкранный режим · Нажмите F11 или Esc для выхода</span>
          <button
            className="fullscreen-hud-close"
            title="Выйти из полноэкранного режима (Esc / F11)"
            aria-label="Выйти из полноэкранного режима"
            onClick={() => run(window.browserApi.toggleFullScreen())}
          >
            <X size={12} />
          </button>
        </div>
      )}
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
        snapshot={effectiveSnapshot ?? snapshot}
        tabSearchOpen={tabSearchOpen}
        onToggleSearch={() => {
          setTabSearchOpen((open) => !open);
          setPopover(null);
        }}
        onActivate={(id) => {
          setPanel("home");
          setOptimisticTabId(id);
          run(window.browserApi.activateTab(id).catch((error) => {
            setOptimisticTabId((pending) => pending === id ? null : pending);
            throw error;
          }));
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
            if (
              selectedSuggestionIndex >= 0 &&
              selectedSuggestionIndex < omniboxSuggestions.length
            ) {
              const target = omniboxSuggestions[selectedSuggestionIndex];
              navigate(target.url);
            } else {
              navigate(address);
            }
            setEditingAddress(false);
            setSelectedSuggestionIndex(-1);
            addressRef.current?.blur();
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
              const val = event.target.value;
              setAddress(val);
              originalAddressRef.current = val;
              setOmniboxQuery(val);
              setSelectedSuggestionIndex(-1);
            }}
            onFocus={() => {
              setEditingAddress(true);
              originalAddressRef.current = address;
              setOmniboxQuery(address);
              setSelectedSuggestionIndex(-1);
            }}
            onBlur={(event) => {
              const related = event.relatedTarget as HTMLElement | null;
              if (related?.closest(".omnibox")) return;
              setTimeout(() => {
                if (document.activeElement !== addressRef.current) {
                  setEditingAddress(false);
                  setSelectedSuggestionIndex(-1);
                }
              }, 200);
            }}
            onKeyDown={(event) => {
              if (omniboxSuggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  const count = omniboxSuggestions.length;
                  const next =
                    selectedSuggestionIndex < count - 1
                      ? selectedSuggestionIndex + 1
                      : -1;
                  setSelectedSuggestionIndex(next);
                  if (next === -1) {
                    setAddress(originalAddressRef.current);
                  } else {
                    const item = omniboxSuggestions[next];
                    const preview =
                      item.kind === "search" ? originalAddressRef.current : item.url;
                    setAddress(preview);
                  }
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  const count = omniboxSuggestions.length;
                  const next =
                    selectedSuggestionIndex <= -1
                      ? count - 1
                      : selectedSuggestionIndex - 1;
                  setSelectedSuggestionIndex(next);
                  if (next === -1) {
                    setAddress(originalAddressRef.current);
                  } else {
                    const item = omniboxSuggestions[next];
                    const preview =
                      item.kind === "search" ? originalAddressRef.current : item.url;
                    setAddress(preview);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (selectedSuggestionIndex !== -1) {
                    setAddress(originalAddressRef.current);
                    setSelectedSuggestionIndex(-1);
                    return;
                  }
                  setAddress(originalAddressRef.current);
                  setEditingAddress(false);
                  setSelectedSuggestionIndex(-1);
                  addressRef.current?.blur();
                  return;
                }
                if (event.key === "Enter") {
                  if (
                    selectedSuggestionIndex >= 0 &&
                    selectedSuggestionIndex < omniboxSuggestions.length
                  ) {
                    event.preventDefault();
                    const target = omniboxSuggestions[selectedSuggestionIndex];
                    navigate(target.url);
                    setEditingAddress(false);
                    setSelectedSuggestionIndex(-1);
                    addressRef.current?.blur();
                    return;
                  }
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                setAddress(originalAddressRef.current);
                setEditingAddress(false);
                setSelectedSuggestionIndex(-1);
                addressRef.current?.blur();
                return;
              }
            }}
            placeholder="Поиск или адрес страницы"
            aria-label="Адресная строка"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="omnibox-tools" role="group" aria-label="Действия со страницей">
          {siteCredentials.length > 0 && currentTab && !currentTab.isInternal && (
            <button
              type="button"
              className="omnibox-credentials-btn"
              title={`Сохранённые пароли для этого сайта (${siteCredentials.length}). Нажмите для автозаполнения`}
              aria-label="Сохранённые пароли"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (siteCredentials.length === 1) {
                  void window.browserApi.fillSavedPassword(currentTab.id, siteCredentials[0].id)
                    .then((res) => {
                      setToast({
                        tone: res.filled ? "success" : "info",
                        message: res.filled ? `Логин ${siteCredentials[0].username || ""} заполнен` : (res.reason || "Не удалось заполнить форму"),
                      });
                    })
                    .catch(() => {
                      setToast({ tone: "error", message: "Не удалось заполнить пароль" });
                    });
                } else {
                  openPanel("settings");
                }
              }}
            >
              <KeyRound size={13} />
              <span>{siteCredentials.length > 1 ? siteCredentials.length : "Вход"}</span>
            </button>
          )}
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
          {canDownloadVideo && currentTab?.url && !currentTab.isInternal && (
            <div className="omnibox-media-actions">
              <button
                type="button"
                className="omnibox-media-btn mp4"
                title="Скачать видео (MP4) в высоком качестве"
                aria-label="Скачать видео (MP4)"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(window.browserApi.downloadMediaUrl(currentTab.url, currentTab.title, false));
                }}
              >
                <Download size={13} strokeWidth={2.4} />
                <span>MP4</span>
              </button>
              <button
                type="button"
                className="omnibox-media-btn mp3"
                title="Скачать аудиодорожку (MP3)"
                aria-label="Скачать аудио (MP3)"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(window.browserApi.downloadMediaUrl(currentTab.url, currentTab.title, true));
                }}
              >
                <Music2 size={13} strokeWidth={2.4} />
                <span>MP3</span>
              </button>
            </div>
          )}
          {currentTab && !currentTab.isInternal && (
            <div className="omnibox-page-actions">
              {(currentTab.isReaderAvailable || currentTab.isReaderActive) && (
                <button
                  type="button"
                  className={`omnibox-action-btn ${currentTab.isReaderActive ? "active" : ""}`}
                  title={
                    currentTab.isReaderActive
                      ? "Выйти из режима чтения · Ctrl+Alt+R"
                      : "Режим чтения · Ctrl+Alt+R"
                  }
                  aria-label="Режим чтения"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    run(window.browserApi.toggleReaderMode(currentTab.id));
                  }}
                >
                  <BookOpen size={15} />
                </button>
              )}
              {(currentTab.hasVideoMedia || currentTab.isPictureInPicture) && (
                <button
                  type="button"
                  className={`omnibox-action-btn ${currentTab.isPictureInPicture ? "active pip-active" : ""}`}
                  title={
                    currentTab.isPictureInPicture
                      ? "Вернуть видео в страницу"
                      : "Смотреть в отдельном окне (PiP)"
                  }
                  aria-label="Picture-in-Picture"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    run(window.browserApi.togglePictureInPicture(currentTab.id).then((result) => {
                      if (!result.success) throw new Error("Не удалось включить мини-плеер. Дождитесь загрузки видео и повторите попытку.");
                    }));
                  }}
                >
                  <PictureInPicture2 size={15} />
                </button>
              )}
              {currentTab.url && !currentTab.url.startsWith("about:") && (
                <button
                  type="button"
                  className={`omnibox-action-btn ${popover === "qrcode" ? "active" : ""}`}
                  title="QR-код страницы · Перенести на смартфон"
                  aria-label="QR-код страницы"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setPopover((val) => (val === "qrcode" ? null : "qrcode"));
                  }}
                >
                  <QrCode size={15} />
                </button>
              )}
            </div>
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
          </div>
          {editingAddress && omniboxSuggestions.length > 0 && (
            <div
              ref={suggestionsListRef}
              className="omnibox-suggestions-dropdown"
              role="listbox"
            >
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
            className={`icon-button download-header-btn ${popover === "downloads" ? "selected" : ""} ${hasActiveDownloads ? "is-downloading" : ""}`}
            title={
              hasActiveDownloads
                ? "Загрузка в процессе · Кликните для списка"
                : "Загрузки · Кликните для списка"
            }
            aria-label="Загрузки"
            aria-expanded={popover === "downloads"}
            onClick={() =>
              setPopover((val) => (val === "downloads" ? null : "downloads"))
            }
          >
            <Download size={18} />
            {hasActiveDownloads && (
              <span className="download-active-dot" title="Идёт загрузка" />
            )}
          </button>
          <button
            className={`icon-button ${popover === "protection" ? "selected" : ""} ${isAdBlockDisabledOnCurrentSite ? "is-adblock-disabled" : ""}`}
            title={
              isAdBlockDisabledOnCurrentSite
                ? "Приватность и защита · Блокировщик рекламы выключен для этого сайта"
                : "Приватность и защита"
            }
            aria-label="Приватность и защита"
            aria-expanded={popover === "protection"}
            onClick={() =>
              setPopover((value) =>
                value === "protection" ? null : "protection",
              )
            }
          >
            {isAdBlockDisabledOnCurrentSite ? <ShieldOff size={18} /> : <Shield size={18} />}
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
            className={`icon-button ${clickCleanOpen ? "selected" : ""}`}
            title="Click & Clean (Ctrl+Shift+Del) · Очистка кэша, куки и истории"
            aria-label="Click & Clean"
            onClick={() => {
              setPopover(null);
              setClickCleanOpen((val) => !val);
            }}
          >
            <Sparkles size={18} />
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
          {snapshot.settings.voodooEnabled !== false && (
            <button
              className={`icon-button voodoo-toolbar-btn ${voodooOpen ? "selected" : ""}`}
              title="AI-Ассистент Вуду (Ctrl+Shift+V)"
              aria-label="AI-Ассистент Вуду"
              onClick={() => {
                const next = !voodooOpen;
                setVoodooOpen(next);
                void window.browserApi.setVoodooOpen(next);
              }}
            >
              <img src={voodooAvatar} alt="Вуду" className="voodoo-toolbar-avatar" />
            </button>
          )}
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
            <div className="menu-divider" />
            <MenuAction
              icon={<Activity size={16} />}
              label="Диспетчер задач"
              detail="Shift+Esc"
              onClick={() => {
                setTaskManagerOpen(true);
                setPopover(null);
              }}
            />
            <MenuAction
              icon={<Sparkles size={16} />}
              label="AI-Ассистент Вуду"
              detail="Ctrl+Shift+V"
              onClick={() => {
                setVoodooOpen(true);
                void window.browserApi.setVoodooOpen(true);
                setPopover(null);
              }}
            />
            <MenuAction
              icon={<Sparkles size={16} />}
              label="Click & Clean"
              detail="Ctrl+Shift+Del"
              onClick={() => {
                setClickCleanOpen(true);
                setPopover(null);
              }}
            />
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
            {currentDomain && (
              <div className="site-adblock-control">
                <div className="site-control-header">
                  <strong>Блокировщик на этом сайте</strong>
                  <span className={`status-badge ${isAdBlockDisabledOnCurrentSite ? "is-off" : "is-on"}`}>
                    {isAdBlockDisabledOnCurrentSite ? "Выключен" : "Включен"}
                  </span>
                </div>
                <small className="site-key">{currentDomain}</small>
                <label>
                  <span>Блокировать рекламу</span>
                  <input
                    type="checkbox"
                    aria-label={`Блокировать рекламу на ${currentDomain}`}
                    checked={!isAdBlockDisabledOnCurrentSite}
                    disabled={snapshot.settings.adBlockEnabled === false}
                    onChange={(event) => {
                      if (currentTab) {
                        const enableForSite = event.target.checked;
                        run(
                          window.browserApi
                            .setSiteAdBlockEnabled(currentTab.id, enableForSite)
                            .then(() => {
                              setToast({
                                tone: "info",
                                message: enableForSite
                                  ? `Блокировка рекламы включена для ${currentDomain}. Обновите страницу.`
                                  : `Блокировка рекламы отключена для ${currentDomain}. Обновите страницу.`,
                              });
                            }),
                        );
                      }
                    }}
                  />
                </label>
                <small>
                  {snapshot.settings.adBlockEnabled === false
                    ? "Блокировщик рекламы выключен глобально во всех настройках браузера."
                    : isAdBlockDisabledOnCurrentSite
                      ? "Реклама и трекеры на этом сайте не блокируются. Обновите страницу, чтобы применить."
                      : "Реклама и трекеры на этом сайте фильтруются встроенным блокировщиком."}
                </small>
              </div>
            )}
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
            {currentOrigin && !isPrivate && (
              <div className="site-cookie-control site-notification-control">
                <strong>Уведомления сайта</strong>
                <small className="site-key">{currentOrigin}</small>
                <label>
                  <span>Разрешение</span>
                  <select
                    aria-label="Разрешение уведомлений для этого сайта"
                    value={currentNotificationPermission ?? "ask"}
                    onChange={(event) => {
                      if (!currentTab) return;
                      const decision = event.target.value as "allow" | "deny" | "ask";
                      run(
                        window.browserApi
                          .setSiteNotificationPermission(currentTab.id, decision)
                          .then(() => {
                            setToast({
                              tone: "info",
                              message: decision === "ask"
                                ? "Браузер снова будет спрашивать разрешение уведомлений для этого сайта."
                                : decision === "allow"
                                  ? "Уведомления разрешены для этого сайта."
                                  : "Уведомления запрещены для этого сайта.",
                            });
                          }),
                      );
                    }}
                  >
                    <option value="ask">Спрашивать</option>
                    <option value="allow">Разрешить</option>
                    <option value="deny">Запретить</option>
                  </select>
                </label>
                <small>Выбор сохраняется для этого HTTPS-источника и не сбрасывается после перезагрузки страницы или перезапуска браузера.</small>
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
        {popover === "downloads" && (
          <DownloadsPopover
            snapshot={snapshot}
            onClose={() => setPopover(null)}
            onOpenAllDownloads={() => {
              setPopover(null);
              openPanel("downloads");
            }}
          />
        )}
        {popover === "qrcode" && currentTab && !currentTab.isInternal && (
          <QrCodePopover
            url={currentTab.url}
            title={currentTab.title}
            onClose={() => setPopover(null)}
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
           />
           <NavItem
             icon={<ShieldCheck size={18} />}
             label="Центр приватности"
             active={panel === "privacy"}
             collapsed={sidebarCollapsed}
             onClick={() => openPanel("privacy")}
           />
           <NavItem
             icon={<StickyNote size={18} />}
             label="Быстрые заметки"
             active={notesDrawerOpen}
             collapsed={sidebarCollapsed}
             onClick={() => setNotesDrawerOpen((val) => !val)}
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
        {wallpaperBackground !== "plain" && (currentTab?.isInternal || panel !== "home") && (
          <div className="workspace-wallpaper newtab-wallpaper" data-newtab-wallpaper data-workspace-wallpaper aria-hidden="true">
            <img
              src={wallpaperSrc}
              alt=""
              decoding="async"
              draggable={false}
            />
          </div>
        )}
        {toast && (
          <div className={`app-toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            <span>{toast.message}</span>
            <button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
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
              <button className="icon-button" aria-label="Скрыть помощь со входом Google" title="Скрыть" onClick={() => setAuthNoticeDismissed(true)}><X size={16}/></button>
            </section>
          )}
        <div
          ref={viewportRef}
          className={`page-viewport ${panel !== "home" || Boolean(currentTab?.isReaderActive) ? "panel-visible" : ""}`}
        >
          {panel === "home" && currentTab && !currentTab.isInternal && currentTab.isReaderActive && (
            <ReaderView
              tabId={currentTab.id}
              url={currentTab.url}
              title={currentTab.title}
              onClose={() => {
                run(window.browserApi.toggleReaderMode(currentTab.id));
              }}
              initialSettings={snapshot.readerSettings}
            />
          )}
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
              onSaveBookmark={async (input) => {
                try {
                  await window.browserApi.saveBookmark(input);
                  setToast({ tone: "success", message: "Закладка сохранена" });
                } catch (e) {
                  showError(e);
                }
              }}
              onRemoveBookmark={async (id) => {
                try {
                  await window.browserApi.removeBookmark(id);
                  setToast({ tone: "info", message: "Закладка удалена" });
                } catch (e) {
                  showError(e);
                }
              }}
            />
          )}
          {panel === "home" && currentTab?.lifecycle === "crashed" && (
            <SiteErrorPage
              tab={currentTab}
              onRetry={() => run(window.browserApi.reload(currentTab.id))}
              onBack={() => run(window.browserApi.goBack(currentTab.id))}
              onNewTab={() => run(window.browserApi.createTab({ isPrivate }))}
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
           {panel === "privacy" && (
             <PrivacyDashboard
               snapshot={snapshot}
               dashboard={privacyDashboard}
               loading={privacyDashboardLoading}
               error={privacyDashboardError}
               onRefresh={() => void refreshPrivacyDashboard()}
               onManagePermissions={() => {
                 setPanel("home");
                 setPopover("protection");
               }}
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
      {taskManagerOpen && (
        <TaskManagerModal
          onDismiss={() => setTaskManagerOpen(false)}
          onError={showError}
        />
      )}
      {clickCleanOpen && (
        <ClickAndCleanModal
          onDismiss={() => setClickCleanOpen(false)}
          onCleanComplete={(res) => {
            const freed = res.freedFormatted
              ? `освобождено ${res.freedFormatted}`
              : res.freedBytesEstimate
              ? `освобождено ${formatBytes(res.freedBytesEstimate)}`
              : "данные успешно очищены";
            setToast({
              tone: "success",
              message: `Click & Clean: ${freed}`,
            });
          }}
          onError={showError}
        />
      )}
      {pendingPasswordOffer && (
        <SavePasswordPrompt
          offer={pendingPasswordOffer}
          onSave={async (orig, user, pwd) => {
            try {
              const res = await window.browserApi.saveCredential(orig, user, pwd);
              setPendingPasswordOffer(null);
              setToast({
                tone: "success",
                message: res.updated
                  ? `Пароль для ${pendingPasswordOffer.domain} обновлён`
                  : `Пароль для ${pendingPasswordOffer.domain} сохранён`,
              });
              const updated = await window.browserApi.getSavedCredentialsForOrigin(orig);
              setSiteCredentials(updated || []);
            } catch {
              showError("Не удалось сохранить пароль");
            }
          }}
          onDismiss={() => setPendingPasswordOffer(null)}
          onNeverSave={async (orig) => {
            await window.browserApi.neverSavePasswordForOrigin(orig);
            setPendingPasswordOffer(null);
            setToast({
              tone: "info",
              message: `Пароли для ${pendingPasswordOffer.domain} больше не сохраняются`,
            });
          }}
        />
      )}
      {notesDrawerOpen && (
        <QuickNotesDrawer
          currentTab={currentTab}
          onClose={() => setNotesDrawerOpen(false)}
          onOpenUrl={(url) => {
            run(window.browserApi.createTab({ url, isPrivate }));
          }}
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
  const [dragOver, setDragOver] = useState<{ id: string; side: "left" | "right" } | null>(null);
  const hasOverflow = overflow.left || overflow.right;
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const tabs = snapshot.tabs
    .filter((tab) => tab.workspaceId === active?.workspaceId)
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
  const unpinnedCount = tabs.filter((t) => !t.isPinned).length;
  const dynamicTabWidth = unpinnedCount <= 10 ? 212 : Math.max(120, Math.round(212 - (unpinnedCount - 10) * 7.5));
  const dynamicActiveTabWidth = unpinnedCount <= 10 ? 240 : Math.max(160, Math.round(240 - (unpinnedCount - 10) * 8.5));
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
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener("scroll", update, { passive: true });
    const scrollWithWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
          list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 24
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientWidth : 1;
      list.scrollLeft += event.deltaY * unit;
    };
    list.addEventListener("wheel", scrollWithWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      list.removeEventListener("scroll", update);
      list.removeEventListener("wheel", scrollWithWheel);
    };
  }, [snapshot.activeTabId, tabs.length]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(".tab-container.active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
          setDraggingId(null);
          setDragOver(null);
          if (sourceId) {
            void window.browserApi.reorderTab(sourceId, "end").catch(console.error);
          }
        }}
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
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const sourceId = draggingId || event.dataTransfer.getData("text/plain");
              if (sourceId === tab.id) {
                setDragOver(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const side = event.clientX < rect.left + rect.width / 2 ? "left" : "right";
              setDragOver({ id: tab.id, side });
            }}
            onDragLeave={(event) => {
              const related = event.relatedTarget as HTMLElement | null;
              if (!event.currentTarget.contains(related)) {
                if (dragOver?.id === tab.id) setDragOver(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
              const currentDragOver = dragOver;
              setDraggingId(null);
              setDragOver(null);
              if (sourceId && sourceId !== tab.id) {
                const position = currentDragOver?.side === "right" ? "after" : "before";
                void window.browserApi.reorderTab(sourceId, tab.id, position).catch(console.error);
              }
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOver(null);
            }}
            onContextMenu={(event) => { event.preventDefault(); void window.browserApi.showTabMenu(tab.id).catch(console.error); }}
            className={`tab-container ${tab.id === snapshot.activeTabId ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""} ${tab.isPinned ? "pinned-tab" : ""} ${tab.lifecycle === "hibernated" ? "sleeping-tab" : ""} ${draggingId === tab.id ? "dragging-tab" : ""} ${dragOver?.id === tab.id ? (dragOver.side === "left" ? "drag-over-left" : "drag-over-right") : ""}`}
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
              {tab.lifecycle === "hibernated" && (
                <span className="sleep-indicator">Спит</span>
              )}
            </button>
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
                  {tab.isMuted ? (
                    <VolumeX size={13} />
                  ) : (
                    <div className="tab-equalizer" aria-hidden="true" title="Воспроизводится звук">
                      <span className="tab-equalizer-bar" />
                      <span className="tab-equalizer-bar" />
                      <span className="tab-equalizer-bar" />
                    </div>
                  )}
                </button>
              )}
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
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  isDownloading?: boolean;
  downloadProgress?: number;
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
  onSaveBookmark,
  onRemoveBookmark,
}: {
  snapshot: BrowserSnapshot;
  privateMode: boolean;
  onSearch: (value: string) => void;
  onOpen: (url: string) => void;
  onBookmarks: () => void;
  onSettings: () => void;
  onSaveBookmark?: (input: { url: string; title: string }) => Promise<void>;
  onRemoveBookmark?: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [addError, setAddError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getSmartTitle = (rawUrl: string): string => {
    try {
      const u = new URL(rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host.includes("youtube.com") || host === "youtu.be") return "YouTube";
      if (host.includes("vk.com") || host.includes("vkvideo.ru")) return "ВКонтакте";
      if (host.includes("yandex.ru") || host.includes("ya.ru")) return "Яндекс";
      if (host.includes("google.com")) return "Google";
      if (host.includes("github.com")) return "GitHub";
      if (host.includes("telegram.org") || host === "t.me") return "Telegram";
      if (host.includes("mail.ru")) return "Mail.ru";
      if (host.includes("dzen.ru")) return "Дзен";
      if (host.includes("rutube.ru")) return "Rutube";
      if (host.includes("reddit.com")) return "Reddit";
      if (host.includes("wikipedia.org")) return "Википедия";
      const parts = host.split(".");
      if (parts.length > 0 && parts[0]) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
      return host;
    } catch {
      return "";
    }
  };

  const previewUrl = useMemo(() => {
    const trimmed = newUrl.trim();
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }, [newUrl]);

  const previewHostname = useMemo(() => {
    if (!previewUrl) return "";
    try {
      return new URL(previewUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }, [previewUrl]);

  const previewTitle = newTitle.trim() || getSmartTitle(newUrl) || previewHostname || "Новая закладка";

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const trimmed = text.trim();
        setNewUrl(trimmed);
        if (!newTitle.trim()) {
          const smart = getSmartTitle(trimmed);
          if (smart) setNewTitle(smart);
        }
      }
    } catch {}
  };

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
  const recent = privateMode ? [] : snapshot.history.slice(0, 4);
  const background = normalizeNewTabBackground(snapshot.settings.newTabBackground);

  const activeBookmarks = useMemo(() => {
    if (snapshot.bookmarks.length > 0) {
      return snapshot.bookmarks.slice(0, 16);
    }
    return DEFAULT_STARTER_BOOKMARKS;
  }, [snapshot.bookmarks]);

  const handleDeleteBookmark = async (bookmark: { id: string; title: string; url: string }) => {
    if (snapshot.bookmarks.length > 0) {
      if (onRemoveBookmark) {
        await onRemoveBookmark(bookmark.id);
      }
    } else {
      if (onSaveBookmark) {
        const remaining = DEFAULT_STARTER_BOOKMARKS.filter((item) => item.id !== bookmark.id);
        for (const item of remaining) {
          await onSaveBookmark({ url: item.url, title: item.title });
        }
      }
    }
  };

  const handleSaveBookmarkForm = async (event: React.FormEvent) => {
    event.preventDefault();
    let trimmedUrl = newUrl.trim();
    if (!trimmedUrl) {
      setAddError("Укажите адрес страницы");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = `https://${trimmedUrl}`;
    }
    try {
      new URL(trimmedUrl);
    } catch {
      setAddError("Некорректный адрес URL");
      return;
    }
    const finalTitle = newTitle.trim() || getSmartTitle(trimmedUrl) || hostname(trimmedUrl);
    setIsSubmitting(true);
    setAddError("");
    try {
      if (snapshot.bookmarks.length === 0 && onSaveBookmark) {
        for (const item of DEFAULT_STARTER_BOOKMARKS) {
          await onSaveBookmark({ url: item.url, title: item.title });
        }
      }
      if (onSaveBookmark) {
        await onSaveBookmark({ url: trimmedUrl, title: finalTitle });
      }
      setNewUrl("");
      setNewTitle("");
      setAddModalOpen(false);
    } catch {
      setAddError("Не удалось сохранить закладку");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`new-tab-page ${privateMode ? "private-newtab" : ""}`} data-new-tab-background={background} data-background={background}>
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
            <section className="newtab-bookmarks-section" aria-label="Закладки">
              <div className="section-heading">
                <div>
                  <Bookmark size={16} />
                  <h2>Закладки</h2>
                  <span className="section-count">
                    {snapshot.bookmarks.length}
                  </span>
                </div>
                <div className="section-heading-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setAddError("");
                      setAddModalOpen(true);
                    }}
                  >
                    <Plus size={14} /> Добавить
                  </button>
                  <button className="text-button" onClick={onBookmarks}>
                    Все закладки <ChevronRight size={15} />
                  </button>
                </div>
              </div>
              <div className="quick-links" aria-label="Быстрый доступ">
                {activeBookmarks.map((bookmark) => (
                  <div className="quick-link-tile" key={bookmark.id}>
                    <div className="quick-link-icon-wrap">
                      <button
                        type="button"
                        className="quick-link-icon-btn"
                        title={`${bookmark.title}\n${bookmark.url}`}
                        onClick={() => onOpen(bookmark.url)}
                      >
                        <span className="quick-link-symbol">
                          <SiteFavicon
                            url={bookmark.url}
                            favicon={(bookmark as any).favicon}
                            size={24}
                          />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="quick-link-delete-btn"
                        title={`Удалить «${bookmark.title}»`}
                        aria-label={`Удалить «${bookmark.title}»`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteBookmark(bookmark);
                        }}
                      >
                        <X size={10} strokeWidth={2.8} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="quick-link-label-btn"
                      title={`${bookmark.title}\n${bookmark.url}`}
                      onClick={() => onOpen(bookmark.url)}
                    >
                      <span className="quick-link-label">{bookmark.title}</span>
                    </button>
                  </div>
                ))}
                <div className="quick-link-tile quick-link-add-tile">
                  <div className="quick-link-icon-wrap">
                    <button
                      type="button"
                      className="quick-link-icon-btn quick-link-add-btn"
                      title="Добавить сайт в закладки"
                      onClick={() => {
                        setAddError("");
                        setAddModalOpen(true);
                      }}
                    >
                      <span className="quick-link-symbol quick-link-add-symbol">
                        <Plus size={20} />
                      </span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="quick-link-label-btn"
                    title="Добавить сайт в закладки"
                    onClick={() => {
                      setAddError("");
                      setAddModalOpen(true);
                    }}
                  >
                    <span className="quick-link-label">Добавить</span>
                  </button>
                </div>
                <div className="quick-link-tile quick-link-all-tile">
                  <div className="quick-link-icon-wrap">
                    <button
                      type="button"
                      className="quick-link-icon-btn"
                      title="Все закладки"
                      onClick={onBookmarks}
                    >
                      <span className="quick-link-symbol">
                        <Bookmark size={20} />
                      </span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="quick-link-label-btn"
                    title="Все закладки"
                    onClick={onBookmarks}
                  >
                    <span className="quick-link-label">Все</span>
                  </button>
                </div>
              </div>
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
                      <span className="recent-page-text">
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
      {addModalOpen &&
        createPortal(
          <div
            className="newtab-modal-overlay"
            role="presentation"
            onClick={() => !isSubmitting && setAddModalOpen(false)}
          >
          <div
            className="newtab-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="newtab-modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !isSubmitting) setAddModalOpen(false);
            }}
          >
            <div className="newtab-modal-header">
              <div className="newtab-modal-header-left">
                <div className="newtab-modal-badge" aria-hidden="true">
                  <Bookmark size={19} />
                </div>
                <div>
                  <h3 id="newtab-modal-title">Добавить закладку</h3>
                  <p className="newtab-modal-subtitle">
                    Быстрый доступ на новой вкладке
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="newtab-modal-close"
                title="Закрыть"
                aria-label="Закрыть"
                onClick={() => setAddModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Live Interactive Preview Tile */}
            <div className="newtab-modal-preview">
              <div className="newtab-modal-preview-icon">
                {previewUrl ? (
                  <SiteFavicon url={previewUrl} size={24} />
                ) : (
                  <Globe2 size={20} className="preview-placeholder-icon" />
                )}
              </div>
              <div className="newtab-modal-preview-text">
                <span className="preview-title">{previewTitle}</span>
                <span className="preview-domain">
                  {previewHostname ? `https://${previewHostname}` : "https://example.com"}
                </span>
              </div>
              <span className="newtab-modal-preview-badge">Предпросмотр</span>
            </div>

            <form onSubmit={handleSaveBookmarkForm} className="newtab-modal-form">
              <label>
                <span className="modal-label-text">
                  <span>Адрес сайта (URL)</span>
                  <span className="modal-label-req">*</span>
                </span>
                <div className="newtab-modal-input-wrap">
                  <Globe2 size={16} className="modal-input-icon" />
                  <input
                    type="text"
                    autoFocus
                    required
                    placeholder="https://example.com"
                    value={newUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewUrl(val);
                      if (!newTitle.trim()) {
                        const smart = getSmartTitle(val);
                        if (smart) setNewTitle(smart);
                      }
                    }}
                    disabled={isSubmitting}
                  />
                  {newUrl ? (
                    <button
                      type="button"
                      className="modal-input-action-btn"
                      title="Очистить"
                      onClick={() => setNewUrl("")}
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="modal-input-action-btn paste-btn"
                      title="Вставить из буфера обмена"
                      onClick={handlePasteClipboard}
                    >
                      Вставить
                    </button>
                  )}
                </div>
              </label>

              <label>
                <span className="modal-label-text">
                  <span>Название закладки</span>
                  <span className="modal-label-optional">(необязательно)</span>
                </span>
                <div className="newtab-modal-input-wrap">
                  <Bookmark size={16} className="modal-input-icon" />
                  <input
                    type="text"
                    placeholder="Например: Мой любимый сайт"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    disabled={isSubmitting}
                  />
                  {newTitle && (
                    <button
                      type="button"
                      className="modal-input-action-btn"
                      title="Очистить"
                      onClick={() => setNewTitle("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </label>

              {addError && <p className="newtab-modal-error">{addError}</p>}

              <div className="newtab-modal-actions">
                <button
                  type="button"
                  className="modal-cancel-btn"
                  onClick={() => setAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="modal-submit-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <LoaderCircle size={15} className="spin-icon" />
                      <span>Сохраняем…</span>
                    </>
                  ) : (
                    <>
                      <Plus size={16} strokeWidth={2.5} />
                      <span>Добавить закладку</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
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
              <article
                className={`download-row ${download.state === "completed" && Boolean(download.path) ? "is-draggable" : ""}`}
                key={download.id}
                draggable={download.state === "completed" && Boolean(download.path)}
                onDragStart={(e) => {
                  if (download.state !== "completed" || !download.path) return;
                  e.preventDefault();
                  window.browserApi.startDownloadDrag(download.id);
                }}
                title={
                  download.state === "completed"
                    ? "Кликните, чтобы открыть · Перетащите в поле ввода на любом сайте"
                    : undefined
                }
              >
                <div className="download-preview">
                  {download.thumbnail ? (
                    <img
                      src={download.thumbnail}
                      alt={download.filename}
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
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
                    {download.state === "completed" && (
                      <span className="downloads-drag-hint">
                        ✥ Перетащите на сайт
                      </span>
                    )}
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
                        aria-label="Повторить загрузку"
                        title="Скачать заново"
                        onClick={() =>
                          run(window.browserApi.retryDownload(download.id))
                        }
                      >
                        <RotateCcw size={17} />
                      </button>
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
                    <>
                      <button
                        className="icon-button"
                        aria-label="Повторить загрузку"
                        title="Повторить попытку скачивания"
                        onClick={() =>
                          run(window.browserApi.retryDownload(download.id))
                        }
                      >
                        <RotateCcw size={17} />
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
  const [newVoodooKey, setNewVoodooKey] = useState("");
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [keyTestFeedback, setKeyTestFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, { status: 'healthy' | 'exhausted' | 'invalid'; latencyMs?: number; error?: string }>>({});
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

  const handleAddVoodooKey = () => {
    const raw = newVoodooKey.trim();
    if (!raw) return;
    const extracted = raw
      .split(/[\r\n,;\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 10);
    const toAdd = extracted.length > 0 ? extracted : [raw];
    const currentKeys = settings.voodooKeys ?? ['sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0'];

    const addedList: string[] = [];
    const nextKeys = [...currentKeys];
    for (const k of toAdd) {
      if (!nextKeys.includes(k)) {
        nextKeys.push(k);
        addedList.push(k);
      }
    }

    if (addedList.length > 0) {
      update({ voodooKeys: nextKeys });
      setKeyTestFeedback({
        text: addedList.length === 1
          ? `Ключ ${addedList[0].slice(0, 10)}… добавлен в список ротации.`
          : `Добавлено ${addedList.length} новых ключей без дубликатов.`,
        isError: false,
      });
    } else {
      setKeyTestFeedback({
        text: "Все указанные ключи уже есть в списке.",
        isError: true,
      });
    }
    setNewVoodooKey("");
  };

  const handleMakePrimaryKey = (index: number) => {
    if (index <= 0) return;
    const currentKeys = settings.voodooKeys ?? ['sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0'];
    const key = currentKeys[index];
    const nextKeys = [key, ...currentKeys.filter((_, idx) => idx !== index)];
    update({ voodooKeys: nextKeys });
    setKeyTestFeedback({
      text: `Ключ ${key.slice(0, 10)}… установлен как основной (приоритетный).`,
      isError: false,
    });
  };

  const handleRemoveVoodooKey = (indexToRemove: number) => {
    const currentKeys = settings.voodooKeys ?? ['sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0'];
    const updated = currentKeys.filter((_, idx) => idx !== indexToRemove);
    update({ voodooKeys: updated });
  };

  const handleTestVoodooKey = async (key: string) => {
    setTestingKey(key);
    try {
      const res = await window.browserApi.testVoodooKey(key);
      if (res.success) {
        setKeyStatuses((prev) => ({
          ...prev,
          [key]: { status: 'healthy', latencyMs: res.latencyMs },
        }));
        setKeyTestFeedback({
          text: `Ключ активен и работает! Задержка отклика: ${res.latencyMs ?? 0} мс`,
          isError: false,
        });
      } else {
        const isExhausted = /quota|limit|rate|balance|credit|429/i.test(res.error || "");
        setKeyStatuses((prev) => ({
          ...prev,
          [key]: {
            status: isExhausted ? 'exhausted' : 'invalid',
            latencyMs: res.latencyMs,
            error: res.error,
          },
        }));
        setKeyTestFeedback({
          text: `Ошибка проверки ключа: ${res.error || "Неизвестная ошибка"}`,
          isError: true,
        });
      }
    } catch (e) {
      setKeyStatuses((prev) => ({
        ...prev,
        [key]: {
          status: 'invalid',
          error: e instanceof Error ? e.message : "Ошибка",
        },
      }));
      setKeyTestFeedback({
        text: `Ошибка соединения: ${e instanceof Error ? e.message : "Ошибка"}`,
        isError: true,
      });
    } finally {
      setTestingKey(null);
    }
  };
  const [customWallpaper, saveCustomWallpaper] = useCustomWallpaper();
  const [wallpaperMessage, setWallpaperMessage] = useState("");
  const onWallpaperFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const wallpaper = await imageAsWallpaper(file);
      // Keep the previous wallpaper if either local storage or settings fail.
      // Storage is written first so a persistence error cannot change browser settings.
      const previous = customWallpaper ? await sourceToWallpaperBlob(customWallpaper) : null;
      await saveCustomWallpaper(wallpaper);
      try {
        await window.browserApi.updateSettings({ newTabBackground: "portrait" });
      } catch (error) {
        try { await saveCustomWallpaper(previous); } catch { /* Preserve original error. */ }
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
  const [newAdBlockSite, setNewAdBlockSite] = useState("");
  const [adBlockSiteError, setAdBlockSiteError] = useState("");
  const handleAddAdBlockException = () => {
    const raw = newAdBlockSite.trim();
    if (!raw) return;
    const normalized = normalizeSiteKey(raw);
    if (!normalized) {
      setAdBlockSiteError("Введите корректный адрес сайта или домен (например, youtube.com)");
      return;
    }
    setAdBlockSiteError("");
    const current = settings.adBlockExceptions ?? [];
    if (!current.some((exc) => normalizeSiteKey(exc) === normalized)) {
      update({ adBlockExceptions: [...current, normalized] });
    }
    setNewAdBlockSite("");
  };
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
              <small>Светлая, тёмная или серая (графитовая) темы с адаптивными цветами.</small>
            </span>
            <select
              value={settings.theme}
              onChange={(event) =>
                update({
                  theme: event.target.value as "system" | "light" | "dark" | "graphite",
                })
              }
            >
              <option value="system">Как в системе</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
              <option value="graphite">Серая (графитовая)</option>
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
            <strong>soulm8te 0.7.1</strong>
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
            <select aria-label="Акцентный цвет" value={settings.accentColor ?? "blue"} onChange={event => update({ accentColor: event.target.value as "blue" | "teal" | "violet" | "rose" | "pink" | "white" | "milk" | "graphite" })}>
              <option value="blue">Классический синий</option>
              <option value="teal">Бирюзовый</option>
              <option value="violet">Фиолетовый</option>
              <option value="rose">Розовый</option>
              <option value="pink">Розовый / Неон</option>
              <option value="white">Белый</option>
              <option value="milk">Молочный</option>
              <option value="graphite">Графитовый</option>
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
              <small>Локальный PNG, JPEG или WebP до 20 МБ. Не отправляется в интернет.</small>
            </span>
            <div className="custom-wallpaper-controls">
              <label className="custom-wallpaper-upload">
                Выбрать файл
                <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Загрузить собственные обои" onChange={(event) => void onWallpaperFile(event)} />
              </label>
              {customWallpaper && <button type="button" className="plain-button" onClick={() => void saveCustomWallpaper(null).then(() => setWallpaperMessage("Возвращён стандартный портрет.")).catch((error) => setWallpaperMessage(error instanceof Error ? error.message : "Не удалось сбросить обои."))}>Сбросить</button>}
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
          <div className="adblock-exceptions-settings">
            <div className="small-heading">
              <ShieldOff size={18} />
              <strong>Сайты, где блокировщик выключен</strong>
            </div>
            <p>
              На этих сайтах фильтрация рекламы и трекеров отключена. Вы можете
              добавить домен или удалить его из списка исключений.
            </p>
            <div className="adblock-add-exception-row">
              <input
                type="text"
                placeholder="Например, youtube.com"
                value={newAdBlockSite}
                onChange={(e) => {
                  setNewAdBlockSite(e.target.value);
                  if (adBlockSiteError) setAdBlockSiteError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddAdBlockException();
                  }
                }}
              />
              <button
                type="button"
                className="plain-button"
                onClick={handleAddAdBlockException}
                disabled={!newAdBlockSite.trim()}
              >
                <Plus size={15} />
                Добавить
              </button>
            </div>
            {adBlockSiteError && <small className="adblock-error-text">{adBlockSiteError}</small>}
            {(settings.adBlockExceptions?.length ?? 0) === 0 ? (
              <small>Исключений пока нет. Блокировщик включен для всех сайтов.</small>
            ) : (
              <ul className="cookie-exception-list adblock-exception-list">
                {settings.adBlockExceptions?.map((site) => (
                  <li key={site}>
                    <span>{site}</span>
                    <button
                      className="icon-button"
                      aria-label={`Удалить сайт ${site} из исключений`}
                      title="Включить блокировщик обратно"
                      onClick={() =>
                        update({
                          adBlockExceptions: settings.adBlockExceptions?.filter(
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
        <div className="settings-section">
          <h3>AI-Ассистент Вуду</h3>
          <p className="privacy-note">
            Интеллектуальный советник для соцсетей (ВКонтакте, Telegram), анализа диалогов и страниц на базе модели Qwen 3.8 Max (провайдер xkiro).
          </p>

          <label className="checkbox-setting" style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
            <input
              type="checkbox"
              checked={settings.voodooEnabled !== false}
              onChange={(e) => update({ voodooEnabled: e.target.checked })}
            />
            <span>Включить ассистента Вуду</span>
          </label>

          <label className="checkbox-setting" style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
            <input
              type="checkbox"
              checked={settings.voodooBubbleVisible !== false}
              disabled={settings.voodooEnabled === false}
              onChange={(e) => update({ voodooBubbleVisible: e.target.checked })}
            />
            <span>Отображать плавающий кружок в правом нижнем углу экрана</span>
          </label>

          <div style={{ marginTop: 14 }}>
            <strong style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
              API-ключи xkiro (ротация при исчерпании лимита токенов)
            </strong>
            <small style={{ color: "var(--text-muted, #94a3b8)", display: "block", marginBottom: 10 }}>
              Добавьте один или несколько ключей от xkiro. Браузер автоматически и незаметно переключится на следующий ключ при превышении квоты или лимита токенов.
            </small>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                type="password"
                placeholder="Вставьте ключ(и) sk-xt-... (можно несколько через перенос или запятую)"
                value={newVoodooKey}
                onChange={(e) => setNewVoodooKey(e.target.value)}
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--border)",
                  color: "var(--text-main)",
                  fontSize: 13,
                }}
              />
              <button
                className="plain-button"
                onClick={handleAddVoodooKey}
                disabled={!newVoodooKey.trim()}
              >
                <Plus size={15} /> Добавить
              </button>
            </div>

            {keyTestFeedback && (
              <p style={{ fontSize: 12, marginBottom: 8, color: keyTestFeedback.isError ? "#ef4444" : "#10b981" }}>
                {keyTestFeedback.text}
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(settings.voodooKeys ?? ['sk-xt-632ce38b37c38453a54bdf73e5ccb707b6a3ef29e192dca0']).map((key, idx) => {
                const masked = key.length > 14
                  ? `${key.slice(0, 10)}${"•".repeat(Math.max(4, key.length - 14))}${key.slice(-4)}`
                  : key;
                const statusInfo = keyStatuses[key];
                const isPrimary = idx === 0;

                return (
                  <div
                    key={idx}
                    className="voodoo-key-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: isPrimary ? "1px solid rgba(0, 210, 255, 0.35)" : "1px solid var(--border)",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 6,
                          background: isPrimary ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.08)",
                          color: isPrimary ? "#10b981" : "var(--text-muted)",
                          border: isPrimary ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        {isPrimary ? "Основной" : `Резервный #${idx}`}
                      </span>
                      <span style={{ fontSize: 13, fontFamily: "monospace", color: "var(--text-main)" }}>
                        {masked}
                      </span>
                      {statusInfo && (
                        statusInfo.status === 'healthy' ? (
                          <span style={{ fontSize: 11, color: "#10b981", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <CheckCircle2 size={12} /> Работает ({statusInfo.latencyMs ?? 0} мс)
                          </span>
                        ) : statusInfo.status === 'exhausted' ? (
                          <span style={{ fontSize: 11, color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: 3 }} title={statusInfo.error}>
                            <AlertTriangle size={12} /> Исчерпан
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#ef4444", display: "inline-flex", alignItems: "center", gap: 3 }} title={statusInfo.error}>
                            <AlertTriangle size={12} /> {statusInfo.error?.slice(0, 25) || "Ошибка"}
                          </span>
                        )
                      )}
                    </div>
                    <div className="voodoo-key-actions" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {!isPrimary && (
                        <button
                          className="plain-button"
                          style={{ fontSize: 11, padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}
                          title="Сделать основным (приоритетным)"
                          onClick={() => handleMakePrimaryKey(idx)}
                        >
                          <ArrowUp size={12} /> Вверх
                        </button>
                      )}
                      <button
                        className="plain-button"
                        style={{ fontSize: 11, padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}
                        onClick={() => handleTestVoodooKey(key)}
                        disabled={testingKey === key}
                        title="Проверить работоспособность ключа (⚡)"
                      >
                        <Zap size={12} /> {testingKey === key ? "Проверка…" : "Проверить"}
                      </button>
                      <button
                        className="plain-button"
                        style={{ fontSize: 11, padding: "3px 8px", color: "#ef4444" }}
                        onClick={() => handleRemoveVoodooKey(idx)}
                        title="Удалить ключ"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="about-card">
          <div className="about-icon-wrapper">
            <img className="about-brand-icon" src={chloeIcon} alt="soulm8te" />
            <span className="about-led-indicator" title="Detroit Android LED status: active" />
          </div>
          <div>
            <strong>soulm8te Browser</strong>
            <p>Ваш цифровой союзник · Detroit: Become Human</p>
            <small>Интерфейс по soulm8te Brand Guidelines 1.0 · Версия 0.7.1</small>
          </div>
        </div>
      </div>
    </section>
  );
}
function VoodooStandaloneApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("voodoo-standalone");
    document.body.classList.add("voodoo-standalone");

    void window.browserApi.getSnapshot().then(setSnapshot).catch(console.error);
    const remove = window.browserApi.onSnapshotChanged((next) => {
      setSnapshot(next);
    });
    return remove;
  }, []);

  const currentTab = snapshot?.tabs.find((t) => t.id === snapshot.activeTabId);

  return (
    <VoodooChatBubble
      standalone={true}
      bubbleVisible={snapshot?.settings?.voodooBubbleVisible !== false && snapshot?.settings?.voodooEnabled !== false}
      currentTab={currentTab}
    />
  );
}

if (window.location.search.includes("view=voodoo")) {
  createRoot(document.getElementById("root")!).render(<VoodooStandaloneApp />);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
