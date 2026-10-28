import { app, Menu, Tray, nativeImage, type NativeImage, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { VpnCoordinator } from '../vpn/VpnCoordinator';
import type { VpnTunnelStatus } from '../../shared/types';

export class TrayManager {
  private tray?: Tray;

  constructor(
    private mainWindow: BrowserWindow,
    private vpnCoordinator: VpnCoordinator
  ) {
    this.createTray();
    this.vpnCoordinator.on('status-changed', (status: VpnTunnelStatus) => {
      this.updateTrayMenu(status);
    });
  }

  private createTray(): void {
    // Generate a clean 16x16 icon in memory or use asset
    const icon = this.createDefaultIcon('disconnected');
    this.tray = new Tray(icon);
    this.tray.setToolTip('Linuxsec VPN');

    this.tray.on('click', () => {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    this.updateTrayMenu(this.vpnCoordinator.getStatus());
  }

  public updateTrayMenu(status: VpnTunnelStatus): void {
    if (!this.tray) return;

    const isConnected = status.state === 'connected';
    const isConnecting = status.state === 'connecting' || status.state === 'reconnecting';
    const serverName = status.activeProfile?.name || 'Сервер не выбран';

    const statusLabel =
      status.state === 'connected'
        ? `Подключено: ${serverName}`
        : status.state === 'connecting'
        ? 'Подключение...'
        : status.state === 'reconnecting'
        ? 'Переподключение...'
        : status.state === 'error'
        ? 'Ошибка подключения'
        : 'Отключено';

    this.tray.setToolTip(`Linuxsec — ${statusLabel}`);
    this.tray.setImage(this.createDefaultIcon(status.state));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Linuxsec: ${statusLabel}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isConnected ? 'Отключить VPN' : 'Подключить VPN',
        enabled: !isConnecting,
        click: () => {
          if (isConnected) {
            this.vpnCoordinator.disconnect();
          } else if (status.activeProfile) {
            this.vpnCoordinator.connect(status.activeProfile);
          } else {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Открыть окно Linuxsec',
        click: () => {
          this.mainWindow.show();
          this.mainWindow.focus();
        },
      },
      {
        label: 'Выход',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  private createDefaultIcon(state: string): NativeImage {
    // Create an SVG-based nativeImage for Linux tray
    let color = '#94a3b8'; // slate-400 (disconnected)
    if (state === 'connected') color = '#10b981'; // emerald-500
    if (state === 'connecting' || state === 'reconnecting') color = '#3b82f6'; // blue-500
    if (state === 'error') color = '#ef4444'; // red-500

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        ${state === 'connected' ? '<path d="m9 12 2 2 4-4"/>' : ''}
      </svg>
    `;
    return nativeImage.createFromBuffer(Buffer.from(svg), { width: 22, height: 22 });
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = undefined;
    }
  }
}
