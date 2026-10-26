import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BrowsecService, normalizeDomain } from '../../src/services/browsec/BrowsecService';
import { generatePacScript, buildCountryProxyMap } from '../../src/services/browsec/PacGenerator';
import { BROWSEC_COUNTRIES, BROWSEC_COUNTRY_LIST } from '../../src/services/browsec/browsecData';

describe('Browsec VPN Service', () => {
  let tmpDir: string;
  let service: BrowsecService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browsec-test-'));
    service = new BrowsecService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provides all 44 countries without subscription restrictions', () => {
    expect(BROWSEC_COUNTRY_LIST.length).toBe(44);
    expect(Object.keys(BROWSEC_COUNTRIES).length).toBe(44);

    const snapshot = service.getSnapshot();
    expect(snapshot.countries.length).toBe(44);

    const requiredCountries = ['nl', 'us', 'uk', 'de', 'sg', 'fr', 'jp', 'ca', 'au', 'ru'];
    for (const code of requiredCountries) {
      const country = BROWSEC_COUNTRIES[code];
      expect(country).toBeDefined();
      expect(country.code).toBe(code);
      expect(country.servers.length).toBeGreaterThan(0);
      expect(country.name.length).toBeGreaterThan(0);
      expect(country.nameEn.length).toBeGreaterThan(0);
      expect(country.flag.length).toBeGreaterThan(0);
    }
  });

  it('normalizes domains properly', () => {
    expect(normalizeDomain('https://example.com/path')).toBe('example.com');
    expect(normalizeDomain('http://*.sub.test.org/')).toBe('sub.test.org');
    expect(normalizeDomain('.google.com')).toBe('google.com');
    expect(normalizeDomain('YANDEX.RU/search')).toBe('yandex.ru');
  });

  it('persists settings to userData/browser-data/browsec-settings.json', async () => {
    const settingsPath = path.join(tmpDir, 'browser-data', 'browsec-settings.json');

    await service.toggle(true);
    await service.setCountry('us');
    await service.addSmartRule('custom-site.com', 'de');

    expect(fs.existsSync(settingsPath)).toBe(true);
    const fileContent = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(fileContent.enabled).toBe(true);
    expect(fileContent.country).toBe('us');
    expect(fileContent.smartRules).toEqual([
      { domain: 'custom-site.com', country: 'de', enabled: true },
    ]);
  });

  it('toggles vpn state correctly', async () => {
    const initial = service.getSnapshot();
    expect(initial.enabled).toBe(false);

    const toggledOn = await service.toggle();
    expect(toggledOn.enabled).toBe(true);

    const explicitlyOff = await service.toggle(false);
    expect(explicitlyOff.enabled).toBe(false);

    const explicitlyOn = await service.toggle(true);
    expect(explicitlyOn.enabled).toBe(true);
  });

  it('updates selected country and validates unsupported country codes', async () => {
    const updated = await service.setCountry('de');
    expect(updated.country).toBe('de');
    expect(updated.selectedCountry).toBe('de');

    await expect(service.setCountry('invalid-xyz')).rejects.toThrow();
  });

  it('manages WebRTC leak protection setting', async () => {
    const initial = service.getSnapshot();
    expect(initial.webrtcLeakProtection).toBe(true);

    const disabled = await service.setWebRtcLeakProtection(false);
    expect(disabled.webrtcLeakProtection).toBe(false);
    expect(disabled.webrtcProtection).toBe(false);

    const reEnabled = await service.setWebRtcLeakProtection(true);
    expect(reEnabled.webrtcLeakProtection).toBe(true);
    expect(reEnabled.webrtcProtection).toBe(true);
  });

  it('adds, toggles and removes smart routing rules', async () => {
    await service.addSmartRule('https://rutracker.org/forum', 'nl');
    await service.addSmartRule('internal.company.com', 'direct');

    let snapshot = service.getSnapshot();
    expect(snapshot.smartRules.length).toBe(2);
    expect(snapshot.smartRules.find((r) => r.domain === 'rutracker.org')?.country).toBe('nl');
    expect(snapshot.smartRules.find((r) => r.domain === 'internal.company.com')?.country).toBe('direct');

    // Updating existing rule domain
    await service.addSmartRule('rutracker.org', 'us');
    snapshot = service.getSnapshot();
    expect(snapshot.smartRules.length).toBe(2);
    expect(snapshot.smartRules.find((r) => r.domain === 'rutracker.org')?.country).toBe('us');

    // Toggling rule
    await service.toggleSmartRule('rutracker.org');
    snapshot = service.getSnapshot();
    expect(snapshot.smartRules.find((r) => r.domain === 'rutracker.org')?.enabled).toBe(false);

    // Removing rule
    await service.removeSmartRule('rutracker.org');
    snapshot = service.getSnapshot();
    expect(snapshot.smartRules.length).toBe(1);
    expect(snapshot.smartRules.find((r) => r.domain === 'rutracker.org')).toBeUndefined();
  });

  it('applies PAC proxy and WebRTC policy to registered sessions', async () => {
    let proxyConfig: any = null;
    let connectionsClosed = false;
    let webrtcPolicy: string | null = null;

    const mockSession = {
      setProxy: async (cfg: any) => {
        proxyConfig = cfg;
      },
      closeAllConnections: async () => {
        connectionsClosed = true;
      },
      setWebRTCIPHandlingPolicy: (policy: string) => {
        webrtcPolicy = policy;
      },
    } as any;

    await service.registerSession(mockSession);
    expect(webrtcPolicy).toBe('disable_non_proxied_udp');

    // Initially disabled -> mode direct
    expect(proxyConfig).toEqual({ mode: 'direct' });
    expect(connectionsClosed).toBe(true);

    // Enable VPN
    connectionsClosed = false;
    await service.toggle(true);
    expect(proxyConfig.pacScript).toContain('data:application/x-ns-proxy-autoconfig;base64,');
    expect(connectionsClosed).toBe(true);

    // Toggle WebRTC protection
    await service.setWebRtcLeakProtection(false);
    expect(webrtcPolicy).toBe('default');

    await service.setWebRtcLeakProtection(true);
    expect(webrtcPolicy).toBe('disable_non_proxied_udp');
  });

  it('applies WebRTC policy to webContents', () => {
    let appliedPolicy = '';
    const mockWebContents = {
      isDestroyed: () => false,
      setWebRTCIPHandlingPolicy: (p: string) => {
        appliedPolicy = p;
      },
    } as any;

    service.applyWebRtcPolicyToWebContents(mockWebContents);
    expect(appliedPolicy).toBe('disable_non_proxied_udp');
  });
});

describe('PAC Script Generator', () => {
  it('builds a valid country proxy map with DIRECT fallback', () => {
    const map = buildCountryProxyMap();
    expect(Object.keys(map).length).toBe(44);
    for (const [code, proxyStr] of Object.entries(map)) {
      expect(proxyStr).toContain('HTTPS ');
      expect(proxyStr.endsWith('DIRECT')).toBe(true);
    }
  });

  it('generates a complete FindProxyForURL script with bypass rules and smart routing', () => {
    const pacScript = generatePacScript({
      enabled: true,
      country: 'nl',
      smartRules: [
        { domain: 'bbc.com', country: 'uk', enabled: true },
        { domain: 'intranet.corp', country: 'direct', enabled: true },
        { domain: 'disabled.com', country: 'us', enabled: false },
      ],
    });

    expect(pacScript).toContain('function FindProxyForURL(url, host)');
    expect(pacScript).toContain('isPlainHostName(host)');
    expect(pacScript).toContain('isInNet');
    expect(pacScript).toContain('dnsDomainIs');
    expect(pacScript).toContain('__countries__');

    // Evaluate PAC script in sandboxed JS context to test logic
    const context: any = {
      isPlainHostName: (host: string) => !host.includes('.'),
      isInNet: (ip: string, net: string, mask: string) => ip.startsWith('127.') || ip.startsWith('192.168.'),
      dnsDomainIs: (host: string, domain: string) => host.endsWith(domain),
    };

    const runPac = new Function('context', `
      with (context) {
        ${pacScript}
        return {
          directPlain: FindProxyForURL('http://mycomputer', 'mycomputer'),
          directLocalhost: FindProxyForURL('http://localhost:3000', 'localhost'),
          directPrivateIp: FindProxyForURL('http://192.168.1.1', '192.168.1.1'),
          directLoopback: FindProxyForURL('http://127.0.0.1:8080', '127.0.0.1'),
          smartBbc: FindProxyForURL('https://bbc.com/news', 'bbc.com'),
          smartBbcSubdomain: FindProxyForURL('https://news.bbc.com/article', 'news.bbc.com'),
          smartDirect: FindProxyForURL('http://intranet.corp/index', 'intranet.corp'),
          disabledRuleFallsBackToGlobal: FindProxyForURL('https://disabled.com', 'disabled.com'),
          generalTrafficThroughGlobal: FindProxyForURL('https://wikipedia.org', 'wikipedia.org'),
        };
      }
    `);

    const result = runPac(context);
    expect(result.directPlain).toBe('DIRECT');
    expect(result.directLocalhost).toBe('DIRECT');
    expect(result.directPrivateIp).toBe('DIRECT');
    expect(result.directLoopback).toBe('DIRECT');
    expect(result.smartDirect).toBe('DIRECT');

    const ukProxy = buildCountryProxyMap()['uk'];
    const nlProxy = buildCountryProxyMap()['nl'];

    expect(result.smartBbc).toBe(ukProxy);
    expect(result.smartBbcSubdomain).toBe(ukProxy);
    expect(result.disabledRuleFallsBackToGlobal).toBe(nlProxy);
    expect(result.generalTrafficThroughGlobal).toBe(nlProxy);
  });

  it('routes to DIRECT when vpn is disabled and no smart rule matches', () => {
    const pacScript = generatePacScript({
      enabled: false,
      country: 'nl',
      smartRules: [
        { domain: 'bbc.com', country: 'uk', enabled: true },
      ],
    });

    const context: any = {
      isPlainHostName: (host: string) => !host.includes('.'),
      isInNet: (ip: string, net: string, mask: string) => false,
      dnsDomainIs: (host: string, domain: string) => host.endsWith(domain),
    };

    const runPac = new Function('context', `
      with (context) {
        ${pacScript}
        return {
          general: FindProxyForURL('https://example.com', 'example.com'),
          smart: FindProxyForURL('https://bbc.com', 'bbc.com'),
        };
      }
    `);

    const result = runPac(context);
    expect(result.general).toBe('DIRECT');
    expect(result.smart).toBe(buildCountryProxyMap()['uk']);
  });
});
