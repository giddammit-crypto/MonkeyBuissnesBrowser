import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { ImportBrowser, ImportedPasswordSummary } from '../../shared/types';

export interface StoredPassword extends ImportedPasswordSummary {
  password: string;
}

interface PasswordRecordInput {
  origin: string;
  username: string;
  password: string;
  browser: ImportBrowser;
}

const supportedBrowsers: ImportBrowser[] = ['chrome', 'yandex', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'file', 'soulm8te'];

function isStoredPassword(value: unknown): value is StoredPassword {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.origin === 'string' && record.origin.length > 0
    && typeof record.username === 'string'
    && typeof record.password === 'string'
    && supportedBrowsers.includes(record.browser as ImportBrowser)
    && typeof record.importedAt === 'number' && Number.isFinite(record.importedAt);
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
    if (!this.canPersistSecurely()) throw new Error('Защищённое хранилище паролей недоступно. Сохранённые данные не изменены.');
    return this.read(true).map(({ password: _password, ...summary }) => summary);
  }

  /** Main-process only. Callers must obtain explicit consent before reading a secret. */
  getForOrigin(id: string, exactOrigin: string): { username: string; password: string } | null {
    const canonical = (raw: string): string | null => {
      try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null; } catch { return null; }
    };
    const origin = canonical(exactOrigin);
    if (!origin || !this.canPersistSecurely()) return null;
    const requested = new URL(exactOrigin);
    if (requested.pathname !== '/' || requested.search || requested.hash) return null;
    const record = this.read(true).find(record => record.id === id && canonical(record.origin) === origin);
    return record ? { username: record.username, password: record.password } : null;
  }

  delete(id: string): boolean {
    if (!this.canPersistSecurely()) throw new Error('Защищённое хранилище недоступно. Запись не удалена.');
    const records = this.read(true);
    const next = records.filter(record => record.id !== id);
    if (next.length === records.length) return false;
    this.write(next);
    return true;
  }

  count(): number {
    return this.read(false).length;
  }

  clearAll(): number {
    if (!this.canPersistSecurely()) return 0;
    const records = this.read(false);
    if (records.length === 0) return 0;
    this.write([]);
    return records.length;
  }

  save(origin: string, username: string, password: string): { id: string; updated: boolean } {
    if (!this.canPersistSecurely()) {
      throw new Error('Защищённое хранилище паролей недоступно. Сохранённые данные не изменены.');
    }
    let normalizedOrigin = origin;
    try {
      const parsed = new URL(origin.includes('://') ? origin : `https://${origin}`);
      normalizedOrigin = parsed.origin;
    } catch {
      normalizedOrigin = origin;
    }

    const existing = this.read(true);
    const normalize = (val: string): string => {
      try {
        return new URL(val.includes('://') ? val : `https://${val}`).origin;
      } catch {
        return val;
      }
    };

    const idx = existing.findIndex(
      (r) => (r.origin === normalizedOrigin || r.origin === origin || normalize(r.origin) === normalizedOrigin) && r.username === username,
    );

    if (idx !== -1) {
      existing[idx].password = password;
      existing[idx].importedAt = Date.now();
      this.write(existing);
      return { id: existing[idx].id, updated: true };
    }

    const id = crypto.randomUUID();
    const newRecord: StoredPassword = {
      id,
      origin: normalizedOrigin,
      username,
      password,
      browser: 'soulm8te',
      importedAt: Date.now(),
    };
    existing.push(newRecord);
    this.write(existing);
    return { id, updated: false };
  }

  getSecret(id: string): string | null {
    if (!this.canPersistSecurely()) return null;
    const records = this.read(false);
    const found = records.find((record) => record.id === id);
    return found ? found.password : null;
  }

  findByOriginAndUser(origin: string, username: string): StoredPassword | null {
    if (!this.canPersistSecurely()) return null;
    let normalizedOrigin = origin;
    try {
      normalizedOrigin = new URL(origin.includes('://') ? origin : `https://${origin}`).origin;
    } catch {
      normalizedOrigin = origin;
    }
    const records = this.read(false);
    return (
      records.find((record) => {
        if (record.username !== username) return false;
        if (record.origin === origin || record.origin === normalizedOrigin) return true;
        try {
          return new URL(record.origin.includes('://') ? record.origin : `https://${record.origin}`).origin === normalizedOrigin;
        } catch {
          return false;
        }
      }) ?? null
    );
  }

  getSummariesForOrigin(origin: string): ImportedPasswordSummary[] {
    if (!this.canPersistSecurely()) return [];
    let normalizedOrigin = origin;
    try {
      normalizedOrigin = new URL(origin.includes('://') ? origin : `https://${origin}`).origin;
    } catch {
      normalizedOrigin = origin;
    }
    const normalize = (val: string): string => {
      try {
        return new URL(val.includes('://') ? val : `https://${val}`).origin;
      } catch {
        return val;
      }
    };
    return this.summaries().filter(
      (r) => r.origin === normalizedOrigin || r.origin === origin || normalize(r.origin) === normalizedOrigin,
    );
  }

  private read(strict = false): StoredPassword[] {
    if (!this.canPersistSecurely()) {
      if (strict) throw new Error('Защищённое хранилище паролей недоступно. Сохранённые данные не изменены.');
      return [];
    }
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const encrypted = fs.readFileSync(this.filePath, 'utf8');
      const records: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
      if (!Array.isArray(records)) throw new Error('Invalid vault shape');
      const valid = records.filter(isStoredPassword);
      if (strict && valid.length !== records.length) throw new Error('Invalid vault record');
      return valid;
    } catch {
      if (strict) throw new Error('Существующее хранилище паролей недоступно или повреждено. Операция отменена, чтобы не заменить сохранённые данные.');
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
