import path from 'node:path';
import type { Session, WebContents } from 'electron';
import { JsonStore } from '../../main/persistence/JsonStore';
import { BROWSEC_COUNTRIES, BROWSEC_COUNTRY_LIST } from './browsecData';
import { generatePacScript } from './PacGenerator';
import {
  BrowsecHealthCheckEngine,
  DEFAULT_CHECK_INTERVAL_MS,
  getAllBrowsecServers,
  normalizeServerKey,
  type BrowsecHealthCheckOptions,
  type HealthCheckSummary,
} from './BrowsecHealthCheck';
import type {
  BrowsecCountry,
  BrowsecSettings,
  BrowsecSmartRule,
  BrowsecSnapshot,
  VpnHealthStatus,
  VpnServerHealth,
} from './types';

export function normalizeDomain(rawDomain: string): string {
  let cleaned = (rawDomain || '').trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  cleaned = cleaned.replace(/^\*\./, '');
  cleaned = cleaned.replace(/^\./, '');
  return cleaned;
}

const defaultSettings: BrowsecSettings = {
  enabled: false,
  country: 'nl',
  webrtcLeakProtection: true,
  smartRules: [],
};

function normalizeBrowsecSettings(value: unknown): BrowsecSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return structuredClone(defaultSettings);
  }
  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false;
  const rawCountry = typeof raw.country === 'string' ? raw.country.toLowerCase() : 'nl';
  const country = BROWSEC_COUNTRIES[rawCountry] ? rawCountry : 'nl';
  const webrtcLeakProtection = typeof raw.webrtcLeakProtection === 'boolean' ? raw.webrtcLeakProtection : true;

  const smartRules: BrowsecSmartRule[] = [];
  if (Array.isArray(raw.smartRules)) {
    const seenDomains = new Set<string>();
    for (const rule of raw.smartRules) {
      if (!rule || typeof rule !== 'object') continue;
      const r = rule as Record<string, unknown>;
      if (typeof r.domain !== 'string') continue;
      const domain = normalizeDomain(r.domain);
      if (!domain || seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      const ruleCountry = typeof r.country === 'string' ? r.country.toLowerCase() : 'direct';
      const validCountry = ruleCountry === 'direct' || Boolean(BROWSEC_COUNTRIES[ruleCountry]) ? ruleCountry : 'direct';
      smartRules.push({
        domain,
        country: validCountry,
        enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
      });
    }
  }

  const deadServers: string[] = [];
  if (Array.isArray(raw.deadServers)) {
    for (const item of raw.deadServers) {
      if (typeof item === 'string' && item.trim()) {
        deadServers.push(item.trim().toLowerCase());
      }
    }
  }

  const serverLatencies: Record<string, number> = {};
  if (raw.serverLatencies && typeof raw.serverLatencies === 'object' && !Array.isArray(raw.serverLatencies)) {
    for (const [k, v] of Object.entries(raw.serverLatencies as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        serverLatencies[k.trim().toLowerCase()] = v;
      }
    }
  }

  const serverHealth: Record<string, import('./types').ServerHealthEntry> = {};
  if (raw.serverHealth && typeof raw.serverHealth === 'object' && !Array.isArray(raw.serverHealth)) {
    for (const [k, v] of Object.entries(raw.serverHealth as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const item = v as Record<string, unknown>;
        if (typeof item.host === 'string') {
          serverHealth[k.trim().toLowerCase()] = {
            host: item.host,
            port: typeof item.port === 'number' ? item.port : 443,
            reachable: item.reachable !== false,
            latency: typeof item.latency === 'number' ? item.latency : 0,
            lastChecked: typeof item.lastChecked === 'number' ? item.lastChecked : 0,
            error: typeof item.error === 'string' ? item.error : undefined,
          };
        }
      }
    }
  }

  return {
    enabled,
    country,
    webrtcLeakProtection,
    smartRules,
    deadServers,
    serverLatencies,
    serverHealth,
    lastHealthCheck: typeof raw.lastHealthCheck === 'number' ? raw.lastHealthCheck : undefined,
  };
}

export interface BrowsecServiceOptions {
  enableHealthCheck?: boolean;
  healthCheckIntervalMs?: number;
  healthCheckSocketTimeoutMs?: number;
  startupDelayMs?: number;
}

export class BrowsecService {
  private readonly store: JsonStore<BrowsecSettings>;
  private readonly registeredSessions = new Set<Session>();
  private readonly listeners = new Set<(snapshot: BrowsecSnapshot) => void>();
  private readonly healthCheck: BrowsecHealthCheckEngine;
  private readonly countriesMap: Record<string, BrowsecCountry>;
  private readonly lastAppliedPac = new Map<Session, string>();
  private webContentsProvider?: () => WebContents[];
  private startupTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(userDataPath: string, options?: BrowsecServiceOptions) {
    const storePath = path.join(userDataPath, 'browser-data', 'browsec-settings.json');
    this.store = new JsonStore<BrowsecSettings>(storePath, defaultSettings, normalizeBrowsecSettings);
    this.countriesMap = structuredClone(BROWSEC_COUNTRIES);
    this.healthCheck = new BrowsecHealthCheckEngine({
      autoStart: options?.enableHealthCheck ?? true,
      intervalMs: options?.healthCheckIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      socketTimeoutMs: options?.healthCheckSocketTimeoutMs,
      serversProvider: () => getAllBrowsecServers(this.countriesMap),
      onStatusChange: (deadServers, latencies) => {
        this.updateCountriesFromHealth(deadServers, latencies);
        this.persistHealthStatus();
        void this.smoothlyReapplyProxy();
      },
    });

    // Restore cached health status from store so states survive restarts
    const persisted = this.store.get();
    if (persisted.deadServers?.length || persisted.serverLatencies || persisted.serverHealth) {
      this.healthCheck.importHealthRecords(
        persisted.serverHealth,
        persisted.deadServers,
        persisted.serverLatencies,
      );
      this.updateCountriesFromHealth(this.healthCheck.getDeadServers(), this.healthCheck.getAllLatencies());
    }

    if (options?.enableHealthCheck ?? true) {
      const startupDelay = options?.startupDelayMs ?? 5000;
      this.startupTimer = setTimeout(() => {
        this.startupTimer = undefined;
        if (!this.disposed) void this.checkServersHealth();
      }, startupDelay);
      this.startupTimer.unref();
    }
  }

  getHealthCheck(): BrowsecHealthCheckEngine {
    return this.healthCheck;
  }

  async checkServersHealth(): Promise<HealthCheckSummary> {
    const summary = await this.healthCheck.checkAllServers();
    if (this.disposed) return summary;
    // The engine's status callback already updates and durably persists this batch.
    // Await proxy application here without writing the same health records twice.
    await this.smoothlyReapplyProxy();
    return summary;
  }

  private updateCountriesFromHealth(deadServers: Set<string>, latencies?: Map<string, number>): void {
    for (const country of Object.values(this.countriesMap)) {
      if (!country.servers || country.servers.length === 0) {
        country.servers = [{ host: country.serverHost, port: 443 }];
      }

      for (const server of country.servers) {
        const key = normalizeServerKey(server);
        const hostOnly = server.host.trim().toLowerCase();
        const isDead = deadServers.has(key) || deadServers.has(hostOnly);
        server.online = !isDead;
        const lat = latencies?.get(key);
        if (typeof lat === 'number' && lat >= 0) {
          server.latency = lat;
        }
      }

      country.servers.sort((a, b) => {
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        const latA = typeof a.latency === 'number' ? a.latency : Infinity;
        const latB = typeof b.latency === 'number' ? b.latency : Infinity;
        return latA - latB;
      });

      const bestOnlineServer = country.servers.find((s) => s.online);
      if (bestOnlineServer) {
        if (typeof bestOnlineServer.latency === 'number' && bestOnlineServer.latency > 0) {
          country.ping = bestOnlineServer.latency;
        }
        country.serverHost = bestOnlineServer.host;
      }
    }
  }

  private persistHealthStatus(): void {
    const current = this.store.get();
    const deadServers = Array.from(this.healthCheck.getDeadServers());
    const serverLatencies = Object.fromEntries(this.healthCheck.getAllLatencies());
    const serverHealth = this.healthCheck.exportHealthRecords();

    this.store.set({
      ...current,
      deadServers,
      serverLatencies,
      serverHealth,
      lastHealthCheck: Date.now(),
    });
  }

  setWebContentsProvider(provider: () => WebContents[]): void {
    this.webContentsProvider = provider;
  }

  getHealthStatus(): VpnHealthStatus {
    return this.healthCheck.getHealthStatus();
  }

  getServerHealth(countryCode?: string): VpnServerHealth {
    const code = (countryCode || this.store.get().country || 'nl').toLowerCase();
    const status = this.healthCheck.getHealthStatus();
    return status.servers[code] || {
      countryCode: code,
      serverHost: (BROWSEC_COUNTRIES[code] || BROWSEC_COUNTRIES['nl']).serverHost,
      status: 'online',
      ping: (BROWSEC_COUNTRIES[code] || BROWSEC_COUNTRIES['nl']).ping,
      lastChecked: Date.now(),
    };
  }

  async triggerManualHealthCheck(countryCode?: string): Promise<VpnHealthStatus> {
    const result = await this.healthCheck.triggerManualHealthCheck(countryCode);
    if (this.disposed) return result;
    // The engine's status callback already updates and durably persists this batch.
    // Await proxy application here without writing the same health records twice.
    await this.smoothlyReapplyProxy();
    this.notify();
    return result;
  }

  getSnapshot(): BrowsecSnapshot {
    const settings = this.store.get();
    return {
      enabled: settings.enabled,
      country: settings.country,
      selectedCountry: settings.country,
      smartSettingsEnabled: true,
      webrtcProtection: settings.webrtcLeakProtection,
      webrtcLeakProtection: settings.webrtcLeakProtection,
      smartRules: structuredClone(settings.smartRules).map((r) => ({
        ...r,
        id: r.id || `rule-${r.domain}`,
        countryCode: r.country,
      })),
      countries: this.getCountries(),
      healthStatus: this.getHealthStatus(),
      serverStatus: this.getServerHealth(settings.country),
    };
  }

  getCountries(): BrowsecCountry[] {
    const healthMap = this.healthCheck.getHealthStatus().servers;
    return structuredClone(Object.values(this.countriesMap)).map((c) => {
      const h = healthMap[c.code];
      return {
        ...c,
        ping: h?.ping ?? c.ping,
        status: h?.status ?? (c.servers?.some((s) => s.online) ? 'online' : 'offline'),
        lastChecked: h?.lastChecked,
      };
    });
  }

  async registerSession(targetSession: Session): Promise<void> {
    this.registeredSessions.add(targetSession);
    try {
      await this.applyProxy(targetSession);
      this.applyWebRtcPolicyToSession(targetSession);
    } catch (error) {
      // A failed registration must not leave a dead session in the retry set;
      // later toggles would otherwise repeatedly hit the same rejected calls.
      this.registeredSessions.delete(targetSession);
      throw error;
    }
  }

  unregisterSession(targetSession: Session): void {
    this.registeredSessions.delete(targetSession);
    this.lastAppliedPac.delete(targetSession);
  }

  async toggle(enabled?: boolean): Promise<BrowsecSnapshot> {
    const current = this.store.get();
    const nextEnabled = typeof enabled === 'boolean' ? enabled : !current.enabled;
    this.store.set({
      ...current,
      enabled: nextEnabled,
    });
    await this.applyProxyToRegisteredSessions();
    this.notify();
    return this.getSnapshot();
  }

  async setCountry(code: string): Promise<BrowsecSnapshot> {
    const normalized = (code || '').trim().toLowerCase();
    if (!BROWSEC_COUNTRIES[normalized]) {
      throw new Error(`Country code "${code}" is not supported`);
    }
    const current = this.store.get();
    this.store.set({
      ...current,
      country: normalized,
    });
    await this.applyProxyToRegisteredSessions();
    this.notify();
    return this.getSnapshot();
  }

  async setWebRtcLeakProtection(enabled: boolean): Promise<BrowsecSnapshot> {
    const current = this.store.get();
    this.store.set({
      ...current,
      webrtcLeakProtection: Boolean(enabled),
    });
    this.applyWebRtcPolicyToAll();
    this.notify();
    return this.getSnapshot();
  }

  async addSmartRule(domain: string, country: string): Promise<BrowsecSnapshot> {
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain) {
      throw new Error('Укажите корректный домен для правила.');
    }
    const cleanCountry = (country || '').trim().toLowerCase();
    if (cleanCountry !== 'direct' && !BROWSEC_COUNTRIES[cleanCountry]) {
      throw new Error(`Недопустимый код страны: "${country}"`);
    }

    const current = this.store.get();
    const existingIndex = current.smartRules.findIndex((r) => r.domain === cleanDomain);
    let nextRules: BrowsecSmartRule[];
    if (existingIndex >= 0) {
      nextRules = current.smartRules.map((r, i) =>
        i === existingIndex ? { ...r, country: cleanCountry, enabled: true } : r,
      );
    } else {
      nextRules = [...current.smartRules, { domain: cleanDomain, country: cleanCountry, enabled: true }];
    }

    this.store.set({
      ...current,
      smartRules: nextRules,
    });
    await this.applyProxyToRegisteredSessions();
    this.notify();
    return this.getSnapshot();
  }

  async removeSmartRule(domain: string): Promise<BrowsecSnapshot> {
    const cleanDomain = normalizeDomain(domain);
    const current = this.store.get();
    this.store.set({
      ...current,
      smartRules: current.smartRules.filter((r) => r.domain !== cleanDomain),
    });
    await this.applyProxyToRegisteredSessions();
    this.notify();
    return this.getSnapshot();
  }

  async toggleSmartRule(domain: string): Promise<BrowsecSnapshot> {
    const cleanDomain = normalizeDomain(domain);
    const current = this.store.get();
    this.store.set({
      ...current,
      smartRules: current.smartRules.map((r) => (r.domain === cleanDomain ? { ...r, enabled: !r.enabled } : r)),
    });
    await this.applyProxyToRegisteredSessions();
    this.notify();
    return this.getSnapshot();
  }

  async applyProxy(targetSession: Session, options?: { closeConnections?: boolean }): Promise<void> {
    const settings = this.store.get();
    const hasActiveSmartRules = settings.smartRules.some((r) => r.enabled);
    if (!settings.enabled && !hasActiveSmartRules) {
      await targetSession.setProxy({ mode: 'direct' });
      this.lastAppliedPac.delete(targetSession);
    } else {
      const pacScript = generatePacScript({
        enabled: settings.enabled,
        country: settings.country,
        smartRules: settings.smartRules,
        deadServers: this.healthCheck.getDeadServers(),
        countries: this.countriesMap,
      });
      const pacDataUrl = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript).toString('base64')}`;
      await targetSession.setProxy({
        pacScript: pacDataUrl,
      });
      this.lastAppliedPac.set(targetSession, pacDataUrl);
    }
    if (options?.closeConnections ?? true) {
      await targetSession.closeAllConnections();
    }
  }

  private async smoothlyReapplyProxy(): Promise<void> {
    const settings = this.store.get();
    const hasActiveSmartRules = settings.smartRules.some((r) => r.enabled);
    if (!settings.enabled && !hasActiveSmartRules) {
      this.notify();
      return;
    }

    const pacScript = generatePacScript({
      enabled: settings.enabled,
      country: settings.country,
      smartRules: settings.smartRules,
      deadServers: this.healthCheck.getDeadServers(),
      countries: this.countriesMap,
    });
    const pacDataUrl = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript).toString('base64')}`;

    for (const s of this.registeredSessions) {
      const previousPac = this.lastAppliedPac.get(s);
      if (previousPac !== pacDataUrl) {
        try {
          // Smoothly update proxy configuration in Chromium NetworkService without closing active connections
          await s.setProxy({ pacScript: pacDataUrl });
          this.lastAppliedPac.set(s, pacDataUrl);
        } catch (err) {
          console.error('Failed to smoothly re-apply proxy PAC to session:', err);
        }
      }
    }
    this.notify();
  }

  applyWebRtcPolicyToSession(targetSession: Session): void {
    const policy = this.store.get().webrtcLeakProtection ? 'disable_non_proxied_udp' : 'default';
    if (typeof (targetSession as any).setWebRTCIPHandlingPolicy === 'function') {
      try {
        (targetSession as any).setWebRTCIPHandlingPolicy(policy);
      } catch {}
    }
  }

  applyWebRtcPolicyToWebContents(webContents: WebContents): void {
    if (webContents.isDestroyed()) return;
    const policy = this.store.get().webrtcLeakProtection ? 'disable_non_proxied_udp' : 'default';
    try {
      webContents.setWebRTCIPHandlingPolicy(policy);
    } catch {}
  }

  private applyWebRtcPolicyToAll(): void {
    for (const s of this.registeredSessions) {
      this.applyWebRtcPolicyToSession(s);
    }
    if (this.webContentsProvider) {
      try {
        const contentsList = this.webContentsProvider();
        for (const wc of contentsList) {
          this.applyWebRtcPolicyToWebContents(wc);
        }
      } catch {}
    }
  }

  private async applyProxyToRegisteredSessions(): Promise<void> {
    for (const s of this.registeredSessions) {
      try {
        await this.applyProxy(s);
        this.applyWebRtcPolicyToSession(s);
      } catch (err) {
        console.error('Failed to apply proxy to session:', err);
      }
    }
    if (this.webContentsProvider) {
      try {
        const contentsList = this.webContentsProvider();
        for (const wc of contentsList) {
          this.applyWebRtcPolicyToWebContents(wc);
        }
      } catch {}
    }
  }

  onSnapshot(listener: (snapshot: BrowsecSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('Error in browsec snapshot listener:', err);
      }
    }
  }

  dispose(): void {
    this.destroy();
  }

  destroy(): void {
    this.disposed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.healthCheck.destroy();
    this.registeredSessions.clear();
    this.lastAppliedPac.clear();
    this.listeners.clear();
  }
}
