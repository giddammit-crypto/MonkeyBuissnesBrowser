import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILE_BYTES = 1024 * 1024;
export type VoodooFileFolder = 'downloads' | 'desktop' | 'documents';

/** Files exposed to the agent are flat, bounded text files in explicit user folders. */
export class VoodooFileService {
  constructor(private readonly folders: Record<VoodooFileFolder, string>) {}

  private resolve(folder: unknown, filename?: unknown): string {
    const selected = folder === undefined ? 'downloads' : folder;
    if (selected !== 'downloads' && selected !== 'desktop' && selected !== 'documents') {
      throw new Error('Неизвестная папка: используйте downloads, desktop или documents');
    }
    const root = this.folders[selected];
    fs.mkdirSync(root, { recursive: true });
    const canonicalRoot = fs.realpathSync(root);
    if (filename === undefined) return canonicalRoot;
    if (typeof filename !== 'string' || !filename.trim() || filename !== filename.trim()
      || filename === '.' || filename === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(filename)
      || /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
      throw new Error('Укажите обычное имя файла с расширением, без пути или специальных символов');
    }
    const target = path.join(canonicalRoot, filename);
    // lstat also rejects links on platforms where O_NOFOLLOW is unavailable.
    try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Символические ссылки недоступны агенту'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return target;
  }

  write(args: Record<string, unknown>) {
    const target = this.resolve(args.folder, args.filename);
    if (typeof args.content !== 'string') throw new Error('Содержимое файла должно быть текстом');
    const sizeBytes = Buffer.byteLength(args.content, 'utf8');
    if (sizeBytes > MAX_FILE_BYTES) throw new Error('Файл превышает лимит 1 МиБ');
    const overwrite = args.overwrite === true;
    // O_NOFOLLOW stops writes through a symlink; O_EXCL avoids accidental overwrites.
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
      | (overwrite ? 0 : fs.constants.O_EXCL);
    const descriptor = fs.openSync(target, flags, 0o600);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Разрешена запись только в обычный файл без ссылок');
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, args.content, 'utf8');
    } finally { fs.closeSync(descriptor); }
    return { filePath: target, fileUrl: pathToFileURL(target).href, filename: path.basename(target), sizeBytes };
  }

  read(args: Record<string, unknown>) {
    const target = this.resolve(args.folder, args.filename);
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Разрешено чтение только обычных файлов без ссылок');
      if (stat.size > MAX_FILE_BYTES) throw new Error('Файл превышает лимит чтения 1 МиБ');
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
        if (count === 0) break;
        bytesRead += count;
      }
      if (bytesRead > MAX_FILE_BYTES) throw new Error('Файл превышает лимит чтения 1 МиБ');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
      if (content.includes('\0')) throw new Error('Файл не является текстовым');
      const limit = typeof args.max_length === 'number' && Number.isFinite(args.max_length)
        ? Math.max(1, Math.min(100000, Math.floor(args.max_length))) : 20000;
      return { filename: path.basename(target), content: content.slice(0, limit), sizeBytes: bytesRead, truncated: content.length > limit };
    } finally { fs.closeSync(descriptor); }
  }

  list(args: Record<string, unknown>) {
    const root = this.resolve(args.folder);
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 100;
    const entries = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { folder: args.folder ?? 'downloads', files: entries.slice(0, limit).map(entry => ({ filename: entry.name })), truncated: entries.length > limit };
  }
}
