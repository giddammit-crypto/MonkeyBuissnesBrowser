import https from 'node:https';
import http from 'node:http';
import type { PublicIpInfo } from '../../shared/types';

interface IpApiResponse {
  ip?: string;
  country_name?: string;
  country_code?: string;
  city?: string;
  org?: string;
}

function fetchJson<T>(url: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Linuxsec-VPN-Client/1.0',
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          return reject(new Error(`HTTP status ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms)`));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

function fetchText(url: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Linuxsec-VPN-Client/1.0',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(data.trim());
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms)`));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

export class PublicIpService {
  private cachedIpInfo?: PublicIpInfo;
  private lastFetchTime = 0;
  private cacheTtlMs = 15000; // 15 seconds

  public async getPublicIp(forceRefresh = false): Promise<PublicIpInfo> {
    const now = Date.now();
    if (!forceRefresh && this.cachedIpInfo && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedIpInfo;
    }

    // Try primary provider (ipapi.co for rich geo data)
    try {
      const data = await fetchJson<IpApiResponse>('https://ipapi.co/json/', 3500);
      if (data && data.ip) {
        const info: PublicIpInfo = {
          ip: data.ip,
          country: data.country_name || 'Unknown',
          countryCode: (data.country_code || 'un').toLowerCase(),
          city: data.city || '',
          isp: data.org || '',
          queryTime: now,
        };
        this.cachedIpInfo = info;
        this.lastFetchTime = now;
        return info;
      }
    } catch {
      // Fallback 1: ipify.org
      try {
        const data = await fetchJson<{ ip: string }>('https://api.ipify.org?format=json', 3000);
        if (data && data.ip) {
          const info: PublicIpInfo = {
            ip: data.ip,
            country: 'External IP',
            countryCode: 'un',
            queryTime: now,
          };
          this.cachedIpInfo = info;
          this.lastFetchTime = now;
          return info;
        }
      } catch {
        // Fallback 2: icanhazip.com
        try {
          const rawIp = await fetchText('https://icanhazip.com', 2500);
          if (rawIp && /^[0-9a-fA-F:.]+$/.test(rawIp)) {
            const info: PublicIpInfo = {
              ip: rawIp,
              country: 'External IP',
              countryCode: 'un',
              queryTime: now,
            };
            this.cachedIpInfo = info;
            this.lastFetchTime = now;
            return info;
          }
        } catch {
          // If all fail, return last known or offline indicator
        }
      }
    }

    return (
      this.cachedIpInfo || {
        ip: 'Checking...',
        country: 'Detecting network...',
        countryCode: 'un',
        queryTime: now,
      }
    );
  }

  public invalidate(): void {
    this.lastFetchTime = 0;
  }
}
