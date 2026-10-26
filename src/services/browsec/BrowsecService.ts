import path from 'node:path';
import type { Session, WebContents } from 'electron';
import { JsonStore } from '../../main/persistence/JsonStore';
import { BROWSEC_COUNTRIES, BROWSEC_COUNTRY_LIST } from './browsecData';
import { generatePacScript } from './PacGenerator';
import type { BrowsecCountry, BrowsecSettings, BrowsecSmartRule, BrowsecSnapshot } from './types';

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

  return {
    enabled,
    country,
    webrtcLeakProtection,
    smartRules,
  };
}

export class BrowsecService {
  private readonly store: JsonStore<BrowsecSettings>;
  private readonly registeredSessions = new Set<Session>();
  private readonly listeners = new Set<(snapshot: BrowsecSnapshot) => void>();
  private webContentsProvider?: () => WebContents[];

  constructor(userDataPath: string) {
    const storePath = path.join(userDataPath, 'browser-data', 'browsec-settings.json');
    this.store = new JsonStore<BrowsecSettings>(storePath, defaultSettings, normalizeBrowsecSettings);
  }

  setWebContentsProvider(provider: () => WebContents[]): void {
    this.webContentsProvider = provider;
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
      countries: structuredClone(BROWSEC_COUNTRY_LIST),
    };
  }

  getCountries(): BrowsecCountry[] {
    return structuredClone(BROWSEC_COUNTRY_LIST);
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

  async applyProxy(targetSession: Session): Promise<void> {
    const settings = this.store.get();
    const hasActiveSmartRules = settings.smartRules.some((r) => r.enabled);
    if (!settings.enabled && !hasActiveSmartRules) {
      await targetSession.setProxy({ mode: 'direct' });
    } else {
      const pacScript = generatePacScript({
        enabled: settings.enabled,
        country: settings.country,
        smartRules: settings.smartRules,
      });
      const pacDataUrl = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript).toString('base64')}`;
      await targetSession.setProxy({
        pacScript: pacDataUrl,
      });
    }
    await targetSession.closeAllConnections();
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
}
