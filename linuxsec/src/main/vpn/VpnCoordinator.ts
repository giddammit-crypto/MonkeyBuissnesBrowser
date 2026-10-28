import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  ServerProfile,
  VpnState,
  VpnTunnelStatus,
  VpnSettings,
  PublicIpInfo,
} from '../../shared/types';
import { NetworkManagerBackend } from './NetworkManagerBackend';
import { DaemonBackend } from './DaemonBackend';
import { TrafficMonitor, type TrafficSnapshot } from './TrafficMonitor';
import { PublicIpService } from './PublicIpService';
import { HistoryStore } from '../storage/HistoryStore';
import { SettingsStore } from '../storage/SettingsStore';

export class VpnCoordinator extends EventEmitter {
  private state: VpnState = 'disconnected';
  private activeProfile?: ServerProfile;
  private connectedSince?: number;
  private interfaceName?: string;
  private currentConnectionId?: string;
  private errorMessage?: string;

  private bytesReceived = 0;
  private bytesSent = 0;
  private currentDownloadSpeed = 0;
  private currentUploadSpeed = 0;

  private originalPublicIp?: PublicIpInfo;
  private currentPublicIp?: PublicIpInfo;

  private trafficMonitor: TrafficMonitor;
  private networkManager: NetworkManagerBackend;
  private daemon: DaemonBackend;
  private publicIpService: PublicIpService;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimer?: NodeJS.Timeout;
  private isIntentionallyDisconnecting = false;

  constructor(
    private settingsStore: SettingsStore,
    private historyStore: HistoryStore,
    publicIpService: PublicIpService,
    nmBackend?: NetworkManagerBackend,
    daemonBackend?: DaemonBackend
  ) {
    super();
    this.publicIpService = publicIpService;
    this.networkManager = nmBackend || new NetworkManagerBackend();
    this.daemon = daemonBackend || new DaemonBackend();
    this.trafficMonitor = new TrafficMonitor();

    this.trafficMonitor.on('stats', (snapshot: TrafficSnapshot) => {
      this.bytesReceived = snapshot.bytesReceived;
      this.bytesSent = snapshot.bytesSent;
      this.currentDownloadSpeed = snapshot.downloadSpeedBps;
      this.currentUploadSpeed = snapshot.uploadSpeedBps;

      this.emit('traffic', {
        bytesReceived: this.bytesReceived,
        bytesSent: this.bytesSent,
        downloadBps: this.currentDownloadSpeed,
        uploadBps: this.currentUploadSpeed,
      });
      this.emitStateChange();
    });

    // Capture initial public IP on boot
    this.publicIpService.getPublicIp().then((ip) => {
      this.originalPublicIp = ip;
      this.emitStateChange();
    }).catch(() => {});
  }

  public getStatus(): VpnTunnelStatus {
    return {
      state: this.state,
      activeProfile: this.activeProfile,
      connectedSince: this.connectedSince,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      currentDownloadSpeed: this.currentDownloadSpeed,
      currentUploadSpeed: this.currentUploadSpeed,
      originalPublicIp: this.originalPublicIp,
      currentPublicIp: this.currentPublicIp,
      interfaceName: this.interfaceName,
      errorMessage: this.errorMessage,
    };
  }

  public async connect(profile: ServerProfile): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.isIntentionallyDisconnecting = false;
    this.setState('connecting');
    this.activeProfile = profile;
    this.errorMessage = undefined;
    this.bytesReceived = 0;
    this.bytesSent = 0;

    const settings = this.settingsStore.getSettings();

    try {
      // 1. Fetch original public IP if not yet known
      if (!this.originalPublicIp || this.originalPublicIp.ip === 'Checking...') {
        this.originalPublicIp = await this.publicIpService.getPublicIp(true);
      }

      // 2. Prepare NetworkManager connection
      const { connectionId, interfaceName } = await this.networkManager.importAndPrepareProfile(
        profile,
        {
          dnsLeakProtection: settings.dnsLeakProtection,
          ipv6LeakProtection: settings.ipv6LeakProtection,
          customDnsServers: settings.customDnsEnabled ? settings.customDnsServers : undefined,
        }
      );
      this.currentConnectionId = connectionId;
      this.interfaceName = interfaceName;

      // 3. Activate connection via NetworkManager
      const activeIface = await this.networkManager.activate(connectionId);
      this.interfaceName = activeIface || interfaceName;

      // 4. Apply Kill Switch and IPv6 protection via daemon if available & enabled
      if (settings.killSwitchEnabled) {
        try {
          await this.daemon.enableKillSwitch(this.interfaceName, profile.endpoint);
        } catch (err) {
          console.warn('[VpnCoordinator] Kill Switch daemon unavailable:', err);
        }
      }

      if (settings.ipv6LeakProtection) {
        try {
          await this.daemon.blockIpv6();
        } catch {
          // Ignore if daemon not running
        }
      }

      // 5. Start traffic monitoring
      this.trafficMonitor.start(this.interfaceName);

      this.connectedSince = Date.now();
      this.setState('connected');
      this.reconnectAttempts = 0;

      // 6. Refresh external IP asynchronously to verify IP change
      setTimeout(async () => {
        if (this.state === 'connected') {
          try {
            this.currentPublicIp = await this.publicIpService.getPublicIp(true);
            this.emitStateChange();
          } catch {
            // Ignore temporary DNS transition delay
          }
        }
      }, 2000);
    } catch (err) {
      console.error('[VpnCoordinator] Connection failed:', err);
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.setState('error');
      await this.cleanup(true);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.state === 'disconnected' || this.state === 'disconnecting') {
      return;
    }

    this.isIntentionallyDisconnecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.setState('disconnecting');
    await this.cleanup(false);
    this.setState('disconnected');
  }

  private async cleanup(isError = false): Promise<void> {
    this.trafficMonitor.stop();

    // 1. Remove Kill Switch and IPv6 blocks first to restore normal traffic
    try {
      await this.daemon.disableKillSwitch();
    } catch {}
    try {
      await this.daemon.unblockIpv6();
    } catch {}

    // 2. Record history if session was active
    if (this.connectedSince && this.activeProfile) {
      const now = Date.now();
      this.historyStore.addEntry({
        id: crypto.randomUUID(),
        serverId: this.activeProfile.id,
        serverName: this.activeProfile.name,
        protocol: this.activeProfile.protocol,
        startTime: this.connectedSince,
        endTime: now,
        durationMs: now - this.connectedSince,
        bytesReceived: this.bytesReceived,
        bytesSent: this.bytesSent,
        exitStatus: isError ? 'error' : 'normal',
        errorMessage: this.errorMessage,
      });
    }

    // 3. Deactivate and remove temporary connection from NetworkManager
    if (this.currentConnectionId) {
      await this.networkManager.deactivate(this.currentConnectionId).catch(() => {});
      await this.networkManager.deleteConnection(this.currentConnectionId).catch(() => {});
      this.currentConnectionId = undefined;
    }

    this.connectedSince = undefined;
    this.interfaceName = undefined;
    this.currentPublicIp = undefined;
    this.currentDownloadSpeed = 0;
    this.currentUploadSpeed = 0;

    // Invalidate IP cache so it re-detects local ISP IP
    this.publicIpService.invalidate();
  }

  public async handleUnexpectedDrop(): Promise<void> {
    if (this.isIntentionallyDisconnecting || this.state === 'disconnected') return;

    if (this.reconnectAttempts < this.maxReconnectAttempts && this.activeProfile) {
      this.reconnectAttempts++;
      this.setState('reconnecting');
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 8000);
      this.reconnectTimer = setTimeout(async () => {
        if (this.activeProfile) {
          await this.connect(this.activeProfile);
        }
      }, delay);
    } else {
      this.errorMessage = 'Connection lost unexpectedly and reconnect attempts exhausted';
      this.setState('error');
      await this.cleanup(true);
    }
  }

  public async shutdown(): Promise<void> {
    await this.disconnect();
    await this.networkManager.cleanupStaleLinuxsecConnections().catch(() => {});
  }

  private setState(state: VpnState): void {
    this.state = state;
    this.emitStateChange();
  }

  private emitStateChange(): void {
    this.emit('status-changed', this.getStatus());
  }
}
