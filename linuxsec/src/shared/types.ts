export type VpnState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'error';

export type VpnProtocol = 'wireguard' | 'openvpn';

export interface WireGuardProfileData {
  privateKey: string;
  address: string[];
  dns?: string[];
  publicKey: string;
  endpoint: string;
  allowedIps: string[];
  presharedKey?: string;
  persistentKeepalive?: number;
  mtu?: number;
}

export interface OpenVpnProfileData {
  rawConfig: string;
  remoteHost: string;
  remotePort: number;
  proto: 'udp' | 'tcp';
  caCert?: string;
  userCert?: string;
  userKey?: string;
  authRequired?: boolean;
  username?: string;
  password?: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  countryCode: string;
  countryName: string;
  flag: string;
  city?: string;
  protocol: VpnProtocol;
  endpoint: string;
  ping?: number;
  isFavorite?: boolean;
  isCustom?: boolean;
  wireguard?: WireGuardProfileData;
  openvpn?: OpenVpnProfileData;
  createdAt: number;
  updatedAt: number;
}

export interface PublicIpInfo {
  ip: string;
  country?: string;
  countryCode?: string;
  city?: string;
  isp?: string;
  queryTime: number;
}

export interface VpnTunnelStatus {
  state: VpnState;
  activeProfile?: ServerProfile;
  connectedSince?: number;
  bytesReceived: number;
  bytesSent: number;
  currentDownloadSpeed: number; // bytes/sec
  currentUploadSpeed: number;   // bytes/sec
  originalPublicIp?: PublicIpInfo;
  currentPublicIp?: PublicIpInfo;
  interfaceName?: string;
  lastHandshakeTime?: number;
  errorMessage?: string;
}

export interface VpnSettings {
  autoStartOnBoot: boolean;
  autoConnectOnStart: boolean;
  killSwitchEnabled: boolean;
  dnsLeakProtection: boolean;
  ipv6LeakProtection: boolean;
  customDnsEnabled: boolean;
  customDnsServers: string[];
  splitTunnelEnabled: boolean;
  splitTunnelExcludedIps: string[];
  splitTunnelExcludedApps: string[];
  theme: 'dark' | 'light' | 'system';
  preferredProtocol: 'wireguard' | 'openvpn' | 'auto';
  defaultServerId?: string;
}

export interface DiagnosticStepResult {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  message: string;
  latencyMs?: number;
  details?: string;
}

export interface DiagnosticsReport {
  timestamp: number;
  steps: DiagnosticStepResult[];
  overallStatus: 'pass' | 'fail' | 'warning';
}

export interface TrafficHistoryPoint {
  timestamp: number;
  downloadBps: number;
  uploadBps: number;
}
