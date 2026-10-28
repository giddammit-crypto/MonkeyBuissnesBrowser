import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { PasswordStore } from '../../src/main/persistence/PasswordStore';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.clearAllMocks(); });
describe('password vault preservation', () => {
  it.each(['not JSON', '{"wrong":"shape"}', '[{"invalid":"record"}]'])('refuses save without altering an unreadable vault: %s', (contents) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-preservation-')); roots.push(root);
    const file = path.join(root, 'browser-data', 'passwords.enc');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const encrypted = Buffer.from(contents).toString('base64');
    fs.writeFileSync(file, encrypted);
    expect(() => new PasswordStore(root).save('https://example.com', 'user', 'password')).toThrow(/повреждено/);
    expect(fs.readFileSync(file, 'utf8')).toBe(encrypted);
    expect(storage.encryptString).not.toHaveBeenCalled();
  });
});
