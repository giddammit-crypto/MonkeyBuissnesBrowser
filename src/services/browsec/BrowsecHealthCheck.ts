import tls from 'node:tls';
import { isIP } from 'node:net';
import { BROWSEC_COUNTRIES } from './browsecData';
import type { BrowsecCountry, BrowsecServer, ServerHealthEntry, VpnHealthStatus, VpnServerHealth } from './types';

export const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DEFAULT_STARTUP_DELAY_MS = 5000; // 5 seconds
export const DEFAULT_SOCKET_TIMEOUT_MS = 8000; // 8 seconds per check

export function normalizeServerKey(server: BrowsecServer | string): string {
  if (typeof server === 'string') {
    const trimmed = server.trim().toLowerCase();
    return trimmed.includes(':') ? trimmed : `${trimmed}:443`;
  }
  return `${server.host.trim().toLowerCase()}:${server.port || 443}`;
}

export function getAllBrowsecServers(countries?: Record<string, BrowsecCountry>): BrowsecServer[] {
  const source = countries ?? BROWSEC_COUNTRIES;
  const seen = new Set<string>();
  const servers: BrowsecServer[] = [];
  for (const info of Object.values(source)) {
    const serverList = info.servers && info.servers.length > 0
      ? info.servers
      : [{ host: info.serverHost, port: 443 }];
    for (const s of serverList) {
      const key = normalizeServerKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        servers.push({ host: s.host, port: s.port || 443 });
      }
    }
  }
  return servers;
}

export interface HealthCheckSummary {
  totalChecked: number;
  healthyCount: number;
  deadCount: number;
  deadServers: string[];
}

export interface BrowsecHealthCheckOptions {
  intervalMs?: number;
  startupDelayMs?: number;
  socketTimeoutMs?: number;
  tlsConnect?: typeof tls.connect;
  autoStart?: boolean;
  onStatusChange?: (deadServers: Set<string>, latencies?: Map<string, number>) => void;
  serversProvider?: () => BrowsecServer[];
}

export class BrowsecHealthCheckEngine {
  private readonly deadServers = new Set<string>();
  private readonly serverLatencies = new Map<string, number>();
  private readonly serverLastChecked = new Map<string, number>();
  private readonly serverErrors = new Map<string, string>();
  private lastCheckedTime: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly startupDelayMs: number;
  private readonly socketTimeoutMs: number;
  private readonly tlsConnect: typeof tls.connect;
  private onStatusChange?: (deadServers: Set<string>, latencies?: Map<string, number>) => void;
  private readonly serversProvider?: () => BrowsecServer[];
  private isChecking = false;
  private disposed = false;
  private readonly pendingProbes = new Set<() => void>();

  constructor(options: BrowsecHealthCheckOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.startupDelayMs = options.startupDelayMs ?? 0;
    this.socketTimeoutMs = options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
    this.tlsConnect = options.tlsConnect ?? tls.connect;
    this.onStatusChange = options.onStatusChange;
    this.serversProvider = options.serversProvider;

    if (options.autoStart) {
      this.startSchedule();
    }
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  getStartupDelayMs(): number {
    return this.startupDelayMs;
  }

  isScheduled(): boolean {
    return this.timer !== null || this.startupTimer !== null;
  }

  startSchedule(customDelayMs?: number): void {
    if (this.disposed || this.timer || this.startupTimer) {
      return;
    }
    const delay = customDelayMs ?? this.startupDelayMs;
    if (typeof delay === 'number' && delay > 0) {
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        void this.checkAllServers();
      }, delay);
      if (typeof this.startupTimer.unref === 'function') {
        this.startupTimer.unref();
      }
    }
    this.timer = setInterval(() => {
      void this.checkAllServers();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stopSchedule(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isServerHealthy(server: BrowsecServer | string): boolean {
    const key = normalizeServerKey(server);
    const hostOnly = typeof server === 'string' ? server.split(':')[0].trim().toLowerCase() : server.host.trim().toLowerCase();
    return !this.deadServers.has(key) && !this.deadServers.has(hostOnly);
  }

  getDeadServers(): Set<string> {
    return new Set(this.deadServers);
  }

  getServerLatency(server: BrowsecServer | string): number | undefined {
    return this.serverLatencies.get(normalizeServerKey(server));
  }

  getAllLatencies(): Map<string, number> {
    return new Map(this.serverLatencies);
  }

  markDead(server: BrowsecServer | string): void {
    const key = normalizeServerKey(server);
    this.serverLatencies.delete(key);
    if (!this.deadServers.has(key)) {
      this.deadServers.add(key);
      this.notifyStatusChange();
    }
  }

  markHealthy(server: BrowsecServer | string, latency?: number): void {
    const key = normalizeServerKey(server);
    const hostOnly = typeof server === 'string' ? server.split(':')[0].trim().toLowerCase() : server.host.trim().toLowerCase();
    const removedKey = this.deadServers.delete(key);
    const removed = this.deadServers.delete(hostOnly) || removedKey;
    if (typeof latency === 'number' && latency >= 0) {
      this.serverLatencies.set(key, latency);
    }
    if (removed || latency !== undefined) {
      this.notifyStatusChange();
    }
  }

  clearDeadServers(): void {
    if (this.deadServers.size > 0) {
      this.deadServers.clear();
      this.notifyStatusChange();
    }
  }

  setOnStatusChange(callback?: (deadServers: Set<string>, latencies?: Map<string, number>) => void): void {
    this.onStatusChange = callback;
  }

  private notifyStatusChange(): void {
    if (!this.disposed && this.onStatusChange) {
      try {
        this.onStatusChange(new Set(this.deadServers), new Map(this.serverLatencies));
      } catch (err) {
        console.error('Error in health check status change listener:', err);
      }
    }
  }

  async checkServer(server: BrowsecServer, timeoutMs = this.socketTimeoutMs): Promise<boolean> {
    if (this.disposed) return false;
    const key = normalizeServerKey(server);
    const port = server.port || 443;
    const host = server.host.trim();

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let socket: tls.TLSSocket | null = null;
      const startTime = Date.now();
      let headerBuffer = '';
      let deadline: NodeJS.Timeout | undefined;
      const cancel = () => finish(false, undefined, 'Health check cancelled');

      const finish = (healthy: boolean, latency?: number, errorMessage?: string) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        this.pendingProbes.delete(cancel);

        if (socket) {
          try {
            socket.removeAllListeners();
            socket.destroy();
          } catch {}
          socket = null;
        }

        if (this.disposed) { resolve(false); return; }
        const now = Date.now();
        this.serverLastChecked.set(key, now);

        if (healthy) {
          this.deadServers.delete(key);
          if (typeof latency === 'number' && latency >= 0) {
            this.serverLatencies.set(key, latency);
          }
          this.serverErrors.delete(key);
        } else {
          this.deadServers.add(key);
          if (typeof latency === 'number' && latency >= 0) {
            this.serverLatencies.set(key, latency);
          }
          this.serverErrors.set(key, errorMessage || 'Connection failed');
        }

        resolve(healthy);
      };

      this.pendingProbes.add(cancel);
      deadline = setTimeout(() => finish(false, Math.max(1, Date.now() - startTime), 'Connection timed out'), timeoutMs);
      deadline.unref?.();
      try {
        const connectFn = this.tlsConnect;
        const options: tls.ConnectionOptions = {
          host,
          port,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        };
        if (!isIP(host)) {
          options.servername = host;
        }
        socket = connectFn(options);

        socket.once('secureConnect', () => {
          if (typeof socket?.write !== 'function') {
            const latency = Math.max(1, Date.now() - startTime);
            finish(true, latency);
            return;
          }

          try {
            socket.write(
              'CONNECT 1.1.1.1:443 HTTP/1.1\r\nHost: 1.1.1.1:443\r\nProxy-Connection: keep-alive\r\nUser-Agent: soulm8te-vpn-probe/1.0\r\n\r\n',
            );
          } catch (writeErr: any) {
            finish(false, Math.max(1, Date.now() - startTime), writeErr?.message || 'Failed to send HTTP CONNECT');
          }
        });

        socket.on('data', (chunk) => {
          if (settled) return;
          const latency = Math.max(1, Date.now() - startTime);
          if (Buffer.byteLength(headerBuffer) + chunk.length > 8192) {
            finish(false, latency, 'Proxy response header exceeds 8 KiB');
            return;
          }
          headerBuffer += chunk.toString('utf8');
          const end = headerBuffer.indexOf('\r\n');
          if (end < 0) return;
          const firstLine = headerBuffer.slice(0, end).trim();
          if (/^HTTP\/\d(?:\.\d)?\s+200(?:\s|$)/i.test(firstLine)) finish(true, latency);
          else finish(false, latency, `Proxy returned status: ${firstLine.slice(0, 200)}`);
        });

        socket.once('timeout', () => {
          const latency = Math.max(1, Date.now() - startTime);
          finish(false, latency, 'Connection timed out');
        });

        socket.once('error', (err) => {
          const latency = Math.max(1, Date.now() - startTime);
          finish(false, latency, err?.message || 'Socket error');
        });

        socket.once('close', () => {
          finish(false, Math.max(1, Date.now() - startTime), 'Connection closed before proxy response');
        });
      } catch (err: any) {
        finish(false, 0, err?.message || 'Connection initialization error');
      }
    });
  }

  async checkAllServers(): Promise<HealthCheckSummary> {
    if (this.isChecking || this.disposed) {
      return {
        totalChecked: 0,
        healthyCount: 0,
        deadCount: this.deadServers.size,
        deadServers: Array.from(this.deadServers),
      };
    }

    this.isChecking = true;
    try {
      const servers = this.serversProvider ? this.serversProvider() : getAllBrowsecServers();

      // Concurrency batch execution (limit to 10 parallel probes to avoid socket limits)
      const batchSize = 10;
      for (let i = 0; i < servers.length && !this.disposed; i += batchSize) {
        const batch = servers.slice(i, i + batchSize);
        await Promise.all(batch.map((server) => this.checkServer(server)));
      }

      this.lastCheckedTime = Date.now();
      this.notifyStatusChange();

      return {
        totalChecked: servers.length,
        healthyCount: servers.length - this.deadServers.size,
        deadCount: this.deadServers.size,
        deadServers: Array.from(this.deadServers),
      };
    } finally {
      this.isChecking = false;
    }
  }

  async triggerManualHealthCheck(countryCode?: string): Promise<VpnHealthStatus> {
    if (countryCode) {
      const info = BROWSEC_COUNTRIES[countryCode.toLowerCase().trim()];
      if (info) {
        const serverList = info.servers && info.servers.length > 0
          ? info.servers
          : [{ host: info.serverHost, port: 443 }];
        await Promise.all(serverList.map((server) => this.checkServer(server)));
        this.lastCheckedTime = Date.now();
        this.notifyStatusChange();
      }
    } else {
      await this.checkAllServers();
    }
    return this.getHealthStatus();
  }

  getHealthStatus(): VpnHealthStatus {
    const servers: Record<string, VpnServerHealth> = {};
    for (const [code, info] of Object.entries(BROWSEC_COUNTRIES)) {
      const serverList = info.servers && info.servers.length > 0
        ? info.servers
        : [{ host: info.serverHost, port: 443 }];

      const healthyServers = serverList.filter((s) => this.isServerHealthy(s));
      healthyServers.sort((a, b) => {
        const latA = this.serverLatencies.get(normalizeServerKey(a)) ?? Infinity;
        const latB = this.serverLatencies.get(normalizeServerKey(b)) ?? Infinity;
        return latA - latB;
      });

      const primaryServer = healthyServers[0] || serverList[0];
      const key = normalizeServerKey(primaryServer);
      const isHealthy = this.isServerHealthy(primaryServer);
      const ping = this.serverLatencies.get(key) ?? info.ping ?? 50;
      const lastChecked = this.serverLastChecked.get(key) ?? this.lastCheckedTime ?? Date.now();
      const error = this.serverErrors.get(key);

      servers[code] = {
        countryCode: code,
        serverHost: primaryServer.host,
        port: primaryServer.port,
        status: isHealthy ? 'online' : 'offline',
        ping,
        lastChecked,
        error,
      };
    }

    const total = Object.keys(servers).length;
    const dead = this.deadServers.size;
    const overallStatus: VpnHealthStatus['overallStatus'] =
      this.lastCheckedTime === null
        ? 'unknown'
        : dead === 0
          ? 'online'
          : dead < total
            ? 'degraded'
            : 'offline';

    return {
      lastChecked: this.lastCheckedTime,
      nextScheduledCheck: this.lastCheckedTime ? this.lastCheckedTime + this.intervalMs : (this.timer ? Date.now() + this.intervalMs : null),
      isChecking: this.isChecking,
      overallStatus,
      servers,
    };
  }

  setServerLatency(server: BrowsecServer | string, latency: number): void {
    const key = normalizeServerKey(server);
    this.serverLatencies.set(key, latency);
    this.notifyStatusChange();
  }

  exportHealthRecords(): Record<string, ServerHealthEntry> {
    const records: Record<string, ServerHealthEntry> = {};
    const servers = this.serversProvider ? this.serversProvider() : getAllBrowsecServers();
    for (const server of servers) {
      const key = normalizeServerKey(server);
      const isDead = this.deadServers.has(key) || this.deadServers.has(server.host.toLowerCase().trim());
      records[key] = {
        host: server.host,
        port: server.port,
        reachable: !isDead,
        latency: this.serverLatencies.get(key) ?? 0,
        lastChecked: this.serverLastChecked.get(key) ?? this.lastCheckedTime ?? Date.now(),
        error: this.serverErrors.get(key),
      };
    }
    return records;
  }

  importHealthRecords(
    records?: Record<string, ServerHealthEntry>,
    deadServersList?: string[],
    latenciesRecord?: Record<string, number>,
  ): void {
    if (deadServersList && Array.isArray(deadServersList)) {
      for (const dead of deadServersList) {
        if (typeof dead === 'string' && dead.trim()) {
          this.deadServers.add(normalizeServerKey(dead));
        }
      }
    }
    if (latenciesRecord && typeof latenciesRecord === 'object') {
      for (const [key, lat] of Object.entries(latenciesRecord)) {
        if (typeof lat === 'number' && Number.isFinite(lat) && lat >= 0) {
          this.serverLatencies.set(normalizeServerKey(key), lat);
        }
      }
    }
    if (records && typeof records === 'object') {
      for (const [key, entry] of Object.entries(records)) {
        if (!entry || typeof entry !== 'object') continue;
        const normalized = normalizeServerKey(key);
        if (entry.reachable === false) {
          this.deadServers.add(normalized);
        } else {
          this.deadServers.delete(normalized);
        }
        if (typeof entry.latency === 'number' && entry.latency >= 0) {
          this.serverLatencies.set(normalized, entry.latency);
        }
        if (typeof entry.lastChecked === 'number' && entry.lastChecked > 0) {
          this.serverLastChecked.set(normalized, entry.lastChecked);
        }
        if (typeof entry.error === 'string') {
          this.serverErrors.set(normalized, entry.error);
        }
      }
    }
    this.notifyStatusChange();
  }

  destroy(): void {
    this.disposed = true;
    this.stopSchedule();
    for (const cancel of this.pendingProbes) cancel();
    this.pendingProbes.clear();
    this.deadServers.clear();
    this.serverLatencies.clear();
    this.serverLastChecked.clear();
    this.serverErrors.clear();
    this.onStatusChange = undefined;
  }
}

// Alias for generic VPN health check naming convention
export { BrowsecHealthCheckEngine as VpnHealthCheckEngine };
