import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { ImportBrowser, ImportedPasswordSummary } from '../../shared/types';

interface StoredPassword extends ImportedPasswordSummary {
  password: string;
}

interface PasswordRecordInput {
  origin: string;
  username: string;
  password: string;
  browser: ImportBrowser;
}

export class PasswordStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'browser-data', 'passwords.enc');
  }

  canPersistSecurely(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform !== 'linux') return true;
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  }

  addMany(records: PasswordRecordInput[]): number {
    if (records.length === 0 || !this.canPersistSecurely()) return 0;
    const existing = this.read(true);
    const identity = (record: { origin: string; username: string }) => {
      try { return `${new URL(record.origin).origin}\u0000${record.username}`; } catch { return `${record.origin}\u0000${record.username}`; }
    };
    const keys = new Set(existing.map(identity));
    const next = [...existing];
    for (const record of records) {
      const key = identity(record);
      if (keys.has(key)) continue;
      next.push({ ...record, id: crypto.randomUUID(), importedAt: Date.now() });
      keys.add(key);
    }
    if (next.length > existing.length) this.write(next);
    return next.length - existing.length;
  }

  summaries(): ImportedPasswordSummary[] {
    return this.read().map(({ password: _password, ...summary }) => summary);
  }

  private read(strict = false): StoredPassword[] {
    if (!this.canPersistSecurely() || !fs.existsSync(this.filePath)) return [];
    try {
      const encrypted = fs.readFileSync(this.filePath, 'utf8');
      const records: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
      if (!Array.isArray(records)) throw new Error('Invalid vault shape');
      const valid = records.filter((record): record is StoredPassword => record && typeof record.origin === 'string' && typeof record.username === 'string' && typeof record.password === 'string' && typeof record.id === 'string' && typeof record.importedAt === 'number');
      if (strict && valid.length !== records.length) throw new Error('Invalid vault record');
      return valid;
    } catch {
      if (strict) throw new Error('Существующее хранилище паролей недоступно или повреждено. Импорт отменён, чтобы не заменить сохранённые данные.');
      return [];
    }
  }

  private write(value: StoredPassword[]): void {
    if (!this.canPersistSecurely()) throw new Error('Защищённое хранилище стало недоступно. Пароли не сохранены.');
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, this.filePath);
    } finally { fs.rmSync(temporaryPath, { force: true }); }
  }
}
