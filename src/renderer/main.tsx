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
} from "../shared/types";
import logoLight from "./assets/soul/logo-light.png";
import logoDark from "./assets/soul/logo-dark.png";
import portrait from "./assets/soul/portrait.webp";
import symbol from "./assets/soul/symbol.svg";
import "./styles.css";

type Panel = "home" | "bookmarks" | "history" | "downloads" | "settings";
type Toast = { tone: "error" | "success" | "info"; message: string };
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
  const sidebarCollapsed = snapshot?.settings.sidebarCollapsed ?? false;
  const showError = useCallback(
    (error: unknown) =>
      setToast({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Действие не выполнено. Попробуйте ещё раз.",
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
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const b = viewport.getBoundingClientRect();
      const hidden =
        panel !== "home" ||
        Boolean(popover) ||
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPopover(null);
      setToast(null);
      if (findOpen && currentTab) {
        setFindOpen(false);
        run(window.browserApi.stopFindInPage(currentTab.id));
      } else if (panel !== "home") setPanel("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentTab?.id, findOpen, panel, run]);

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
            <EntriesPanel
              kind="bookmarks"
              snapshot={snapshot}
              onOpen={navigate}
            />
          )}
          {panel === "history" && (
            <EntriesPanel
              kind="history"
              snapshot={snapshot}
              onOpen={navigate}
            />
          )}
          {panel === "downloads" && (
            <DownloadsPanel downloads={snapshot.downloads} run={run} />
          )}
          {panel === "settings" && (
            <SettingsPanel
              snapshot={snapshot}
              run={run}
              onDone={() => openPanel("home")}
            />
          )}
        </div>
      </main>
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
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const tabs = snapshot.tabs
    .filter((tab) => tab.workspaceId === active?.workspaceId)
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
  return (
    <div className="tab-strip">
      <div className="tab-list" role="tablist" aria-label="Вкладки">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-container ${tab.id === snapshot.activeTabId ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""} ${tab.isPinned ? "pinned-tab" : ""}`}
          >
            <button
              className="tab"
              role="tab"
              aria-selected={tab.id === snapshot.activeTabId}
              title={`${tab.title}${tab.isPrivate ? " · Приватная" : ""}${tab.lifecycle === "hibernated" ? " · Спит" : ""}`}
              onClick={() => onActivate(tab.id)}
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
              {tab.isPinned && <Pin size={12} />}
              {tab.isMuted && <VolumeX size={12} />}
              {tab.lifecycle === "hibernated" && (
                <span className="sleep-indicator">Спит</span>
              )}
            </button>
            <button
              className="tab-close"
              aria-label={`Закрыть вкладку ${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
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
  return (
    <div className={`new-tab-page ${privateMode ? "private-newtab" : ""}`}>
      <div className="newtab-topline">
        <span>
          {new Intl.DateTimeFormat("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date())}
        </span>
        <button
          onClick={onSettings}
          title="Настроить браузер"
          aria-label="Настроить браузер"
        >
          <Settings size={17} />
        </button>
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
            : "Ваши страницы, идеи и открытия — в одном месте."}
        </p>
        <form
          className="hero-search"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("query");
            if (input instanceof HTMLInputElement) onSearch(input.value);
          }}
        >
          <Search size={21} />
          <input
            name="query"
            autoComplete="off"
            placeholder="Поиск или адрес страницы"
            aria-label="Поиск на новой вкладке"
          />
          <button type="submit" title="Открыть" aria-label="Искать">
            <ArrowRight size={20} />
          </button>
        </form>
        <div className="quick-links" aria-label="Быстрый доступ">
          {quickLinks.map((link) => (
            <button key={link.label} onClick={() => onOpen(link.url)}>
              <span>
                <Globe2 size={20} />
              </span>
              {link.label}
            </button>
          ))}
          <button onClick={onBookmarks}>
            <span>
              <Bookmark size={20} />
            </span>
            Сохранённое
          </button>
        </div>
        {privateMode ? (
          <div className="private-card">
            <Shield size={23} />
            <div>
              <strong>Что остаётся приватным</strong>
              <p>
                Cookies и данные сайтов временные. Они удаляются после закрытия
                всех приватных вкладок. Сохранённые файлы и закладки остаются на
                устройстве.
              </p>
              <p>
                Этот режим не скрывает IP-адрес и не заменяет Tor.{" "}
                {snapshot.privacy?.proxy
                  ? "Для приватных вкладок настроен прокси."
                  : "Прокси не подключён."}
              </p>
              <button className="text-button" onClick={onSettings}>
                Настроить приватность <ChevronRight size={15} />
              </button>
            </div>
          </div>
        ) : snapshot.bookmarks.length > 0 ? (
          <section className="newtab-saved">
            <div className="section-heading">
              <h2>Сохранённые страницы</h2>
              <button className="text-button" onClick={onBookmarks}>
                Все закладки <ChevronRight size={15} />
              </button>
            </div>
            <div className="saved-grid">
              {snapshot.bookmarks.slice(0, 4).map((bookmark) => (
                <button
                  key={bookmark.id}
                  className="saved-card"
                  onClick={() => onOpen(bookmark.url)}
                >
                  <Globe2 size={19} />
                  <span>
                    <strong>{bookmark.title}</strong>
                    <small>{new URL(bookmark.url).hostname}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="newtab-tip">
            <Star size={17} />
            <span>Сохраняйте важные страницы звездой в адресной строке.</span>
            <kbd>Ctrl D</kbd>
          </div>
        )}
      </div>
      <footer className="newtab-footer">
        <span>
          <span className="mode-dot" />
          {privateMode ? "Приватная сессия" : "Личный профиль"}
        </span>
        <span>SOUL-M8TE · Ваш цифровой союзник</span>
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
function EntriesPanel({
  kind,
  snapshot,
  onOpen,
}: {
  kind: "bookmarks" | "history";
  snapshot: BrowserSnapshot;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const entries = kind === "bookmarks" ? snapshot.bookmarks : snapshot.history;
  const filtered = entries.filter((entry) =>
    `${entry.title} ${entry.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="utility-panel">
      <PanelHeader
        icon={
          kind === "bookmarks" ? <Bookmark size={22} /> : <History size={22} />
        }
        title={kind === "bookmarks" ? "Закладки" : "История"}
        subtitle={
          kind === "bookmarks"
            ? "Ваши сохранённые страницы"
            : "Последние посещения обычного профиля"
        }
      />
      <label className="panel-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти по названию или адресу"
          aria-label={
            kind === "history" ? "Поиск в истории" : "Поиск в закладках"
          }
        />
        <span>{filtered.length}</span>
      </label>
      {filtered.length === 0 ? (
        <EmptyState
          icon={
            kind === "bookmarks" ? <Star size={28} /> : <History size={28} />
          }
          title={
            query
              ? "Ничего не найдено"
              : kind === "bookmarks"
                ? "Сохраните первую страницу"
                : "История пуста"
          }
          description={
            query
              ? "Попробуйте другой запрос."
              : kind === "bookmarks"
                ? "Нажмите на звезду в адресной строке или Ctrl+D."
                : "Посещённые страницы обычного профиля появятся здесь."
          }
        />
      ) : (
        <div className="entry-list">
          {filtered.map((entry) => (
            <button
              className="entry-row"
              key={entry.id}
              onClick={() => onOpen(entry.url)}
            >
              <span className="entry-icon">
                <Globe2 size={19} />
              </span>
              <span className="entry-copy">
                <strong>{entry.title}</strong>
                <small>{entry.url}</small>
              </span>
              {"visitedAt" in entry && (
                <span className="entry-time">
                  {new Date(entry.visitedAt).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              )}
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      )}
    </section>
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
}: {
  downloads: DownloadEntry[];
  run: (promise: Promise<unknown>) => void;
}): React.JSX.Element {
  return (
    <section className="utility-panel">
      <PanelHeader
        icon={<Download size={22} />}
        title="Загрузки"
        subtitle="Сохранённые файлы и текущие загрузки"
      />
      {downloads.length === 0 ? (
        <EmptyState
          icon={<Download size={28} />}
          title="Загрузок пока нет"
          description="Сохранённые файлы и их состояние появятся здесь."
        />
      ) : (
        <div className="download-list">
          {downloads.map((download) => {
            const active =
              download.state === "queued" || download.state === "progressing";
            const percent =
              download.totalBytes > 0
                ? Math.min(
                    100,
                    Math.round(
                      (download.receivedBytes / download.totalBytes) * 100,
                    ),
                  )
                : null;
            const status = download.isPaused
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
                          download.isPaused
                            ? "Продолжить загрузку"
                            : "Приостановить загрузку"
                        }
                        title={download.isPaused ? "Продолжить" : "Пауза"}
                        onClick={() =>
                          run(
                            window.browserApi.controlDownload(
                              download.id,
                              download.isPaused ? "resume" : "pause",
                            ),
                          )
                        }
                      >
                        {download.isPaused ? (
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
    "cookies",
    "passwords",
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  const refreshProfiles = async () => {
    setBusy(true);
    setMessage("");
    try {
      const next = await window.browserApi.discoverImportProfiles();
      setProfiles(next);
      setSelectedProfileId((current) =>
        next.some((profile) => profile.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
      if (next.length === 0)
        setMessage("Профили Chrome, Яндекс Браузера или Firefox не найдены.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось найти профили браузеров.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshProfiles();
  }, []);

  const selectedProfile = profiles.find(
    (profile) => profile.id === selectedProfileId,
  );
  const toggleKind = (kind: ImportDataKind) =>
    setSelectedKinds((current) =>
      current.includes(kind)
        ? current.filter((value) => value !== kind)
        : [...current, kind],
    );
  const importData = async () => {
    if (!selectedProfileId || selectedKinds.length === 0) return;
    setBusy(true);
    setMessage("");
    setReport(null);
    try {
      const next = await window.browserApi.importBrowserData({
        profileId: selectedProfileId,
        data: selectedKinds,
      });
      setReport(next);
      setMessage("Импорт завершён.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Импорт не выполнен.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="import-card">
      <div className="import-card-heading">
        <div className="vpn-title">
          <div className="panel-icon">
            <Database size={19} />
          </div>
          <span>
            <strong>Импорт данных браузера</strong>
            <small>
              Локальный импорт из Google Chrome, Яндекс Браузера или Firefox без
              отправки данных наружу.
            </small>
          </span>
        </div>
        <button
          className="icon-button subtle"
          aria-label="Обновить список профилей"
          onClick={() => void refreshProfiles()}
          disabled={busy}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />
        </button>
      </div>
      <div className="import-controls">
        <label className="import-field">
          <span>Профиль</span>
          <select
            value={selectedProfileId}
            onChange={(event) => setSelectedProfileId(event.target.value)}
            disabled={busy || profiles.length === 0}
          >
            <option value="">Профиль не выбран</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.browserLabel} · {profile.profileName}
              </option>
            ))}
          </select>
        </label>
        <div className="import-field">
          <span>Что импортировать</span>
          <div className="import-checks">
            {importKinds.map((kind) => (
              <label key={kind.value} className="import-check">
                <input
                  type="checkbox"
                  checked={selectedKinds.includes(kind.value)}
                  onChange={() => toggleKind(kind.value)}
                  disabled={
                    busy || !selectedProfile?.available.includes(kind.value)
                  }
                />
                <span>{kind.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="import-actions">
        <button
          className="vpn-primary"
          disabled={busy || !selectedProfileId || selectedKinds.length === 0}
          onClick={() => void importData()}
        >
          <Database size={15} />{" "}
          {busy ? "Импортируем…" : "Импортировать выбранное"}
        </button>
        {selectedProfile && <small>Источник: {selectedProfile.path}</small>}
      </div>
      <div className="import-note">
        <KeyRound size={14} /> Пароли сохраняются только в зашифрованное
        хранилище приложения. На Linux поддерживается системный keyring
        Chromium; для Firefox используйте официальный CSV-экспорт, если профиль
        защищён NSS.
      </div>
      {message && <div className="setting-status ready">{message}</div>}
      {report && (
        <div className="import-report">
          <strong>Результат импорта</strong>
          <span>
            История: {report.imported.history} · Закладки:{" "}
            {report.imported.bookmarks} · Cookies: {report.imported.cookies} ·
            Пароли: {report.imported.passwords}
          </span>
          {report.skipped.cookies + report.skipped.passwords > 0 && (
            <span>
              Пропущено защищённых записей:{" "}
              {report.skipped.cookies + report.skipped.passwords}
            </span>
          )}
          {report.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
          {report.errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  snapshot,
  run,
  onDone,
}: {
  snapshot: BrowserSnapshot;
  run: (promise: Promise<unknown>) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [proxy, setProxy] = useState(snapshot.privacy?.proxy ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const settings = snapshot.settings;
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
                Некоторые встроенные сервисы могут потребовать входа.
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
