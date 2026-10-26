import type {
  BrowsecCountry,
  BrowsecServer,
  BrowsecSmartRule,
  BrowsecSnapshot,
  BrowsecState,
  VpnHealthStatus,
  VpnServerHealth,
  VpnServerStatus,
} from '../../shared/types';

export interface ServerHealthEntry {
  host: string;
  port: number;
  reachable: boolean;
  latency: number;
  lastChecked: number;
  error?: string;
}

export interface BrowsecSettings {
  enabled: boolean;
  country: string;
  webrtcLeakProtection: boolean;
  smartRules: BrowsecSmartRule[];
  deadServers?: string[];
  serverLatencies?: Record<string, number>;
  serverHealth?: Record<string, ServerHealthEntry>;
  lastHealthCheck?: number;
}

export type {
  BrowsecCountry,
  BrowsecServer,
  BrowsecSmartRule,
  BrowsecSnapshot,
  BrowsecState,
  VpnHealthStatus,
  VpnServerHealth,
  VpnServerStatus,
};
