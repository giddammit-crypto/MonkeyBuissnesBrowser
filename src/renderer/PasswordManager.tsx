import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, RefreshCw, Search, Shield, Trash2 } from 'lucide-react';
import type { ImportedPasswordSummary, TabSnapshot } from '../shared/types';
import './password-manager.css';

interface PasswordManagerProps {
  currentTab?: TabSnapshot;
  onChanged?: () => void;
  onBeforeFill?: () => void | Promise<void>;
  onFeedback?: (message: string, isError?: boolean) => void;
}
const origin = (raw?: string): string | null => {
  try { const url = new URL(raw || ''); return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null; } catch { return null; }
};

export default function PasswordManager({ currentTab, onChanged, onBeforeFill, onFeedback }: PasswordManagerProps): React.JSX.Element {
  const [records, setRecords] = useState<ImportedPasswordSummary[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const mounted = useRef(true);
  const refreshEpoch = useRef(0);
  const feedback = useCallback((text: string, isError = false) => {
    if (mounted.current) { setMessage(isError ? '' : text); setError(isError ? text : ''); }
    onFeedback?.(text, isError);
  }, [onFeedback]);
  const refresh = useCallback(async () => {
    const epoch = ++refreshEpoch.current;
    if (mounted.current) setLoading(true);
    try {
      const next = await window.browserApi.getImportedPasswordSummaries();
      if (mounted.current && epoch === refreshEpoch.current) { setRecords(next); setLoadError(''); }
    } catch {
      if (mounted.current && epoch === refreshEpoch.current) {
        setRecords([]);
        setLoadError('Список паролей сейчас недоступен. Сохранённые данные не изменены. Проверьте системное хранилище паролей и повторите попытку.');
      }
    } finally { if (mounted.current && epoch === refreshEpoch.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const changed = () => { void refresh(); };
    const remove = window.browserApi.onTabEvent(event => { if (event.type === 'passwords-changed') changed(); });
    window.addEventListener('soul-passwords-changed', changed);
    window.addEventListener('focus', changed);
    return () => { mounted.current = false; refreshEpoch.current++; remove(); window.removeEventListener('soul-passwords-changed', changed); window.removeEventListener('focus', changed); };
  }, [refresh]);
  const currentOrigin = currentTab && !currentTab.isPrivate && !currentTab.isInternal ? origin(currentTab.url) : null;
  const filtered = useMemo(() => records.filter(record => `${record.origin} ${record.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [records, query]);
  const remove = async (record: ImportedPasswordSummary) => {
    setBusy(record.id); setMessage(''); setError('');
    try {
      const deleted = await window.browserApi.deleteSavedPassword(record.id);
      if (deleted) { await refresh(); onChanged?.(); feedback('Сохранённый пароль удалён.'); }
    } catch { feedback('Запись не удалена. Проверьте доступность защищённого хранилища.', true); }
    finally { if (mounted.current) setBusy(null); }
  };
  const fill = async (record: ImportedPasswordSummary) => {
    if (!currentTab || !currentOrigin || origin(record.origin) !== currentOrigin) return;
    setBusy(record.id); setMessage(''); setError('');
    try {
      if (onBeforeFill) await onBeforeFill();
      else await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const result = await window.browserApi.fillSavedPassword(currentTab.id, record.id);
      feedback(result.filled ? 'Поля заполнены. Браузер не нажимает кнопку входа.' : result.reason || 'Поля не заполнены.', !result.filled && result.reason !== 'Заполнение отменено.');
    } catch { feedback('Заполнение отклонено: проверьте HTTPS-адрес, выбранную вкладку и видимую форму входа.', true); }
    finally { if (mounted.current) setBusy(null); }
  };
  return <section className="import-card password-manager" data-password-manager>
    <div className="import-card-heading"><div className="vpn-title"><div className="panel-icon"><KeyRound size={19} /></div><span><strong>Сохранённые пароли</strong><small>{loading ? "Читаем хранилище…" : loadError ? "Хранилище недоступно. Записи не удалены." : `В хранилище: ${records.length}. Пароли не выводятся в интерфейс.`}</small></span></div><button type="button" className="icon-button subtle" aria-label="Обновить список паролей" title="Обновить список" disabled={loading || busy !== null} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>
    <div className="import-note"><Shield size={16} /><span>Заполнение доступно после подтверждения, только при совпадении HTTPS-домена и порта открытой обычной вкладки. Поддерживается видимая форма входа в верхнем документе; iframe, формы регистрации и другие сайты не заполняются. Браузер не нажимает кнопку входа. Сайт может сам реагировать на ввод.</span></div>
    <label className="import-field"><span><Search size={14} /> Найти сайт или логин</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Адрес сайта или имя пользователя" aria-label="Поиск сохранённых паролей" autoComplete="off" disabled={loading || Boolean(loadError)} /></label>
    {!currentOrigin && <div className="import-note">Для заполнения откройте HTTPS-сайт в обычной вкладке и вернитесь в этот раздел.</div>}
    {currentOrigin && <div className="import-note">Открытый сайт: <strong>{currentOrigin}</strong></div>}
    {loadError ? <div className="vpn-errors" role="alert">{loadError}</div> : loading && !records.length ? <p role="status">Открываем защищённое хранилище…</p> : !filtered.length ? <p>{records.length ? 'Совпадений не найдено.' : 'Сохранённых записей пока нет. Импортируйте пароли из браузера или CSV в разделе переноса данных.'}</p> : <div className="password-record-list" style={{ display: 'grid', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
      {filtered.map(record => {
        const eligible = Boolean(currentOrigin && origin(record.origin) === currentOrigin);
        return <article key={record.id} className="setting-card password-record" style={{ flexWrap: 'wrap', gap: 12 }}><span style={{ minWidth: 0, flex: '1 1 230px', overflowWrap: 'anywhere' }}><strong>{record.origin}</strong><small>{record.username || 'Логин не указан'}</small></span><div className="import-actions" style={{ flexWrap: 'wrap', margin: 0 }}><button type="button" className="vpn-secondary" disabled={loading || !eligible || busy !== null} title={eligible ? 'Показать сайт и подтвердить заполнение' : 'Запись относится к другому HTTPS-адресу'} onClick={() => void fill(record)}><KeyRound size={14} /> Заполнить на сайте</button><button type="button" className="icon-button" aria-label={`Удалить пароль для ${record.origin}, ${record.username || 'без логина'}`} title="Удалить запись" disabled={loading || busy !== null} onClick={() => void remove(record)}><Trash2 size={16} /></button></div></article>;
      })}
    </div>}
    {message && <div className="setting-status ready" role="status">{message}</div>}
    {error && <div className="vpn-errors" role="alert">{error}</div>}
  </section>;
}
