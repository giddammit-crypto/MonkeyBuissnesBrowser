import { BROWSEC_COUNTRIES } from './browsecData';
import type { BrowsecCountry, BrowsecSmartRule } from './types';

const IGNORED_DOMAINS = [
  'corp',
  'dns',
  'eth',
  'home',
  'ip',
  'intra',
  'intranet',
  'local',
  'onion',
  'tenet',
  'localhost',
  'localtest.me',
  'lvh.me',
  'spotilocal.com',
  'vcap.me',
  'google-analytics.com',
  'browsec.com',
];

const IP_RANGES: Array<[string, string]> = [
  ['0.0.0.0', '255.0.0.0'],
  ['10.0.0.0', '255.0.0.0'],
  ['127.0.0.0', '255.0.0.0'],
  ['169.254.0.0', '255.255.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.0.2.0', '255.255.255.0'],
  ['192.88.99.0', '255.255.255.0'],
  ['192.168.0.0', '255.255.0.0'],
  ['198.18.0.0', '255.254.0.0'],
  ['224.0.0.0', '240.0.0.0'],
  ['240.0.0.0', '240.0.0.0'],
];

export interface PacConfig {
  enabled: boolean;
  country: string;
  smartRules: BrowsecSmartRule[];
  deadServers?: Set<string> | Iterable<string>;
  countries?: Record<string, BrowsecCountry>;
}

export function buildCountryProxyMap(
  deadServers?: Set<string> | Iterable<string>,
  countries?: Record<string, BrowsecCountry>,
): Record<string, string> {
  const deadSet = new Set<string>();
  if (deadServers) {
    for (const item of deadServers) {
      deadSet.add(item.toLowerCase().trim());
    }
  }

  const countrySource = countries ?? BROWSEC_COUNTRIES;
  const map: Record<string, string> = {};
  for (const [code, info] of Object.entries(countrySource)) {
    const serverList = info.servers && info.servers.length > 0
      ? info.servers
      : [{ host: info.serverHost, port: 443 }];

    let healthyServers = serverList.filter((s) => {
      const fullKey = `${s.host}:${s.port || 443}`.toLowerCase().trim();
      const hostOnly = s.host.toLowerCase().trim();
      if (deadSet.has(fullKey) || deadSet.has(hostOnly)) {
        return false;
      }
      if (s.online === false) {
        return false;
      }
      return true;
    });

    healthyServers = healthyServers.slice().sort((a, b) => {
      const latA = typeof a.latency === 'number' ? a.latency : Infinity;
      const latB = typeof b.latency === 'number' ? b.latency : Infinity;
      return latA - latB;
    });

    if (healthyServers.length > 0) {
      const proxies = healthyServers.map((s) => `HTTPS ${s.host.trim().toLowerCase()}:${s.port || 443}`);
      proxies.push('DIRECT');
      map[code] = proxies.join('; ');
    } else {
      map[code] = 'DIRECT';
    }
  }
  return map;
}

export function generatePacScript(config: PacConfig): string {
  const countriesMap = buildCountryProxyMap(config.deadServers, config.countries);
  const globalReturn = config.enabled ? config.country : null;
  const activeFilters = config.smartRules
    .filter((r) => r.enabled && r.domain.trim())
    .map((r) => ({
      value: r.domain.trim().toLowerCase(),
      country: r.country ? r.country.toLowerCase() : 'direct',
    }));

  const jsonCountries = JSON.stringify(countriesMap);
  const jsonGlobalReturn = JSON.stringify(globalReturn);
  const jsonFilters = JSON.stringify(activeFilters);
  const jsonIgnored = JSON.stringify(IGNORED_DOMAINS);
  const jsonIpRanges = JSON.stringify(IP_RANGES);

  return `
var __countries__ = ${jsonCountries};
var __globalReturn__ = ${jsonGlobalReturn};
var __siteFilters__ = ${jsonFilters};
var __ignoredDomains__ = ${jsonIgnored};
var __ipRanges__ = ${jsonIpRanges};

function FindProxyForURL(url, host) {
  if (!host) return "DIRECT";
  host = host.toLowerCase();
  var domain = host.split(":")[0];

  // 1. Plain host names (e.g. "localhost", "my-nas")
  if (isPlainHostName(host) || domain === "localhost") {
    return "DIRECT";
  }

  // 2. IPv6 Unique Local and Link-Local Addresses
  if (typeof isInNetEx !== "undefined") {
    try {
      if (isInNetEx(host, "fc00::/7") || isInNetEx(host, "fe80::/10")) {
        return "DIRECT";
      }
    } catch (e) {}
  }

  // 3. IPv4 Private / Loopback / Multicast subnets
  if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(domain)) {
    for (var i = 0; i < __ipRanges__.length; i++) {
      if (isInNet(domain, __ipRanges__[i][0], __ipRanges__[i][1])) {
        return "DIRECT";
      }
    }
  }

  // 4. Ignored / intranet domain patterns
  for (var j = 0; j < __ignoredDomains__.length; j++) {
    var ignored = __ignoredDomains__[j];
    if (domain === ignored || dnsDomainIs(domain, "." + ignored)) {
      return "DIRECT";
    }
  }

  // 5. Smart Settings (per-domain routing rules)
  for (var k = 0; k < __siteFilters__.length; k++) {
    var filter = __siteFilters__[k];
    if (domain === filter.value || dnsDomainIs(domain, "." + filter.value)) {
      if (!filter.country || filter.country === "direct") {
        return "DIRECT";
      }
      return __countries__[filter.country] || "DIRECT";
    }
  }

  // 6. Global VPN routing
  if (__globalReturn__ && __countries__[__globalReturn__]) {
    return __countries__[__globalReturn__];
  }

  return "DIRECT";
}
`.trim();
}
