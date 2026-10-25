import fs from 'node:fs';
import path from 'node:path';

export class JsonStore<T> {
  private value: T;

  constructor(
    private readonly filePath: string,
    private readonly fallback: T,
    private readonly normalize?: (value: unknown) => T,
  ) {
    this.value = this.read();
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    const normalized = this.normalize ? this.normalize(next) : next;
    // Publish the new value only after the atomic write succeeds.
    this.flush(normalized);
    this.value = normalized;
  }

  update(mutator: (current: T) => T): T {
    this.set(mutator(this.value));
    return this.value;
  }

  private read(): T {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (this.normalize) return this.normalize(value);
      if (Array.isArray(this.fallback) && !Array.isArray(value)) return structuredClone(this.fallback);
      if (this.fallback && typeof this.fallback === 'object' && !Array.isArray(this.fallback)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(this.fallback);
      }
      return value as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }

  private flush(value: T): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}
