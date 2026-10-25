import fs from 'node:fs';
import path from 'node:path';

export class JsonStore<T> {
  private value: T;

  constructor(private readonly filePath: string, private readonly fallback: T) {
    this.value = this.read();
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    this.flush();
  }

  update(mutator: (current: T) => T): T {
    this.set(mutator(this.value));
    return this.value;
  }

  private read(): T {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }
}
