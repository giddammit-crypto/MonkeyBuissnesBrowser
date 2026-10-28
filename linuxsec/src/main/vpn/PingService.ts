import net from 'node:net';
import { spawn } from 'node:child_process';

export class PingService {
  private cache = new Map<string, { latency: number; timestamp: number }>();
  private cacheTtlMs = 30000; // 30s TTL

  public async measureLatency(endpoint: string, timeoutMs = 1500): Promise<number> {
    if (!endpoint) return 999;

    const cached = this.cache.get(endpoint);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.cacheTtlMs) {
      return cached.latency;
    }

    // Split host:port
    const colonIdx = endpoint.lastIndexOf(':');
    let host = endpoint;
    let port = 443;
    if (colonIdx !== -1) {
      host = endpoint.slice(0, colonIdx);
      const parsedPort = parseInt(endpoint.slice(colonIdx + 1), 10);
      if (!isNaN(parsedPort) && parsedPort > 0) {
        port = parsedPort;
      }
    }

    // Attempt TCP connect latency test
    try {
      const latency = await this.tcpPing(host, port, timeoutMs);
      this.cache.set(endpoint, { latency, timestamp: now });
      return latency;
    } catch {
      // Fallback to ICMP ping if available
      try {
        const icmpLatency = await this.icmpPing(host, timeoutMs);
        this.cache.set(endpoint, { latency: icmpLatency, timestamp: now });
        return icmpLatency;
      } catch {
        const fallback = 999;
        this.cache.set(endpoint, { latency: fallback, timestamp: now });
        return fallback;
      }
    }
  }

  private tcpPing(host: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = process.hrtime.bigint();
      const socket = new net.Socket();

      let resolved = false;
      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        const diffNs = process.hrtime.bigint() - start;
        const latencyMs = Math.round(Number(diffNs) / 1_000_000);
        cleanup();
        resolve(latencyMs);
      });

      socket.on('timeout', () => {
        cleanup();
        reject(new Error('TCP ping timeout'));
      });

      socket.on('error', (err) => {
        cleanup();
        // If connection was refused by target port, host is still reachable!
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          const diffNs = process.hrtime.bigint() - start;
          const latencyMs = Math.round(Number(diffNs) / 1_000_000);
          resolve(latencyMs);
        } else {
          reject(err);
        }
      });

      socket.connect(port, host);
    });
  }

  private icmpPing(host: string, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn('ping', ['-c', '1', '-W', Math.ceil(timeoutMs / 1000).toString(), host]);
      let stdout = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          const match = stdout.match(/time=([\d.]+)\s*ms/);
          if (match && match[1]) {
            return resolve(Math.round(parseFloat(match[1])));
          }
        }
        reject(new Error('ICMP ping failed'));
      });

      child.on('error', reject);
    });
  }
}
