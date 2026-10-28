import { ipcMain, type BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { VpnCoordinator } from '../vpn/VpnCoordinator';
import type { ProfileStore } from '../storage/ProfileStore';
import type { SettingsStore } from '../storage/SettingsStore';
import type { DiagnosticEngine } from '../vpn/DiagnosticEngine';
import type { PublicIpService } from '../vpn/PublicIpService';
import type { PingService } from '../vpn/PingService';
import type { AutostartManager } from '../system/AutostartManager';
import type { ServerProfile, VpnSettings } from '../../shared/types';

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  vpnCoordinator: VpnCoordinator,
  profileStore: ProfileStore,
  settingsStore: SettingsStore,
  diagnosticEngine: DiagnosticEngine,
  publicIpService: PublicIpService,
  pingService: PingService,
  autostartManager: AutostartManager
): void {
  // Push status changes to renderer
  vpnCoordinator.on('status-changed', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.VPN_STATUS_CHANGED, status);
    }
  });

  vpnCoordinator.on('traffic', (stats) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.VPN_TRAFFIC_STATS, stats);
    }
  });

  // VPN Control
  ipcMain.handle(IPC_CHANNELS.VPN_GET_STATUS, () => {
    return vpnCoordinator.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.VPN_CONNECT, async (_event, profileId?: string) => {
    let profile: ServerProfile | undefined;
    if (profileId) {
      profile = profileStore.getById(profileId);
    } else {
      const all = profileStore.getAll();
      profile = all[0];
    }

    if (!profile) {
      throw new Error('No server profile available to connect');
    }

    await vpnCoordinator.connect(profile);
    return vpnCoordinator.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.VPN_DISCONNECT, async () => {
    await vpnCoordinator.disconnect();
    return vpnCoordinator.getStatus();
  });

  // Server Profiles
  ipcMain.handle(IPC_CHANNELS.PROFILES_GET_ALL, () => {
    return profileStore.getAll();
  });

  ipcMain.handle(IPC_CHANNELS.PROFILES_SAVE, (_event, profileData: Partial<ServerProfile> & { name: string; protocol: 'wireguard' | 'openvpn' }) => {
    return profileStore.saveProfile(profileData);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILES_DELETE, (_event, id: string) => {
    return profileStore.deleteProfile(id);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILES_IMPORT_CONF, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт конфигурации WireGuard',
      filters: [{ name: 'WireGuard Config', extensions: ['conf'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    const baseName = filePath.split('/').pop()?.replace(/\.conf$/i, '') || 'Imported WireGuard';

    return profileStore.importWireGuardConfig(baseName, content);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILES_IMPORT_OVPN, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт конфигурации OpenVPN',
      filters: [{ name: 'OpenVPN Config', extensions: ['ovpn', 'conf'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    const baseName = filePath.split('/').pop()?.replace(/\.(ovpn|conf)$/i, '') || 'Imported OpenVPN';

    return profileStore.importOpenVpnConfig(baseName, content);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILES_PING_ALL, async () => {
    const profiles = profileStore.getAll();
    const results: Record<string, number> = {};

    await Promise.all(
      profiles.map(async (p) => {
        const ping = await pingService.measureLatency(p.endpoint, 1500);
        profileStore.updatePing(p.id, ping);
        results[p.id] = ping;
      })
    );

    return results;
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return settingsStore.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_event, partial: Partial<VpnSettings>) => {
    const updated = settingsStore.updateSettings(partial);
    if (partial.autoStartOnBoot !== undefined) {
      autostartManager.setEnabled(partial.autoStartOnBoot);
    }
    return updated;
  });

  // Diagnostics
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_RUN, async () => {
    const status = vpnCoordinator.getStatus();
    return diagnosticEngine.runDiagnostics(status);
  });

  // System
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_PUBLIC_IP, async () => {
    return publicIpService.getPublicIp(true);
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow.hide();
  });
}
