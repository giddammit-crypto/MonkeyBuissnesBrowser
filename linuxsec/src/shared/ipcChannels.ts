export const IPC_CHANNELS = {
  // VPN control
  VPN_CONNECT: 'linuxsec:vpn:connect',
  VPN_DISCONNECT: 'linuxsec:vpn:disconnect',
  VPN_GET_STATUS: 'linuxsec:vpn:get-status',
  VPN_STATUS_CHANGED: 'linuxsec:vpn:status-changed',
  VPN_TRAFFIC_STATS: 'linuxsec:vpn:traffic-stats',

  // Server profiles
  PROFILES_GET_ALL: 'linuxsec:profiles:get-all',
  PROFILES_SAVE: 'linuxsec:profiles:save',
  PROFILES_DELETE: 'linuxsec:profiles:delete',
  PROFILES_IMPORT_CONF: 'linuxsec:profiles:import-conf',
  PROFILES_IMPORT_OVPN: 'linuxsec:profiles:import-ovpn',
  PROFILES_PING_ALL: 'linuxsec:profiles:ping-all',

  // Settings
  SETTINGS_GET: 'linuxsec:settings:get',
  SETTINGS_UPDATE: 'linuxsec:settings:update',

  // Diagnostics
  DIAGNOSTICS_RUN: 'linuxsec:diagnostics:run',
  DIAGNOSTICS_REPORT: 'linuxsec:diagnostics:report',

  // System
  SYSTEM_GET_PUBLIC_IP: 'linuxsec:system:get-public-ip',
  SYSTEM_CHECK_PRIVILEGES: 'linuxsec:system:check-privileges',
  SYSTEM_SHOW_TRAY_NOTIFICATION: 'linuxsec:system:tray-notification',
  WINDOW_MINIMIZE: 'linuxsec:window:minimize',
  WINDOW_CLOSE: 'linuxsec:window:close',
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
