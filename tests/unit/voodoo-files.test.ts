import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoodooFileService } from '../../src/main/services/VoodooFileService';

describe('Voodoo bounded file tools', () => {
  let root: string;
  let service: VoodooFileService;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'voodoo-files-'));
    service = new VoodooFileService({ downloads: root, desktop: root, documents: root });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it('writes and reads UTF8 with encoded file URL, truncation and listing', () => {
    const saved = service.write({ filename: 'тест #1.txt', content: 'Привет мир' });
    expect(saved.fileUrl).toContain('%23');
    expect(service.read({ filename: saved.filename, max_length: 6 })).toMatchObject({ content: 'Привет', truncated: true });
    expect(service.list({})).toMatchObject({ files: [{ filename: 'тест #1.txt' }] });
  });
  it('refuses accidental overwrite and supports explicit replacement', () => {
    service.write({ filename: 'a.txt', content: 'long contents' });
    expect(() => service.write({ filename: 'a.txt', content: 'new' })).toThrow();
    service.write({ filename: 'a.txt', content: 'new', overwrite: true });
    expect(service.read({ filename: 'a.txt' }).content).toBe('new');
  });
  it('rejects traversal and unknown folders instead of silently changing destinations', () => {
    for (const filename of ['../secret', '/tmp/file', '.', '..', 'dir\\file', 'a\0.txt', 'CON.txt']) {
      expect(() => service.write({ filename, content: 'x' })).toThrow();
    }
    expect(() => service.write({ filename: 'a.txt', content: 'x', folder: 'other' })).toThrow();
  });
  it('rejects symbolic and hard links for reads and writes', () => {
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(root, 'link.txt'));
    fs.linkSync(outside, path.join(root, 'hard.txt'));
    for (const filename of ['link.txt', 'hard.txt']) {
      expect(() => service.read({ filename })).toThrow();
      expect(() => service.write({ filename, content: 'bad', overwrite: true })).toThrow();
    }
    expect(fs.readFileSync(outside, 'utf8')).toBe('secret');
  });
  it('enforces bounded size, UTF8 text and bounded directory listing', () => {
    expect(() => service.write({ filename: 'huge.txt', content: 'я'.repeat(600000) })).toThrow(/лимит/);
    fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([0xff, 0x00]));
    expect(() => service.read({ filename: 'binary.txt' })).toThrow();
    service.write({ filename: 'a.txt', content: 'one' });
    expect(service.list({ limit: 1 })).toMatchObject({ files: [{ filename: 'a.txt' }], truncated: true });
  });
});
