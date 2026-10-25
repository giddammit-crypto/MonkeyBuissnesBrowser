import type { Session } from 'electron';

export interface AdBlockStats {
  enabled: boolean;
  blockedTotal: number;
  blockedByHost: Record<string, number>;
}

interface FilterRule {
  token: string;
  kind: 'host' | 'path';
}

const builtInRules: FilterRule[] = [
  { token: 'doubleclick.net', kind: 'host' },
  { token: 'googlesyndication.com', kind: 'host' },
  { token: 'adservice.google.com', kind: 'host' },
  { token: 'ads-twitter.com', kind: 'host' },
  { token: '/ads/', kind: 'path' },
  { token: '/adserver/', kind: 'path' },
  { token: '/tracking/', kind: 'path' },
  { token: 'pixel.gif', kind: 'path' },
];

export class FilterEngine {
  private enabled = true;
  private readonly rules: FilterRule[] = [...builtInRules];
  private blockedTotal = 0;
  private readonly blockedByHost = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  addRule(rule: string): void {
    const token = rule.trim().toLowerCase();
    if (!token || token.length > 512) return;
    const kind = token.includes('/') ? 'path' : 'host';
    if (!this.rules.some((item) => item.token === token && item.kind === kind)) this.rules.push({ token, kind });
  }

  shouldBlock(rawUrl: string, resourceType?: string): boolean {
    if (!this.enabled || resourceType === 'mainFrame' || resourceType === 'subFrame') return false;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
    const blocked = this.rules.some((rule) => rule.kind === 'host' ? (host === rule.token || host.endsWith(`.${rule.token}`)) : pathAndQuery.includes(rule.token));
    if (blocked) {
      this.blockedTotal += 1;
      this.blockedByHost.set(host, (this.blockedByHost.get(host) ?? 0) + 1);
    }
    return blocked;
  }

  stats(): AdBlockStats {
    return { enabled: this.enabled, blockedTotal: this.blockedTotal, blockedByHost: Object.fromEntries(this.blockedByHost) };
  }
}

export class SessionAdBlock {
  private readonly installed = new WeakSet<Session>();

  constructor(readonly engine: FilterEngine) {}

  install(targetSession: Session): void {
    if (this.installed.has(targetSession)) return;
    this.installed.add(targetSession);
    targetSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      callback({ cancel: this.engine.shouldBlock(details.url, details.resourceType) });
    });
  }
}
