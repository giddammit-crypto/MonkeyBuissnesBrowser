import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Write beside the selected destination, then atomically replace it after success. */
export async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporaryPath, filePath);
  } finally { await fs.rm(temporaryPath, { force: true }); }
}
