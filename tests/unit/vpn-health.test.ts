import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BrowsecHealthCheckEngine,
  VpnHealthCheckEngine,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_SOCKET_TIMEOUT_MS,
  normalizeServerKey,
  getAllBrowsecServers,
} from '../../src/services/browsec/BrowsecHealthCheck';
import { BrowsecService } from '../../src/services/browsec/BrowsecService';
import { buildCountryProxyMap, generatePacScript } from '../../src/services/browsec/PacGenerator';
import { BROWSEC_COUNTRIES } from '../../src/services/browsec/browsecData';
import type { BrowsecServer } from '../../src/services/browsec/types';

class MockTlsSocket extends EventEmitter {
  destroyed = false;
  options: any;

  constructor(options: any) {
    super();
    this.options = options;
  }

  destroy() {
    this.destroyed = true;
    return this as any;
  }
}

class MockHttpConnectSocket extends EventEmitter {
  destroyed = false;
  writtenData: string[] = [];
  responseChunks: string[] = [];
  options: any;

  constructor(options: any, response: string = 'HTTP/1.1 200 Connection established\r\n\r\n') {
    super();
    this.options = options;
    this.responseChunks = [response];
  }

  write(chunk: any) {
    this.writtenData.push(chunk.toString());
    queueMicrotask(() => {
      for (const res of this.responseChunks) {
        this.emit('data', Buffer.from(res));
      }
    });
    return true;
  }

  destroy() {
    this.destroyed = true;
    return this as any;
  }
}

describe('VPN Server Health Check Engine', () => {
  it('normalizes server keys correctly with fallback port 443', () => {
    expect(normalizeServerKey({ host: 'nl1.server.net', port: 443 })).toBe('nl1.server.net:443');
    expect(normalizeServerKey({ host: 'NL1.SERVER.NET', port: 8443 })).toBe('nl1.server.net:8443');
    expect(normalizeServerKey('nl1.server.net:443')).toBe('nl1.server.net:443');
    expect(normalizeServerKey('nl1.server.net')).toBe('nl1.server.net:443');
    expect(normalizeServerKey('  US1.SERVER.COM:16927 ')).toBe('us1.server.com:16927');
  });

  it('gathers all unique servers across Browsec country catalog', () => {
    const servers = getAllBrowsecServers();
    expect(servers.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const s of servers) {
      expect(s.host).toBeDefined();
      expect(s.port).toBeGreaterThan(0);
      const key = `${s.host}:${s.port}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  describe('TLS Socket Health Verification (Success & Failure)', () => {
    it('marks server healthy when TLS socket emits secureConnect', async () => {
      let createdSocket: MockTlsSocket | null = null;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        createdSocket = new MockTlsSocket(options);
        queueMicrotask(() => {
          createdSocket?.emit('secureConnect');
        });
        return createdSocket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'nl124.staticvaultcdn.xyz', port: 443 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(true);
      expect(engine.isServerHealthy(server)).toBe(true);
      expect(engine.getDeadServers().size).toBe(0);
      expect(createdSocket?.destroyed).toBe(true);
      expect(mockTlsConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'nl124.staticvaultcdn.xyz',
          port: 443,
          servername: 'nl124.staticvaultcdn.xyz',
          rejectUnauthorized: false,
        }),
      );
      engine.destroy();
    });

    it('marks server dead when TLS socket times out', async () => {
      let createdSocket: MockTlsSocket | null = null;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        createdSocket = new MockTlsSocket(options);
        queueMicrotask(() => {
          createdSocket?.emit('timeout');
        });
        return createdSocket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'nl124.staticvaultcdn.xyz', port: 443 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(false);
      expect(engine.isServerHealthy(server)).toBe(false);
      expect(engine.getDeadServers().has('nl124.staticvaultcdn.xyz:443')).toBe(true);
      expect(createdSocket?.destroyed).toBe(true);
      engine.destroy();
    });

    it('marks server dead when TLS socket encounters a network or handshake error', async () => {
      let createdSocket: MockTlsSocket | null = null;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        createdSocket = new MockTlsSocket(options);
        queueMicrotask(() => {
          createdSocket?.emit('error', new Error('ECONNREFUSED'));
        });
        return createdSocket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'uk25.contentnode.net', port: 16927 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(false);
      expect(engine.isServerHealthy(server)).toBe(false);
      expect(engine.getDeadServers().has('uk25.contentnode.net:16927')).toBe(true);
      expect(createdSocket?.destroyed).toBe(true);
      engine.destroy();
    });

    it('handles synchronous connect exceptions cleanly', async () => {
      const mockTlsConnect = vi.fn().mockImplementation(() => {
        throw new Error('ENETUNREACH');
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'de80.staticvaultcdn.xyz', port: 443 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(false);
      expect(engine.isServerHealthy(server)).toBe(false);
      expect(engine.getDeadServers().has('de80.staticvaultcdn.xyz:443')).toBe(true);
      engine.destroy();
    });

    it('recovers server to healthy when a subsequent check succeeds', async () => {
      let shouldSucceed = false;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        const socket = new MockTlsSocket(options);
        queueMicrotask(() => {
          if (shouldSucceed) {
            socket.emit('secureConnect');
          } else {
            socket.emit('error', new Error('ETIMEDOUT'));
          }
        });
        return socket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'de80.staticvaultcdn.xyz', port: 443 };

      // 1. Initial failure
      shouldSucceed = false;
      const firstCheck = await engine.checkServer(server);
      expect(firstCheck).toBe(false);
      expect(engine.isServerHealthy(server)).toBe(false);
      expect(engine.getDeadServers().size).toBe(1);

      // 2. Recovery on next probe
      shouldSucceed = true;
      const secondCheck = await engine.checkServer(server);
      expect(secondCheck).toBe(true);
      expect(engine.isServerHealthy(server)).toBe(true);
      expect(engine.getDeadServers().size).toBe(0);

      engine.destroy();
    });

    it('runs batch health checks and notifies on status changes', async () => {
      const servers: BrowsecServer[] = [
        { host: 's1.test.net', port: 443 },
        { host: 's2.test.net', port: 443 },
        { host: 's3.test.net', port: 443 },
      ];

      const statusHistory: Set<string>[] = [];
      const mockTlsConnect = vi.fn().mockImplementation((opts: any) => {
        const socket = new MockTlsSocket(opts);
        queueMicrotask(() => {
          if (opts.host === 's2.test.net') {
            socket.emit('timeout');
          } else {
            socket.emit('secureConnect');
          }
        });
        return socket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
        serversProvider: () => servers,
        onStatusChange: (dead) => {
          statusHistory.push(new Set(dead));
        },
      });

      const summary = await engine.checkAllServers();
      expect(summary.totalChecked).toBe(3);
      expect(summary.healthyCount).toBe(2);
      expect(summary.deadCount).toBe(1);
      expect(summary.deadServers).toEqual(['s2.test.net:443']);

      expect(statusHistory.length).toBe(1);
      expect(statusHistory[0].has('s2.test.net:443')).toBe(true);

      engine.destroy();
    });

    it('verifies HTTP CONNECT probe succeeds when proxy returns 200 Connection established', async () => {
      let createdSocket: MockHttpConnectSocket | null = null;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        createdSocket = new MockHttpConnectSocket(options, 'HTTP/1.1 200 Connection established\r\n\r\n');
        queueMicrotask(() => {
          createdSocket?.emit('secureConnect');
        });
        return createdSocket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'nl45.cdnbridge.org', port: 443 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(true);
      expect(engine.isServerHealthy(server)).toBe(true);
      expect(createdSocket?.writtenData.length).toBeGreaterThan(0);
      expect(createdSocket?.writtenData[0]).toContain('CONNECT 1.1.1.1:443 HTTP/1.1');
      engine.destroy();
    });

    it('marks server dead when HTTP CONNECT probe returns non-200 status (e.g. 502 Bad Gateway)', async () => {
      let createdSocket: MockHttpConnectSocket | null = null;
      const mockTlsConnect = vi.fn().mockImplementation((options: any) => {
        createdSocket = new MockHttpConnectSocket(options, 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
        queueMicrotask(() => {
          createdSocket?.emit('secureConnect');
        });
        return createdSocket as any;
      });

      const engine = new BrowsecHealthCheckEngine({
        tlsConnect: mockTlsConnect as any,
      });

      const server: BrowsecServer = { host: 'broken.proxy.net', port: 443 };
      const isAlive = await engine.checkServer(server);

      expect(isAlive).toBe(false);
      expect(engine.isServerHealthy(server)).toBe(false);
      expect(engine.getDeadServers().has('broken.proxy.net:443')).toBe(true);
      engine.destroy();
    });
  });

  describe('12-Hour Timer Schedule Verification', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults to exactly 12 hours check interval (43,200,000 ms)', () => {
      expect(DEFAULT_CHECK_INTERVAL_MS).toBe(12 * 60 * 60 * 1000);
      expect(DEFAULT_CHECK_INTERVAL_MS).toBe(43200000);

      const engine = new BrowsecHealthCheckEngine();
      expect(engine.getIntervalMs()).toBe(43200000);
      engine.destroy();
    });

    it('schedules periodic checks and triggers every 12 hours', async () => {
      const engine = new BrowsecHealthCheckEngine({
        intervalMs: 12 * 60 * 60 * 1000,
      });

      const checkSpy = vi.spyOn(engine, 'checkAllServers').mockResolvedValue({
        totalChecked: 1,
        healthyCount: 1,
        deadCount: 0,
        deadServers: [],
      });

      expect(engine.isScheduled()).toBe(false);
      engine.startSchedule();
      expect(engine.isScheduled()).toBe(true);

      // Advance by 6 hours: should NOT trigger yet
      vi.advanceTimersByTime(6 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(0);

      // Advance another 6 hours (total 12 hours): triggers 1st time
      vi.advanceTimersByTime(6 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(1);

      // Advance another 12 hours (total 24 hours): triggers 2nd time
      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(2);

      // Advance another 24 hours (total 48 hours): triggers 2 more times (total 4)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(4);

      // Stop schedule
      engine.stopSchedule();
      expect(engine.isScheduled()).toBe(false);

      // Advance 12 hours after stopping: should NOT trigger again
      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(4);

      engine.destroy();
    });

    it('does not create duplicate timers if startSchedule is called multiple times', () => {
      const engine = new BrowsecHealthCheckEngine({
        intervalMs: 12 * 60 * 60 * 1000,
      });

      const checkSpy = vi.spyOn(engine, 'checkAllServers').mockResolvedValue({
        totalChecked: 0,
        healthyCount: 0,
        deadCount: 0,
        deadServers: [],
      });

      engine.startSchedule();
      engine.startSchedule();
      engine.startSchedule();

      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(1);

      engine.destroy();
    });

    it('schedules initial check delayed by 5s on startup followed by 12h periodic checks', () => {
      const engine = new BrowsecHealthCheckEngine({
        intervalMs: 12 * 60 * 60 * 1000,
        startupDelayMs: 5000,
      });

      const checkSpy = vi.spyOn(engine, 'checkAllServers').mockResolvedValue({
        totalChecked: 0,
        healthyCount: 0,
        deadCount: 0,
        deadServers: [],
      });

      engine.startSchedule();
      expect(engine.isScheduled()).toBe(true);

      // Advance by 4 seconds: initial check has NOT fired yet
      vi.advanceTimersByTime(4000);
      expect(checkSpy).toHaveBeenCalledTimes(0);

      // Advance by 1 second (total 5 seconds): initial startup check fires!
      vi.advanceTimersByTime(1000);
      expect(checkSpy).toHaveBeenCalledTimes(1);

      // Advance by 12 hours: periodic 12h check fires!
      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
      expect(checkSpy).toHaveBeenCalledTimes(2);

      engine.destroy();
    });
  });

  describe('Dead Server Exclusion from PAC Proxy List', () => {
    it('excludes dead servers from country proxy list while keeping healthy servers', () => {
      const nlInfo = BROWSEC_COUNTRIES['nl'];
      expect(nlInfo.servers).toBeDefined();
      expect(nlInfo.servers!.length).toBeGreaterThanOrEqual(2);

      const primary = nlInfo.servers![0];
      const secondary = nlInfo.servers![1];

      // 1. All healthy
      const mapAllHealthy = buildCountryProxyMap();
      expect(mapAllHealthy['nl']).toContain(`HTTPS ${primary.host}:${primary.port}`);
      expect(mapAllHealthy['nl']).toContain(`HTTPS ${secondary.host}:${secondary.port}`);

      // 2. Primary dead -> excluded from list
      const deadServers = new Set([`${primary.host}:${primary.port}`]);
      const mapWithDead = buildCountryProxyMap(deadServers);

      expect(mapWithDead['nl']).not.toContain(`HTTPS ${primary.host}:${primary.port}`);
      expect(mapWithDead['nl']).toContain(`HTTPS ${secondary.host}:${secondary.port}`);
      expect(mapWithDead['nl'].endsWith('DIRECT')).toBe(true);
    });

    it('matches dead servers by host with or without explicit port and handles casing', () => {
      const deInfo = BROWSEC_COUNTRIES['de'];
      const targetServer = deInfo.servers![0];

      // Match by host only (without port)
      const mapHostOnly = buildCountryProxyMap(new Set([targetServer.host]));
      expect(mapHostOnly['de']).not.toContain(`HTTPS ${targetServer.host}:${targetServer.port}`);

      // Match case-insensitively
      const mapCase = buildCountryProxyMap(new Set([`${targetServer.host.toUpperCase()}:${targetServer.port}`]));
      expect(mapCase['de']).not.toContain(`HTTPS ${targetServer.host}:${targetServer.port}`);
    });

    it('generates PAC script embedding only healthy proxies', () => {
      const nlServers = BROWSEC_COUNTRIES['nl'].servers!;
      const deadPrimary = `${nlServers[0].host}:${nlServers[0].port}`;

      const pacScript = generatePacScript({
        enabled: true,
        country: 'nl',
        smartRules: [],
        deadServers: new Set([deadPrimary]),
      });

      expect(pacScript).not.toContain(deadPrimary);
      expect(pacScript).toContain(`${nlServers[1].host}:${nlServers[1].port}`);
    });
  });

  describe('Fallback to DIRECT or Secondary Server when Primary is Down', () => {
    it('routes to secondary server as first hop when primary server is down', () => {
      const ukServers = BROWSEC_COUNTRIES['uk'].servers!;
      expect(ukServers.length).toBeGreaterThanOrEqual(2);

      const primary = ukServers[0];
      const secondary = ukServers[1];

      const pacScript = generatePacScript({
        enabled: true,
        country: 'uk',
        smartRules: [],
        deadServers: new Set([`${primary.host}:${primary.port}`]),
      });

      // Sandbox evaluate PAC script
      const context: any = {
        isPlainHostName: () => false,
        isInNet: () => false,
        dnsDomainIs: () => false,
      };

      const runPac = new Function('context', `
        with (context) {
          ${pacScript}
          return FindProxyForURL('https://bbc.com', 'bbc.com');
        }
      `);

      const proxyRoute = runPac(context) as string;
      // Must start with secondary server, skipping the dead primary
      expect(proxyRoute.startsWith(`HTTPS ${secondary.host}:${secondary.port}`)).toBe(true);
      expect(proxyRoute).not.toContain(`HTTPS ${primary.host}:${primary.port}`);
      expect(proxyRoute.endsWith('DIRECT')).toBe(true);
    });

    it('falls back to DIRECT when ALL servers for a country are down', () => {
      const usServers = BROWSEC_COUNTRIES['us'].servers!;
      const allUsDead = new Set(usServers.map((s) => `${s.host}:${s.port}`));

      const map = buildCountryProxyMap(allUsDead);
      expect(map['us']).toBe('DIRECT');

      const pacScript = generatePacScript({
        enabled: true,
        country: 'us',
        smartRules: [],
        deadServers: allUsDead,
      });

      const context: any = {
        isPlainHostName: () => false,
        isInNet: () => false,
        dnsDomainIs: () => false,
      };

      const runPac = new Function('context', `
        with (context) {
          ${pacScript}
          return FindProxyForURL('https://example.com', 'example.com');
        }
      `);

      const proxyRoute = runPac(context);
      expect(proxyRoute).toBe('DIRECT');
    });

    it('falls back to DIRECT for smart rule when target country has all dead servers', () => {
      const jpServers = BROWSEC_COUNTRIES['jp'].servers!;
      const allJpDead = new Set(jpServers.map((s) => `${s.host}:${s.port}`));

      const pacScript = generatePacScript({
        enabled: true,
        country: 'nl', // global is NL (healthy)
        smartRules: [
          { domain: 'nhk.or.jp', country: 'jp', enabled: true },
        ],
        deadServers: allJpDead,
      });

      const context: any = {
        isPlainHostName: () => false,
        isInNet: () => false,
        dnsDomainIs: (host: string, domain: string) => host.endsWith(domain),
      };

      const runPac = new Function('context', `
        with (context) {
          ${pacScript}
          return {
            smartJp: FindProxyForURL('https://nhk.or.jp', 'nhk.or.jp'),
            globalNl: FindProxyForURL('https://wikipedia.org', 'wikipedia.org'),
          };
        }
      `);

      const result = runPac(context);
      // Smart rule for Japan falls back to DIRECT because Japan servers are all dead
      expect(result.smartJp).toBe('DIRECT');
      // Normal traffic still routes through healthy Netherlands proxies
      expect(result.globalNl).toContain('HTTPS nl124.staticvaultcdn.xyz:443');
    });

    it('integrates with BrowsecService to dynamically re-apply session proxy upon health changes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-health-service-'));
      const service = new BrowsecService(tmpDir);

      let currentPacScript: string = '';
      const mockSession = {
        setProxy: async (cfg: any) => {
          if (cfg.pacScript) {
            const base64Part = cfg.pacScript.replace('data:application/x-ns-proxy-autoconfig;base64,', '');
            currentPacScript = Buffer.from(base64Part, 'base64').toString('utf8');
          }
        },
        closeAllConnections: async () => {},
        setWebRTCIPHandlingPolicy: () => {},
      } as any;

      await service.registerSession(mockSession);
      await service.toggle(true);
      await service.setCountry('nl');

      const nlServers = BROWSEC_COUNTRIES['nl'].servers!;
      const primaryKey = `${nlServers[0].host}:${nlServers[0].port}`;

      // Initially, primary server is in the PAC script
      expect(currentPacScript).toContain(primaryKey);

      // Health engine detects primary is dead
      const healthCheck = service.getHealthCheck();
      healthCheck.markDead(nlServers[0]);

      // Service receives callback and automatically re-applies updated PAC
      expect(currentPacScript).not.toContain(primaryKey);
      expect(currentPacScript).toContain(`${nlServers[1].host}:${nlServers[1].port}`);

      // Now mark all NL servers dead
      for (const s of nlServers) {
        healthCheck.markDead(s);
      }

      // PAC script should now map NL to DIRECT
      expect(currentPacScript).toContain('"nl":"DIRECT"');

      // Recover servers
      healthCheck.clearDeadServers();
      expect(currentPacScript).toContain(primaryKey);

      service.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('persists server health in browsec-settings.json and restores cached health on restart', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-persist-test-'));
      const service1 = new BrowsecService(tmpDir, { enableHealthCheck: false });

      const healthCheck1 = service1.getHealthCheck();
      healthCheck1.markDead({ host: 'nl124.staticvaultcdn.xyz', port: 443 });
      healthCheck1.setServerLatency({ host: 'nl45.cdnbridge.org', port: 443 }, 42);

      // Check persisted file
      const settingsPath = path.join(tmpDir, 'browser-data', 'browsec-settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(content.deadServers).toContain('nl124.staticvaultcdn.xyz:443');
      expect(content.serverLatencies['nl45.cdnbridge.org:443']).toBe(42);

      service1.destroy();

      // Create service2 pointing to the same directory (simulating app restart)
      const service2 = new BrowsecService(tmpDir, { enableHealthCheck: false });
      const healthCheck2 = service2.getHealthCheck();

      // Cached dead servers and latencies should be restored immediately from browsec-settings.json!
      expect(healthCheck2.isServerHealthy({ host: 'nl124.staticvaultcdn.xyz', port: 443 })).toBe(false);
      expect(healthCheck2.getServerLatency('nl45.cdnbridge.org:443')).toBe(42);

      // Country dynamic primary serverHost should be set to the working server!
      const countries = service2.getCountries();
      const nl = countries.find((c) => c.code === 'nl');
      expect(nl).toBeDefined();
      expect(nl?.serverHost).toBe('nl45.cdnbridge.org');
      expect(nl?.ping).toBe(42);

      service2.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('dynamically sets primary serverHost to fastest working server for each country', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-fastest-test-'));
      const service = new BrowsecService(tmpDir, { enableHealthCheck: false });
      const healthCheck = service.getHealthCheck();

      // For DE: de80 (100ms), de90 (50ms), de81 (150ms)
      healthCheck.markHealthy({ host: 'de80.staticvaultcdn.xyz', port: 443 }, 100);
      healthCheck.markHealthy({ host: 'de90.staticvaultcdn.org', port: 443 }, 50);
      healthCheck.markHealthy({ host: 'de81.servefaststatic.work', port: 443 }, 150);

      let de = service.getCountries().find((c) => c.code === 'de');
      expect(de?.serverHost).toBe('de90.staticvaultcdn.org');
      expect(de?.ping).toBe(50);

      // Now fastest dies (de90 marked dead) -> serverHost should dynamically switch to de80 (100ms)
      healthCheck.markDead({ host: 'de90.staticvaultcdn.org', port: 443 });
      de = service.getCountries().find((c) => c.code === 'de');
      expect(de?.serverHost).toBe('de80.staticvaultcdn.xyz');
      expect(de?.ping).toBe(100);

      service.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('provides getHealthStatus() and triggerManualHealthCheck() on BrowsecService', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-manual-health-test-'));
      const service = new BrowsecService(tmpDir, { enableHealthCheck: false });

      const initialStatus = service.getHealthStatus();
      expect(initialStatus).toBeDefined();
      expect(initialStatus.servers).toBeDefined();
      expect(Object.keys(initialStatus.servers).length).toBe(44);
      expect(initialStatus.servers['nl']).toBeDefined();
      expect(initialStatus.servers['nl'].countryCode).toBe('nl');
      expect(initialStatus.servers['nl'].serverHost).toBeDefined();
      expect(initialStatus.servers['nl'].status).toBe('online');

      // Check snapshot integration
      const snapshot = service.getSnapshot();
      expect(snapshot.healthStatus).toBeDefined();
      expect(snapshot.serverStatus).toBeDefined();
      expect(snapshot.serverStatus?.countryCode).toBe('nl');

      // Check server health lookup
      const nlHealth = service.getServerHealth('nl');
      expect(nlHealth.countryCode).toBe('nl');

      // Manual health check for single country
      let notified = false;
      service.onSnapshot(() => {
        notified = true;
      });

      vi.spyOn(service.getHealthCheck(), 'checkServer').mockImplementation(async (server) => {
        service.getHealthCheck().markHealthy(server, 35);
        return true;
      });

      const updatedStatus = await service.triggerManualHealthCheck('us');
      expect(updatedStatus).toBeDefined();
      expect(updatedStatus.lastChecked).toBeTypeOf('number');
      expect(updatedStatus.servers['us']).toBeDefined();
      expect(notified).toBe(true);

      // Countries catalog has status and latency
      const countries = service.getCountries();
      const us = countries.find((c) => c.code === 'us');
      expect(us).toBeDefined();
      expect(us?.status).toBe('online');
      expect(typeof us?.ping).toBe('number');

      service.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

