import net from 'node:net';
import fs from 'node:fs';

const SOCKET_PATH = '/run/linuxsec/daemon.sock';

export interface DaemonResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export class DaemonBackend {
  public async isAvailable(): Promise<boolean> {
    try {
      if (!fs.existsSync(SOCKET_PATH)) return false;
      const resp = await this.sendRequest({ action: 'status' }, 1000);
      return resp.success;
    } catch {
      return false;
    }
  }

  public async enableKillSwitch(vpnIface: string, endpointIp: string): Promise<DaemonResponse> {
    return this.sendRequest({
      action: 'enable_killswitch',
      vpnIface,
      endpointIp,
    });
  }

  public async disableKillSwitch(): Promise<DaemonResponse> {
    return this.sendRequest({
      action: 'disable_killswitch',
    });
  }

  public async blockIpv6(): Promise<DaemonResponse> {
    return this.sendRequest({
      action: 'block_ipv6',
    });
  }

  public async unblockIpv6(): Promise<DaemonResponse> {
    return this.sendRequest({
      action: 'unblock_ipv6',
    });
  }

  private sendRequest(payload: Record<string, unknown>, timeoutMs = 3000): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(SOCKET_PATH);
      let data = '';

      client.setTimeout(timeoutMs);

      client.on('connect', () => {
        client.write(JSON.stringify(payload) + '\n');
      });

      client.on('data', (chunk) => {
        data += chunk.toString();
      });

      client.on('end', () => {
        try {
          const resp = JSON.parse(data.trim()) as DaemonResponse;
          resolve(resp);
        } catch (e) {
          reject(new Error(`Daemon response parse error: ${e}`));
        }
      });

      client.on('timeout', () => {
        client.destroy();
        reject(new Error('linuxsecd socket timeout'));
      });

      client.on('error', (err) => {
        reject(err);
      });
    });
  }
}
