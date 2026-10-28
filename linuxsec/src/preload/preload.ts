import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  VpnTunnelStatus,
  ServerProfile,
  VpnSettings,
  DiagnosticsReport,
  PublicIpInfo,
  TrafficHistoryPoint,
} from '../shared/types';

export interface LinuxsecApi {
  vpn: {
    getStatus: () => Promise<VpnTunnelStatus>;
    connect: (profileId?: string) => Promise<VpnTunnelStatus>;
    disconnect: () => Promise<VpnTunnelStatus>;
    onStatusChanged: (callback: (status: VpnTunnelStatus) => void) => () => void;
    onTrafficStats: (callback: (stats: { bytesReceived: number; bytesSent: number; downloadBps: number; uploadBps: number }) => void) => () => void;
  };
  profiles: {
    getAll: () => Promise<ServerProfile[]>;
    save: (profile: Partial<ServerProfile> & { name: string; protocol: 'wireguard' | 'openvpn' }) => Promise<ServerProfile>;
    delete: (id: string) => Promise<boolean>;
    importWireGuard: () => Promise<ServerProfile | null>;
    importOpenVpn: () => Promise<ServerProfile | null>;
    pingAll: () => Promise<Record<string, number>>;
  };
  settings: {
    get: () => Promise<VpnSettings>;
    update: (partial: Partial<VpnSettings>) => Promise<VpnSettings>;
  };
  diagnostics: {
    run: () => Promise<DiagnosticsReport>;
  };
  system: {
    getPublicIp: () => Promise<PublicIpInfo>;
    minimizeWindow: () => void;
    closeWindow: () => void;
  };
}

const api: LinuxsecApi = {
  vpn: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.VPN_GET_STATUS),
    connect: (profileId) => ipcRenderer.invoke(IPC_CHANNELS.VPN_CONNECT, profileId),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.VPN_DISCONNECT),
    onStatusChanged: (callback) => {
      const listener = (_event: unknown, status: VpnTunnelStatus) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.VPN_STATUS_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.VPN_STATUS_CHANGED, listener);
      };
    },
    onTrafficStats: (callback) => {
      const listener = (_event: unknown, stats: any) => callback(stats);
      ipcRenderer.on(IPC_CHANNELS.VPN_TRAFFIC_STATS, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.VPN_TRAFFIC_STATS, listener);
      };
    },
  },
  profiles: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_GET_ALL),
    save: (profile) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SAVE, profile),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DELETE, id),
    importWireGuard: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_IMPORT_CONF),
    importOpenVpn: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_IMPORT_OVPN),
    pingAll: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_PING_ALL),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (partial) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, partial),
  },
  diagnostics: {
    run: () => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_RUN),
  },
  system: {
    getPublicIp: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_PUBLIC_IP),
    minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
    closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  },
};

contextBridge.exposeInMainWorld('linuxsec', api);
