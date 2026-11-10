import { parse } from 'tldts';

export const dnsTypes = { A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16, CAA: 257 } as const;
export type DnsType = keyof typeof dnsTypes;

export interface DnsResult {
  type: DnsType;
  status: 'ok' | 'nxdomain' | 'error';
  records: { name: string; ttl: number; value: string }[];
}

export interface HttpEvidence {
  status: number;
  headers: { name: string; value: string }[];
  protections: { name: string; present: boolean }[];
}

export interface PageOsint {
  origin: string;
  http?: HttpEvidence;
  title: string;
  description: string;
  generator: string;
  language: string;
  robots: string;
  canonicalOrigin: string;
  protocol: string;
  linkOrigins: string[];
  resourceOrigins: string[];
  frameOrigins: string[];
  forms: { count: number; external: number; http: number };
}

export function publicOsintTarget(input: string): { hostname: string; domain: string } | null {
  const value = input.trim();
  if (!value || value.length > 2048 || /\s/.test(value)) return null;
  const url = URL.parse(value.includes('://') ? value : `https://${value}`);
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.replace(/\.$/, '');
  const { domain, isIcann, isIp } = parse(hostname);
  if (!domain || !isIcann || isIp || hostname.length > 253 || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return { hostname, domain };
}

export function osintSources({ hostname, domain }: NonNullable<ReturnType<typeof publicOsintTarget>>) {
  return [
    { label: 'ICANN · RDAP', detail: 'Данные регистрации домена', url: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}` },
    { label: 'crt.sh', detail: 'Сертификаты и имена в журналах CT', url: `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}` },
    { label: 'Wayback Machine', detail: 'Архивные снимки сайта', url: `https://web.archive.org/web/*/https://${hostname}/` },
    { label: 'Google · поиск по сайту', detail: 'Проиндексированные страницы', url: `https://www.google.com/search?q=${encodeURIComponent(`site:${hostname}`)}` },
    { label: 'GitHub · поиск по коду', detail: 'Публичные упоминания домена в коде', url: `https://github.com/search?type=code&q=${encodeURIComponent(`"${hostname}"`)}` },
  ];
}
