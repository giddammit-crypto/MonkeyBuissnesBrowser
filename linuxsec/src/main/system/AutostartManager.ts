import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class AutostartManager {
  private autostartDir: string;
  private desktopFilePath: string;

  constructor() {
    this.autostartDir = path.join(os.homedir(), '.config', 'autostart');
    this.desktopFilePath = path.join(this.autostartDir, 'linuxsec.desktop');
  }

  public isEnabled(): boolean {
    return fs.existsSync(this.desktopFilePath);
  }

  public setEnabled(enable: boolean, appPath?: string): void {
    if (enable) {
      if (!fs.existsSync(this.autostartDir)) {
        fs.mkdirSync(this.autostartDir, { recursive: true, mode: 0o755 });
      }

      const execPath = appPath || process.execPath;
      const content = `[Desktop Entry]
Type=Application
Version=1.0
Name=Linuxsec
GenericName=VPN Client
Comment=Native, secure WireGuard and OpenVPN client for Linux
Exec=${execPath} --hidden
Icon=linuxsec
Terminal=false
Categories=Network;Security;
StartupNotify=false
X-GNOME-Autostart-enabled=true
`;
      fs.writeFileSync(this.desktopFilePath, content, { encoding: 'utf8', mode: 0o644 });
    } else {
      if (fs.existsSync(this.desktopFilePath)) {
        try {
          fs.unlinkSync(this.desktopFilePath);
        } catch (err) {
          console.warn('[AutostartManager] Could not remove autostart entry:', err);
        }
      }
    }
  }
}
