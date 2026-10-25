import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBookmarksHtml, parsePasswordsCsv } from '../../src/main/import/ImportParsers';
import { decryptChromiumValue, deriveChromiumKey } from '../../src/main/import/ChromiumCrypto';
import { BrowserDataImporter } from '../../src/main/import/BrowserDataImporter';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const directory = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-file-import-')); directories.push(root); return root; };

describe('bookmarks HTML import', () => {
  it('handles nested Netscape exports and entities without evaluating scripts or importing dangerous schemes', () => {
    const parsed = parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Folder</H3><DL><DT><A ADD_DATE="1700000000" HREF="https://example.test/?a=1&amp;b=2">Книги &amp; чтение &#x1F4DA;</A><DT><A HREF='javascript:alert(1)'>Unsafe</A></DL><script><A HREF="https://script.test/">Fake</A></script></DL>`);
    expect(parsed.total).toBe(2);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ url: 'https://example.test/?a=1&b=2', title: 'Книги & чтение 📚', createdAt: 1700000000000 });
  });
  it('reports actual new bookmarks and skips duplicates on repeated imports', async () => {
    const root = directory();
    const filePath = path.join(root, 'bookmarks.html');
    fs.writeFileSync(filePath, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><A HREF="https://example.test">First</A><A HREF="https://example.test/">Duplicate</A></DL>');
    const stores = new BrowserStores(path.join(root, 'target'));
    const importer = new BrowserDataImporter(stores, {} as never, async () => 0);
    expect(await importer.importFile(filePath, 'bookmarks')).toMatchObject({ imported: 1, skipped: 1, errors: [] });
    expect(await importer.importFile(filePath, 'bookmarks')).toMatchObject({ imported: 0, skipped: 2, errors: [] });
    expect(stores.bookmarks.get()).toHaveLength(1);
  });
});

describe('password CSV import', () => {
  it('preserves RFC4180 quotes, Unicode, multiline passwords and empty usernames', () => {
    const parsed = parsePasswordsCsv('\uFEFFname,url,username,password,note\r\nExample,https://example.test/login,"олег, пользователь","p""a\r\nss",\r\nEmpty,https://empty.test,,password,\r\nUnsafe,javascript:bad,user,secret,\r\n');
    expect(parsed.total).toBe(3);
    expect(parsed.records).toEqual([{ origin: 'https://example.test', username: 'олег, пользователь', password: 'p"a\r\nss' }, { origin: 'https://empty.test', username: '', password: 'password' }]);
  });
  it('supports Firefox headers and semicolon exports and rejects malformed quoting', () => {
    expect(parsePasswordsCsv('url;username;password;httpRealm\nhttps://example.test;user;" p;ss ";\n').records[0]).toMatchObject({ password: ' p;ss ' });
    expect(() => parsePasswordsCsv('url,username,password\nhttps://example.test,user,"unterminated')).toThrow('кавычка');
    expect(() => parsePasswordsCsv('name,secret\nuser,password')).toThrow('столбцы');
  });
  it('refuses to even read a password file if secure storage is unavailable', async () => {
    const importer = new BrowserDataImporter(new BrowserStores(path.join(directory(), 'target')), { canPersistSecurely: () => false } as never, async () => 0);
    const report = await importer.importFile('/file-that-does-not-exist.csv', 'passwords');
    expect(report.imported).toBe(0);
    expect(report.errors[0]).toContain('защищённое системное хранилище');
    expect(report.errors[0]).not.toContain('ENOENT');
  });
  it('hands password records only to the secure store and leaves no plaintext copies', async () => {
    const root = directory();
    const filePath = path.join(root, 'source.csv');
    const source = 'url,username,password\nhttps://example.test/login,user,"exact secret "\n';
    fs.writeFileSync(filePath, source);
    const stored: unknown[] = [];
    const importer = new BrowserDataImporter(new BrowserStores(path.join(root, 'target')), { canPersistSecurely: () => true, addMany: (records: unknown[]) => { stored.push(...records); return records.length; } } as never, async () => 0);
    const report = await importer.importFile(filePath, 'passwords');
    expect(report).toMatchObject({ imported: 1, skipped: 0, errors: [] });
    expect(stored).toEqual([{ origin: 'https://example.test', username: 'user', password: 'exact secret ', browser: 'file' }]);
    expect(JSON.stringify(report)).not.toContain('exact secret');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(source);
    expect(fs.readdirSync(root)).toEqual(['source.csv']);
  });
});

describe('Chromium safe-storage formats', () => {
  function encrypt(plain: Buffer, key: Buffer, version: string): string { const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20)); return Buffer.concat([Buffer.from(version), cipher.update(plain), cipher.final()]).toString('hex'); }
  it('validates and strips schema24 host digest before UTF-8 decoding', () => {
    const key = deriveChromiumKey('keyring-secret', 'linux');
    const host = '.example.test';
    const value = 'cookie-значение';
    const encrypted = encrypt(Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from(value)]), key, 'v11');
    expect(decryptChromiumValue(encrypted, { v11: key }, { host, schemaVersion: 24 })).toBe(value);
    expect(decryptChromiumValue(encrypted, { v11: key }, { host: '.wrong.test', schemaVersion: 24 })).toBeUndefined();
  });
  it('distinguishes Linux v10 fallback, v11 keyring, mac1003 derivation and unsupported Windows v20', () => {
    const fallback = deriveChromiumKey('peanuts', 'linux');
    const v10 = encrypt(Buffer.from('password with trailing space '), fallback, 'v10');
    expect(decryptChromiumValue(v10, { v10: fallback })).toBe('password with trailing space ');
    expect(decryptChromiumValue(v10, { v11: fallback })).toBeUndefined();
    expect(deriveChromiumKey('secret', 'darwin')).toEqual(crypto.pbkdf2Sync('secret', 'saltysalt', 1003, 16, 'sha1'));
    expect(decryptChromiumValue(encrypt(Buffer.from('value'), fallback, 'v20'), { v10: fallback })).toBeUndefined();
  });
});
