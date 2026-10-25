import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  ExternalLink,
  File,
  Film,
  FolderOpen,
  Globe2,
  History,
  Home,
  Image,
  KeyRound,
  LoaderCircle,
  LayoutGrid,
  Menu,
  Minus,
  MoreHorizontal,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Square,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { BrowserSnapshot, DownloadEntry, HistoryEntry, ImportDataKind, ImportProfile, ImportReport, TabSnapshot } from '../shared/types';
import brandLogo from './assets/brand/logo-horizontal-detailed.png';
import monkeyBackground from './assets/monkey-business-los-angeles.jpg';
import './styles.css';

type Panel = 'home' | 'bookmarks' | 'history' | 'downloads' | 'settings';
type ToastState = { tone: 'info' | 'error' | 'success'; message: string };

const quickLinks = [
  { label: 'Docs', url: 'https://developer.mozilla.org/', tone: 'coral' },
  { label: 'Mail', url: 'https://mail.google.com/', tone: 'violet' },
  { label: 'Maps', url: 'https://www.openstreetmap.org/', tone: 'green' },
  { label: 'Images', url: 'https://commons.wikimedia.org/', tone: 'blue' },
  { label: 'News', url: 'https://news.ycombinator.com/', tone: 'amber' },
  { label: 'Games', url: 'https://itch.io/', tone: 'purple' },
  { label: 'Shop', url: 'https://www.etsy.com/', tone: 'red' },
];

const feedItems = [
  { title: 'Тихие места для перезагрузки', meta: 'Путешествия · 5 мин', category: 'Путешествия', image: 'mountain' },
  { title: 'Чистое рабочее пространство', meta: 'Продуктивность · 4 мин', category: 'Работа', image: 'desk' },
  { title: 'Дом, который помогает думать', meta: 'Дизайн · 6 мин', category: 'Идеи', image: 'plant' },
];

function formatDate(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date());
}

function activeTab(snapshot: BrowserSnapshot | null): TabSnapshot | undefined {
  return snapshot?.tabs.find((tab) => tab.id === snapshot.activeTabId);
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [panel, setPanel] = useState<Panel>('home');
  const [address, setAddress] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toolbarPopover, setToolbarPopover] = useState<'protection' | 'profile' | 'menu' | null>(null);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [clearDataBusy, setClearDataBusy] = useState(false);
  const [clearDataMessage, setClearDataMessage] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentTab = activeTab(snapshot);
  const isInternal = currentTab?.isInternal ?? true;
  const theme = snapshot?.settings.theme ?? 'system';

  useEffect(() => {
    let mounted = true;
    void window.browserApi.getSnapshot().then((next) => {
      if (mounted) setSnapshot(next);
    });
    const removeSnapshotListener = window.browserApi.onSnapshotChanged((next) => setSnapshot(next));
    return () => {
      mounted = false;
      removeSnapshotListener();
    };
  }, []);

  useEffect(() => {
    const removeTabEventListener = window.browserApi.onTabEvent((event) => {
      const nextToast = event.type === 'navigation-error'
        ? { tone: 'error' as const, message: event.message ?? 'Не удалось открыть страницу.' }
        : event.type === 'renderer-gone'
          ? { tone: 'error' as const, message: 'Вкладка завершила работу. Перезагрузите страницу.' }
          : event.type === 'download-started'
            ? { tone: 'success' as const, message: 'Загрузка добавлена в панель «Загрузки».' }
            : null;
      if (!nextToast) return;
      setToast(nextToast);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    });
    return () => {
      removeTabEventListener();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isEditingAddress) setAddress(currentTab?.isInternal ? '' : currentTab?.url ?? '');
  }, [currentTab?.id, currentTab?.url, currentTab?.isInternal, isEditingAddress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-omnibox]')?.focus();
        document.querySelector<HTMLInputElement>('[data-omnibox]')?.select();
      }
      if (modifier && event.key.toLowerCase() === 't') {
        event.preventDefault();
        void window.browserApi.createTab();
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void window.browserApi.createTab({ isPrivate: true });
      }
      if (modifier && event.key.toLowerCase() === 'w' && currentTab) {
        event.preventDefault();
        void window.browserApi.closeTab(currentTab.id);
      }
      if (modifier && event.key.toLowerCase() === 'd' && currentTab) {
        event.preventDefault();
        void window.browserApi.toggleBookmark(currentTab.id);
      }
      if (event.key === 'Escape' && panel !== 'home') {
        event.preventDefault();
        setPanel('home');
        setSidebarCollapsed(false);
      }
      if (event.key === 'Escape' && toolbarPopover) {
        event.preventDefault();
        setToolbarPopover(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTab, panel]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (prefersDark.matches ? 'dark' : 'light') : theme;
      root.dataset.theme = resolved;
    };
    apply();
    prefersDark.addEventListener('change', apply);
    return () => prefersDark.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (panel !== 'home') {
      void window.browserApi.setChromeBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const updateBounds = () => {
      const bounds = viewport.getBoundingClientRect();
      void window.browserApi.setChromeBounds({
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(viewport);
    window.addEventListener('resize', updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [panel, sidebarCollapsed]);

  const isBookmarked = useMemo(
    () => Boolean(snapshot?.bookmarks.some((bookmark) => bookmark.url === currentTab?.url)),
    [snapshot?.bookmarks, currentTab?.url],
  );

  if (!snapshot) return <div className="boot-screen">Запуск MonkeyBuissnesBrowser…</div>;

  const submitAddress = (value = address) => {
    if (!currentTab) return;
    setIsEditingAddress(false);
    void window.browserApi.navigate(currentTab.id, value);
  };

  const openPanel = (nextPanel: Panel) => {
    setPanel(nextPanel);
    setSidebarCollapsed(false);
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="window-titlebar">
        <div className="brand-lockup">
          <img className="brand-logo" src={brandLogo} alt="MonkeyBuissnesBrowser" />
        </div>
        <div className="window-actions" aria-label="Управление окном">
          <button className="window-button no-drag" aria-label="Свернуть" onClick={() => void window.browserApi.minimizeWindow()}><Minus size={15} /></button>
          <button className="window-button no-drag" aria-label="Развернуть" onClick={() => void window.browserApi.toggleMaximizeWindow()}><Square size={13} /></button>
          <button className="window-button close no-drag" aria-label="Закрыть" onClick={() => void window.browserApi.closeWindow()}><X size={15} /></button>
        </div>
      </div>

      <TabStrip snapshot={snapshot} onActivate={(id) => void window.browserApi.activateTab(id)} onClose={(id) => void window.browserApi.closeTab(id)} onCreate={() => void window.browserApi.createTab()} />

      <aside className="sidebar">
        <div className="sidebar-scroll">
          <NavItem icon={<Home size={18} />} label="Главная" active={panel === 'home'} collapsed={sidebarCollapsed} onClick={() => openPanel('home')} />
          <NavItem icon={<Bookmark size={18} />} label="Закладки" active={panel === 'bookmarks'} collapsed={sidebarCollapsed} onClick={() => openPanel('bookmarks')} />
          <NavItem icon={<History size={18} />} label="История" active={panel === 'history'} collapsed={sidebarCollapsed} onClick={() => openPanel('history')} />
          <NavItem icon={<Download size={18} />} label="Загрузки" active={panel === 'downloads'} collapsed={sidebarCollapsed} onClick={() => openPanel('downloads')} />
          <NavItem icon={<Shield size={18} />} label="Защита" active={false} collapsed={sidebarCollapsed} badge="beta" onClick={() => openPanel('settings')} />
          <div className="sidebar-divider" />
          {!sidebarCollapsed && <div className="sidebar-section-label">Пространства</div>}
          {snapshot.workspaces.map((workspace) => (
            <button className={`workspace-row ${currentTab?.workspaceId === workspace.id ? 'active' : ''}`} key={workspace.id} title={workspace.name} aria-current={currentTab?.workspaceId === workspace.id ? 'page' : undefined} onClick={() => void window.browserApi.switchWorkspace(workspace.id)}>
              <span className="workspace-dot" style={{ background: workspace.color }} />
              {!sidebarCollapsed && <span>{workspace.name}</span>}
              {!sidebarCollapsed && <span className="workspace-count">{workspace.tabIds.length || '—'}</span>}
            </button>
          ))}
          {workspaceCreateOpen && !sidebarCollapsed ? <form className="workspace-create-form" onSubmit={(event) => { event.preventDefault(); const name = workspaceDraft.trim(); if (!name) return; void window.browserApi.createWorkspace(name).then(() => { setWorkspaceDraft(''); setWorkspaceCreateOpen(false); }); }}><input autoFocus value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} placeholder="Название" maxLength={40} aria-label="Название пространства" /><button type="submit" aria-label="Создать пространство"><Plus size={15} /></button></form> : <button className="new-space" title={sidebarCollapsed ? 'Новое пространство' : undefined} onClick={() => setWorkspaceCreateOpen(true)}><Plus size={16} />{!sidebarCollapsed && 'Новое пространство'}</button>}
        </div>
        <div className="sidebar-bottom">
          <NavItem icon={<Settings size={18} />} label="Настройки" active={panel === 'settings'} collapsed={sidebarCollapsed} onClick={() => openPanel('settings')} />
          <button className="collapse-button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель'}>
            <Menu size={18} />
            {!sidebarCollapsed && <span>Свернуть панель</span>}
          </button>
        </div>
      </aside>

      <header className="toolbar">
        <div className="navigation-actions">
          <button className="icon-button" aria-label="Назад" disabled={!currentTab?.canGoBack} onClick={() => currentTab && void window.browserApi.goBack(currentTab.id)}><ArrowLeft size={18} /></button>
          <button className="icon-button" aria-label="Вперёд" disabled={!currentTab?.canGoForward} onClick={() => currentTab && void window.browserApi.goForward(currentTab.id)}><ArrowRight size={18} /></button>
          <button className="icon-button" aria-label={currentTab?.isLoading ? 'Остановить' : 'Обновить'} onClick={() => currentTab && void (currentTab.isLoading ? window.browserApi.stop(currentTab.id) : window.browserApi.reload(currentTab.id))}><RefreshCw size={17} className={currentTab?.isLoading ? 'spin' : ''} /></button>
        </div>
        <form className="omnibox" onSubmit={(event) => { event.preventDefault(); submitAddress(); }}>
          <Search size={18} className="omnibox-search" />
          <input
            data-omnibox
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => setIsEditingAddress(true)}
            onBlur={() => setIsEditingAddress(false)}
            placeholder="Поиск или введите адрес"
            aria-label="Адресная строка"
          />
          <button type="button" className={`omnibox-action ${isBookmarked ? 'active' : ''}`} aria-label="Добавить в закладки" onMouseDown={(event) => event.preventDefault()} onClick={() => currentTab && void window.browserApi.toggleBookmark(currentTab.id)}><Star size={17} fill={isBookmarked ? 'currentColor' : 'none'} /></button>
        </form>
        <div className="toolbar-actions">
          <button className="icon-button" aria-label="Загрузки" onClick={() => openPanel('downloads')}><Download size={17} /></button>
          <button className={`icon-button status-icon ${toolbarPopover === 'protection' ? 'selected' : ''}`} aria-label="Состояние защиты" aria-expanded={toolbarPopover === 'protection'} onClick={() => setToolbarPopover((current) => current === 'protection' ? null : 'protection')}><Shield size={17} /></button>
          <button className="icon-button" aria-label="Справка и настройки" onClick={() => openPanel('settings')}><CircleHelp size={17} /></button>
          <button className={`profile-chip profile-button ${toolbarPopover === 'profile' ? 'selected' : ''}`} aria-label="Профиль по умолчанию" aria-expanded={toolbarPopover === 'profile'} onClick={() => setToolbarPopover((current) => current === 'profile' ? null : 'profile')}>NS</button>
          <button className={`icon-button ${toolbarPopover === 'menu' ? 'selected' : ''}`} aria-label="Дополнительно" aria-expanded={toolbarPopover === 'menu'} onClick={() => setToolbarPopover((current) => current === 'menu' ? null : 'menu')}><MoreHorizontal size={18} /></button>
        </div>
         {toolbarPopover === 'protection' && <ProtectionPopover blockedTotal={snapshot.adBlock.blockedTotal} privateMode={currentTab?.isPrivate ?? false} onOpenSettings={() => { setToolbarPopover(null); openPanel('settings'); }} />}
        {toolbarPopover === 'profile' && <ProfilePopover onNewPrivateTab={() => { setToolbarPopover(null); void window.browserApi.createTab({ isPrivate: true }); }} onOpenSettings={() => { setToolbarPopover(null); openPanel('settings'); }} />}
        {toolbarPopover === 'menu' && <QuickMenuPopover onNewTab={() => { setToolbarPopover(null); void window.browserApi.createTab(); }} onOpenHistory={() => { setToolbarPopover(null); openPanel('history'); }} onOpenDownloads={() => { setToolbarPopover(null); openPanel('downloads'); }} onOpenSettings={() => { setToolbarPopover(null); openPanel('settings'); }} onToggleSidebar={() => { setToolbarPopover(null); setSidebarCollapsed((value) => !value); }} />}
      </header>

      <main className="content-area">
        <div className={`page-viewport ${panel === 'home' && isInternal ? 'new-tab-visible' : 'chrome-panel-visible'}`} ref={viewportRef}>
           {panel === 'home' && isInternal && <NewTabPage onSearch={(value) => submitAddress(value)} onOpen={(url) => void window.browserApi.createTab({ url })} onOpenSettings={() => openPanel('settings')} backgroundImage={monkeyBackground} privateMode={currentTab?.isPrivate ?? false} />}
          {panel === 'bookmarks' && <BookmarksPanel bookmarks={snapshot.bookmarks} onOpen={(url) => submitAddress(url)} />}
          {panel === 'history' && <HistoryPanel history={snapshot.history} onOpen={(url) => submitAddress(url)} />}
           {panel === 'downloads' && <DownloadsPanel downloads={snapshot.downloads} onOpen={(downloadId) => { void window.browserApi.openDownload(downloadId).catch((error) => setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Не удалось открыть файл.' })); }} onShowInFolder={(downloadId) => void window.browserApi.showDownloadInFolder(downloadId)} />}
          {panel === 'settings' && <SettingsPanel snapshot={snapshot} onClose={() => openPanel('home')} onThemeChange={(value) => void window.browserApi.updateSettings({ theme: value })} onImportVpn={() => window.browserApi.importVpnConfig()} onClearVpn={() => window.browserApi.clearVpnConfig()} onClearHistoryCookies={async () => { setClearDataBusy(true); setClearDataMessage(''); try { await window.browserApi.clearHistoryAndCookies(); setClearDataMessage('История и cookies очищены.'); } finally { setClearDataBusy(false); } }} clearDataBusy={clearDataBusy} clearDataMessage={clearDataMessage} />}
        </div>
      </main>
      {toast && <div className={`app-toast ${toast.tone}`} role="status"><span>{toast.tone === 'error' ? <AlertTriangle size={16} /> : toast.tone === 'success' ? <CheckCircle2 size={16} /> : <CircleHelp size={16} />}</span>{toast.message}<button type="button" aria-label="Закрыть уведомление" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </div>
  );
}

function TabStrip({ snapshot, onActivate, onClose, onCreate }: { snapshot: BrowserSnapshot; onActivate: (id: string) => void; onClose: (id: string) => void; onCreate: () => void }): React.JSX.Element {
  return (
    <div className="tab-strip">
      <div className="tab-list" role="tablist">
        {snapshot.tabs.map((tab) => <React.Fragment key={tab.id}>
          <button className={`tab ${tab.id === snapshot.activeTabId ? 'active' : ''}`} onClick={() => onActivate(tab.id)} role="tab" aria-selected={tab.id === snapshot.activeTabId}>
            <span className="tab-favicon">{tab.isPrivate ? <Shield size={14} /> : tab.isInternal ? <Sparkles size={14} /> : tab.favicon ? <img src={tab.favicon} alt="" /> : <Globe2 size={14} />}</span>
            <span className="tab-title">{tab.title || 'Новая вкладка'}</span>
            {tab.isLoading && <span className="tab-loading" />}
            <span className="tab-close" role="button" aria-label="Закрыть вкладку" onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}><X size={14} /></span>
          </button>
          {tab.id === snapshot.activeTabId && <button type="button" className="new-tab-button" aria-label="Новая вкладка" onClick={(event) => { event.stopPropagation(); onCreate(); }}><Plus size={18} /></button>}
        </React.Fragment>)}
        {snapshot.tabs.length === 0 && <button type="button" className="new-tab-button" aria-label="Новая вкладка" onClick={onCreate}><Plus size={18} /></button>}
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, collapsed, badge, onClick }: { icon: React.ReactNode; label: string; active: boolean; collapsed: boolean; badge?: string; onClick: () => void }): React.JSX.Element {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>{icon}{!collapsed && <span>{label}</span>}{!collapsed && badge && <span className="nav-badge">{badge}</span>}</button>;
}

function NewTabPage({ onSearch, onOpen, onOpenSettings, backgroundImage, privateMode }: { onSearch: (value: string) => void; onOpen: (url: string) => void; onOpenSettings: () => void; backgroundImage: string; privateMode: boolean }): React.JSX.Element {
  const [feedFilter, setFeedFilter] = useState('Все');
  const visibleFeedItems = feedFilter === 'Все' ? feedItems : feedItems.filter((item) => item.category === feedFilter);
  return (
    <div className="new-tab-page" style={{ backgroundImage: `linear-gradient(180deg, rgba(16,27,45,.15), rgba(16,27,45,.62)), url(${backgroundImage})` }}>
       <div className="new-tab-overlay">
         <div className="hero-copy">
           <p className="eyebrow">{privateMode ? 'АНОНИМНАЯ СЕССИЯ · БЕЗ СОХРАНЕНИЯ ИСТОРИИ' : 'MONKEY BROWSER · СПОКОЙНЫЙ РЕЖИМ'}</p>
           <h1>{privateMode ? 'Приватная вкладка' : 'Доброе утро'}</h1>
           <p>{privateMode ? 'Временная сессия без постоянных cookies и истории. IP-адрес не скрывается.' : 'Меньше шума. Больше возможностей.'}</p>
        </div>
        <form className="hero-search" onSubmit={(event) => { event.preventDefault(); const query = event.currentTarget.elements.namedItem('query'); onSearch(query instanceof HTMLInputElement ? query.value : ''); }}>
          <Search size={21} />
          <input name="query" placeholder="Поиск в интернете или введите адрес" aria-label="Поиск на новой вкладке" />
          <button type="submit" aria-label="Искать"><Sparkles size={18} /></button>
        </form>
        <div className="quick-links" aria-label="Быстрые ссылки">
          {quickLinks.map((link) => <button key={link.label} className="quick-link" onClick={() => onOpen(link.url)}><span className={`quick-icon ${link.tone}`}><Globe2 size={20} /></span><span>{link.label}</span></button>)}
          <button className="quick-link add" onClick={() => { const url = window.prompt('Адрес быстрого доступа', 'https://'); if (url?.startsWith('http')) onOpen(url); }}><span className="quick-icon neutral"><Plus size={20} /></span><span>Добавить</span></button>
        </div>
        <div className="dashboard-grid">
          <section className="feature-card">
            <div className="feature-card-image" style={{ backgroundImage: `url(${backgroundImage})` }} />
            <div className="feature-card-content"><p className="eyebrow">ИДЕИ ДЛЯ ПЕРЕЗАГРУЗКИ</p><h2>Открывайте места,<br />где становится тише.</h2><p>Подборки маршрутов, истории и вдохновение для следующего свободного дня.</p><button onClick={() => onOpen('https://www.openstreetmap.org/')}><ChevronRight size={18} /></button></div>
          </section>
          <section className="feed-card">
             <div className="card-header"><div><p className="eyebrow">ДЛЯ ВАС</p><h3>Небольшие находки</h3></div><button className="text-button" onClick={() => setFeedFilter('Все')}>Все <ChevronRight size={15} /></button></div>
             <div className="feed-tabs">{['Все', 'Идеи', 'Путешествия', 'Работа'].map((category) => <button key={category} className={feedFilter === category ? 'active' : ''} onClick={() => setFeedFilter(category)}>{category}</button>)}</div>
             <div className="feed-list">{visibleFeedItems.map((item) => <button className="feed-item" key={item.title} onClick={() => onOpen('https://developer.mozilla.org/')}><div className={`feed-thumb ${item.image}`} /><span className="feed-item-copy"><strong>{item.title}</strong><small>{item.meta}</small></span><ChevronRight size={15} /></button>)}</div>
          </section>
          <section className="widget-card">
             <div className="card-header"><div><p className="eyebrow">СЕГОДНЯ</p><h3>Ваши ориентиры</h3></div><button className="icon-button subtle" aria-label="Настроить виджеты" onClick={onOpenSettings}><MoreHorizontal size={18} /></button></div>
            <div className="weather-empty"><Sun size={23} /><span><strong>Погода не настроена</strong><small>Добавьте город в настройках</small></span></div>
            <div className="widget-row"><CheckCircle2 size={18} /><span>Один важный шаг</span><ChevronRight size={15} /></div>
            <div className="widget-row"><CalendarDays size={18} /><span>{formatDate()}</span><ChevronRight size={15} /></div>
            <div className="widget-promo"><span>Пространство для вашего дня</span><ExternalLink size={16} /></div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }): React.JSX.Element {
  return <div className="panel-header"><div className="panel-icon">{icon}</div><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function ToolbarPopover({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="toolbar-popover" role="dialog"><div className="toolbar-popover-title">{title}</div>{children}</div>;
}

function PopoverAction({ icon, label, detail, onClick }: { icon: React.ReactNode; label: string; detail?: string; onClick: () => void }): React.JSX.Element {
  return <button className="popover-action" onClick={onClick}><span className="popover-action-icon">{icon}</span><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><ChevronRight size={15} /></button>;
}

function ProtectionPopover({ blockedTotal, privateMode, onOpenSettings }: { blockedTotal: number; privateMode: boolean; onOpenSettings: () => void }): React.JSX.Element {
  return <ToolbarPopover title="Защита"><div className="protection-status"><span className="protection-dot" /><span><strong>Базовая защита активна</strong><small>Заблокировано запросов: {blockedTotal}</small></span></div>{privateMode && <div className="protection-status muted"><Shield size={16} /><span><strong>Анонимная сессия включена</strong><small>История и site data не сохраняются. IP не скрывается.</small></span></div>}<div className="protection-status muted"><Shield size={16} /><span><strong>VPN не настроен</strong><small>Импортируйте WireGuard-конфигурацию в настройках.</small></span></div><button className="popover-primary" onClick={onOpenSettings}>Открыть настройки</button></ToolbarPopover>;
}

function ProfilePopover({ onNewPrivateTab, onOpenSettings }: { onNewPrivateTab: () => void; onOpenSettings: () => void }): React.JSX.Element {
  return <ToolbarPopover title="Профиль"><div className="profile-summary"><div className="profile-avatar-large">NS</div><span><strong>Профиль по умолчанию</strong><small>Обычная сессия браузера</small></span></div><PopoverAction icon={<Shield size={16} />} label="Новая анонимная вкладка" detail="Временная сессия без истории и cookies" onClick={onNewPrivateTab} /><div className="profile-privacy-note">Это режим приватности, а не Tor/VPN: IP-адрес и сетевой оператор не скрываются.</div><PopoverAction icon={<Settings size={16} />} label="Настройки профиля" onClick={onOpenSettings} /></ToolbarPopover>;
}

function QuickMenuPopover({ onNewTab, onOpenHistory, onOpenDownloads, onOpenSettings, onToggleSidebar }: { onNewTab: () => void; onOpenHistory: () => void; onOpenDownloads: () => void; onOpenSettings: () => void; onToggleSidebar: () => void }): React.JSX.Element {
  return <ToolbarPopover title="Быстрые действия"><PopoverAction icon={<Plus size={16} />} label="Новая вкладка" onClick={onNewTab} /><PopoverAction icon={<History size={16} />} label="История" onClick={onOpenHistory} /><PopoverAction icon={<Download size={16} />} label="Загрузки" onClick={onOpenDownloads} /><PopoverAction icon={<Settings size={16} />} label="Настройки" onClick={onOpenSettings} /><PopoverAction icon={<Menu size={16} />} label="Свернуть панель" onClick={onToggleSidebar} /></ToolbarPopover>;
}

function BookmarksPanel({ bookmarks, onOpen }: { bookmarks: BrowserSnapshot['bookmarks']; onOpen: (url: string) => void }): React.JSX.Element {
  return <section className="utility-panel"><PanelHeader icon={<Bookmark size={20} />} title="Закладки" subtitle={`${bookmarks.length} сохранённых адреса`} />{bookmarks.length === 0 ? <EmptyState icon={<Star size={28} />} title="Здесь пока пусто" description="Сохраните страницу кнопкой со звездой в адресной строке." /> : <div className="entry-list">{bookmarks.map((bookmark) => <button className="entry-row" key={bookmark.id} onClick={() => onOpen(bookmark.url)}><span className="entry-icon"><Globe2 size={17} /></span><span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span><ExternalLink size={16} /></button>)}</div>}</section>;
}

function HistoryPanel({ history, onOpen }: { history: HistoryEntry[]; onOpen: (url: string) => void }): React.JSX.Element {
  return <section className="utility-panel"><PanelHeader icon={<History size={20} />} title="История" subtitle={`${history.length} последних посещений`} />{history.length === 0 ? <EmptyState icon={<History size={28} />} title="История пуста" description="Посещённые страницы появятся здесь после навигации." /> : <div className="entry-list">{history.slice(0, 50).map((entry) => <button className="entry-row" key={entry.id} onClick={() => onOpen(entry.url)}><span className="entry-icon"><Globe2 size={17} /></span><span><strong>{entry.title}</strong><small>{entry.url}</small></span><span className="entry-time">{new Date(entry.visitedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>}</section>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

function downloadIcon(kind: DownloadEntry['kind']): React.JSX.Element {
  if (kind === 'image') return <Image size={19} />;
  if (kind === 'video') return <Film size={19} />;
  if (kind === 'audio') return <Music2 size={19} />;
  return <File size={19} />;
}

function downloadKindLabel(kind: DownloadEntry['kind']): string {
  return { image: 'Изображение', video: 'Видео', audio: 'Аудио', file: 'Файл' }[kind];
}

function downloadStatus(download: DownloadEntry, percent: number | null): string {
  if (download.state === 'queued') return 'Подготовка к сохранению…';
  if (download.state === 'progressing') return percent === null ? 'Загрузка…' : `Загрузка · ${percent}%`;
  if (download.state === 'completed') return 'Сохранено';
  if (download.state === 'cancelled') return 'Отменено';
  return 'Прервано';
}

function DownloadRow({ download, onOpen, onShowInFolder }: { download: DownloadEntry; onOpen: (downloadId: string) => void; onShowInFolder: (downloadId: string) => void }): React.JSX.Element {
  const percent = download.totalBytes > 0 ? Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)) : null;
  const isActive = download.state === 'queued' || download.state === 'progressing';
  return <article className={`download-row ${download.state}`}>
    <div className={`download-preview ${download.thumbnail ? 'has-thumbnail' : ''}`}>
      {download.thumbnail ? <img src={download.thumbnail} alt="" /> : downloadIcon(download.kind)}
      {isActive && <span className="download-preview-loader"><LoaderCircle size={15} /></span>}
    </div>
    <div className="download-main">
      <div className="download-title-line"><strong title={download.filename}>{download.filename}</strong><span className="download-kind">{downloadKindLabel(download.kind)}</span></div>
      <div className="download-meta"><span>{downloadStatus(download, percent)}</span><span>{formatBytes(download.receivedBytes)}{download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ''}</span></div>
      <div className={`download-progress ${percent === null ? 'indeterminate' : ''}`} aria-label={percent === null ? 'Прогресс загрузки неизвестен' : `Загружено ${percent}%`}><span style={percent === null ? undefined : { width: `${percent}%` }} /></div>
      {download.error && <small className="download-error">{download.error}</small>}
    </div>
    <div className="download-row-actions">{download.state === 'completed' && download.path && <><button type="button" className="download-action" aria-label="Открыть файл" title="Открыть файл" onClick={() => onOpen(download.id)}><ExternalLink size={15} /></button><button type="button" className="download-action" aria-label="Показать в папке" title="Показать в папке" onClick={() => onShowInFolder(download.id)}><FolderOpen size={15} /></button></>}<span className="download-status-icon" aria-label={downloadStatus(download, percent)}>{isActive ? <LoaderCircle size={18} className="download-spinner" /> : download.state === 'completed' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span></div>
  </article>;
}

function DownloadsPanel({ downloads, onOpen, onShowInFolder }: { downloads: DownloadEntry[]; onOpen: (downloadId: string) => void; onShowInFolder: (downloadId: string) => void }): React.JSX.Element {
  return <section className="utility-panel"><PanelHeader icon={<Download size={20} />} title="Загрузки" subtitle={`${downloads.length} сохранённых файлов`} /><div className="download-help"><strong>Изображения и видео</strong><span>Каждая загрузка появляется здесь сразу, показывает прогресс и после завершения получает миниатюру изображения. Защищённые DRM-потоки и сегментированные стримы браузер не обходит.</span></div>{downloads.length === 0 ? <EmptyState icon={<Download size={28} />} title="Загрузок пока нет" description="Когда вы сохраните файл, его прогресс и состояние появятся здесь." /> : <div className="download-list">{downloads.map((download) => <DownloadRow download={download} key={download.id} onOpen={onOpen} onShowInFolder={onShowInFolder} />)}</div>}</section>;
}

const importKinds: Array<{ value: ImportDataKind; label: string }> = [
  { value: 'history', label: 'История' },
  { value: 'bookmarks', label: 'Закладки' },
  { value: 'cookies', label: 'Cookies' },
  { value: 'passwords', label: 'Пароли' },
];

function ImportDataCard(): React.JSX.Element {
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<ImportDataKind[]>(['history', 'bookmarks', 'cookies', 'passwords']);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);

  const refreshProfiles = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await window.browserApi.discoverImportProfiles();
      setProfiles(next);
      setSelectedProfileId((current) => next.some((profile) => profile.id === current) ? current : next[0]?.id ?? '');
      if (next.length === 0) setMessage('Профили Chrome, Яндекс Браузера или Firefox не найдены.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось найти профили браузеров.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refreshProfiles(); }, []);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const toggleKind = (kind: ImportDataKind) => setSelectedKinds((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]);
  const importData = async () => {
    if (!selectedProfileId || selectedKinds.length === 0) return;
    setBusy(true);
    setMessage('');
    setReport(null);
    try {
      const next = await window.browserApi.importBrowserData({ profileId: selectedProfileId, data: selectedKinds });
      setReport(next);
      setMessage('Импорт завершён.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Импорт не выполнен.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="import-card"><div className="import-card-heading"><div className="vpn-title"><div className="panel-icon"><Database size={19} /></div><span><strong>Импорт данных браузера</strong><small>Локальный импорт из Google Chrome, Яндекс Браузера или Firefox без отправки данных наружу.</small></span></div><button className="icon-button subtle" aria-label="Обновить список профилей" onClick={() => void refreshProfiles()} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /></button></div><div className="import-controls"><label className="import-field"><span>Профиль</span><select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={busy || profiles.length === 0}><option value="">Профиль не выбран</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.browserLabel} · {profile.profileName}</option>)}</select></label><div className="import-field"><span>Что импортировать</span><div className="import-checks">{importKinds.map((kind) => <label key={kind.value} className="import-check"><input type="checkbox" checked={selectedKinds.includes(kind.value)} onChange={() => toggleKind(kind.value)} disabled={busy || !selectedProfile?.available.includes(kind.value)} /><span>{kind.label}</span></label>)}</div></div></div><div className="import-actions"><button className="vpn-primary" disabled={busy || !selectedProfileId || selectedKinds.length === 0} onClick={() => void importData()}><Database size={15} /> {busy ? 'Импортируем…' : 'Импортировать выбранное'}</button>{selectedProfile && <small>Источник: {selectedProfile.path}</small>}</div><div className="import-note"><KeyRound size={14} /> Пароли сохраняются только в зашифрованное хранилище приложения. На Linux поддерживается системный keyring Chromium; для Firefox используйте официальный CSV-экспорт, если профиль защищён NSS.</div>{message && <div className="setting-status ready">{message}</div>}{report && <div className="import-report"><strong>Результат импорта</strong><span>История: {report.imported.history} · Закладки: {report.imported.bookmarks} · Cookies: {report.imported.cookies} · Пароли: {report.imported.passwords}</span>{report.skipped.cookies + report.skipped.passwords > 0 && <span>Пропущено защищённых записей: {report.skipped.cookies + report.skipped.passwords}</span>}{report.warnings.map((warning) => <span key={warning}>{warning}</span>)}{report.errors.map((error) => <span key={error}>{error}</span>)}</div>}</div>;
}

function SettingsPanel({ snapshot, onClose, onThemeChange, onImportVpn, onClearVpn, onClearHistoryCookies, clearDataBusy, clearDataMessage }: { snapshot: BrowserSnapshot; onClose: () => void; onThemeChange: (value: 'light' | 'dark' | 'system') => void; onImportVpn: () => Promise<unknown>; onClearVpn: () => Promise<unknown>; onClearHistoryCookies: () => Promise<void>; clearDataBusy: boolean; clearDataMessage: string }): React.JSX.Element {
  const workingSetMb = snapshot.performance ? Math.round(snapshot.performance.totalWorkingSet / 1024) : null;
  const [vpnBusy, setVpnBusy] = useState(false);
  const [vpnError, setVpnError] = useState('');
  const importVpn = async () => {
    setVpnBusy(true);
    setVpnError('');
    try { await onImportVpn(); } catch (error) { setVpnError(error instanceof Error ? error.message : 'Не удалось импортировать конфигурацию.'); } finally { setVpnBusy(false); }
  };
  const clearVpn = async () => {
    setVpnBusy(true);
    setVpnError('');
    try { await onClearVpn(); } catch (error) { setVpnError(error instanceof Error ? error.message : 'Не удалось удалить конфигурацию.'); } finally { setVpnBusy(false); }
  };
  const vpn = snapshot.vpn;
  return <section className="utility-panel settings-panel"><div className="settings-heading"><PanelHeader icon={<Settings size={20} />} title="Настройки" subtitle="Внешний вид и поведение MonkeyBuissnesBrowser" /><button className="back-to-home" onClick={onClose}><ArrowLeft size={16} /> На главную</button></div><div className="settings-grid"><ImportDataCard /><label className="setting-card"><span><strong>Тема интерфейса</strong><small>Системная тема или ручной выбор.</small></span><select value={snapshot.settings.theme} onChange={(event) => onThemeChange(event.target.value as 'light' | 'dark' | 'system')}><option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><div className="data-settings-card"><div><strong>История и cookies</strong><small>Удаляет историю навигации и cookies обычного профиля. Приватные данные не сохраняются.</small></div><button className="vpn-secondary" disabled={clearDataBusy} onClick={() => void onClearHistoryCookies()}><Trash2 size={15} /> {clearDataBusy ? 'Очищаем…' : 'Очистить данные'}</button>{clearDataMessage && <span className="setting-status ready">{clearDataMessage}</span>}</div><div className="vpn-settings-card"><div className="vpn-settings-header"><div className="vpn-title"><div className="panel-icon"><Shield size={19} /></div><span><strong>VPN · WireGuard</strong><small>Импорт конфигурации и проверка профиля без фиктивного подключения.</small></span></div><span className={`vpn-state ${vpn.state}`}>{vpn.state === 'configured' ? 'Профиль проверен' : vpn.state === 'error' ? 'Ошибка' : 'Не настроен'}</span></div>{vpn.configured ? <div className="vpn-details"><div><span>Профиль</span><strong>{vpn.profileName}</strong></div><div><span>Режим</span><strong>Системный VPN</strong></div><div><span>Сервер</span><strong>{vpn.endpoint ?? 'Не указан'}</strong></div><div><span>Peer-ов</span><strong>{vpn.peerCount}</strong></div><div><span>Адрес</span><strong>{vpn.addresses.join(', ') || 'Не указан'}</strong></div><div><span>DNS</span><strong>{vpn.dns.join(', ') || 'Не указан'}</strong></div></div> : <div className="vpn-empty"><Shield size={22} /><span><strong>Конфигурация не импортирована</strong><small>Выберите .conf-файл WireGuard. Туннель не будет запущен автоматически.</small></span></div>}{vpn.savedSecurely ? <div className="vpn-secure-note"><CheckCircle2 size={15} /> Конфигурация сохранена через системное защищённое хранилище.</div> : vpn.configured && <div className="vpn-warning"><AlertTriangle size={15} /> Защищённое хранилище недоступно: профиль действует только до завершения этой сессии.</div>}{vpn.errors.length > 0 && <div className="vpn-errors">{vpn.errors.map((error) => <span key={error}><AlertTriangle size={14} /> {error}</span>)}</div>}{vpnError && <div className="vpn-errors"><span><AlertTriangle size={14} /> {vpnError}</span></div>}<div className="vpn-actions"><button className="vpn-primary" disabled={vpnBusy} onClick={() => void importVpn()}><Upload size={15} /> {vpnBusy ? 'Проверка…' : vpn.configured ? 'Заменить конфигурацию' : 'Импортировать .conf'}</button>{vpn.configured && <button className="vpn-secondary" disabled={vpnBusy} onClick={() => void clearVpn()}><Trash2 size={15} /> Удалить профиль</button>}</div><small className="vpn-disclaimer">Подключение, handshake, маршруты, DNS, IPv6, WebRTC и kill switch ещё не выполняются этим приложением.</small></div><div className="setting-card"><span><strong>AdBlock</strong><small>Базовые правила активны; заблокировано запросов: {snapshot.adBlock.blockedTotal}.</small></span><span className="setting-status ready">Активен</span></div><div className="setting-card"><span><strong>Память и процессы</strong><small>{workingSetMb === null ? 'Метрики ещё собираются.' : `Рабочий набор процессов: ${workingSetMb} МБ · процессов: ${snapshot.performance?.processCount ?? '—'}`}</small></span><span className="setting-status ready">Live</span></div><div className="setting-card"><span><strong>Усыпление вкладок</strong><small>Реальные метрики и manual hibernate API готовы; автоматическое правило требует дополнительных исключений.</small></span><span className="setting-status">Ручной режим</span></div></div></section>;
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }): React.JSX.Element {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
