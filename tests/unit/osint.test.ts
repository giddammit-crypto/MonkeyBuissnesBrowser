import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { lookupPublicDns, osintHttpEvidence } from '../../src/main/services/OsintService';
import { osintSources, publicOsintTarget } from '../../src/shared/osint';

describe('public OSINT inputs and evidence', () => {
  it('uses only normalized public hosts in provider URLs', () => {
    const target = publicOsintTarget('https://WWW.example.co.uk/path?token=secret#hash');
    expect(target).toEqual({ hostname: 'www.example.co.uk', domain: 'example.co.uk' });
    expect(JSON.stringify(osintSources(target!))).not.toMatch(/secret|\/path|#hash/);
    expect(publicOsintTarget('пример.рф')?.hostname).toBe('xn--e1afmkfd.xn--p1ai');
    for (const invalid of ['localhost', '127.0.0.1', 'http://[::1]', 'host.test', 'https://user:password@example.org', 'ftp://example.org', 'foo_bar.example.org', 'https://.example.org']) {
      expect(publicOsintTarget(invalid)).toBeNull();
    }
  });

  it('reports header presence without retaining cookies or CSP nonce values', () => {
    const report = osintHttpEvidence(200, {
      Server: ['fixture'],
      'CONTENT-SECURITY-POLICY': ["script-src 'nonce-secret'"],
      'Set-Cookie': ['secret=123'],
      Authorization: ['Bearer secret'],
    });
    expect(report.headers).toEqual([{ name: 'server', value: 'fixture' }]);
    expect(report.protections).toContainEqual({ name: 'content-security-policy', present: true });
    expect(report.protections).toContainEqual({ name: 'referrer-policy', present: false });
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('uses the fixed DoH endpoint, rejects redirects and keeps partial DNS results', async () => {
    const fetch = vi.fn(async (address: string) => {
      const { searchParams } = new URL(address);
      const type = searchParams.get('type');
      const data = type === 'A' ? { Status: 0, Answer: [{ type: 1, data: '192.0.2.1', TTL: 120, name: 'example.org.' }, { type: 5, data: 'alias', TTL: 1, name: 'example.org.' }] }
        : type === 'AAAA' ? { Status: 3 }
          : type === 'MX' ? { Status: 2 } : { Status: 0 };
      return Response.json(data);
    });
    const session = { fetch } as unknown as Session;
    await expect(lookupPublicDns(session, 'server.local')).rejects.toThrow('публичный домен');
    expect(fetch).not.toHaveBeenCalled();
    const result = await lookupPublicDns(session, 'https://example.org/?token=secret');
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch).toHaveBeenCalledWith('https://dns.google/resolve?name=example.org&type=A', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    expect(result).toContainEqual({ type: 'A', status: 'ok', records: [{ value: '192.0.2.1', ttl: 120, name: 'example.org.' }] });
    expect(result).toContainEqual({ type: 'AAAA', status: 'nxdomain', records: [] });
    expect(result).toContainEqual({ type: 'MX', status: 'error', records: [] });
  });
});
