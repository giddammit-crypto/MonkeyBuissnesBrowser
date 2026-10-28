import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Broom,
  CheckCircle2,
  Clock,
  Cookie,
  CreditCard,
  Database,
  Download,
  Globe,
  HardDrive,
  History,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Rocket,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sliders,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type {
  CleanPresetId,
  CleanResult,
  CleanTargetOptions,
  StorageMetrics,
} from "../shared/types";
import "./click-and-clean.css";

export interface ClickAndCleanModalProps {
  onDismiss: () => void;
  onCleanComplete?: (result: CleanResult) => void;
  onError?: (message: string) => void;
}

interface CleanOptionMeta {
  key: keyof CleanTargetOptions;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  isDanger?: boolean;
  isWarning?: boolean;
  badge?: string;
}

const CLEAN_OPTIONS_CONFIG: CleanOptionMeta[] = [
  {
    key: "cache",
    title: "Кэш браузера",
    description: "Кэш веб-страниц, шейдеров GPU и Code Cache",
    icon: HardDrive,
  },
  {
    key: "cookies",
    title: "Файлы Cookies",
    description: "Файлы cookies и сохраненные токены сессий",
    icon: Cookie,
  },
  {
    key: "history",
    title: "История посещений",
    description: "История открытых сайтов и переходов",
    icon: History,
  },
  {
    key: "downloadsHistory",
    title: "Журнал загрузок",
    description: "Список скачанных файлов (без удаления с диска)",
    icon: Download,
  },
  {
    key: "localStorage",
    title: "Локальные данные (LocalStorage)",
    description: "Постоянные хранилища настроек и данных сайтов",
    icon: Database,
  },
  {
    key: "indexedDB",
    title: "Базы данных (IndexedDB)",
    description: "Структурированные базы веб-приложений",
    icon: Layers,
  },
  {
    key: "serviceWorkers",
    title: "Service Workers и CacheStorage",
    description: "Фоновые скрипты и автономные кэши сайтов",
    icon: Zap,
  },
  {
    key: "authCache",
    title: "Кэш HTTP-авторизации",
    description: "Сетевой кэш учетных записей Basic / Digest",
    icon: Lock,
  },
  {
    key: "dnsCache",
    title: "Кэш DNS-резолвера",
    description: "Внутренний кэш IP-адресов Chromium Host Resolver",
    icon: Globe,
  },
  {
    key: "closedTabsHistory",
    title: "История закрытых вкладок",
    description: "Стек восстановления вкладок (Ctrl+Shift+T)",
    icon: RotateCcw,
  },
  {
    key: "closeTabs",
    title: "Закрыть обычные вкладки",
    description: "Закрыть все открытые вкладки (Режим паники)",
    icon: LogOut,
    isWarning: true,
    badge: "Паника",
  },
  {
    key: "passwords",
    title: "Сохраненные пароли",
    description: "Логины и пароли в зашифрованном хранилище",
    icon: KeyRound,
    isDanger: true,
    badge: "Опасно",
  },
];

const PRESETS: Record<Exclude<CleanPresetId, "custom">, CleanTargetOptions> = {
  quick: {
    cache: true,
    history: true,
    closedTabsHistory: true,
    dnsCache: true,
    cookies: false,
    downloadsHistory: false,
    localStorage: false,
    indexedDB: false,
    serviceWorkers: false,
    authCache: false,
    closeTabs: false,
    passwords: false,
  },
  "post-payment": {
    cache: true,
    cookies: true,
    localStorage: true,
    indexedDB: true,
    serviceWorkers: true,
    authCache: true,
    history: false,
    downloadsHistory: false,
    dnsCache: false,
    closedTabsHistory: false,
    closeTabs: false,
    passwords: false,
  },
  kiosk: {
    cache: true,
    cookies: true,
    history: true,
    downloadsHistory: true,
    localStorage: true,
    indexedDB: true,
    serviceWorkers: true,
    authCache: true,
    dnsCache: true,
    closedTabsHistory: true,
    closeTabs: true,
    passwords: false,
  },
};

export const ClickAndCleanModal: React.FC<ClickAndCleanModalProps> = ({
  onDismiss,
  onCleanComplete,
  onError,
}) => {
  const [activePreset, setActivePreset] = useState<CleanPresetId>("quick");
  const [options, setOptions] = useState<CleanTargetOptions>(PRESETS.quick);
  const [confirmPasswordDelete, setConfirmPasswordDelete] = useState(false);
  const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);

  // Fetch metrics on mount
  const fetchMetrics = useCallback(async () => {
    try {
      setIsLoadingMetrics(true);
      const data = await window.browserApi.getStorageMetrics();
      setMetrics(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, [onError]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isCleaning) {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, isCleaning]);

  // Preset selector
  const handleSelectPreset = (presetId: CleanPresetId) => {
    setActivePreset(presetId);
    if (presetId !== "custom") {
      setOptions({ ...PRESETS[presetId] });
      setConfirmPasswordDelete(false);
    }
  };

  // Option toggle
  const handleToggleOption = (key: keyof CleanTargetOptions) => {
    const nextVal = !options[key];
    const newOptions: CleanTargetOptions = {
      ...options,
      [key]: nextVal,
    };
    setOptions(newOptions);
    setActivePreset("custom");

    if (key === "passwords" && !nextVal) {
      setConfirmPasswordDelete(false);
    }
  };

  // Select all / Deselect all
  const handleSelectAll = () => {
    const allSelected: CleanTargetOptions = {
      cache: true,
      cookies: true,
      history: true,
      downloadsHistory: true,
      localStorage: true,
      indexedDB: true,
      serviceWorkers: true,
      authCache: true,
      dnsCache: true,
      closedTabsHistory: true,
      closeTabs: true,
      passwords: options.passwords || false,
    };
    setOptions(allSelected);
    setActivePreset("custom");
  };

  const handleDeselectAll = () => {
    setOptions({
      cache: false,
      cookies: false,
      history: false,
      downloadsHistory: false,
      localStorage: false,
      indexedDB: false,
      serviceWorkers: false,
      authCache: false,
      dnsCache: false,
      closedTabsHistory: false,
      closeTabs: false,
      passwords: false,
    });
    setConfirmPasswordDelete(false);
    setActivePreset("custom");
  };

  // Selected count calculation
  const selectedCount = useMemo(() => {
    return Object.values(options).filter(Boolean).length;
  }, [options]);

  // Can execute cleaning?
  const isActionDisabled =
    isCleaning ||
    selectedCount === 0 ||
    (Boolean(options.passwords) && !confirmPasswordDelete);

  // Execute clean
  const handleExecuteClean = async () => {
    if (isActionDisabled) return;
    setIsCleaning(true);
    setCleanResult(null);

    try {
      const result = await window.browserApi.executeClean(options);
      setCleanResult(result);
      if (result.metricsAfter) {
        setMetrics(result.metricsAfter);
      } else {
        void fetchMetrics();
      }
      onCleanComplete?.(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div
      className="click-clean-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCleaning) {
          onDismiss();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Click & Clean Очистка следов"
    >
      <div className="click-clean-modal" onClick={(e) => e.stopPropagation()}>
        {/* HUD Scanning Overlay while cleaning */}
        {isCleaning && (
          <div className="click-clean-scanning-overlay">
            <div className="click-clean-scanning-radar">
              <Sparkles size={28} color="var(--cc-cyan)" />
            </div>
            <div style={{ textAlign: "center" }}>
              <p className="click-clean-scanning-text">
                Detroit CyberLife Diagnostics: Purging Data...
              </p>
              <p className="click-clean-scanning-subtext">
                Очистка следов сессии, кэша и защищенных хранилищ
              </p>
            </div>
          </div>
        )}

        {/* Modal Header */}
        <header className="click-clean-header">
          <div className="click-clean-header-title-group">
            <div className="click-clean-avatar-led" title="CyberLife System LED">
              <div className="click-clean-avatar-led-ring" />
              <Broom size={22} />
            </div>
            <div className="click-clean-title-wrap">
              <div className="click-clean-title-row">
                <h2 className="click-clean-title-gradient">Click & Clean</h2>
                <span className="click-clean-badge">
                  <span className="click-clean-badge-dot" />
                  Cyber Clean v1.0
                </span>
              </div>
              <p className="click-clean-subtitle">
                Мгновенное удаление цифровых следов и оптимизация браузера
              </p>
            </div>
          </div>
          <button
            type="button"
            className="click-clean-close-btn"
            onClick={onDismiss}
            aria-label="Закрыть"
            title="Закрыть (Esc)"
            disabled={isCleaning}
          >
            <X size={18} />
          </button>
        </header>

        {/* Modal Body */}
        <div className="click-clean-body">
          {/* Success Banner if clean completed */}
          {cleanResult && cleanResult.success && (
            <div className="click-clean-success-toast">
              <div className="click-clean-success-left">
                <div className="click-clean-success-icon">
                  <CheckCircle2 size={22} />
                </div>
                <div className="click-clean-success-info">
                  <h4 className="click-clean-success-title">
                    Очистка успешно завершена!
                  </h4>
                  <p className="click-clean-success-detail">
                    Освобождено памяти:{" "}
                    <strong>{cleanResult.freedFormatted || "0 Б"}</strong> · Время
                    выполнения: <strong>{cleanResult.durationMs} мс</strong> ·
                    Очищено категорий:{" "}
                    <strong>{cleanResult.clearedTargets.length}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn-clean-cancel"
                style={{ padding: "6px 14px", fontSize: 12 }}
                onClick={() => setCleanResult(null)}
              >
                Закрыть отчет
              </button>
            </div>
          )}

          {/* Presets Section */}
          <section>
            <div className="click-clean-section-header">
              <span className="click-clean-section-title">
                <Rocket size={13} /> Выберите пресет очистки
              </span>
            </div>
            <div className="click-clean-presets">
              {/* Quick */}
              <button
                type="button"
                className={`click-clean-preset-card ${activePreset === "quick" ? "active" : ""}`}
                onClick={() => handleSelectPreset("quick")}
              >
                <div className="click-clean-preset-top">
                  <div className="click-clean-preset-icon">
                    <Rocket size={17} />
                  </div>
                  <span className="click-clean-preset-badge">Быстро</span>
                </div>
                <h4 className="click-clean-preset-name">Быстрая очистка</h4>
                <p className="click-clean-preset-desc">
                  Кэш, история, закрытые вкладки, DNS.
                </p>
              </button>

              {/* Post-payment */}
              <button
                type="button"
                className={`click-clean-preset-card ${activePreset === "post-payment" ? "active" : ""}`}
                onClick={() => handleSelectPreset("post-payment")}
              >
                <div className="click-clean-preset-top">
                  <div className="click-clean-preset-icon">
                    <CreditCard size={17} />
                  </div>
                  <span className="click-clean-preset-badge">Платежи</span>
                </div>
                <h4 className="click-clean-preset-name">После онлайн-оплаты</h4>
                <p className="click-clean-preset-desc">
                  Куки, хранилища, кэш, токены сессий.
                </p>
              </button>

              {/* Kiosk */}
              <button
                type="button"
                className={`click-clean-preset-card ${activePreset === "kiosk" ? "active" : ""}`}
                onClick={() => handleSelectPreset("kiosk")}
              >
                <div className="click-clean-preset-top">
                  <div className="click-clean-preset-icon">
                    <Shield size={17} />
                  </div>
                  <span className="click-clean-preset-badge">Максимум</span>
                </div>
                <h4 className="click-clean-preset-name">Чужой компьютер</h4>
                <p className="click-clean-preset-desc">
                  Полное удаление всех следов + закрытие вкладок.
                </p>
              </button>

              {/* Custom */}
              <button
                type="button"
                className={`click-clean-preset-card ${activePreset === "custom" ? "active" : ""}`}
                onClick={() => handleSelectPreset("custom")}
              >
                <div className="click-clean-preset-top">
                  <div className="click-clean-preset-icon">
                    <Sliders size={17} />
                  </div>
                  <span className="click-clean-preset-badge">Ручной</span>
                </div>
                <h4 className="click-clean-preset-name">Пользовательская</h4>
                <p className="click-clean-preset-desc">
                  Индивидуальный выбор параметров.
                </p>
              </button>
            </div>
          </section>

          {/* Live HUD Metrics */}
          <section>
            <div className="click-clean-section-header">
              <span className="click-clean-section-title">
                <Sparkles size={13} /> Живые показатели хранилища
              </span>
              <button
                type="button"
                className="click-clean-section-action"
                onClick={() => void fetchMetrics()}
                disabled={isLoadingMetrics}
              >
                {isLoadingMetrics ? "Обновление…" : "Обновить замеры"}
              </button>
            </div>
            <div className="click-clean-metrics-grid">
              {/* Cache */}
              <div className="click-clean-metric-card">
                <div className="click-clean-metric-icon">
                  <HardDrive size={18} />
                </div>
                <div className="click-clean-metric-info">
                  <span className="click-clean-metric-label">Кэш</span>
                  <span className="click-clean-metric-value">
                    {metrics ? metrics.cacheSizeFormatted : "…"}
                  </span>
                </div>
              </div>

              {/* Cookies */}
              <div className="click-clean-metric-card">
                <div className="click-clean-metric-icon">
                  <Cookie size={18} />
                </div>
                <div className="click-clean-metric-info">
                  <span className="click-clean-metric-label">Cookies</span>
                  <span className="click-clean-metric-value">
                    {metrics ? `${metrics.cookiesCount} шт` : "…"}
                  </span>
                </div>
              </div>

              {/* History */}
              <div className="click-clean-metric-card">
                <div className="click-clean-metric-icon">
                  <History size={18} />
                </div>
                <div className="click-clean-metric-info">
                  <span className="click-clean-metric-label">История</span>
                  <span className="click-clean-metric-value">
                    {metrics ? `${metrics.historyCount} записей` : "…"}
                  </span>
                </div>
              </div>

              {/* Passwords */}
              <div className="click-clean-metric-card">
                <div className="click-clean-metric-icon">
                  <KeyRound size={18} />
                </div>
                <div className="click-clean-metric-info">
                  <span className="click-clean-metric-label">Пароли</span>
                  <span className="click-clean-metric-value">
                    {metrics ? `${metrics.passwordsCount} аккаунтов` : "…"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Clean Target Options */}
          <section>
            <div className="click-clean-section-header">
              <span className="click-clean-section-title">
                <Zap size={13} /> Опции очистки ({selectedCount} из{" "}
                {CLEAN_OPTIONS_CONFIG.length})
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  className="click-clean-section-action"
                  onClick={handleSelectAll}
                >
                  Выбрать все
                </button>
                <button
                  type="button"
                  className="click-clean-section-action"
                  onClick={handleDeselectAll}
                >
                  Снять все
                </button>
              </div>
            </div>

            <div className="click-clean-options-grid">
              {CLEAN_OPTIONS_CONFIG.map((opt) => {
                const IconComponent = opt.icon;
                const isSelected = Boolean(options[opt.key]);

                return (
                  <div
                    key={opt.key}
                    className={`click-clean-option-item ${
                      isSelected ? "selected" : ""
                    } ${opt.isDanger ? "danger-option" : ""}`}
                    onClick={() => handleToggleOption(opt.key)}
                  >
                    <div className="click-clean-option-left">
                      <div className="click-clean-option-icon">
                        <IconComponent size={15} />
                      </div>
                      <div className="click-clean-option-texts">
                        <div className="click-clean-option-title-row">
                          <span className="click-clean-option-title">
                            {opt.title}
                          </span>
                          {opt.badge && (
                            <span
                              className={`click-clean-option-badge ${
                                opt.isDanger
                                  ? "danger"
                                  : opt.isWarning
                                    ? "warning"
                                    : ""
                              }`}
                            >
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        <span className="click-clean-option-desc">
                          {opt.description}
                        </span>
                      </div>
                    </div>

                    <div
                      className="click-clean-toggle-switch"
                      role="checkbox"
                      aria-checked={isSelected}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Password Guard Confirmation */}
          {options.passwords && (
            <div className="click-clean-password-guard">
              <div className="click-clean-guard-top">
                <div className="click-clean-guard-icon">
                  <ShieldAlert size={20} />
                </div>
                <div className="click-clean-guard-text">
                  <h5 className="click-clean-guard-title">
                    Внимание! Удаление сохраненных паролей
                  </h5>
                  <p className="click-clean-guard-desc">
                    Все мастер-ключи, сохраненные логины и данные автозаполнения
                    будут безвозвратно удалены из защищенного хранилища.
                  </p>
                </div>
              </div>

              <label className="click-clean-guard-checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmPasswordDelete}
                  onChange={(e) => setConfirmPasswordDelete(e.target.checked)}
                />
                <span>
                  Я подтверждаю безвозвратное удаление всех паролей
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="click-clean-footer">
          <div className="click-clean-footer-hint">
            <span>
              Горячие клавиши: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Del</kbd>
            </span>
          </div>

          <div className="click-clean-footer-actions">
            <button
              type="button"
              className="btn-clean-cancel"
              onClick={onDismiss}
              disabled={isCleaning}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-clean-action"
              onClick={() => void handleExecuteClean()}
              disabled={isActionDisabled}
            >
              {isCleaning ? (
                <>
                  <Loader2 size={16} className="btn-clean-spinner" />
                  <span>Очистка…</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Очистить следы</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ClickAndCleanModal;
