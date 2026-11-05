import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Search, Type, X } from 'lucide-react';
import type { PageFontReport } from '../shared/types';
import './font-diagnostics.css';

export interface FontDiagnosticsModalProps {
  tabId: string;
  onDismiss: () => void;
  onError?: (error: unknown) => void;
}

const FONT_STATUS: Record<PageFontReport['faces'][number]['status'], string> = {
  unloaded: 'Не запрошен', loading: 'Загружается', loaded: 'Загружен', error: 'Ошибка загрузки',
};

export default function FontDiagnosticsModal({ tabId, onDismiss, onError }: FontDiagnosticsModalProps): React.JSX.Element {
  const [report, setReport] = useState<PageFontReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setReport(null);
    void window.browserApi.getPageFonts(tabId).then(value => {
      if (current) setReport(value);
    }).catch(reason => {
      if (!current) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось получить сведения о шрифтах.');
      onErrorRef.current?.(reason);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [tabId, revision]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru');
    const matches = (font: { family: string; style: string; weight: string }) =>
      !search || `${font.family} ${font.style} ${font.weight}`.toLocaleLowerCase('ru').includes(search);
    return { faces: report?.faces.filter(matches) ?? [], computed: report?.computedFonts.filter(matches) ?? [] };
  }, [query, report]);
  const failed = report?.faces.filter(face => face.status === 'error').length ?? 0;
  const loaded = report?.faces.filter(face => face.status === 'loaded').length ?? 0;

  return <div className="font-diagnostics-backdrop" onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className="font-diagnostics-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="font-diagnostics-title"
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? [])]
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (!controls.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="font-diagnostics-header">
        <div className="font-diagnostics-heading"><Type size={22} aria-hidden="true" /><div><h2 id="font-diagnostics-title">Шрифты страницы</h2><p>Загрузка и оформление текста</p></div></div>
        <button className="icon-button" type="button" ref={closeRef} aria-label="Закрыть шрифты страницы" title="Закрыть · Esc" onClick={onDismiss}><X size={18} /></button>
      </header>
      <div className="font-diagnostics-toolbar">
        <label className="font-diagnostics-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Название шрифта" aria-label="Найти шрифт" disabled={!report} /></label>
        <button className="font-diagnostics-refresh" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Обновить</button>
      </div>
      <div className="font-diagnostics-body" aria-busy={loading}>
        {loading && <div className="font-diagnostics-state" role="status"><LoaderCircle className="font-diagnostics-spinner" size={25} aria-hidden="true" /><p>Проверяем шрифты страницы…</p></div>}
        {!loading && error && <div className="font-diagnostics-state" role="alert"><AlertTriangle size={25} aria-hidden="true" /><p>{error}</p><button className="font-diagnostics-refresh" type="button" onClick={() => setRevision(value => value + 1)}>Попробовать ещё раз</button></div>}
        {!loading && report && <>
          <div className="font-diagnostics-summary" role="status">
            {failed ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
            <span>Загружено: <strong>{loaded}</strong>{failed > 0 && <> · С ошибкой: <strong>{failed}</strong></>}{report.documentStatus === 'loading' && ' · Загрузка продолжается'}</span>
          </div>
          <section aria-labelledby="font-diagnostics-web-title">
            <h3 id="font-diagnostics-web-title">Подключённые веб-шрифты <span>{report.faces.length}</span></h3>
            <p className="font-diagnostics-help">«Не запрошен» означает, что страница ещё не использовала это начертание.</p>
            {filtered.faces.length > 0 ? <ul className="font-diagnostics-list">{filtered.faces.map((font, index) => <li key={`${font.family}-${font.style}-${font.weight}-${index}`}>
              <div className="font-diagnostics-font"><strong>{font.family}</strong><span>{font.weight} · {font.style}</span></div>
              <span className={`font-diagnostics-badge font-status-${font.status}`}>{FONT_STATUS[font.status]}</span>
            </li>)}</ul> : <p className="font-diagnostics-empty">{query.trim() ? 'Совпадений нет.' : 'Подключённые веб-шрифты не найдены. Страница может использовать системные шрифты.'}</p>}
            {report.facesTruncated && <p className="font-diagnostics-help">Показаны первые {report.faces.length} подключённых начертаний.</p>}
          </section>
          <section aria-labelledby="font-diagnostics-css-title">
            <h3 id="font-diagnostics-css-title">Шрифты в стилях страницы</h3>
            <p className="font-diagnostics-help">Список CSS содержит и запасные шрифты. Он не определяет, каким шрифтом нарисован каждый символ.</p>
            {filtered.computed.length > 0 ? <ul className="font-diagnostics-list">{filtered.computed.map((font, index) => <li key={`${font.family}-${font.style}-${font.weight}-${index}`}>
              <div className="font-diagnostics-font"><strong>{font.family}</strong><span>{font.weight} · {font.style}</span></div><span className="font-diagnostics-count">Элементов: {font.count}</span>
            </li>)}</ul> : <p className="font-diagnostics-empty">{query.trim() ? 'Совпадений нет.' : 'Текстовые элементы не найдены.'}</p>}
          </section>
          <p className="font-diagnostics-footnote">Проверено элементов: {report.sampledElements} · {new Date(report.sampledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
        </>}
      </div>
      <footer className="font-diagnostics-footer">Проверка читает только сведения о шрифтах этой вкладки.</footer>
    </div>
  </div>;
}
