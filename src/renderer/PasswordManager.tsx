import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { ImportedPasswordSummary, TabSnapshot } from '../shared/types';
import './password-manager.css';

interface PasswordManagerProps {
  currentTab?: TabSnapshot;
  onChanged?: () => void;
  onBeforeFill?: () => void | Promise<void>;
  onFeedback?: (message: string, isError?: boolean) => void;
}

const origin = (raw?: string): string | null => {
  try {
    const url = new URL(raw || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
};

function generateSecurePassword(length = 18): string {
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const symbols = '!@#$%^&*-_+=';
  const all = lowercase + uppercase + numbers + symbols;

  const result: string[] = [
    lowercase[Math.floor(Math.random() * lowercase.length)],
    uppercase[Math.floor(Math.random() * uppercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  const remaining = Math.max(0, length - result.length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const array = new Uint32Array(remaining);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < array.length; i++) {
      result.push(all[array[i] % all.length]);
    }
  } else {
    for (let i = 0; i < remaining; i++) {
      result.push(all[Math.floor(Math.random() * all.length)]);
    }
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }

  return result.join('');
}

export default function PasswordManager({
  currentTab,
  onChanged,
  onBeforeFill,
  onFeedback,
}: PasswordManagerProps): React.JSX.Element {
  const [records, setRecords] = useState<ImportedPasswordSummary[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  // Add Password Form State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newOrigin, setNewOrigin] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newShowPassword, setNewShowPassword] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Password Reveal & Copy State
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string | null>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<{ id: string; field: 'username' | 'password' } | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mounted = useRef(true);
  const refreshEpoch = useRef(0);

  const feedback = useCallback(
    (text: string, isError = false) => {
      if (mounted.current) {
        setMessage(isError ? '' : text);
        setError(isError ? text : '');
      }
      onFeedback?.(text, isError);
    },
    [onFeedback],
  );

  const refresh = useCallback(async () => {
    const epoch = ++refreshEpoch.current;
    if (mounted.current) setLoading(true);
    try {
      const next = await window.browserApi.getImportedPasswordSummaries();
      if (mounted.current && epoch === refreshEpoch.current) {
        setRecords(next);
        setLoadError('');
      }
    } catch {
      if (mounted.current && epoch === refreshEpoch.current) {
        setRecords([]);
        setLoadError('Список паролей сейчас недоступен. Сохранённые данные не изменены. Проверьте системное хранилище паролей и повторите попытку.');
      }
    } finally {
      if (mounted.current && epoch === refreshEpoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const changed = () => {
      void refresh();
    };
    const remove = window.browserApi.onTabEvent((event) => {
      if (event.type === 'passwords-changed') changed();
    });
    window.addEventListener('soul-passwords-changed', changed);
    window.addEventListener('focus', changed);
    return () => {
      mounted.current = false;
      refreshEpoch.current++;
      remove();
      window.removeEventListener('soul-passwords-changed', changed);
      window.removeEventListener('focus', changed);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [refresh]);

  const currentOrigin = currentTab && !currentTab.isPrivate && !currentTab.isInternal ? origin(currentTab.url) : null;

  const filtered = useMemo(
    () =>
      records.filter((record) =>
        `${record.origin} ${record.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [records, query],
  );

  const handleOpenAdd = () => {
    setIsAddOpen((prev) => {
      const next = !prev;
      if (next && currentOrigin && !newOrigin) {
        setNewOrigin(currentOrigin);
      }
      return next;
    });
    setAddError('');
  };

  const handleGeneratePassword = () => {
    const pwd = generateSecurePassword(18);
    setNewPassword(pwd);
    setNewShowPassword(true);
  };

  const handleSaveNewPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isAdding) return;

    const trimmedUrl = newOrigin.trim();
    if (!trimmedUrl) {
      setAddError('Укажите адрес сайта');
      return;
    }

    let targetOrigin = trimmedUrl;
    try {
      const parsed = new URL(trimmedUrl.includes('://') ? trimmedUrl : `https://${trimmedUrl}`);
      targetOrigin = parsed.origin;
    } catch {
      setAddError('Некорректный адрес сайта. Используйте формат https://example.com');
      return;
    }

    if (!newPassword.trim()) {
      setAddError('Введите пароль или нажмите «Случайный»');
      return;
    }

    setAddError('');
    setIsAdding(true);
    try {
      await window.browserApi.saveCredential(targetOrigin, newUsername.trim(), newPassword);
      await refresh();
      onChanged?.();
      feedback(`Пароль для ${targetOrigin} успешно сохранён в защищённом хранилище.`);
      setIsAddOpen(false);
      setNewOrigin('');
      setNewUsername('');
      setNewPassword('');
      setNewShowPassword(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить пароль. Проверьте системное хранилище.';
      setAddError(msg);
    } finally {
      if (mounted.current) setIsAdding(false);
    }
  };

  const toggleRevealPassword = async (record: ImportedPasswordSummary) => {
    if (revealedPasswords[record.id]) {
      setRevealedPasswords((prev) => ({ ...prev, [record.id]: null }));
      return;
    }

    setRevealingId(record.id);
    try {
      const secret = await window.browserApi.revealSavedPassword(record.id);
      if (mounted.current) {
        setRevealedPasswords((prev) => ({ ...prev, [record.id]: secret || '••••••••' }));
      }
    } catch {
      feedback('Не удалось получить пароль из защищённого хранилища.', true);
    } finally {
      if (mounted.current) setRevealingId(null);
    }
  };

  const copyToClipboard = async (text: string, id: string, field: 'username' | 'password') => {
    try {
      await navigator.clipboard.writeText(text);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopiedField({ id, field });
      copyTimeoutRef.current = setTimeout(() => {
        if (mounted.current) setCopiedField(null);
      }, 2000);
      feedback(field === 'username' ? 'Логин скопирован в буфер обмена.' : 'Пароль скопирован в буфер обмена.');
    } catch {
      feedback('Не удалось скопировать данные в буфер обмена.', true);
    }
  };

  const handleCopyPassword = async (record: ImportedPasswordSummary) => {
    let secret = revealedPasswords[record.id];
    if (!secret) {
      setRevealingId(record.id);
      try {
        secret = await window.browserApi.revealSavedPassword(record.id);
        if (mounted.current && secret) {
          setRevealedPasswords((prev) => ({ ...prev, [record.id]: secret }));
        }
      } catch {
        feedback('Не удалось получить пароль для копирования.', true);
        return;
      } finally {
        if (mounted.current) setRevealingId(null);
      }
    }

    if (secret) {
      await copyToClipboard(secret, record.id, 'password');
    }
  };

  const remove = async (record: ImportedPasswordSummary) => {
    setBusy(record.id);
    setMessage('');
    setError('');
    try {
      const deleted = await window.browserApi.deleteSavedPassword(record.id);
      if (deleted) {
        await refresh();
        onChanged?.();
        feedback('Сохранённый пароль удалён.');
      }
    } catch {
      feedback('Запись не удалена. Проверьте доступность защищённого хранилища.', true);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const fill = async (record: ImportedPasswordSummary) => {
    if (!currentTab || !currentOrigin || origin(record.origin) !== currentOrigin) return;
    setBusy(record.id);
    setMessage('');
    setError('');
    try {
      if (onBeforeFill) await onBeforeFill();
      else await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const result = await window.browserApi.fillSavedPassword(currentTab.id, record.id);
      feedback(
        result.filled
          ? 'Поля заполнены. Браузер не нажимает кнопку входа.'
          : result.reason || 'Поля не заполнены.',
        !result.filled && result.reason !== 'Заполнение отменено.',
      );
    } catch {
      feedback('Заполнение отклонено: проверьте HTTPS-адрес, выбранную вкладку и видимую форму входа.', true);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  return (
    <section className="import-card password-manager" data-password-manager>
      {/* Header */}
      <div className="import-card-heading">
        <div className="vpn-title">
          <div className="panel-icon">
            <KeyRound size={19} />
          </div>
          <span>
            <strong>Сохранённые пароли</strong>
            <small>
              {loading
                ? 'Читаем хранилище…'
                : loadError
                  ? 'Хранилище недоступно. Записи не удалены.'
                  : `В хранилище: ${records.length} записей. Защищённое хранилище soulm8te Vault.`}
            </small>
          </span>
        </div>

        <div className="heading-actions">
          <button
            type="button"
            className="btn-add-password"
            onClick={handleOpenAdd}
            disabled={loading || busy !== null}
            title={isAddOpen ? 'Закрыть форму' : 'Добавить новый логин и пароль вручную'}
          >
            {isAddOpen ? <X size={14} /> : <Plus size={14} />}
            {isAddOpen ? 'Отмена' : 'Добавить пароль'}
          </button>

          <button
            type="button"
            className="icon-button subtle"
            aria-label="Обновить список паролей"
            title="Обновить список"
            disabled={loading || busy !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Manual Add Password Form */}
      {isAddOpen && (
        <form onSubmit={handleSaveNewPassword} className="add-password-card" noValidate>
          <div className="add-password-heading">
            <h4>
              <KeyRound size={15} color="#00f0ff" />
              Добавить пароль вручную
            </h4>
            <button
              type="button"
              className="icon-button subtle"
              onClick={() => setIsAddOpen(false)}
              aria-label="Закрыть форму"
              title="Закрыть"
            >
              <X size={15} />
            </button>
          </div>

          <div className="add-password-fields">
            {/* Origin / Site */}
            <div className="add-password-field">
              <label>
                <Globe size={12} /> Сайт / URL
              </label>
              <div className="add-input-wrap">
                <input
                  type="url"
                  value={newOrigin}
                  onChange={(e) => setNewOrigin(e.target.value)}
                  placeholder="https://example.com"
                  autoComplete="url"
                  disabled={isAdding}
                />
              </div>
            </div>

            {/* Username / Login */}
            <div className="add-password-field">
              <label>
                <User size={12} /> Логин / Email
              </label>
              <div className="add-input-wrap">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="user@example.com или логин"
                  autoComplete="username"
                  disabled={isAdding}
                />
              </div>
            </div>

            {/* Password with generator & eye toggle */}
            <div className="add-password-field" style={{ gridColumn: '1 / -1' }}>
              <label>
                <Lock size={12} /> Пароль
              </label>
              <div className="add-input-wrap">
                <input
                  type={newShowPassword ? 'text' : 'password'}
                  className="pwd-code"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Пароль"
                  autoComplete="new-password"
                  disabled={isAdding}
                />
                <button
                  type="button"
                  className="add-input-action-btn"
                  onClick={() => setNewShowPassword((prev) => !prev)}
                  aria-label={newShowPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  title={newShowPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  disabled={isAdding}
                >
                  {newShowPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="button"
                  className="add-input-action-btn btn-gen-pwd"
                  onClick={handleGeneratePassword}
                  title="Сгенерировать случайный надёжный пароль"
                  disabled={isAdding}
                >
                  <Sparkles size={13} />
                  Случайный
                </button>
              </div>
            </div>
          </div>

          {addError && (
            <div className="vpn-errors" role="alert" style={{ marginTop: 4, padding: '8px 12px' }}>
              {addError}
            </div>
          )}

          <div className="add-actions">
            <button
              type="button"
              className="btn-cancel-new-pwd"
              onClick={() => setIsAddOpen(false)}
              disabled={isAdding}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn-save-new-pwd"
              disabled={isAdding}
              aria-busy={isAdding}
            >
              {isAdding ? (
                <>
                  <RefreshCw size={13} className="spin" />
                  Сохранение…
                </>
              ) : (
                <>
                  <Check size={14} />
                  Сохранить
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Info note */}
      <div className="import-note">
        <Shield size={16} />
        <span>
          Заполнение доступно после подтверждения, только при совпадении HTTPS-домена и порта открытой обычной вкладки.
          Поддерживается видимая форма входа в верхнем документе; iframe, формы регистрации и другие сайты не заполняются.
          Браузер не нажимает кнопку входа. Сайт может сам реагировать на ввод.
        </span>
      </div>

      {/* Search field */}
      <label className="import-field">
        <span>
          <Search size={14} /> Найти сайт или логин
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Адрес сайта или имя пользователя"
          aria-label="Поиск сохранённых паролей"
          autoComplete="off"
          disabled={loading || Boolean(loadError)}
        />
      </label>

      {!currentOrigin && (
        <div className="import-note">
          Для заполнения откройте HTTPS-сайт в обычной вкладке и вернитесь в этот раздел.
        </div>
      )}

      {currentOrigin && (
        <div className="import-note">
          Открытый сайт: <strong>{currentOrigin}</strong>
        </div>
      )}

      {/* Records list */}
      {loadError ? (
        <div className="vpn-errors" role="alert">
          {loadError}
        </div>
      ) : loading && !records.length ? (
        <p role="status">Открываем защищённое хранилище…</p>
      ) : !filtered.length ? (
        <p>
          {records.length
            ? 'Совпадений не найдено.'
            : 'Сохранённых записей пока нет. Импортируйте пароли из браузера или добавьте вручную.'}
        </p>
      ) : (
        <div className="password-record-list" style={{ display: 'grid', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
          {filtered.map((record) => {
            const eligible = Boolean(currentOrigin && origin(record.origin) === currentOrigin);
            const isRevealed = Boolean(revealedPasswords[record.id]);
            const isRevealing = revealingId === record.id;
            const isCopiedUser = copiedField?.id === record.id && copiedField?.field === 'username';
            const isCopiedPwd = copiedField?.id === record.id && copiedField?.field === 'password';

            return (
              <article key={record.id} className="setting-card password-record" style={{ flexWrap: 'wrap', gap: 12 }}>
                <span style={{ minWidth: 0, flex: '1 1 230px', overflowWrap: 'anywhere' }}>
                  <strong>{record.origin}</strong>
                  <small>{record.username || 'Логин не указан'}</small>

                  {/* Revealed password indicator */}
                  {isRevealed && (
                    <div className="pwd-revealed-row">
                      <span className="pwd-revealed-label">Пароль:</span>
                      <code className="pwd-revealed-code">{revealedPasswords[record.id]}</code>
                    </div>
                  )}
                </span>

                <div className="import-actions" style={{ flexWrap: 'wrap', margin: 0 }}>
                  {/* Eye / EyeOff reveal button */}
                  <button
                    type="button"
                    className="icon-button pwd-action-btn"
                    aria-label={isRevealed ? `Скрыть пароль для ${record.origin}` : `Показать пароль для ${record.origin}`}
                    title={isRevealed ? 'Скрыть пароль' : 'Показать пароль'}
                    disabled={loading || busy !== null || isRevealing}
                    onClick={() => void toggleRevealPassword(record)}
                  >
                    {isRevealing ? <RefreshCw size={15} className="spin" /> : isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>

                  {/* Copy username button */}
                  <button
                    type="button"
                    className="icon-button pwd-action-btn"
                    aria-label={`Скопировать логин для ${record.origin}`}
                    title="Скопировать логин"
                    disabled={loading || busy !== null || !record.username}
                    onClick={() => void copyToClipboard(record.username, record.id, 'username')}
                  >
                    {isCopiedUser ? <Check size={15} className="pwd-copied-icon" /> : <Copy size={15} />}
                  </button>

                  {/* Copy password button */}
                  <button
                    type="button"
                    className="icon-button pwd-action-btn"
                    aria-label={`Скопировать пароль для ${record.origin}`}
                    title="Скопировать пароль"
                    disabled={loading || busy !== null || isRevealing}
                    onClick={() => void handleCopyPassword(record)}
                  >
                    {isCopiedPwd ? <Check size={15} className="pwd-copied-icon" /> : <Copy size={15} />}
                  </button>

                  {/* Fill on site button */}
                  <button
                    type="button"
                    className="vpn-secondary"
                    disabled={loading || !eligible || busy !== null}
                    title={eligible ? 'Показать сайт и подтвердить заполнение' : 'Запись относится к другому HTTPS-адресу'}
                    onClick={() => void fill(record)}
                  >
                    <KeyRound size={14} /> Заполнить на сайте
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Удалить пароль для ${record.origin}, ${record.username || 'без логина'}`}
                    title="Удалить запись"
                    disabled={loading || busy !== null}
                    onClick={() => void remove(record)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {message && (
        <div className="setting-status ready" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="vpn-errors" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
