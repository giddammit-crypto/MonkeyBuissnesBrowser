import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('electron', () => ({ dialog: {}, safeStorage: {
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
} }));
import { safeStorage } from 'electron';
import { VpnConfigStore } from '../../src/services/vpn/VpnConfigStore';
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const config = `[Interface]\nPrivateKey = ${key}\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = ${key}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example:51820`;
let directory: string;
beforeEach(() => { vi.clearAllMocks(); directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-integrity-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
describe('VPN import preserves existing profile', () => {
  it('rejects invalid replacements without losing encrypted storage or current snapshot', async () => {
    const store = new VpnConfigStore(directory);
    await store.importRaw('original', config);
    const before = fs.readFileSync(path.join(directory, 'browser-data/vpn-config.json'), 'utf8');
    await expect(store.importRaw('broken', '[Interface]')).rejects.toThrow(/не изменена/);
    expect(store.getSnapshot().profileName).toBe('original');
    expect(fs.readFileSync(path.join(directory, 'browser-data/vpn-config.json'), 'utf8')).toBe(before);
  });
  it('preserves the profile when encryption becomes unavailable', async () => {
    const store = new VpnConfigStore(directory);
    await store.importRaw('original', config);
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValueOnce(false);
    await expect(store.importRaw('replacement', config)).rejects.toThrow(/не изменена/);
    expect(new VpnConfigStore(directory).getSnapshot().profileName).toBe('original');
  });
  it.skipIf(process.platform !== 'linux')('fails closed if Linux cannot identify its keyring backend', async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockImplementationOnce(() => { throw new Error('keyring failed'); });
    await expect(new VpnConfigStore(directory).importRaw('new', config)).rejects.toThrow(/Защищённое/);
    expect(safeStorage.encryptStringAsync).not.toHaveBeenCalled();
  });
});
