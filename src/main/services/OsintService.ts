import type { Session, WebContents } from 'electron';
import { dnsTypes, publicOsintTarget, type DnsResult, type DnsType, type HttpEvidence, type PageOsint } from '../../shared/osint';

const technicalHeaders = ['content-type', 'server', 'x-powered-by'];
const protectionHeaders = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];

export function osintHttpEvidence(status: number, headers: Record<string, string[] | undefined>): HttpEvidence {
  const values = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status,
    headers: technicalHeaders.flatMap(name => {
      const value = values.get(name)?.[0]?.trim().slice(0, 160);
      return value ? [{ name, value }] : [];
    }),
    protections: protectionHeaders.map(name => ({ name, present: Boolean(values.get(name)?.some(value => value.trim())) })),
  };
}

const dnsEndpoint = 'https://dns.google/resolve';

async function readDnsResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('DNS provider unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024) throw new Error('DNS response too large');
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function queryRecord(session: Session, hostname: string, type: DnsType, signal: AbortSignal): Promise<DnsResult> {
  try {
    const url = new URL(dnsEndpoint);
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const response = await session.fetch(url.href, { credentials: 'omit', redirect: 'error', signal });
    const data = await readDnsResponse(response) as { Status?: unknown; Answer?: unknown };
    if (data?.Status === 3) return { type, status: 'nxdomain', records: [] };
    if (data?.Status !== 0) throw new Error('DNS resolution failed');
    const records = (Array.isArray(data.Answer) ? data.Answer : [])
      .filter(entry => entry && entry.type === dnsTypes[type] && typeof entry.name === 'string' && typeof entry.data === 'string' && Number.isInteger(entry.TTL) && entry.TTL >= 0)
      .slice(0, 24)
      .map(entry => ({ name: entry.name.slice(0, 253), ttl: Number(entry.TTL), value: entry.data.slice(0, 1024) }));
    return { type, status: 'ok', records };
  } catch {
    return { type, status: 'error', records: [] };
  }
}

export async function lookupPublicDns(session: Session, input: unknown): Promise<DnsResult[]> {
  const target = typeof input === 'string' ? publicOsintTarget(input) : null;
  if (!target) throw new Error('Введите публичный домен.');
  const signal = AbortSignal.timeout(8000);
  return Promise.all((Object.keys(dnsTypes) as DnsType[]).map(type => queryRecord(session, target.hostname, type, signal)));
}

function pageEvidence(): PageOsint {
  const field = (selector: string) => (document.querySelector<HTMLMetaElement>(selector)?.content || '').trim().slice(0, 350);
  const origin = (address: string) => {
    const url = URL.parse(address, document.baseURI);
    return url && (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.origin : '';
  };
  const collectOrigins = <T>(items: ArrayLike<T>, address: (item: T) => string) => {
    const result = new Set<string>();
    for (let index = 0; index < Math.min(500, items.length) && result.size < 35; index++) {
      const value = origin(address(items[index]));
      if (value && value !== location.origin) result.add(value);
    }
    return [...result].sort();
  };
  const resources = performance.getEntriesByType('resource');
  const connection = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const forms = Array.from(document.forms).slice(0, 200);
  const actions = forms.map(form => origin(form.action));
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  return {
    origin: location.origin,
    title: document.title.trim().slice(0, 160),
    description: field('meta[name="description" i]'),
    generator: field('meta[name="generator" i]'),
    language: document.documentElement.lang.slice(0, 32),
    robots: field('meta[name="robots" i]'),
    canonicalOrigin: canonical?.href ? origin(canonical.href) : '',
    protocol: (connection?.nextHopProtocol || '').slice(0, 24),
    linkOrigins: collectOrigins(document.links, link => link.href),
    resourceOrigins: collectOrigins(resources, resource => resource.name),
    frameOrigins: collectOrigins(document.getElementsByTagName('iframe'), frame => frame.src),
    forms: { count: forms.length, external: actions.filter(action => action && action !== location.origin).length, http: actions.filter(action => action.startsWith('http:')).length },
  };
}

export async function inspectOsintPage(contents: WebContents): Promise<PageOsint> {
  return contents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${pageEvidence.toString()})()` }], false);
}
