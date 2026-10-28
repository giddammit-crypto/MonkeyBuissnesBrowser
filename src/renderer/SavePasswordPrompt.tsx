import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Globe, KeyRound, Lock, RefreshCw, User, X } from 'lucide-react';
import type { SavePasswordOffer } from '../shared/types';
import './save-password-prompt.css';

export interface SavePasswordPromptProps {
  offer: SavePasswordOffer;
  onSave: (origin: string, username: string, password: string) => Promise<void>;
  onDismiss: () => void;
  onNeverSave: (origin: string) => Promise<void>;
}

function extractDomain(rawOrigin: string): string {
  try {
    const url = new URL(rawOrigin.includes('://') ? rawOrigin : `https://${rawOrigin}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return rawOrigin.replace(/^https?:\/\//, '').split('/')[0] || rawOrigin;
  }
}

export const SavePasswordPrompt: React.FC<SavePasswordPromptProps> = ({
  offer,
  onSave,
  onDismiss,
  onNeverSave,
}) => {
  const [username, setUsername] = useState(offer.username || '');
  const [password, setPassword] = useState(offer.password || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isNeverSaving, setIsNeverSaving] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const usernameInputId = useId();
  const passwordInputId = useId();

  // Keep state synced if offer changes while prompt is displayed
  useEffect(() => {
    setUsername(offer.username || '');
    setPassword(offer.password || '');
    setError(null);
  }, [offer.origin, offer.username, offer.password]);

  const domain = useMemo(() => {
    return offer.domain || extractDomain(offer.origin);
  }, [offer.domain, offer.origin]);

  const handleDismiss = () => {
    if (isSaving || isDismissing) return;
    setIsDismissing(true);
    setTimeout(() => {
      onDismiss();
    }, 200);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving || isDismissing) return;

    if (!password.trim()) {
      setError('Введите пароль');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave(offer.origin, username.trim(), password);
      setIsDismissing(true);
      setTimeout(() => {
        onDismiss();
      }, 150);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить пароль';
      setError(msg);
      setIsSaving(false);
    }
  };

  const handleNeverSave = async () => {
    if (isSaving || isNeverSaving || isDismissing) return;
    setIsNeverSaving(true);
    try {
      await onNeverSave(offer.origin);
      handleDismiss();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить выбор';
      setError(msg);
      setIsNeverSaving(false);
    }
  };

  // Keyboard navigation: Escape closes prompt
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, isDismissing]);

  const isUpdate = Boolean(offer.isUpdate);

  return (
    <aside
      ref={containerRef}
      className={`save-password-prompt ${isDismissing ? 'is-dismissing' : ''}`}
      role="dialog"
      aria-labelledby="save-pwd-title"
      aria-modal="false"
      data-testid="save-password-prompt"
    >
      {/* Header */}
      <header className="save-password-header">
        <div className="save-password-icon-wrapper" aria-hidden="true">
          <KeyRound size={18} />
          <span
            className={`save-password-led ${isUpdate ? 'is-updating' : ''}`}
            title={`CyberLife LED Status: ${isUpdate ? 'Updating Credentials' : 'New Credentials Offer'}`}
          />
        </div>

        <div className="save-password-titles">
          <h2 id="save-pwd-title" className="save-password-title">
            {isUpdate ? 'Обновить пароль?' : 'Сохранить пароль?'}
          </h2>
          <span className="save-password-domain-badge" title={offer.origin}>
            <Globe size={11} />
            {domain}
          </span>
        </div>

        <button
          type="button"
          className="save-password-close-btn"
          onClick={handleDismiss}
          disabled={isSaving || isNeverSaving}
          aria-label="Закрыть уведомление"
          title="Закрыть"
        >
          <X size={15} />
        </button>
      </header>

      {/* Body / Form */}
      <form onSubmit={handleSave} className="save-password-body" noValidate>
        {/* Username Field */}
        <div className="save-password-field">
          <label htmlFor={usernameInputId} className="save-password-label">
            Логин или Email
          </label>
          <div className="save-password-input-group">
            <span className="save-password-input-icon" aria-hidden="true">
              <User size={15} />
            </span>
            <input
              id={usernameInputId}
              type="text"
              className="save-password-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Имя пользователя или email"
              autoComplete="username"
              disabled={isSaving || isNeverSaving}
            />
          </div>
        </div>

        {/* Password Field */}
        <div className="save-password-field">
          <label htmlFor={passwordInputId} className="save-password-label">
            Пароль
          </label>
          <div className="save-password-input-group">
            <span className="save-password-input-icon" aria-hidden="true">
              <Lock size={15} />
            </span>
            <input
              id={passwordInputId}
              type={showPassword ? 'text' : 'password'}
              className="save-password-input pwd-code"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="current-password"
              disabled={isSaving || isNeverSaving}
            />
            <button
              type="button"
              className="save-password-toggle-btn"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              tabIndex={0}
              disabled={isSaving || isNeverSaving}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="save-password-error-message" role="alert" style={{ color: '#f43f5e', fontSize: 11, marginTop: -4 }}>
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="save-password-actions">
          <div className="save-password-btn-row">
            <button
              type="submit"
              className="btn-save-pwd"
              disabled={isSaving || isNeverSaving}
              aria-busy={isSaving}
            >
              {isSaving ? (
                <>
                  <RefreshCw size={14} className="pwd-spin" />
                  Сохранение…
                </>
              ) : (
                <>
                  <KeyRound size={14} />
                  {isUpdate ? 'Обновить' : 'Сохранить'}
                </>
              )}
            </button>

            <button
              type="button"
              className="btn-dismiss-pwd"
              onClick={handleDismiss}
              disabled={isSaving || isNeverSaving}
            >
              Не сейчас
            </button>
          </div>

          <button
            type="button"
            className="btn-never-pwd"
            onClick={handleNeverSave}
            disabled={isSaving || isNeverSaving}
          >
            {isNeverSaving ? 'Сохраняем выбор…' : 'Никогда для этого сайта'}
          </button>
        </div>
      </form>
    </aside>
  );
};

export default SavePasswordPrompt;
