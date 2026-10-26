import type { Session } from 'electron';
import { isAdBlockDisabledForSite } from '../../shared/sitePolicy';

export interface AdBlockStats {
  enabled: boolean;
  blockedTotal: number;
  blockedByHost: Record<string, number>;
  exceptions: string[];
}

interface FilterRule {
  token: string;
  kind: 'host' | 'path';
}

const builtInRules: FilterRule[] = [
  // Google advertising & telemetry
  { token: 'doubleclick.net', kind: 'host' },
  { token: 'googlesyndication.com', kind: 'host' },
  { token: 'adservice.google.com', kind: 'host' },
  { token: 'googleadservices.com', kind: 'host' },
  { token: 'pagead2.googlesyndication.com', kind: 'host' },
  { token: 'stats.g.doubleclick.net', kind: 'host' },
  { token: 'admob.com', kind: 'host' },
  { token: '2mdn.net', kind: 'host' },
  // Yandex advertising & metrics
  { token: 'an.yandex.ru', kind: 'host' },
  { token: 'yabs.yandex.ru', kind: 'host' },
  { token: 'adstat.yandex.ru', kind: 'host' },
  { token: 'bs.yandex.ru', kind: 'host' },
  { token: 'adfox.ru', kind: 'host' },
  { token: 'awaps.yandex.net', kind: 'host' },
  { token: 'direct.yandex.ru', kind: 'host' },
  // VK & Mail.ru advertising
  { token: 'ads.vk.com', kind: 'host' },
  { token: 'ad.mail.ru', kind: 'host' },
  { token: 'target.my.com', kind: 'host' },
  { token: 'top-fwz1.mail.ru', kind: 'host' },
  { token: 'counter.yadro.ru', kind: 'host' },
  { token: 'tns-counter.ru', kind: 'host' },
  // Global ad exchanges & trackers
  { token: 'ads-twitter.com', kind: 'host' },
  { token: 'criteo.com', kind: 'host' },
  { token: 'criteo.net', kind: 'host' },
  { token: 'taboola.com', kind: 'host' },
  { token: 'outbrain.com', kind: 'host' },
  { token: 'adroll.com', kind: 'host' },
  { token: 'rubiconproject.com', kind: 'host' },
  { token: 'adnxs.com', kind: 'host' },
  { token: 'smartadserver.com', kind: 'host' },
  { token: 'pubmatic.com', kind: 'host' },
  { token: 'openx.net', kind: 'host' },
  { token: 'casalemedia.com', kind: 'host' },
  { token: 'popads.net', kind: 'host' },
  { token: 'mgid.com', kind: 'host' },
  { token: 'scorecardresearch.com', kind: 'host' },
  { token: 'quantserve.com', kind: 'host' },
  { token: 'moatads.com', kind: 'host' },
  { token: 'advertising.com', kind: 'host' },
  { token: 'adtechus.com', kind: 'host' },
  // Path rules
  { token: '/ads/', kind: 'path' },
  { token: '/adserver/', kind: 'path' },
  { token: '/pagead/', kind: 'path' },
  { token: '/api/stats/ads', kind: 'path' },
  { token: '/ptracking', kind: 'path' },
  { token: '/get_midroll_info', kind: 'path' },
  { token: 'pixel.gif', kind: 'path' },
];

export class FilterEngine {
  private enabled = true;
  private readonly rules: FilterRule[] = [...builtInRules];
  private exceptions: string[] = [];
  private blockedTotal = 0;
  private readonly blockedByHost = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setExceptions(exceptions: string[]): void {
    this.exceptions = Array.isArray(exceptions) ? exceptions : [];
  }

  getExceptions(): string[] {
    return [...this.exceptions];
  }

  isException(initiatingPageUrl?: string): boolean {
    if (!initiatingPageUrl || this.exceptions.length === 0) return false;
    return isAdBlockDisabledForSite(initiatingPageUrl, this.exceptions);
  }

  addRule(rule: string): void {
    const token = rule.trim().toLowerCase();
    if (!token || token.length > 512) return;
    const kind = token.includes('/') ? 'path' : 'host';
    if (!this.rules.some((item) => item.token === token && item.kind === kind)) this.rules.push({ token, kind });
  }

  shouldBlock(rawUrl: string, resourceType?: string, initiatingPageUrl?: string): boolean {
    if (!this.enabled || resourceType === 'mainFrame') return false;
    if (initiatingPageUrl && this.isException(initiatingPageUrl)) return false;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
    const blocked = this.rules.some((rule) => rule.kind === 'host' ? (host === rule.token || host.endsWith(`.${rule.token}`)) : (pathAndQuery.includes(rule.token) || rawUrl.toLowerCase().includes(rule.token)));
    if (blocked) {
      this.blockedTotal += 1;
      this.blockedByHost.set(host, (this.blockedByHost.get(host) ?? 0) + 1);
    }
    return blocked;
  }

  stats(): AdBlockStats {
    return {
      enabled: this.enabled,
      blockedTotal: this.blockedTotal,
      blockedByHost: Object.fromEntries(this.blockedByHost),
      exceptions: [...this.exceptions],
    };
  }
}

export class SessionAdBlock {
  private readonly installed = new WeakSet<Session>();

  constructor(readonly engine: FilterEngine) {}

  install(targetSession: Session, getInitiatingPageUrl?: (details: Electron.OnBeforeRequestListenerDetails) => string | undefined): void {
    if (this.installed.has(targetSession)) return;
    this.installed.add(targetSession);
    targetSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const pageUrl = getInitiatingPageUrl ? getInitiatingPageUrl(details) : details.referrer;
      callback({ cancel: this.engine.shouldBlock(details.url, details.resourceType, pageUrl) });
    });
  }
}
