import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'basic_text'),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { PasswordStore } from '../../src/main/persistence/PasswordStore';

const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('PasswordStore secure persistence', () => {
  it.runIf(process.platform === 'linux')('refuses to persist secrets with Linux basic_text encryption fallback', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-password-'));
    directories.push(directory);
    const store = new PasswordStore(directory);
    expect(store.canPersistSecurely()).toBe(false);
    expect(store.addMany([{ origin: 'https://example.test', username: 'user', password: 'secret', browser: 'chrome' }])).toBe(0);
    expect(fs.existsSync(path.join(directory, 'browser-data/passwords.enc'))).toBe(false);
  });
});
