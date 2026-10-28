import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SettingsStore, DEFAULT_SETTINGS } from '../../src/main/storage/SettingsStore';
import { ProfileStore } from '../../src/main/storage/ProfileStore';
import { HistoryStore } from '../../src/main/storage/HistoryStore';

describe('Storage Layer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxsec-test-store-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('SettingsStore', () => {
    it('initializes with default settings', () => {
      const store = new SettingsStore(tempDir);
      const settings = store.getSettings();
      expect(settings.killSwitchEnabled).toBe(false);
      expect(settings.dnsLeakProtection).toBe(true);
      expect(settings.ipv6LeakProtection).toBe(true);
      expect(settings.theme).toBe('dark');
    });

    it('updates and persists settings atomically', () => {
      const store = new SettingsStore(tempDir);
      const updated = store.updateSettings({
        killSwitchEnabled: true,
        theme: 'light',
      });
      expect(updated.killSwitchEnabled).toBe(true);
      expect(updated.theme).toBe('light');

      // Reload in fresh instance
      const reloadedStore = new SettingsStore(tempDir);
      const reloaded = reloadedStore.getSettings();
      expect(reloaded.killSwitchEnabled).toBe(true);
      expect(reloaded.theme).toBe('light');
    });
  });

  describe('ProfileStore', () => {
    it('creates sample seed profile if empty', () => {
      const store = new ProfileStore(tempDir);
      const profiles = store.getAll();
      expect(profiles.length).toBeGreaterThanOrEqual(1);
      expect(profiles[0].protocol).toBe('wireguard');
    });

    it('can save, update, toggle favorite and delete profiles', () => {
      const store = new ProfileStore(tempDir);
      const saved = store.saveProfile({
        name: 'Test Netherlands WG',
        protocol: 'wireguard',
        countryName: 'Netherlands',
        countryCode: 'nl',
        endpoint: '198.51.100.20:51820',
      });

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Test Netherlands WG');

      // Toggle favorite
      const isFav = store.toggleFavorite(saved.id);
      expect(isFav).toBe(true);

      // Verify favorite sort priority
      const all = store.getAll();
      expect(all[0].id).toBe(saved.id);

      // Delete
      const deleted = store.deleteProfile(saved.id);
      expect(deleted).toBe(true);
      expect(store.getById(saved.id)).toBeUndefined();
    });
  });

  describe('HistoryStore', () => {
    it('records and retrieves session history', () => {
      const store = new HistoryStore(tempDir);
      expect(store.getEntries()).toEqual([]);

      store.addEntry({
        id: 'session-1',
        serverId: 'srv-1',
        serverName: 'Server 1',
        protocol: 'wireguard',
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        durationMs: 60000,
        bytesReceived: 1048576,
        bytesSent: 524288,
        exitStatus: 'normal',
      });

      const entries = store.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].durationMs).toBe(60000);
      expect(entries[0].bytesReceived).toBe(1048576);
    });
  });
});
