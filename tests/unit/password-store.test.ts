import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'basic_text'),
  encryptString: vi.fn((text: string) => Buffer.from(text, 'utf8')),
  decryptString: vi.fn((buf: Buffer) => buf.toString('utf8')),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { PasswordStore, getBaseDomain } from '../../src/main/persistence/PasswordStore';

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

  describe('getBaseDomain utility', () => {
    it('correctly extracts base domain for subdomains and complex public suffixes', () => {
      expect(getBaseDomain('id.vk.com')).toBe('vk.com');
      expect(getBaseDomain('m.vk.com')).toBe('vk.com');
      expect(getBaseDomain('vk.com')).toBe('vk.com');
      expect(getBaseDomain('https://id.vk.com:8443/auth')).toBe('vk.com');
      expect(getBaseDomain('auth.service.co.uk')).toBe('service.co.uk');
      expect(getBaseDomain('localhost')).toBe('localhost');
      expect(getBaseDomain('127.0.0.1')).toBe('127.0.0.1');
      expect(getBaseDomain('')).toBe('');
    });
  });

  describe('cross-subdomain autofill and matching', () => {
    it('finds credentials across subdomains of the same base domain', () => {
      storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-password-'));
      directories.push(directory);
      const store = new PasswordStore(directory);

      // Сохраняем пароль для id.vk.com
      const saved = store.save('https://id.vk.com', 'durov', 'telegram123');
      expect(saved.id).toBeDefined();
      expect(saved.updated).toBe(false);

      // Поиск для vk.com должен найти эту запись
      const forVk = store.getCredentialsForAutofill('https://vk.com', 'vk.com');
      expect(forVk).toHaveLength(1);
      expect(forVk[0].username).toBe('durov');
      expect(forVk[0].password).toBe('telegram123');

      // findByOriginAndUser для vk.com
      const found = store.findByOriginAndUser('https://vk.com', 'durov');
      expect(found).not.toBeNull();
      expect(found?.username).toBe('durov');

      // save на vk.com с тем же логином обновляет существующую запись
      const updated = store.save('https://vk.com', 'durov', 'new_pass_456');
      expect(updated.updated).toBe(true);
      expect(updated.id).toBe(saved.id);

      const afterUpdate = store.getCredentialsForAutofill('https://id.vk.com');
      expect(afterUpdate[0].password).toBe('new_pass_456');
    });
  });
});
