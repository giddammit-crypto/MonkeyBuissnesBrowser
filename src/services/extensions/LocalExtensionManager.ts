import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { dialog, type BaseWindow, type Session } from 'electron';
import { JsonStore } from '../../main/persistence/JsonStore';

export interface LocalExtension {
  id: string;
  name: string;
  version: string;
  directory: string;
}
type SavedDirectory = { directory: string };

/**
 * Electron supports only a subset of extension APIs and unpacked folders.
 * Never enable file:// access or load extensions into the private session.
 */
export class LocalExtensionManager {
  private readonly saved: JsonStore<SavedDirectory[]>;
  private readonly active = new Map<string, LocalExtension>();
  private readonly loading = new Map<string, Promise<LocalExtension>>();
  constructor(private readonly browserSession: Session, userDataPath: string) {
    this.saved = new JsonStore(path.join(userDataPath, 'browser-data', 'extensions.json'), []);
  }
  list(): LocalExtension[] { return [...this.active.values()]; }

  private async validate(directory: string): Promise<{ name: string; version: string }> {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error('Выберите папку распакованного расширения.');
    const handle = await fs.open(path.join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NONBLOCK);
    let manifest: string;
    try {
      const manifestStat = await handle.stat();
      if (!manifestStat.isFile()) throw new Error('manifest.json должен быть обычным файлом.');
      const limit = 1024 * 1024;
      if (manifestStat.size > limit) throw new Error('Файл manifest.json слишком большой.');
      // Read with a fixed bound even if a local process grows the file after stat().
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, null);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > limit) throw new Error('Файл manifest.json слишком большой.');
      manifest = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    } finally { await handle.close(); }
    const data: unknown = JSON.parse(manifest);
    if (!data || typeof data !== 'object') throw new Error('Некорректный manifest.json.');
    const record = data as Record<string, unknown>;
    if (record.manifest_version !== 2 && record.manifest_version !== 3)
      throw new Error('Неподдерживаемая версия манифеста.');
    if (typeof record.name !== 'string' || !record.name.trim() || typeof record.version !== 'string' || !record.version.trim())
      throw new Error('У расширения отсутствуют имя или версия.');
    return { name: record.name.slice(0, 120), version: record.version.slice(0, 40) };
  }

  private async load(directory: string): Promise<LocalExtension> {
    const realPath = await fs.realpath(directory);
    const alreadyLoaded = [...this.active.values()].find((item) => item.directory === realPath);
    if (alreadyLoaded) return alreadyLoaded;
    const pending = this.loading.get(realPath);
    if (pending) return pending;
    const loading = (async () => {
      const manifest = await this.validate(realPath);
      const result = await this.browserSession.extensions.loadExtension(realPath, { allowFileAccess: false });
      const item = { id: result.id, ...manifest, directory: realPath };
      this.active.set(item.id, item);
      return item;
    })();
    this.loading.set(realPath, loading);
    try { return await loading; }
    finally { this.loading.delete(realPath); }
  }

  async restore(): Promise<void> {
    const records = this.saved.get();
    if (!Array.isArray(records)) return;
    for (const item of records.slice(0, 30)) {
      if (!item || typeof item.directory !== 'string') continue;
      try { await this.load(item.directory); }
      catch (error) { console.warn('SOUL-M8TE extension could not be restored:', error); }
    }
  }

  async install(owner: BaseWindow): Promise<LocalExtension | null> {
    const pick = await dialog.showOpenDialog(owner, {
      title: 'Папка распакованного расширения',
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const directory = await fs.realpath(pick.filePaths[0]);
    const info = await this.validate(directory);
    const warning = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: 'Установка расширения',
      message: 'Доверяете ли вы этому расширению?',
      detail: `${info.name} (${info.version})\nРасширения могут читать и изменять содержимое посещаемых страниц. Устанавливайте только проверенный код. Electron не гарантирует поддержку всех API Chrome.`,
      buttons: ['Отмена', 'Установить'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (warning.response !== 1) return null;
    const wasAlreadyActive = [...this.active.values()].some(item => item.directory === directory);
    if (!wasAlreadyActive && this.active.size >= 30) throw new Error('Можно установить не более 30 локальных расширений.');
    const item = await this.load(directory);
    try {
      const existing = this.saved.get();
      const directories = Array.isArray(existing) ? existing.filter((entry): entry is SavedDirectory => Boolean(entry && typeof entry.directory === 'string' && entry.directory !== directory)) : [];
      this.saved.set([...directories, { directory }].slice(-30));
    } catch (error) {
      // Failed re-registration must not unload a previously working extension.
      if (!wasAlreadyActive) {
        try {
          this.browserSession.extensions.removeExtension(item.id);
          this.active.delete(item.id);
        } catch { /* Keep the runtime entry if Electron could not unload it. */ }
      }
      throw error;
    }
    return item;
  }

  remove(id: string): void {
    const item = this.active.get(id);
    if (!item) return;
    // Do not erase our registry while extension code is still running after an unload failure.
    this.browserSession.extensions.removeExtension(id);
    this.active.delete(id);
    const current = this.saved.get();
    if (Array.isArray(current)) this.saved.set(current.filter(entry => entry && entry.directory !== item.directory));
  }
}
