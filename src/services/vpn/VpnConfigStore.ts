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

function normalizeStoredRecord(value: unknown): StoredVpnRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const metadata = raw.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const snapshot = metadata as Record<string, unknown>;
  if (typeof raw.profileName !== 'string' || !raw.profileName
    || typeof raw.encryptedConfig !== 'string' || !raw.encryptedConfig
    || snapshot.configured !== true || snapshot.mode !== 'system'
    || snapshot.state !== 'configured'
    || !Array.isArray(snapshot.addresses) || !snapshot.addresses.every((item) => typeof item === 'string')
    || !Array.isArray(snapshot.dns) || !snapshot.dns.every((item) => typeof item === 'string')
    || typeof snapshot.peerCount !== 'number' || !Number.isInteger(snapshot.peerCount) || snapshot.peerCount < 1
    || typeof snapshot.savedSecurely !== 'boolean' || !Array.isArray(snapshot.errors) || !snapshot.errors.every((item) => typeof item === 'string')) return null;
  return {
    profileName: raw.profileName,
    encryptedConfig: raw.encryptedConfig,
    metadata: metadata as VpnSnapshot,
  };
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
    this.record = new JsonStore<StoredVpnRecord | null>(path.join(userDataPath, 'browser-data', 'vpn-config.json'), null, normalizeStoredRecord);
    const stored = this.record.get();
    this.sessionSnapshot = stored ? stored.metadata : emptySnapshot();
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
      throw new Error('Файл конфигурации больше 1 МБ. Существующая конфигурация не изменена.');
    }
    const rawConfig = await fs.readFile(filePath, 'utf8');
    const profileName = path.basename(filePath, path.extname(filePath)).slice(0, 60) || 'WireGuard';
    return this.importRaw(profileName, rawConfig);
  }

  async importRaw(profileName: string, rawConfig: string): Promise<VpnSnapshot> {
    const backend = process.platform === 'linux' ? this.storageBackend() : undefined;
    const encryptionAvailable = await this.isEncryptionAvailable();
    const secureBackend = process.platform !== 'linux' || (typeof backend === 'string' && !['basic_text', 'unknown'].includes(backend));
    const savedSecurely = encryptionAvailable && secureBackend;
    const next = snapshotFromConfig(profileName, rawConfig, savedSecurely, backend);

    if (!next.configured) {
      throw new Error(`VPN-конфигурация не импортирована: ${next.errors.join(' ')} Существующая конфигурация не изменена.`);
    }

    if (!savedSecurely) {
      throw new Error('Защищённое хранилище недоступно. VPN-конфигурация не импортирована; существующая конфигурация не изменена.');
    }

    let encrypted: Buffer;
    try {
      encrypted = await safeStorage.encryptStringAsync(rawConfig);
    } catch {
      throw new Error('Не удалось зашифровать VPN-конфигурацию. Существующая конфигурация не изменена.');
    }
    this.record.set({ profileName, encryptedConfig: encrypted.toString('base64'), metadata: next });
    this.sessionSnapshot = next;
    return next;
  }

  private storageBackend(): string | undefined {
    try { return safeStorage.getSelectedStorageBackend(); } catch { return undefined; }
  }

  private async isEncryptionAvailable(): Promise<boolean> {
    try { return await safeStorage.isAsyncEncryptionAvailable(); } catch { return false; }
  }

  clear(): VpnSnapshot {
    this.record.set(null);
    this.sessionSnapshot = emptySnapshot();
    return this.sessionSnapshot;
  }
}
