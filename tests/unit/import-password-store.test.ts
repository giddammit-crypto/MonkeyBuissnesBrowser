import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString()),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { PasswordStore } from '../../src/main/persistence/PasswordStore';

const directories: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const directory = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-secure-import-')); directories.push(root); return root; };

it('deduplicates same origin/user across login paths without replacing existing saved passwords', () => {
  const root = directory();
  const store = new PasswordStore(root);
  expect(store.addMany([{ origin: 'https://example.test/first-login', username: 'user', password: 'first', browser: 'chrome' }])).toBe(1);
  const filePath = path.join(root, 'browser-data', 'passwords.enc');
  const before = fs.readFileSync(filePath);
  expect(store.addMany([{ origin: 'https://example.test', username: 'user', password: 'different', browser: 'file' }])).toBe(0);
  expect(fs.readFileSync(filePath)).toEqual(before);
  expect(store.summaries()).toHaveLength(1);
  expect(store.summaries()[0]).not.toHaveProperty('password');
});

it('refuses to overwrite an inaccessible or malformed existing vault during import', () => {
  const root = directory();
  const filePath = path.join(root, 'browser-data', 'passwords.enc');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'damaged-existing-vault');
  const store = new PasswordStore(root);
  expect(() => store.addMany([{ origin: 'https://example.test', username: 'user', password: 'new-secret', browser: 'file' }])).toThrow('Импорт отменён');
  expect(fs.readFileSync(filePath, 'utf8')).toBe('damaged-existing-vault');
  expect(fs.readdirSync(path.dirname(filePath))).toEqual(['passwords.enc']);
});
