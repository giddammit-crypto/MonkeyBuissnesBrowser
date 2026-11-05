import type { Session } from 'electron';
import { normalizeSiteExceptions, normalizeSiteKey } from '../../shared/sitePolicy';

export interface AdBlockStats {
  enabled: boolean;
  blockedTotal: number;
  blockedByHost: Record<string, number>;
  exceptions: string[];
}

interface FilterRule {
  token: string;
  kind: 'host' | 'path';
  excludedResourceTypes?: readonly string[];
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
  { token: 'google-analytics.com', kind: 'host' },
  { token: 'ssl.google-analytics.com', kind: 'host' },
  { token: 'googletagmanager.com', kind: 'host' },
  // Yandex advertising & metrics
  { token: 'mc.yandex.ru', kind: 'host' },
  { token: 'mc.yandex.com', kind: 'host' },
  { token: 'mc.webvisor.com', kind: 'host' },
  { token: 'mc.webvisor.org', kind: 'host' },
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
  // Telemetry, heatmap & keylogger trackers
  { token: 'connect.facebook.net', kind: 'host' },
  { token: 'clarity.ms', kind: 'host' },
  { token: 'hotjar.com', kind: 'host' },
  { token: 'static.hotjar.com', kind: 'host' },
  { token: 'analytics.tiktok.com', kind: 'host' },
  { token: 'segment.io', kind: 'host' },
  { token: 'api.segment.io', kind: 'host' },
  { token: 'amplitude.com', kind: 'host' },
  // Cookie consent banner trackers
  { token: 'consent.cookiebot.com', kind: 'host' },
  { token: 'cdn.cookielaw.org', kind: 'host' },
  // Generic directory names also occur in legitimate layout assets. Preserve
  // CSS and web fonts here; explicit host rules and user rules still apply.
  // Chromium remains responsible for CSP, CORS and font validation.
  // Path rules
  { token: '/ads/', kind: 'path', excludedResourceTypes: ['font', 'stylesheet'] },
  { token: '/adserver/', kind: 'path', excludedResourceTypes: ['font', 'stylesheet'] },
  { token: '/pagead/', kind: 'path', excludedResourceTypes: ['font', 'stylesheet'] },
  { token: '/api/stats/ads', kind: 'path' },
  { token: '/ptracking', kind: 'path' },
  { token: '/get_midroll_info', kind: 'path' },
  { token: 'pixel.gif', kind: 'path' },
  // YouTube advertising & tracking
  { token: 'ad.youtube.com', kind: 'host' },
  { token: 'ads.youtube.com', kind: 'host' },
  { token: '/youtubei/v1/player/ad_break', kind: 'path' },
  { token: '/pagead/parallel_ad_break', kind: 'path' },
  { token: '/pagead/lv_ad_break', kind: 'path' },
  { token: '/api/stats/qoe?adformat=', kind: 'path' },
  { token: '/youtubei/v1/att/get', kind: 'path' },
];

export class FilterEngine {
  private enabled = true;
  private readonly rules: FilterRule[] = builtInRules.map(rule => ({ ...rule }));
  private exceptions: string[] = [];
  private exceptionSites = new Set<string>();
  private readonly exceptionDecisions = new Map<string, boolean>();
  private readonly hostRules = new Set(builtInRules.filter(rule => rule.kind === 'host').map(rule => rule.token));
  private readonly pathRules = this.rules.filter(rule => rule.kind === 'path');
  private blockedTotal = 0;
  private readonly blockedByHost = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setExceptions(exceptions: string[]): void {
    this.exceptions = normalizeSiteExceptions(exceptions);
    this.exceptionSites = new Set(this.exceptions);
    this.exceptionDecisions.clear();
  }

  getExceptions(): string[] {
    return [...this.exceptions];
  }

  isException(initiatingPageUrl?: string): boolean {
    if (!initiatingPageUrl || this.exceptions.length === 0) return false;
    const cacheable = initiatingPageUrl.length <= 4096;
    const known = cacheable ? this.exceptionDecisions.get(initiatingPageUrl) : undefined;
    if (known !== undefined) return known;
    const site = normalizeSiteKey(initiatingPageUrl);
    const decision = site !== null && this.exceptionSites.has(site);
    if (this.exceptionDecisions.size >= 256) this.exceptionDecisions.delete(this.exceptionDecisions.keys().next().value!);
    if (cacheable) this.exceptionDecisions.set(initiatingPageUrl, decision);
    return decision;
  }

  addRule(rule: string): void {
    const token = rule.trim().toLowerCase();
    if (!token || token.length > 512) return;
    const kind = token.includes('/') ? 'path' : 'host';
    const existing = this.rules.find((item) => item.token === token && item.kind === kind);
    if (existing) {
      // A user-added rule is explicit, including when it refines a built-in
      // directory heuristic. Do not mutate the shared built-in definitions.
      existing.excludedResourceTypes = undefined;
    } else {
      this.rules.push({ token, kind });
      if (kind === 'host') this.hostRules.add(token);
      else this.pathRules.push({ token, kind });
    }
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
    const pathname = url.pathname.toLowerCase();
    let matchedHost = host;
    let hostBlocked = false;
    while (matchedHost) {
      if (this.hostRules.has(matchedHost)) { hostBlocked = true; break; }
      const dot = matchedHost.indexOf('.');
      if (dot < 0) break;
      matchedHost = matchedHost.slice(dot + 1);
    }
    // A nested URL, video title or tracking parameter is data, not the
    // requested resource path. Matching the entire URL blocked legitimate
    // icon/stylesheet/bootstrap requests with e.g. ?next=/ads/ in their query.
    const blocked = hostBlocked || this.pathRules.some(rule => {
      if (resourceType && rule.excludedResourceTypes?.includes(resourceType)) return false;
      const token = rule.token;
      const queryStart = token.indexOf('?');
      if (queryStart < 0) return pathname.includes(token);
      const path = token.slice(0, queryStart);
      if (!pathname.includes(path)) return false;
      const expected = new URLSearchParams(token.slice(queryStart + 1));
      return [...expected].every(([key, value]) => {
        const actual = url.searchParams.get(key);
        return actual !== null && (value === '' || actual.toLowerCase().includes(value));
      });
    });
    if (blocked) {
      this.blockedTotal += 1;
      if (!this.blockedByHost.has(host) && this.blockedByHost.size >= 1024) {
        this.blockedByHost.delete(this.blockedByHost.keys().next().value!);
      }
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
