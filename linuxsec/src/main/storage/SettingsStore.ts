import fs from 'node:fs';
import path from 'node:path';
import type { VpnSettings } from '../../shared/types';

export const DEFAULT_SETTINGS: VpnSettings = {
  autoStartOnBoot: false,
  autoConnectOnStart: false,
  killSwitchEnabled: false,
  dnsLeakProtection: true,
  ipv6LeakProtection: true,
  customDnsEnabled: false,
  customDnsServers: ['1.1.1.1', '1.0.0.1'],
  splitTunnelEnabled: false,
  splitTunnelExcludedIps: [],
  splitTunnelExcludedApps: [],
  theme: 'dark',
  preferredProtocol: 'wireguard',
};

export class SettingsStore {
  private filePath: string;
  private settings: VpnSettings;

  constructor(baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(baseDir, 'settings.json');
    this.settings = this.load();
  }

  private load(): VpnSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
        };
      }
    } catch (err) {
      console.error('[SettingsStore] Failed to parse settings file, restoring defaults:', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  public getSettings(): VpnSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<VpnSettings>): VpnSettings {
    this.settings = {
      ...this.settings,
      ...partial,
    };
    this.save();
    return { ...this.settings };
  }

  private save(): void {
    try {
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.settings, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[SettingsStore] Failed to write settings file:', err);
    }
  }
}
