import React, { useState, useMemo } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Globe,
  Plus,
  Power,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { BrowsecCountry, BrowsecSmartRule, BrowsecState } from "../shared/types";

interface BrowsecModalProps {
  state: BrowsecState;
  countries: BrowsecCountry[];
  onUpdate: (patch: Partial<BrowsecState>) => Promise<void>;
  onClose: () => void;
}

export const BrowsecModal: React.FC<BrowsecModalProps> = ({
  state,
  countries,
  onUpdate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"main" | "countries" | "smart">("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState<"all" | "europe" | "americas" | "asia">("all");
  const [newDomain, setNewDomain] = useState("");
  const [newCountry, setNewCountry] = useState("nl");
  const [saving, setSaving] = useState(false);

  const selectedCode = state.country || state.selectedCountry || "nl";
  const currentCountry = useMemo(() => {
    return countries.find((c) => c.code === selectedCode) || countries[0] || {
      code: "nl",
      name: "Нидерланды",
      nameEn: "Netherlands",
      flag: "🇳🇱",
      ping: 22,
      serverHost: "nl.browsec.com",
    };
  }, [countries, selectedCode]);

  const handleToggleVpn = async () => {
    setSaving(true);
    try {
      await onUpdate({ enabled: !state.enabled });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectCountry = async (code: string) => {
    setSaving(true);
    try {
      await onUpdate({ country: code, selectedCountry: code });
      setActiveTab("main");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleWebRtc = async () => {
    const nextVal = !(state.webrtcProtection ?? state.webrtcLeakProtection ?? true);
    await onUpdate({ webrtcProtection: nextVal, webrtcLeakProtection: nextVal });
  };

  const handleToggleSmartSettings = async () => {
    await onUpdate({ smartSettingsEnabled: !state.smartSettingsEnabled });
  };

  const handleAddSmartRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = newDomain.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!cleanDomain) return;

    const existing = state.smartRules.find((r) => r.domain === cleanDomain);
    let nextRules: BrowsecSmartRule[];
    if (existing) {
      nextRules = state.smartRules.map((r) =>
        r.domain === cleanDomain ? { ...r, country: newCountry, countryCode: newCountry, enabled: true } : r
      );
    } else {
      nextRules = [
        ...state.smartRules,
        {
          id: `rule-${Date.now()}`,
          domain: cleanDomain,
          country: newCountry,
          countryCode: newCountry,
          enabled: true,
        },
      ];
    }
    setNewDomain("");
    await onUpdate({ smartRules: nextRules });
  };

  const handleToggleRule = async (id?: string) => {
    if (!id) return;
    const nextRules = state.smartRules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    );
    await onUpdate({ smartRules: nextRules });
  };

  const handleDeleteRule = async (id?: string) => {
    if (!id) return;
    const nextRules = state.smartRules.filter((r) => r.id !== id);
    await onUpdate({ smartRules: nextRules });
  };

  const handleLoadPresetRules = async () => {
    const presets: BrowsecSmartRule[] = [
      { id: `preset-yt-${Date.now()}`, domain: "youtube.com", country: "us", countryCode: "us", enabled: true },
      { id: `preset-rt-${Date.now()}`, domain: "rutracker.org", country: "nl", countryCode: "nl", enabled: true },
      { id: `preset-x-${Date.now()}`, domain: "x.com", country: "nl", countryCode: "nl", enabled: true },
      { id: `preset-ig-${Date.now()}`, domain: "instagram.com", country: "de", countryCode: "de", enabled: true },
    ];
    const existingDomains = new Set(state.smartRules.map((r) => r.domain));
    const toAdd = presets.filter((p) => !existingDomains.has(p.domain));
    if (toAdd.length) {
      await onUpdate({ smartRules: [...state.smartRules, ...toAdd] });
    }
  };

  const filteredCountries = useMemo(() => {
    return countries.filter((c) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q);

      if (!matchesQuery) return false;

      if (regionFilter === "europe") {
        return ["nl", "gb", "de", "fr", "ch", "se", "pl", "it", "es", "at", "be", "bg", "cz", "dk", "ee", "fi", "hu", "is", "ie", "lv", "lt", "lu", "md", "no", "ro", "rs", "sk", "ua"].includes(c.code);
      }
      if (regionFilter === "americas") {
        return ["us", "ca", "br", "mx", "ar"].includes(c.code);
      }
      if (regionFilter === "asia") {
        return ["sg", "jp", "au", "hk", "in", "il", "nz", "za", "kr", "tr", "ae"].includes(c.code);
      }
      return true;
    });
  }, [countries, searchQuery, regionFilter]);

  const activeRulesCount = state.smartRules.filter((r) => r.enabled).length;

  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest(".browsec-toolbar-btn")) {
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

  return (
    <div ref={popoverRef} className="browsec-popover" role="dialog" aria-label="soulm8te VPN">
      {/* Popover Header */}
      <div className="browsec-header">
        <div className="browsec-brand">
          <div className="browsec-logo-icon">
            <Shield size={18} className="shield-icon" />
            <span className="browsec-badge-b">S</span>
          </div>
          <div className="browsec-titles">
            <span className="browsec-name">soulm8te VPN</span>
            <span className="browsec-free-tag">
              <Sparkles size={11} /> Бесплатно & Защищено
            </span>
          </div>
        </div>
        <div className="browsec-header-actions">
          <button
            type="button"
            className="browsec-close-btn"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="browsec-tabs">
        <button
          type="button"
          className={`browsec-tab-btn ${activeTab === "main" ? "active" : ""}`}
          onClick={() => setActiveTab("main")}
        >
          VPN
        </button>
        <button
          type="button"
          className={`browsec-tab-btn ${activeTab === "countries" ? "active" : ""}`}
          onClick={() => setActiveTab("countries")}
        >
          Локации ({countries.length || 44})
        </button>
        <button
          type="button"
          className={`browsec-tab-btn ${activeTab === "smart" ? "active" : ""}`}
          onClick={() => setActiveTab("smart")}
        >
          SmartSettings
          {activeRulesCount > 0 && (
            <span className="browsec-tab-badge">{activeRulesCount}</span>
          )}
        </button>
      </div>

      {/* Main Tab */}
      {activeTab === "main" && (
        <div className="browsec-body">
          {/* Status banner */}
          <div className={`browsec-status-banner ${state.enabled ? "on" : "off"}`}>
            <span className="browsec-status-dot" />
            <span className="browsec-status-text">
              {state.enabled
                ? "Защита активна · Ваш реальный IP скрыт"
                : "Защита выключена · Ваш реальный IP виден сайтам"}
            </span>
          </div>

          {/* Big ON / OFF Switch */}
          <div className="browsec-power-container">
            <button
              type="button"
              className={`browsec-power-btn ${state.enabled ? "is-active" : "is-inactive"}`}
              onClick={handleToggleVpn}
              disabled={saving}
              title={state.enabled ? "Отключить VPN" : "Включить VPN"}
              aria-label={state.enabled ? "Отключить VPN" : "Включить VPN"}
            >
              <div className="power-circle">
                <Power size={32} />
              </div>
              <span className="power-label">
                {state.enabled ? "ВКЛЮЧЕНО" : "ПОДКЛЮЧИТЬ"}
              </span>
              <span className="power-sublabel">
                {state.enabled ? "Трафик зашифрован" : "Нажмите для защиты"}
              </span>
            </button>
          </div>

          {/* Current Location Card */}
          <div className="browsec-location-card">
            <div className="location-flag-badge">
              <span className="location-flag">{currentCountry.flag}</span>
            </div>
            <div className="location-info">
              <span className="location-caption">Текущая локация</span>
              <span className="location-title">
                {currentCountry.name}{" "}
                <small className="location-en">({currentCountry.nameEn})</small>
              </span>
              <div className="location-meta">
                <span className="ping-indicator">
                  <span className="ping-dot" />
                  {currentCountry.ping} ms
                </span>
                <span className="speed-badge">Без ограничений</span>
              </div>
            </div>
            <button
              type="button"
              className="browsec-change-btn"
              onClick={() => setActiveTab("countries")}
              title="Выбрать другую страну"
            >
              <span>Сменить</span>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* WebRTC Leak Protection */}
          <div className="browsec-toggle-card">
            <div className="toggle-card-icon">
              <ShieldCheck size={20} className="text-emerald" />
            </div>
            <div className="toggle-card-content">
              <div className="toggle-card-title">Защита от утечек WebRTC</div>
              <div className="toggle-card-desc">
                Блокирует раскрытие реального IP адреса через WebRTC STUN/UDP
              </div>
            </div>
            <label className="browsec-switch">
              <input
                type="checkbox"
                checked={state.webrtcProtection ?? state.webrtcLeakProtection ?? true}
                onChange={handleToggleWebRtc}
                aria-label="Включить защиту от утечек WebRTC"
              />
              <span className="switch-slider" />
            </label>
          </div>

          {/* SmartSettings Shortcut */}
          <div
            className="browsec-smart-shortcut"
            onClick={() => setActiveTab("smart")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveTab("smart");
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Открыть умные настройки SmartSettings"
          >
            <div className="smart-shortcut-icon">
              <Sliders size={18} />
            </div>
            <div className="smart-shortcut-info">
              <span className="smart-shortcut-title">Умные настройки (SmartSettings)</span>
              <span className="smart-shortcut-desc">
                {state.smartSettingsEnabled
                  ? `${activeRulesCount} активных правил для сайтов`
                  : "Правила для сайтов выключены"}
              </span>
            </div>
            <ChevronRight size={16} className="text-muted" />
          </div>
        </div>
      )}

      {/* Countries Tab */}
      {activeTab === "countries" && (
        <div className="browsec-countries-panel">
          <div className="countries-toolbar">
            <button
              type="button"
              className="countries-back-btn"
              onClick={() => setActiveTab("main")}
              title="Назад"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="countries-search-box">
              <Search size={15} className="search-icon" />
              <input
                type="text"
                placeholder="Поиск по 44 локациям..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Region filters */}
          <div className="region-filter-chips">
            <button
              type="button"
              className={`chip ${regionFilter === "all" ? "active" : ""}`}
              onClick={() => setRegionFilter("all")}
            >
              Все (44)
            </button>
            <button
              type="button"
              className={`chip ${regionFilter === "europe" ? "active" : ""}`}
              onClick={() => setRegionFilter("europe")}
            >
              Европа
            </button>
            <button
              type="button"
              className={`chip ${regionFilter === "americas" ? "active" : ""}`}
              onClick={() => setRegionFilter("americas")}
            >
              Америка
            </button>
            <button
              type="button"
              className={`chip ${regionFilter === "asia" ? "active" : ""}`}
              onClick={() => setRegionFilter("asia")}
            >
              Азия / Океания
            </button>
          </div>

          {/* Free banner */}
          <div className="countries-free-banner">
            <Sparkles size={14} className="sparkle-icon" />
            <span>Все 44 локации soulm8te VPN доступны бесплатно и без ограничений</span>
          </div>

          {/* Countries list */}
          <div className="countries-list">
            {filteredCountries.map((c) => {
              const isSelected = c.code === selectedCode;
              return (
                <div
                  key={c.code}
                  className={`country-item ${isSelected ? "selected" : ""}`}
                  onClick={() => handleSelectCountry(c.code)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleSelectCountry(c.code);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${c.name} (${c.nameEn}), ${c.ping} миллисекунд`}
                  aria-pressed={isSelected}
                >
                  <span className="country-flag">{c.flag}</span>
                  <div className="country-names">
                    <span className="country-name-ru">{c.name}</span>
                    <span className="country-name-en">{c.nameEn}</span>
                  </div>
                  <div className="country-badges">
                    <span className="ping-chip">{c.ping} ms</span>
                    <span className="free-chip">FREE</span>
                  </div>
                  {isSelected && (
                    <div className="selected-check">
                      <Check size={16} />
                    </div>
                  )}
                </div>
              );
            })}
            {filteredCountries.length === 0 && (
              <div className="countries-empty">Страна не найдена</div>
            )}
          </div>
        </div>
      )}

      {/* SmartSettings Tab */}
      {activeTab === "smart" && (
        <div className="browsec-smart-panel">
          <div className="smart-panel-header">
            <button
              type="button"
              className="countries-back-btn"
              onClick={() => setActiveTab("main")}
              title="Назад"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="smart-header-title">
              <span>Умные настройки (SmartSettings)</span>
            </div>
            <label className="browsec-switch">
              <input
                type="checkbox"
                checked={state.smartSettingsEnabled}
                onChange={handleToggleSmartSettings}
                aria-label="Включить SmartSettings"
              />
              <span className="switch-slider" />
            </label>
          </div>

          <p className="smart-desc">
            Автоматически переключайте локацию VPN для определенных доменов или открывайте их напрямую без VPN.
          </p>

          {/* Add rule form */}
          <form className="smart-add-form" onSubmit={handleAddSmartRule}>
            <div className="form-row">
              <input
                type="text"
                placeholder="домен (например, youtube.com)"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="smart-domain-input"
              />
              <select
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value)}
                className="smart-country-select"
              >
                <option value="direct">⚡ Прямое соединение (Без VPN)</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name} ({c.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-submit-row">
              <button
                type="submit"
                disabled={!newDomain.trim()}
                className="smart-submit-btn"
              >
                <Plus size={15} />
                <span>Добавить правило</span>
              </button>
              <button
                type="button"
                className="smart-preset-btn"
                onClick={handleLoadPresetRules}
                title="Добавить популярные правила"
              >
                + Популярные сайты
              </button>
            </div>
          </form>

          {/* Rules list */}
          <div className="smart-rules-list">
            <div className="smart-rules-heading">
              <span>Правила ({state.smartRules.length})</span>
            </div>
            {state.smartRules.map((rule) => {
              const ruleCountryCode = rule.country || rule.countryCode || "nl";
              const isDirect = ruleCountryCode === "direct";
              const targetCountry = !isDirect
                ? countries.find((c) => c.code === ruleCountryCode)
                : null;

              return (
                <div
                  key={rule.id || rule.domain}
                  className={`smart-rule-item ${rule.enabled ? "enabled" : "disabled"}`}
                >
                  <div className="rule-info">
                    <span className="rule-domain">{rule.domain}</span>
                    <span className="rule-target">
                      {isDirect ? (
                        <span className="rule-direct-tag">
                          <Zap size={12} /> Напрямую (Без VPN)
                        </span>
                      ) : (
                        <span className="rule-country-tag">
                          {targetCountry?.flag || "🌐"}{" "}
                          {targetCountry?.name || ruleCountryCode.toUpperCase()}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="rule-actions">
                    <label className="browsec-switch switch-sm">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule.id)}
                        aria-label={`Переключить правило для ${rule.domain}`}
                      />
                      <span className="switch-slider" />
                    </label>
                    <button
                      type="button"
                      className="rule-delete-btn"
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Удалить правило"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {state.smartRules.length === 0 && (
              <div className="smart-rules-empty">
                Нет добавленных правил. Добавьте сайт выше или нажмите «+ Популярные сайты».
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BrowsecModal;
