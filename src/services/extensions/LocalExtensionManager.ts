import fs from 'node:fs/promises';
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
  constructor(private readonly browserSession: Session, userDataPath: string) {
    this.saved = new JsonStore(path.join(userDataPath, 'browser-data', 'extensions.json'), []);
  }
  list(): LocalExtension[] { return [...this.active.values()]; }

  private async validate(directory: string): Promise<{ name: string; version: string }> {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error('Выберите папку распакованного расширения.');
    const manifest = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
    if (manifest.length > 1024 * 1024) throw new Error('Файл manifest.json слишком большой.');
    const data: unknown = JSON.parse(manifest);
    if (!data || typeof data !== 'object') throw new Error('Некорректный manifest.json.');
    const record = data as Record<string, unknown>;
    if (record.manifest_version !== 2 && record.manifest_version !== 3)
      throw new Error('Неподдерживаемая версия манифеста.');
    if (typeof record.name !== 'string' || !record.name.trim() || typeof record.version !== 'string')
      throw new Error('У расширения отсутствуют имя или версия.');
    return { name: record.name.slice(0, 120), version: record.version.slice(0, 40) };
  }

  private async load(directory: string): Promise<LocalExtension> {
    const realPath = await fs.realpath(directory);
    const alreadyLoaded = [...this.active.values()].find((item) => item.directory === realPath);
    if (alreadyLoaded) return alreadyLoaded;
    const manifest = await this.validate(realPath);
    const result = await this.browserSession.extensions.loadExtension(realPath, { allowFileAccess: false });
    const item = { id: result.id, ...manifest, directory: realPath };
    this.active.set(item.id, item);
    return item;
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
    const item = await this.load(directory);
    try {
      const existing = this.saved.get();
      const directories = Array.isArray(existing) ? existing.filter((entry): entry is SavedDirectory => Boolean(entry && typeof entry.directory === 'string' && entry.directory !== directory)) : [];
      this.saved.set([...directories, { directory }].slice(-30));
    } catch (error) {
      // Do not leave an extension active when its durable registration failed.
      try { this.browserSession.extensions.removeExtension(item.id); } catch {}
      this.active.delete(item.id);
      throw error;
    }
    return item;
  }

  remove(id: string): void {
    const item = this.active.get(id);
    if (!item) return;
    try { this.browserSession.extensions.removeExtension(id); } finally {
      this.active.delete(id);
      const current = this.saved.get();
      if (Array.isArray(current)) this.saved.set(current.filter(entry => entry.directory !== item.directory));
    }
  }
}
