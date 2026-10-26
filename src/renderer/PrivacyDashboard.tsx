import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CircleHelp,
  Clock,
  Cookie,
  Database,
  Gauge,
  Globe2,
  LockKeyhole,
  Network,
  Radar,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldOff,
  Waypoints,
  Wifi,
  WifiOff,
} from "lucide-react";
import React, { useState } from "react";
import type { BrowserSnapshot, PrivacyDashboardSnapshot, PrivacyCheckStatus, PrivacySitePermission } from "../shared/types";

type PrivacyDashboardProps = {
  snapshot: BrowserSnapshot;
  dashboard: PrivacyDashboardSnapshot | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onManagePermissions: () => void;
};

function statusLabel(status: PrivacyCheckStatus): string {
  if (status === "pass") return "Проверено";
  if (status === "warn") return "Внимание";
  if (status === "fail") return "Проблема";
  return "Нет данных";
}

function statusIcon(status: PrivacyCheckStatus): React.JSX.Element {
  if (status === "pass") return <Check size={15} />;
  if (status === "warn" || status === "fail") return <AlertTriangle size={15} />;
  return <CircleHelp size={15} />;
}

function permissionIcon(permission: PrivacySitePermission): React.JSX.Element {
  if (permission.kind === "notifications") return <Bell size={16} />;
  if (permission.kind === "cookies") return <Cookie size={16} />;
  return permission.decision === "exception" ? <ShieldOff size={16} /> : <ShieldCheck size={16} />;
}

function permissionState(permission: PrivacySitePermission): string {
  if (permission.decision === "allow") return "Разрешено";
  if (permission.decision === "exception") return "Исключение";
  return "Запрещено";
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.JSX.Element;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "accent" | "warning";
}): React.JSX.Element {
  return (
    <article className={`privacy-metric privacy-metric-${tone}`}>
      <div className="privacy-metric-icon">{icon}</div>
      <div className="privacy-metric-copy">
        <span>{label}</span>
        <strong title={value}>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export default function PrivacyDashboard({
  snapshot,
  dashboard,
  loading,
  error,
  onRefresh,
  onManagePermissions,
}: PrivacyDashboardProps): React.JSX.Element {
  if (!dashboard) {
    return (
      <section className="privacy-dashboard privacy-dashboard-loading" aria-label="Центр приватности">
        <div className="privacy-dashboard-header">
          <div>
            <span className="privacy-eyebrow">PRIVACY CENTER</span>
            <h1>Центр приватности</h1>
            <p>Собираем состояние соединения и запускаем проверки утечек.</p>
          </div>
          <RefreshCw className={loading ? "spin" : ""} size={22} />
        </div>
        <div className="privacy-loading-card" role="status">
          <Radar size={32} className={loading ? "privacy-radar-pulse" : ""} />
          <strong>{loading ? "Проверяем соединение…" : "Данные пока недоступны"}</strong>
          <span>{error || "Нажмите обновить, чтобы повторить проверку."}</span>
          <button className="primary-button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            Проверить сейчас
          </button>
        </div>
      </section>
    );
  }

  const [manualChecking, setManualChecking] = useState(false);
  const protectedRoute = dashboard.route.mode === "browsec" || dashboard.route.mode === "proxy";
  const overallStatus = dashboard.leakChecks.some((check) => check.status === "fail")
    ? "fail"
    : dashboard.leakChecks.some((check) => check.status === "warn" || check.status === "unknown") || !protectedRoute
      ? "warn"
      : "pass";
  const ipValue = dashboard.externalIp.value || "Не определён";
  const dnsValue = dashboard.dns.servers.length ? `${dashboard.dns.servers.length} сервера` : "Не определён";
  const checkedAt = new Date(dashboard.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const serverHealth =
    dashboard.serverHealth ||
    dashboard.route.serverStatus ||
    snapshot.browsec?.serverStatus ||
    (snapshot.browsec?.country && snapshot.browsec?.healthStatus?.servers?.[snapshot.browsec.country]) ||
    null;

  const handleTriggerManualCheck = async () => {
    if (manualChecking) return;
    setManualChecking(true);
    try {
      if (window.browserApi?.triggerManualHealthCheck) {
        await window.browserApi.triggerManualHealthCheck();
      }
      onRefresh();
    } catch {
      // ignore
    } finally {
      setManualChecking(false);
    }
  };

  const formatServerTime = (ts?: number) => {
    if (!ts) return "Ожидание";
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <section className="privacy-dashboard" aria-label="Центр приватности">
      <header className="privacy-dashboard-header">
        <div>
          <span className="privacy-eyebrow">PRIVACY CENTER</span>
          <h1>Центр приватности</h1>
          <p>Один экран для маршрута, разрешений и защиты от утечек.</p>
        </div>
        <div className="privacy-dashboard-header-actions">
          <span className="privacy-last-check">Проверено в {checkedAt}</span>
          <button className="privacy-refresh-button" onClick={onRefresh} disabled={loading} title="Обновить проверки" aria-label="Обновить проверки">
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      {error && <div className="privacy-inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}

      <article className={`privacy-hero privacy-hero-${overallStatus}`}>
        <div className="privacy-hero-orbit" aria-hidden="true"><span /><span /><span /></div>
        <div className="privacy-hero-status">
          <div className="privacy-hero-icon"><ShieldCheck size={30} /></div>
          <div>
            <span className="privacy-eyebrow">СОСТОЯНИЕ СЕССИИ</span>
            <h2>{overallStatus === "pass" ? "Соединение защищено" : "Защита требует внимания"}</h2>
            <p>{dashboard.isPrivate ? "Приватная вкладка · данные сессии не сохраняются" : "Обычный профиль · решения и разрешения сохраняются локально"}</p>
          </div>
        </div>
        <div className="privacy-hero-route">
          <span>Текущий маршрут</span>
          <strong>{dashboard.route.label}</strong>
          <small>{dashboard.route.detail}</small>
        </div>
        <button className="privacy-hero-action" onClick={onRefresh} disabled={loading}>
          {loading ? <RefreshCw size={16} className="spin" /> : <Activity size={16} />}
          {loading ? "Проверяем…" : "Проверить сейчас"}
        </button>
      </article>

      <div className="privacy-metrics-grid">
        <Metric icon={<Globe2 size={19} />} label="Внешний IP" value={ipValue} detail={dashboard.externalIp.family || dashboard.externalIp.source} tone={dashboard.externalIp.status === "ok" ? "accent" : "warning"} />
        <Metric
          icon={serverHealth && serverHealth.status === "offline" ? <WifiOff size={19} /> : <Waypoints size={19} />}
          label="Маршрут и сервер"
          value={serverHealth ? `${serverHealth.status === 'online' ? 'В сети' : 'Недоступен'} · ${serverHealth.ping} ms` : dashboard.route.label}
          detail={serverHealth ? `12-ч проверка: ${formatServerTime(serverHealth.lastChecked)}` : (dashboard.isPrivate ? "Приватная сессия" : "Обычный профиль")}
          tone={serverHealth ? (serverHealth.status === 'online' ? "accent" : "warning") : (protectedRoute ? "accent" : "warning")}
        />
        <Metric icon={<Network size={19} />} label="DNS" value={dnsValue} detail={dashboard.dns.detail} tone={dashboard.dns.status === "system" ? "default" : "warning"} />
        <Metric icon={<ShieldOff size={19} />} label="Заблокировано трекеров" value={String(dashboard.blockedTrackers.total)} detail={dashboard.blockedTrackers.enabled ? "Встроенный блокировщик включён" : "Блокировщик выключен"} tone={dashboard.blockedTrackers.enabled ? "accent" : "warning"} />
      </div>

      <div className="privacy-dashboard-grid">
        <section className="privacy-card privacy-checks-card">
          <div className="privacy-card-heading">
            <div><span className="privacy-card-kicker">LIVE CHECKS</span><h2>Проверки утечек</h2></div>
            <Radar size={20} />
          </div>
          <div className="privacy-check-list">
            {dashboard.leakChecks.map((check) => (
              <div className="privacy-check-row" key={check.id}>
                <span className={`privacy-check-status privacy-check-${check.status}`}>{statusIcon(check.status)}</span>
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                <em>{statusLabel(check.status)}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="privacy-card privacy-route-card">
          <div className="privacy-card-heading">
            <div><span className="privacy-card-kicker">NETWORK PATH</span><h2>Маршрут соединения</h2></div>
            <Waypoints size={20} />
          </div>
          <div className="privacy-route-visual"><span className="privacy-route-node privacy-route-node-local"><LockKeyhole size={16} /></span><span className="privacy-route-line" /><span className="privacy-route-node privacy-route-node-active"><Server size={17} /></span><span className="privacy-route-line" /><span className="privacy-route-node"><Globe2 size={17} /></span></div>
          <div className="privacy-route-labels"><span>Ваш браузер</span><strong>{dashboard.route.label}</strong><span>Интернет</span></div>
          <p>{dashboard.route.detail}</p>
          {dashboard.route.proxyRule && <code>{dashboard.route.proxyRule}</code>}

          {serverHealth && (
            <div className="privacy-server-health-box">
              <div className="privacy-server-health-top">
                <div className="privacy-server-badge-group">
                  <span className={`privacy-server-status-pill ${serverHealth.status}`}>
                    <span className={`privacy-status-dot-sm ${serverHealth.status}`} />
                    {serverHealth.status === "online" ? "Сервер в сети" : serverHealth.status === "offline" ? "Сервер недоступен" : "Проверка статуса"}
                  </span>
                  <span className="privacy-server-ping-badge">
                    <Activity size={12} /> {serverHealth.ping} ms
                  </span>
                </div>
                <button
                  type="button"
                  className="privacy-health-recheck-btn"
                  onClick={() => void handleTriggerManualCheck()}
                  disabled={manualChecking || loading}
                  title="Запустить ручную проверку здоровья сервера"
                >
                  <RefreshCw size={12} className={manualChecking ? "spin" : ""} />
                  {manualChecking ? "Проверяем…" : "Проверить"}
                </button>
              </div>
              <div className="privacy-server-details-row">
                <span className="privacy-server-host">Хост: <code>{serverHealth.serverHost}</code></span>
                <span className="privacy-server-checked">
                  <Clock size={11} /> 12-ч проверка: {formatServerTime(serverHealth.lastChecked)}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="privacy-card privacy-trackers-card">
          <div className="privacy-card-heading">
            <div><span className="privacy-card-kicker">CONTENT SHIELD</span><h2>Заблокированные трекеры</h2></div>
            <ShieldOff size={20} />
          </div>
          <div className="privacy-big-number">{dashboard.blockedTrackers.total}<small> запросов</small></div>
          {dashboard.blockedTrackers.topHosts.length ? (
            <div className="privacy-host-list">{dashboard.blockedTrackers.topHosts.map((host) => <div key={host.host}><span>{host.host}</span><strong>{host.count}</strong></div>)}</div>
          ) : <div className="privacy-empty-inline"><Gauge size={18} />Пока нет заблокированных запросов.</div>}
        </section>

        <section className="privacy-card privacy-permissions-card">
          <div className="privacy-card-heading">
            <div><span className="privacy-card-kicker">SITE CONTROL</span><h2>Разрешения сайтов</h2></div>
            <button className="privacy-card-link" onClick={onManagePermissions}>Управлять</button>
          </div>
          {dashboard.sitePermissions.length ? (
            <div className="privacy-permissions-list">{dashboard.sitePermissions.map((permission) => <div className="privacy-permission-row" key={permission.id}><span className="privacy-permission-icon">{permissionIcon(permission)}</span><div><strong>{permission.origin}</strong><small>{permission.label}</small></div><em className={`privacy-permission-state privacy-permission-${permission.decision}`}>{permissionState(permission)}</em></div>)}</div>
          ) : <div className="privacy-empty-state"><Database size={24} /><strong>Разрешений пока нет</strong><span>Когда сайт запросит доступ к уведомлениям, cookies или исключение блокировщика, запись появится здесь.</span></div>}
        </section>

        <section className="privacy-card privacy-dns-card">
          <div className="privacy-card-heading"><div><span className="privacy-card-kicker">RESOLVER</span><h2>DNS-серверы</h2></div><Network size={20} /></div>
          <div className="privacy-dns-status"><span className={`privacy-status-dot ${dashboard.dns.status === "system" ? "is-live" : ""}`} />{dashboard.dns.detail}</div>
          <div className="privacy-dns-list">{dashboard.dns.servers.length ? dashboard.dns.servers.map((server) => <code key={server}>{server}</code>) : <span>Нет данных о DNS-серверах.</span>}</div>
        </section>
      </div>
      <footer className="privacy-dashboard-footer"><span><LockKeyhole size={14} /> Данные проверок обрабатываются локально в браузере.</span><span>IP-проверка использует {dashboard.externalIp.source}.</span></footer>
    </section>
  );
}
