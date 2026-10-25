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
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  addMany(records: PasswordRecordInput[]): number {
    if (records.length === 0 || !this.canPersistSecurely()) return 0;
    const existing = this.read();
    const keys = new Set(existing.map((item) => `${item.origin}\u0000${item.username}`));
    const next = [...existing];
    for (const record of records) {
      const key = `${record.origin}\u0000${record.username}`;
      if (keys.has(key)) continue;
      next.push({ ...record, id: crypto.randomUUID(), importedAt: Date.now() });
      keys.add(key);
    }
    this.write(next);
    return next.length - existing.length;
  }

  summaries(): ImportedPasswordSummary[] {
    return this.read().map(({ password: _password, ...summary }) => summary);
  }

  private read(): StoredPassword[] {
    if (!this.canPersistSecurely() || !fs.existsSync(this.filePath)) return [];
    try {
      const encrypted = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as StoredPassword[];
    } catch {
      return [];
    }
  }

  private write(value: StoredPassword[]): void {
    if (!this.canPersistSecurely()) return;
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, encrypted, 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }
}
