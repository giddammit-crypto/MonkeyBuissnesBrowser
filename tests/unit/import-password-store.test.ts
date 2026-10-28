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
afterEach(() => { vi.clearAllMocks(); storage.isEncryptionAvailable.mockReturnValue(true); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
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
  expect(() => store.addMany([{ origin: 'https://example.test', username: 'user', password: 'new-secret', browser: 'file' }])).toThrow('Операция отменена');
  expect(fs.readFileSync(filePath, 'utf8')).toBe('damaged-existing-vault');
  expect(fs.readdirSync(path.dirname(filePath))).toEqual(['passwords.enc']);
});

it('retrieves a secret only by exact HTTPS origin and never includes it in summaries', () => {
  const store = new PasswordStore(directory());
  store.addMany([{ origin: 'https://example.test:444/login', username: 'user', password: 'private-fixture', browser: 'file' }]);
  const id = store.summaries()[0].id;
  expect(JSON.stringify(store.summaries())).not.toContain('private-fixture');
  expect(store.getForOrigin(id, 'https://example.test:444')).toEqual({ username: 'user', password: 'private-fixture' });
  for (const target of ['https://example.test', 'http://example.test:444', 'https://user:pass@example.test:444', 'https://example.test:444/path', 'https://other.test:444']) expect(store.getForOrigin(id, target)).toBeNull();
  expect(store.getForOrigin('missing', 'https://example.test:444')).toBeNull();
});

it('deletes one encrypted record atomically and refuses to replace a corrupted vault', () => {
  const root = directory(); const store = new PasswordStore(root);
  store.addMany([{ origin: 'https://one.test', username: 'user', password: 'first', browser: 'file' }, { origin: 'https://two.test', username: 'user', password: 'second', browser: 'file' }]);
  const [one, two] = store.summaries();
  expect(store.delete(one.id)).toBe(true);
  expect(store.getForOrigin(one.id, 'https://one.test')).toBeNull();
  expect(new PasswordStore(root).summaries().map(record => record.id)).toEqual([two.id]);
  const file = path.join(root, 'browser-data/passwords.enc');
  fs.writeFileSync(file, 'broken-vault');
  expect(() => store.delete(two.id)).toThrow('Операция отменена');
  expect(fs.readFileSync(file, 'utf8')).toBe('broken-vault');
  expect(fs.readdirSync(path.dirname(file))).toEqual(['passwords.enc']);
});

it('reports locked and corrupted vaults rather than an empty password list and recovers without data loss', () => {
  const root=directory(); const store=new PasswordStore(root);
  store.addMany([{origin:'https://saved.test',username:'user',password:'fake-fixture',browser:'file'}]);
  const file=path.join(root,'browser-data/passwords.enc'); const before=fs.readFileSync(file);
  storage.isEncryptionAvailable.mockReturnValue(false);
  expect(()=>store.summaries()).toThrow('недоступно');
  expect(fs.readFileSync(file)).toEqual(before);
  storage.isEncryptionAvailable.mockReturnValue(true);
  expect(store.summaries()).toHaveLength(1);
  fs.writeFileSync(file,'broken-fixture');
  expect(()=>store.summaries()).toThrow('Операция отменена');
  expect(fs.readFileSync(file,'utf8')).toBe('broken-fixture');
  fs.writeFileSync(file,before);
  expect(store.summaries()).toHaveLength(1);
});

it('rejects malformed records instead of exposing them as summaries', () => {
  const root = directory(); const store = new PasswordStore(root);
  store.addMany([{ origin: 'https://saved.test', username: 'user', password: 'secret', browser: 'file' }]);
  const file = path.join(root, 'browser-data', 'passwords.enc');
  const records = JSON.parse(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString());
  // The fixture encryption is identity-like, so alter the serialized vault
  // and verify strict reads fail without replacing it.
  records[0].browser = 'unknown';
  fs.writeFileSync(file, Buffer.from(JSON.stringify(records)).toString('base64'));
  expect(() => store.summaries()).toThrow('Операция отменена');
});

it('counts stored passwords and clears all passwords securely', () => {
  const root = directory();
  const store = new PasswordStore(root);
  expect(store.count()).toBe(0);
  expect(store.clearAll()).toBe(0);

  store.addMany([
    { origin: 'https://one.test', username: 'user1', password: 'p1', browser: 'chrome' },
    { origin: 'https://two.test', username: 'user2', password: 'p2', browser: 'yandex' },
  ]);
  expect(store.count()).toBe(2);

  const deleted = store.clearAll();
  expect(deleted).toBe(2);
  expect(store.count()).toBe(0);
  expect(store.summaries()).toHaveLength(0);

  // Calling clearAll on empty vault returns 0
  expect(store.clearAll()).toBe(0);
});

it('clearAll and count return 0 when secure storage is unavailable', () => {
  const root = directory();
  const store = new PasswordStore(root);
  store.addMany([
    { origin: 'https://one.test', username: 'user1', password: 'p1', browser: 'chrome' },
  ]);
  expect(store.count()).toBe(1);

  storage.isEncryptionAvailable.mockReturnValue(false);
  expect(store.count()).toBe(0);
  expect(store.clearAll()).toBe(0);

  storage.isEncryptionAvailable.mockReturnValue(true);
  expect(store.count()).toBe(1);
});

it('saves, updates, finds and reveals credentials for soulm8te browser', () => {
  const root = directory();
  const store = new PasswordStore(root);

  // 1. Save new credential
  const result1 = store.save('https://vk.com/feed', 'durov', 'secret123');
  expect(result1.updated).toBe(false);
  expect(result1.id).toBeDefined();

  const summaries = store.summaries();
  expect(summaries).toHaveLength(1);
  expect(summaries[0].origin).toBe('https://vk.com');
  expect(summaries[0].username).toBe('durov');
  expect(summaries[0].browser).toBe('soulm8te');

  // 2. getSecret
  expect(store.getSecret(result1.id)).toBe('secret123');
  expect(store.getSecret('non-existent')).toBeNull();

  // 3. findByOriginAndUser
  const found = store.findByOriginAndUser('https://vk.com', 'durov');
  expect(found).not.toBeNull();
  expect(found?.password).toBe('secret123');
  expect(found?.id).toBe(result1.id);

  // Should also find by path-based origin or exact match
  const foundByPath = store.findByOriginAndUser('https://vk.com/login', 'durov');
  expect(foundByPath?.id).toBe(result1.id);

  // 4. Update existing credential
  const result2 = store.save('https://vk.com', 'durov', 'newPassword456');
  expect(result2.updated).toBe(true);
  expect(result2.id).toBe(result1.id);
  expect(store.getSecret(result1.id)).toBe('newPassword456');
  expect(store.count()).toBe(1);

  // 5. Secure storage unavailable
  storage.isEncryptionAvailable.mockReturnValue(false);
  expect(() => store.save('https://vk.com', 'durov', 'fail')).toThrow('Защищённое хранилище');
  expect(store.getSecret(result1.id)).toBeNull();
  expect(store.findByOriginAndUser('https://vk.com', 'durov')).toBeNull();
});

