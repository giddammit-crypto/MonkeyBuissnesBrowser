import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Globe2, Search, Shield, X } from 'lucide-react';
import type { BrowserSnapshot } from '../shared/types';

export interface TabSearchProps {
  snapshot: BrowserSnapshot;
  onActivate: (tabId: string) => Promise<void> | void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onDismiss: () => void;
  onError?: (error: unknown) => void;
}

/** Modal tab navigation. It never fetches page icons in the shell's session. */
export default function TabSearch({ snapshot, onActivate, onCloseTab, onDismiss, onError }: TabSearchProps): React.JSX.Element {
  const instanceId = useId();
  // Keep the opening mode fixed: closing its last tab must not suddenly reveal
  // tabs from the other mode while the modal remains on screen.
  const [isPrivate] = useState(() => snapshot.tabs.find(tab => tab.id === snapshot.activeTabId)?.isPrivate ?? false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.activeTabId);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusBeforeOpen = useRef<Element | null>(null);
  const restoreFocus = useRef(true);
  const closingRef = useRef(new Set<string>());
  const workspaceNames = useMemo(() => new Map(snapshot.workspaces.map(workspace => [workspace.id, workspace.name])), [snapshot.workspaces]);
  const tabs = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
    return snapshot.tabs.filter(tab => {
      if (tab.isPrivate !== isPrivate) return false;
      const haystack = `${tab.title}\n${tab.url}\n${workspaceNames.get(tab.workspaceId) ?? ''}`.toLocaleLowerCase('ru-RU');
      return words.every(word => haystack.includes(word));
    });
  }, [snapshot.tabs, query, isPrivate, workspaceNames]);
  const selectedIndex = Math.max(0, tabs.findIndex(tab => tab.id === selectedId));
  const selected = tabs[selectedIndex];

  useEffect(() => {
    focusBeforeOpen.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const previous = focusBeforeOpen.current;
      if (restoreFocus.current && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    // A live snapshot can remove the focused result after its close button runs.
    if (!dialogRef.current?.contains(document.activeElement)) inputRef.current?.focus();
  }, [selected?.id, selectedId, tabs.length]);

  useEffect(() => {
    // Opening on a tab near the end must reveal its selected row without moving
    // keyboard focus away from the search field.
    if (selected) buttonRefs.current.get(selected.id)?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);

  const perform = async (id: string, activate: boolean) => {
    if (closingRef.current.has(id)) return;
    closingRef.current.add(id);
    setPendingIds(new Set(closingRef.current));
    setError('');
    try {
      if (activate) { await onActivate(id); restoreFocus.current = false; onDismiss(); }
      else await onCloseTab(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Действие с вкладкой не выполнено.');
      onError?.(cause);
    } finally {
      closingRef.current.delete(id);
      setPendingIds(new Set(closingRef.current));
    }
  };

  const move = (direction: -1 | 1) => {
    if (!tabs.length) return;
    const startingIndex = tabs.findIndex(tab => tab.id === selectedId);
    const nextIndex = startingIndex === -1 ? (direction > 0 ? 0 : tabs.length - 1) : (startingIndex + direction + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setSelectedId(next.id);
    const button = buttonRefs.current.get(next.id);
    button?.focus();
    button?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowDown' ? 1 : -1); return;
    }
    if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault(); event.stopPropagation();
      if (selected) void perform(selected.id, true);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? [])].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };

  return <div className="tab-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className="tab-search-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${instanceId}-title`} aria-describedby={`${instanceId}-help`} onKeyDown={handleKeyDown}>
      <header className="tab-search-header">
        <div><p className="tab-search-eyebrow">SOUL-M8TE · {isPrivate ? 'Приватная сессия' : 'Обычный профиль'}</p><h2 id={`${instanceId}-title`}>Поиск по вкладкам</h2></div>
        <button type="button" className="icon-button" aria-label="Закрыть поиск по вкладкам" onClick={onDismiss}><X size={19} /></button>
      </header>
      <label className="tab-search-field"><Search size={19} aria-hidden="true" /><input ref={inputRef} type="search" value={query} maxLength={512} onChange={event => { setQuery(event.target.value); setSelectedId(null); }} placeholder="Название, адрес или пространство" aria-label="Поиск по названию или адресу вкладки" autoComplete="off" spellCheck={false} /></label>
      <p className="tab-search-help" id={`${instanceId}-help`}>Вкладки {isPrivate ? 'приватной сессии' : 'обычного профиля'} во всех пространствах. Стрелки — выбрать, Enter — перейти, Escape — закрыть.</p>
      <p className="tab-search-count" role="status" aria-live="polite">Найдено вкладок: {tabs.length}</p>
      <div className="tab-search-results">
        {!tabs.length ? <div className="tab-search-empty"><Search size={26} aria-hidden="true" /><strong>Вкладки не найдены</strong><p>Измените запрос. Вкладки другого режима здесь не отображаются.</p></div> : <ul className="tab-search-list" aria-label="Найденные вкладки">{tabs.map(tab => {
          const title = tab.title || 'Новая вкладка';
          const workspace = workspaceNames.get(tab.workspaceId) ?? 'Пространство';
          return <li key={tab.id} className={`tab-search-row ${selected?.id === tab.id ? 'is-selected' : ''} ${snapshot.activeTabId === tab.id ? 'is-current' : ''}`}>
            <button ref={element => { if (element) buttonRefs.current.set(tab.id, element); else buttonRefs.current.delete(tab.id); }} type="button" className="tab-search-activate" disabled={pendingIds.has(tab.id)} onFocus={() => setSelectedId(tab.id)} onClick={() => void perform(tab.id, true)} aria-current={snapshot.activeTabId === tab.id ? 'page' : undefined} aria-label={`Перейти: ${title}. Адрес: ${tab.url}. Пространство: ${workspace}`}>
              <span className="tab-search-icon" aria-hidden="true">{isPrivate ? <Shield size={18} /> : <Globe2 size={18} />}</span>
              <span className="tab-search-copy"><strong className="tab-search-title">{title}</strong><span className="tab-search-url" title={tab.url}>{tab.url}</span><span className="tab-search-meta">{workspace}{snapshot.activeTabId === tab.id ? ' · Текущая' : ''}{tab.isPinned ? ' · Закреплена' : ''}{tab.lifecycle === 'hibernated' ? ' · Спит' : ''}{tab.lifecycle === 'crashed' ? ' · Требует перезагрузки' : ''}</span></span>
            </button>
            <button type="button" className="tab-search-close icon-button" disabled={pendingIds.has(tab.id)} aria-label={`Закрыть вкладку ${title}`} title={`Закрыть вкладку ${title}`} onClick={() => void perform(tab.id, false)}><X size={17} /></button>
          </li>;
        })}</ul>}
      </div>
      {error && <p className="tab-search-error" role="alert">{error}</p>}
      <footer className="tab-search-footer"><span><ArrowUp size={13} aria-hidden="true" /><ArrowDown size={13} aria-hidden="true" /> Навигация</span><span><kbd>Enter</kbd> Перейти</span><span><kbd>Esc</kbd> Закрыть</span></footer>
    </div>
  </div>;
}
