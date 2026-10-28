import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VpnCoordinator } from '../../src/main/vpn/VpnCoordinator';
import { SettingsStore } from '../../src/main/storage/SettingsStore';
import { HistoryStore } from '../../src/main/storage/HistoryStore';
import { PublicIpService } from '../../src/main/vpn/PublicIpService';
import { NetworkManagerBackend } from '../../src/main/vpn/NetworkManagerBackend';
import { DaemonBackend } from '../../src/main/vpn/DaemonBackend';
import type { ServerProfile } from '../../shared/types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('VpnCoordinator State Machine', () => {
  let tempDir: string;
  let settingsStore: SettingsStore;
  let historyStore: HistoryStore;
  let publicIpService: PublicIpService;
  let mockNm: NetworkManagerBackend;
  let mockDaemon: DaemonBackend;
  let coordinator: VpnCoordinator;

  const testProfile: ServerProfile = {
    id: 'test-server',
    name: 'Test Server',
    countryCode: 'nl',
    countryName: 'Netherlands',
    flag: '🇳🇱',
    protocol: 'wireguard',
    endpoint: '198.51.100.1:51820',
    wireguard: {
      privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      address: ['10.0.0.2/24'],
      endpoint: '198.51.100.1:51820',
      allowedIps: ['0.0.0.0/0'],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxsec-test-coord-'));
    settingsStore = new SettingsStore(tempDir);
    historyStore = new HistoryStore(tempDir);
    publicIpService = new PublicIpService();

    mockNm = {
      isAvailable: vi.fn().mockResolvedValue(true),
      importAndPrepareProfile: vi.fn().mockResolvedValue({ connectionId: 'linuxsec-test', interfaceName: 'linuxsec-test' }),
      activate: vi.fn().mockResolvedValue('linuxsec-test'),
      deactivate: vi.fn().mockResolvedValue(undefined),
      deleteConnection: vi.fn().mockResolvedValue(undefined),
      getActiveConnections: vi.fn().mockResolvedValue([]),
      cleanupStaleLinuxsecConnections: vi.fn().mockResolvedValue(undefined),
      getInterfaceName: vi.fn().mockReturnValue('linuxsec-test'),
    } as unknown as NetworkManagerBackend;

    mockDaemon = {
      isAvailable: vi.fn().mockResolvedValue(true),
      enableKillSwitch: vi.fn().mockResolvedValue({ success: true }),
      disableKillSwitch: vi.fn().mockResolvedValue({ success: true }),
      blockIpv6: vi.fn().mockResolvedValue({ success: true }),
      unblockIpv6: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DaemonBackend;

    coordinator = new VpnCoordinator(
      settingsStore,
      historyStore,
      publicIpService,
      mockNm,
      mockDaemon
    );
  });

  it('starts in disconnected state', () => {
    const status = coordinator.getStatus();
    expect(status.state).toBe('disconnected');
    expect(status.activeProfile).toBeUndefined();
    expect(status.bytesReceived).toBe(0);
  });

  it('transitions from disconnected to connecting, then connected on success', async () => {
    const states: string[] = [];
    coordinator.on('status-changed', (s) => states.push(s.state));

    await coordinator.connect(testProfile);

    const status = coordinator.getStatus();
    expect(status.state).toBe('connected');
    expect(status.activeProfile?.id).toBe(testProfile.id);
    expect(mockNm.importAndPrepareProfile).toHaveBeenCalled();
    expect(mockNm.activate).toHaveBeenCalledWith('linuxsec-test');
    expect(states).toContain('connecting');
    expect(states).toContain('connected');
  });

  it('transitions to disconnecting and disconnected on disconnect()', async () => {
    await coordinator.connect(testProfile);
    expect(coordinator.getStatus().state).toBe('connected');

    const states: string[] = [];
    coordinator.on('status-changed', (s) => states.push(s.state));

    await coordinator.disconnect();

    const status = coordinator.getStatus();
    expect(status.state).toBe('disconnected');
    expect(mockNm.deactivate).toHaveBeenCalled();
    expect(mockNm.deleteConnection).toHaveBeenCalled();
    expect(states).toContain('disconnecting');
    expect(states).toContain('disconnected');
  });

  it('handles activation failure and transitions to error state', async () => {
    vi.mocked(mockNm.activate).mockRejectedValueOnce(new Error('Connection activation timeout'));

    await coordinator.connect(testProfile);

    const status = coordinator.getStatus();
    expect(status.state).toBe('error');
    expect(status.errorMessage).toContain('Connection activation timeout');
  });
});
