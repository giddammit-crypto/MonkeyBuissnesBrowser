import React, { useEffect, useRef, useState } from 'react';
import { Columns2, X } from 'lucide-react';
import type { BrowserSnapshot, TabSnapshot } from '../shared/types';
import './split-view.css';

interface SplitViewControlsProps {
  snapshot: BrowserSnapshot;
  currentTab?: TabSnapshot;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: unknown) => void;
}

function canPair(tab: TabSnapshot): boolean {
  return !tab.isPrivate && !tab.isInternal && tab.lifecycle !== 'crashed'
    && !tab.isReaderActive && !tab.isPictureInPicture;
}

export default function SplitViewControls({ snapshot, currentTab, open, disabled, onOpenChange, onError }: SplitViewControlsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [selectedTab, setSelectedTab] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 140, left: 12, maxHeight: 400 });
  const candidates = snapshot.tabs.filter((tab) => tab.id !== currentTab?.id && canPair(tab) && tab.workspaceId === currentTab?.workspaceId);
  const selected = candidates.some((tab) => tab.id === selectedTab) ? selectedTab : candidates[0]?.id || '';
  const unavailable = disabled || !currentTab || !canPair(currentTab);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const bounds = buttonRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(350, Math.max(0, window.innerWidth - 24));
      const top = Math.min(bounds.bottom + 8, Math.max(12, window.innerHeight - 300));
      setPickerPosition({ top, left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)), maxHeight: Math.max(120, window.innerHeight - top - 12) });
    };
    position();
    window.addEventListener('resize', position);
    const timer = setTimeout(() => selectRef.current?.focus(), 0);
    const close = () => { onOpenChange(false); buttonRef.current?.focus(); };
    const pointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', position);
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, [open, onOpenChange]);

  const enable = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await window.browserApi.setSplitView(selected);
      onOpenChange(false);
      buttonRef.current?.focus();
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  };

  return <div className="split-controls" ref={containerRef}>
    <button type="button" ref={buttonRef} className={`icon-button ${snapshot.splitView ? 'selected' : ''}`}
      disabled={unavailable} aria-label="Две страницы рядом" aria-expanded={open} aria-controls="split-view-picker"
      title={unavailable ? 'Две страницы рядом: открой обычную веб-страницу вне режима чтения или PiP' : 'Две страницы рядом'}
      onClick={() => onOpenChange(!open)}><Columns2 size={18} /></button>
    {open && <section id="split-view-picker" className="split-picker" style={pickerPosition} role="dialog" aria-label="Открыть две страницы рядом">
      <div className="split-picker-heading"><strong>Две страницы рядом</strong>
        <button type="button" className="icon-button" aria-label="Закрыть выбор второй страницы" onClick={() => { onOpenChange(false); buttonRef.current?.focus(); }}><X size={16} /></button>
      </div>
      <p>Сравнивай источники или работай с двумя сайтами одновременно.</p>
      <label htmlFor="split-secondary-tab">Вторая страница</label>
      <select ref={selectRef} id="split-secondary-tab" value={selected} disabled={busy || !candidates.length}
        onChange={(event) => setSelectedTab(event.target.value)}>
        {!candidates.length && <option value="">Нет подходящей вкладки</option>}
        {candidates.map((tab) => <option key={tab.id} value={tab.id}>{tab.title || tab.url}</option>)}
      </select>
      <p className="split-picker-note">{candidates.length ? 'Доступны обычные вкладки текущего пространства. При выборе третьей вкладки разделение закроется.' : 'Открой ещё одну обычную веб-страницу в этом пространстве. Режим чтения и PiP нужно выключить.'}</p>
      <button type="button" className="primary-button" disabled={!selected || busy || unavailable} onClick={() => void enable()}>{busy ? 'Открываем…' : 'Показать рядом'}</button>
    </section>}
  </div>;
}

export function SplitViewStatus({ snapshot, onError }: { snapshot: BrowserSnapshot; onError: (error: unknown) => void }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const split = snapshot.splitView;
  if (!split) return null;
  const primary = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const secondary = snapshot.tabs.find((tab) => tab.id === split.secondaryTabId);
  if (!primary || !secondary) return null;
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { onError(error); }
    finally { setBusy(false); }
  };
  return <div className="split-view-status" role="region" aria-label="Открыты две страницы рядом">
    <Columns2 size={15} aria-hidden="true" />
    <span className="split-page-title" title={primary.title || primary.url}>Основная: {primary.title || primary.url}</span>
    <button type="button" className="split-page-switch" title="Сделать вторую страницу основной" disabled={busy}
      onClick={() => void perform(() => window.browserApi.activateTab(secondary.id))}>Рядом: {secondary.title || secondary.url}</button>
    <label className="split-ratio-label">Размеры
      <select aria-label="Соотношение размеров двух страниц" disabled={busy} value={split.ratio}
        onChange={(event) => void perform(() => window.browserApi.setSplitViewRatio(Number(event.target.value)))}>
        <option value={0.5}>50 / 50</option><option value={0.35}>35 / 65</option><option value={0.65}>65 / 35</option>
        {![0.5, 0.35, 0.65].includes(split.ratio) && <option value={split.ratio}>{Math.round(split.ratio * 100)} / {Math.round((1 - split.ratio) * 100)}</option>}
      </select>
    </label>
    <button type="button" className="split-close" disabled={busy} onClick={() => void perform(() => window.browserApi.setSplitView())} aria-label="Закрыть режим двух страниц"><X size={15} /> <span>Одна страница</span></button>
  </div>;
}
