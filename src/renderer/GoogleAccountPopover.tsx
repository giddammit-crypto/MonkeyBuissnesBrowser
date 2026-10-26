import React, { useState } from "react";
import {
  Database,
  Film,
  Globe2,
  LogIn,
  Plus,
  Search,
  Trash2,
  User,
} from "lucide-react";
import type { BrowserSnapshot } from "../shared/types";

export function GoogleAccountPopover({
  snapshot,
  onClose,
  onCreateTab,
}: {
  snapshot: BrowserSnapshot;
  onClose: () => void;
  onCreateTab: (url: string) => void;
}): React.JSX.Element {
  const accounts = snapshot.googleAccounts || [];
  const activeAccount =
    snapshot.activeGoogleAccount ||
    accounts.find((a) => a.isActive) ||
    accounts[0] ||
    null;
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest(".account-toolbar-btn")) {
          onClose();
        }
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail || !addEmail.includes("@")) return;
    await window.browserApi.addGoogleAccount(
      addEmail.trim(),
      addName.trim() || undefined,
    );
    setAddEmail("");
    setAddName("");
    setShowAddForm(false);
  };

  return (
    <div
      ref={popoverRef}
      className="google-popover"
      role="dialog"
      aria-label="Аккаунт Google"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="google-popover-header">
        <div className="google-popover-title">
          <svg className="google-g-icon" viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Google Аккаунт</span>
        </div>
        <div
          className="google-sso-badge"
          title="Сайты автоматически распознают ваш Google аккаунт через OAuth и One-Tap"
        >
          <span className="google-sso-dot" />
          <span>SSO Авто-вход</span>
        </div>
      </div>

      {activeAccount ? (
        <div className="google-active-card">
          {activeAccount.avatar ? (
            <img src={activeAccount.avatar} alt="" className="google-active-avatar" />
          ) : (
            <div className="google-avatar-placeholder">
              {(activeAccount.name || activeAccount.email)[0].toUpperCase()}
            </div>
          )}
          <div className="google-account-info">
            <div className="google-account-name">
              {activeAccount.name || activeAccount.email.split("@")[0]}
            </div>
            <div className="google-account-email">{activeAccount.email}</div>
          </div>
        </div>
      ) : (
        <button
          className="google-btn-primary"
          onClick={() => {
            onCreateTab("https://accounts.google.com/ServiceLogin");
            onClose();
          }}
        >
          <LogIn size={16} />
          Войти через Google
        </button>
      )}

      {accounts.length > 1 && (
        <div className="google-account-list">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className={`google-account-item ${acc.id === activeAccount?.id ? "active" : ""}`}
              onClick={() => {
                void window.browserApi.switchGoogleAccount(acc.id);
              }}
            >
              <div className="google-account-item-left">
                {acc.avatar ? (
                  <img
                    src={acc.avatar}
                    alt=""
                    className="google-account-item-avatar"
                  />
                ) : (
                  <div className="google-account-item-placeholder">
                    {(acc.name || acc.email)[0].toUpperCase()}
                  </div>
                )}
                <div className="google-account-item-text">
                  <div className="google-account-item-name">
                    {acc.name || acc.email.split("@")[0]}
                  </div>
                  <div className="google-account-item-email">{acc.email}</div>
                </div>
              </div>
              <button
                className="icon-button danger-hover"
                title="Удалить аккаунт"
                onClick={(e) => {
                  e.stopPropagation();
                  void window.browserApi.removeGoogleAccount(acc.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAddForm ? (
        <form
          onSubmit={handleAddAccount}
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          <input
            type="email"
            placeholder="Электронная почта Google"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            required
            style={{
              padding: "6px 10px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface-subtle)",
              color: "var(--text)",
              fontSize: "12px",
            }}
          />
          <input
            type="text"
            placeholder="Имя (необязательно)"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface-subtle)",
              color: "var(--text)",
              fontSize: "12px",
            }}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="submit"
              className="google-btn-primary"
              style={{ flex: 1, height: "30px" }}
            >
              Сохранить
            </button>
            <button
              type="button"
              className="google-btn-secondary"
              style={{ flex: 1, height: "30px" }}
              onClick={() => setShowAddForm(false)}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="google-btn-secondary"
            onClick={() => {
              onCreateTab("https://accounts.google.com/AddSession");
              onClose();
            }}
          >
            <Plus size={14} />
            Добавить аккаунт
          </button>
          <button
            className="google-btn-secondary"
            onClick={() => setShowAddForm(true)}
          >
            <User size={14} />
            Вручную
          </button>
        </div>
      )}

      <div className="google-services-grid">
        <button
          className="google-service-chip"
          onClick={() => {
            onCreateTab("https://www.youtube.com");
            onClose();
          }}
          title="Открыть YouTube"
        >
          <Film size={16} color="#FF0000" />
          <span>YouTube</span>
        </button>
        <button
          className="google-service-chip"
          onClick={() => {
            onCreateTab("https://mail.google.com");
            onClose();
          }}
          title="Открыть Gmail"
        >
          <Globe2 size={16} color="#EA4335" />
          <span>Gmail</span>
        </button>
        <button
          className="google-service-chip"
          onClick={() => {
            onCreateTab("https://drive.google.com");
            onClose();
          }}
          title="Открыть Google Диск"
        >
          <Database size={16} color="#34A853" />
          <span>Диск</span>
        </button>
        <button
          className="google-service-chip"
          onClick={() => {
            onCreateTab("https://www.google.com");
            onClose();
          }}
          title="Открыть Google Поиск"
        >
          <Search size={16} color="#4285F4" />
          <span>Поиск</span>
        </button>
      </div>

      <div className="google-auto-sync-hint">
        💡 Сайты (Pinterest, Figma, Spotify и др.) автоматически подхватывают выбранный аккаунт.
      </div>
    </div>
  );
}

export default GoogleAccountPopover;
