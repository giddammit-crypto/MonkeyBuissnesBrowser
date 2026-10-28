import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadThumbnailQueue, thumbnailDimensions, thumbnailSourceWithinBudget, renderDownloadThumbnail } from '../../src/main/services/DownloadThumbnailQueue';
import type { DownloadEntry } from '../../src/shared/types';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
function entry(id: string): DownloadEntry { return { id, path: '/' + id + '.png', filename: id + '.png', state: 'completed', kind: 'image', url: 'https://example.com/' + id, receivedBytes: 1, totalBytes: 1, startedAt: 1 }; }
function png(width: number, height: number) {
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
async function imageFile(bytes: Buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-budget-')); directories.push(dir);
  const filename = path.join(dir, 'source.png'); await fs.writeFile(filename, bytes); return filename;
}

describe('Bounded download thumbnails', () => {
  it('rejects malformed or oversized source headers before calling a native decoder', async () => {
    expect(await thumbnailSourceWithinBudget(await imageFile(png(100, 100)))).toBe(true);
    expect(await thumbnailSourceWithinBudget(await imageFile(png(10000, 10000)))).toBe(false);
    expect(await thumbnailSourceWithinBudget(await imageFile(png(0, 100)))).toBe(false);
    expect(await thumbnailSourceWithinBudget(await imageFile(Buffer.from('<svg width="100000" height="100000"/>')))).toBe(false);
    const big = await imageFile(png(100, 100)); await fs.truncate(big, 8 * 1024 * 1024 + 1);
    expect(await thumbnailSourceWithinBudget(big)).toBe(false);
    const link = big + '.link'; await fs.symlink(big, link);
    expect(await thumbnailSourceWithinBudget(link)).toBe(false);
    for (let n = 0; n < 64; n++) {
      const malformed = Buffer.alloc(n, 255);
      expect(() => thumbnailDimensions(malformed)).not.toThrow();
    }
  });

  it('parses common bounded raster formats without decoding full pixels', () => {
    expect(thumbnailDimensions(png(120, 80))).toEqual({ width: 120, height: 80 });
    const gif = Buffer.alloc(10); gif.write('GIF89a'); gif.writeUInt16LE(50, 6); gif.writeUInt16LE(60, 8);
    expect(thumbnailDimensions(gif)).toEqual({ width: 50, height: 60 });
    const jpeg = Buffer.from([255,216,255,192,0,7,8,0,80,0,120]);
    expect(thumbnailDimensions(jpeg)).toEqual({ width: 120, height: 80 });
    const webp = Buffer.alloc(30); webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8X',12); webp.writeUIntLE(119,24,3); webp.writeUIntLE(79,27,3);
    expect(thumbnailDimensions(webp)).toEqual({ width: 120, height: 80 });
  });

  it('preserves Linux previews with bounded file IO and never invokes an unavailable native thumbnail API', async () => {
    const resized = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA==' };
    const image = { isEmpty: () => false, getSize: () => ({ width: 400, height: 200 }), resize: vi.fn(() => resized) };
    const images = { createThumbnailFromPath: vi.fn(), createFromBuffer: vi.fn(() => image) } as any;
    const filename = await imageFile(png(400, 200));
    expect(await renderDownloadThumbnail(filename, images, 'linux')).toBe('data:image/png;base64,AA==');
    expect(images.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(images.createFromBuffer).toHaveBeenCalledTimes(1);
    expect(image.resize).toHaveBeenCalledWith({ width: 120, height: 60, quality: 'good' });
    await fs.writeFile(filename, png(10000, 10000));
    expect(await renderDownloadThumbnail(filename, images, 'linux')).toBeUndefined();
    expect(images.createFromBuffer).toHaveBeenCalledTimes(1);
  });

  it('bounds pending work, deduplicates requests and runs only one native job at a time', async () => {
    const resolves: Array<(value: string) => void> = [];
    const render = vi.fn(() => new Promise<string>(resolve => resolves.push(resolve)));
    const onReady = vi.fn();
    const queue = new DownloadThumbnailQueue({ isCurrent: () => true, checkSource: async () => true, render, onReady });
    const first = entry('0'); expect(queue.enqueue(first)).toBe(true); expect(queue.enqueue(first)).toBe(false);
    let accepted = 1;
    for (let n = 1; n < 100; n++) if (queue.enqueue(entry(String(n)))) accepted++;
    expect(accepted).toBe(33);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    resolves[0]('data:image/png;base64,AA==');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(onReady).toHaveBeenCalledTimes(1);
    queue.dispose(); resolves[1]('data:image/png;base64,AA==');
    await Promise.resolve(); await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(queue.enqueue(entry('new'))).toBe(false);
  });

  it('does not commit removed, private, changed-path or oversized thumbnail results', async () => {
    for (const mutation of ['removed', 'private', 'path', 'oversized']) {
      const download = entry(mutation); let current = true; let resolve!: (value: string) => void;
      const onReady = vi.fn();
      const queue = new DownloadThumbnailQueue({ isCurrent: () => current, checkSource: async () => true,
        render: () => new Promise<string>(done => { resolve = done; }), onReady });
      queue.enqueue(download); await vi.waitFor(() => expect(resolve).toBeDefined());
      if (mutation === 'removed') current = false;
      if (mutation === 'private') download.isPrivate = true;
      if (mutation === 'path') download.path = '/changed.png';
      resolve('data:image/png;base64,' + (mutation === 'oversized' ? 'x'.repeat(128 * 1024) : 'AA=='));
      await Promise.resolve(); await Promise.resolve();
      expect(onReady).not.toHaveBeenCalled(); queue.dispose();
    }
  });

  it('does not decode sources outside budget or enqueue private downloads', async () => {
    const render = vi.fn(); const queue = new DownloadThumbnailQueue({ isCurrent: () => true, checkSource: async () => false, render, onReady: vi.fn() });
    expect(queue.enqueue({ ...entry('private'), isPrivate: true })).toBe(false);
    expect(queue.enqueue(entry('large'))).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(render).not.toHaveBeenCalled(); queue.dispose();
  });
});
