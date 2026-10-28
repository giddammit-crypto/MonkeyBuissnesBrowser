import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ServerProfile } from '../../shared/types';
import { generateWireGuardConfigText } from './WireGuardParser';

export interface NMActiveConnectionInfo {
  uuid: string;
  name: string;
  type: string;
  device: string;
}

function runNmcli(args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('nmcli', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`nmcli ${args[0]} failed: ${stderr || err.message}`));
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export class NetworkManagerBackend {
  private activeConnectionId?: string;
  private activeInterface?: string;

  public async isAvailable(): Promise<boolean> {
    try {
      const res = await runNmcli(['general', 'status'], 3000);
      return res.stdout.toLowerCase().includes('connected') || res.stdout.toLowerCase().includes('подключено');
    } catch {
      return false;
    }
  }

  public async importAndPrepareProfile(
    profile: ServerProfile,
    options: {
      dnsLeakProtection?: boolean;
      ipv6LeakProtection?: boolean;
      customDnsServers?: string[];
    } = {}
  ): Promise<{ connectionId: string; interfaceName: string }> {
    // Linux kernel interface names must be <= 15 characters (IFNAMSIZ-1) and alphanumeric
    const cleanId = profile.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 9) || '0';
    const connName = `lsec_${cleanId}`;
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `${connName}.conf`);

    // Clean up any stale connection with same name
    await this.deleteConnection(connName).catch(() => {});

    try {
      if (profile.protocol === 'wireguard') {
        if (!profile.wireguard) {
          throw new Error('Profile is missing WireGuard configuration data');
        }
        const configText = generateWireGuardConfigText(profile.wireguard);
        fs.writeFileSync(tempFile, configText, { encoding: 'utf8', mode: 0o600 });

        await runNmcli(['connection', 'import', 'type', 'wireguard', 'file', tempFile]);
      } else if (profile.protocol === 'openvpn') {
        if (!profile.openvpn) {
          throw new Error('Profile is missing OpenVPN configuration data');
        }
        fs.writeFileSync(tempFile, profile.openvpn.rawConfig, { encoding: 'utf8', mode: 0o600 });
        await runNmcli(['connection', 'import', 'type', 'openvpn', 'file', tempFile]);
      } else {
        throw new Error(`Unsupported VPN protocol: ${profile.protocol}`);
      }
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }

    // Configure connection settings for DNS leak protection & priority
    const modifications: string[] = ['connection', 'modify', connName];

    // Ensure autoconnect is disabled so NetworkManager does not reconnect unexpectedly
    modifications.push('connection.autoconnect', 'no');

    if (options.dnsLeakProtection) {
      // Priority < 0 gives this connection's DNS absolute precedence in systemd-resolved
      modifications.push('ipv4.dns-priority', '-50');
    }

    if (options.customDnsServers && options.customDnsServers.length > 0) {
      modifications.push('ipv4.dns', options.customDnsServers.join(' '));
      modifications.push('ipv4.ignore-auto-dns', 'yes');
    }

    if (options.ipv6LeakProtection) {
      modifications.push('ipv6.method', 'disabled');
    }

    try {
      await runNmcli(modifications);
    } catch (err) {
      console.warn('[NetworkManagerBackend] Warning applying connection modifications:', err);
    }

    this.activeConnectionId = connName;
    this.activeInterface = connName;
    return { connectionId: connName, interfaceName: connName };
  }

  public async activate(connectionId: string): Promise<string> {
    const res = await runNmcli(['connection', 'up', connectionId], 25000);
    this.activeConnectionId = connectionId;

    // Detect actual active interface device
    const active = await this.getActiveConnections();
    const match = active.find((c) => c.name === connectionId || c.uuid === connectionId);
    if (match && match.device && match.device !== '--') {
      this.activeInterface = match.device;
      return match.device;
    }

    return connectionId;
  }

  public async deactivate(connectionId: string): Promise<void> {
    try {
      await runNmcli(['connection', 'down', connectionId], 10000);
    } catch (err) {
      console.warn(`[NetworkManagerBackend] Could not bring down ${connectionId}:`, err);
    }
  }

  public async deleteConnection(connectionId: string): Promise<void> {
    try {
      await runNmcli(['connection', 'delete', connectionId], 8000);
    } catch {
      // Ignore if connection does not exist
    }
    if (this.activeConnectionId === connectionId) {
      this.activeConnectionId = undefined;
      this.activeInterface = undefined;
    }
  }

  public async getActiveConnections(): Promise<NMActiveConnectionInfo[]> {
    try {
      const { stdout } = await runNmcli(['-t', '-f', 'UUID,NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
      const lines = stdout.split('\n').filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(':');
        return {
          uuid: parts[0] || '',
          name: parts[1] || '',
          type: parts[2] || '',
          device: parts[3] || '',
        };
      });
    } catch {
      return [];
    }
  }

  public async cleanupStaleLinuxsecConnections(): Promise<void> {
    try {
      const { stdout } = await runNmcli(['-t', '-f', 'NAME', 'connection', 'show']);
      const names = stdout.split('\n').filter((n) => n.startsWith('lsec_') || n.startsWith('linuxsec-'));
      for (const name of names) {
        await this.deleteConnection(name).catch(() => {});
      }
    } catch {
      // Ignore cleanup error
    }
  }

  public getInterfaceName(): string | undefined {
    return this.activeInterface;
  }
}
