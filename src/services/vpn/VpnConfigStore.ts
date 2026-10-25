import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, safeStorage } from 'electron';
import type { VpnSnapshot } from '../../shared/types';
import { JsonStore } from '../../main/persistence/JsonStore';
import { parseWireGuardConfig } from './WireGuardConfig';

interface StoredVpnRecord {
  profileName: string;
  encryptedConfig?: string;
  metadata: VpnSnapshot;
}

const emptySnapshot = (): VpnSnapshot => ({
  configured: false,
  mode: 'system',
  state: 'not-configured',
  addresses: [],
  dns: [],
  peerCount: 0,
  savedSecurely: false,
  errors: [],
});

function endpointFromConfig(endpoint?: string): string | undefined {
  return endpoint?.trim() || undefined;
}

function snapshotFromConfig(profileName: string, rawConfig: string, savedSecurely: boolean, storageBackend?: string): VpnSnapshot {
  const parsed = parseWireGuardConfig(rawConfig);
  if (!parsed.config) {
    return {
      ...emptySnapshot(),
      profileName,
      state: 'error',
      errors: parsed.errors,
      lastValidatedAt: Date.now(),
      savedSecurely,
      storageBackend,
    };
  }
  const peer = parsed.config.peers[0];
  return {
    configured: true,
    profileName,
    mode: 'system',
    state: 'configured',
    endpoint: endpointFromConfig(peer?.endpoint),
    addresses: parsed.config.address,
    dns: parsed.config.dns,
    peerCount: parsed.config.peers.length,
    savedSecurely,
    storageBackend,
    lastValidatedAt: Date.now(),
    errors: [],
  };
}

export class VpnConfigStore {
  private readonly record: JsonStore<StoredVpnRecord | null>;
  private sessionSnapshot: VpnSnapshot;

  constructor(userDataPath: string) {
    this.record = new JsonStore<StoredVpnRecord | null>(path.join(userDataPath, 'browser-data', 'vpn-config.json'), null);
    const stored = this.record.get();
    this.sessionSnapshot = stored?.encryptedConfig ? stored.metadata : emptySnapshot();
  }

  getSnapshot(): VpnSnapshot {
    return this.sessionSnapshot;
  }

  async importFromDialog(ownerWindow: Electron.BaseWindow): Promise<VpnSnapshot> {
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Импорт WireGuard-конфигурации',
      properties: ['openFile'],
      filters: [{ name: 'WireGuard configuration', extensions: ['conf', 'ini', 'txt'] }],
    });
    if (result.canceled || !result.filePaths[0]) return this.sessionSnapshot;
    const filePath = result.filePaths[0];
    const file = await fs.stat(filePath);
    if (file.size > 1024 * 1024) {
      this.sessionSnapshot = { ...emptySnapshot(), state: 'error', errors: ['Файл конфигурации больше 1 МБ.'] };
      return this.sessionSnapshot;
    }
    const rawConfig = await fs.readFile(filePath, 'utf8');
    const profileName = path.basename(filePath, path.extname(filePath)).slice(0, 60) || 'WireGuard';
    return this.importRaw(profileName, rawConfig);
  }

  async importRaw(profileName: string, rawConfig: string): Promise<VpnSnapshot> {
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined;
    const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
    const secureBackend = backend === undefined || (backend !== 'basic_text' && backend !== 'unknown');
    const savedSecurely = encryptionAvailable && secureBackend;
    const next = snapshotFromConfig(profileName, rawConfig, savedSecurely, backend);
    this.sessionSnapshot = next;

    if (!next.configured) {
      this.record.set(null);
      return next;
    }

    if (!savedSecurely) {
      this.record.set({ profileName, metadata: next });
      return next;
    }

    const encrypted = await safeStorage.encryptStringAsync(rawConfig);
    this.record.set({ profileName, encryptedConfig: encrypted.toString('base64'), metadata: next });
    return next;
  }

  clear(): VpnSnapshot {
    this.record.set(null);
    this.sessionSnapshot = emptySnapshot();
    return this.sessionSnapshot;
  }
}
