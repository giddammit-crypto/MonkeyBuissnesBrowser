import fs from 'node:fs/promises';
import type { nativeImage } from 'electron';
import type { DownloadEntry } from '../../shared/types';

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 12_000_000;
const MAX_PENDING = 32;
const MAX_HEADER_BYTES = 64 * 1024;

/** Parse only bounded raster headers; unsupported/unknown formats retain the file icon. */
export function thumbnailDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
    const dib = data.readUInt32LE(14);
    if (dib === 12) return { width: data.readUInt16LE(18), height: data.readUInt16LE(20) };
    if (dib >= 40) return { width: data.readInt32LE(18), height: Math.abs(data.readInt32LE(22)) };
  }
  if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && data.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && data[20] === 47) return { width: 1 + data[21] + ((data[22] & 63) << 8), height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 15) << 10) };
  }
  if (data.length > 4 && data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 255) return null;
      while (data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > data.length) return null;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) return null;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 7) {
        return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}

export async function thumbnailSourceWithinBudget(filename: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOURCE_BYTES) return false;
    handle = await fs.open(filename, 'r');
    const header = Buffer.alloc(Math.min(stat.size, MAX_HEADER_BYTES));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const dimensions = thumbnailDimensions(header.subarray(0, bytesRead));
    return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0
      && dimensions.width <= 16384 && dimensions.height <= 16384
      && dimensions.width * dimensions.height <= MAX_SOURCE_PIXELS);
  } catch { return false; }
  finally { await handle?.close().catch(() => undefined); }
}

/** Native async previews are not implemented by Electron on Linux. */
export async function renderDownloadThumbnail(filename: string, images: Pick<typeof nativeImage, 'createThumbnailFromPath' | 'createFromBuffer'>, platform = process.platform): Promise<string | undefined> {
  if (platform === 'darwin' || platform === 'win32') {
    const image = await images.createThumbnailFromPath(filename, { width: 120, height: 120 });
    return image.isEmpty() ? undefined : image.toDataURL();
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    // Read a fixed, bounded buffer rather than readFile(), which could grow
    // without limit if a download is replaced while a thumbnail is queued.
    handle = await fs.open(filename, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOURCE_BYTES) return;
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const read = await handle.read(data, offset, data.length - offset, offset);
      if (!read.bytesRead) return;
      offset += read.bytesRead;
    }
    const dimensions = thumbnailDimensions(data.subarray(0, MAX_HEADER_BYTES));
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 16384 || dimensions.height > 16384
      || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) return;
    // Linux fallback still decodes synchronously, but a single queued raster is
    // bounded to 12 MP (about 48 MB RGBA), with all disk IO performed off-thread.
    const image = images.createFromBuffer(data);
    if (image.isEmpty()) return;
    const size = image.getSize();
    if (!size.width || !size.height) return;
    const scale = 120 / Math.max(size.width, size.height);
    const resized = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' });
    return resized.isEmpty() ? undefined : resized.toDataURL();
  } finally { await handle?.close().catch(() => undefined); }
}

export class DownloadThumbnailQueue {
  private pending: DownloadEntry[] = [];
  private readonly scheduled = new Set<string>();
  private active = false;
  private disposed = false;

  constructor(private readonly options: {
    isCurrent: (entry: DownloadEntry) => boolean;
    render: (filename: string) => Promise<string | undefined>;
    onReady: (entry: DownloadEntry, dataUrl: string) => void;
    checkSource?: (filename: string) => Promise<boolean>;
  }) {}

  enqueue(entry: DownloadEntry): boolean {
    if (this.disposed || !entry.path || entry.isPrivate || entry.thumbnail || entry.state !== 'completed'
      || this.scheduled.has(entry.id) || this.pending.length >= MAX_PENDING) return false;
    this.scheduled.add(entry.id);
    this.pending.push(entry);
    void this.drain();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
    this.scheduled.clear();
  }

  private async drain(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    try {
      while (!this.disposed && this.pending.length) {
        const entry = this.pending.shift()!;
        await new Promise<void>(resolve => setImmediate(resolve));
        if (this.disposed) break;
        const filename = entry.path!;
        try {
          if (!this.options.isCurrent(entry) || entry.isPrivate || entry.thumbnail || entry.state !== 'completed') continue;
          if (!(await (this.options.checkSource || thumbnailSourceWithinBudget)(filename))) continue;
          if (this.disposed || !this.options.isCurrent(entry) || entry.isPrivate || entry.thumbnail || entry.state !== 'completed' || entry.path !== filename) continue;
          const dataUrl = await this.options.render(filename);
          // Native thumbnail work cannot be cancelled, but stale completion must
          // never revive removed downloads or write after a window is disposed.
          if (!this.disposed && this.options.isCurrent(entry) && !entry.isPrivate && !entry.thumbnail && entry.state === 'completed' && entry.path === filename && dataUrl
            && dataUrl.length <= 128 * 1024 && dataUrl.startsWith('data:image/')) this.options.onReady(entry, dataUrl);
        } catch { /* Keep the download usable with its existing file icon. */ }
        finally { this.scheduled.delete(entry.id); }
      }
    } finally { this.active = false; }
  }
}
