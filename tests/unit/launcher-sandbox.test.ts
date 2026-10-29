import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'linux')('requires a sandbox and never inserts --no-sandbox into the installed launch command', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-launcher-'));
  try {
    const launcher = path.join(directory, 'launcher.sh');
    fs.copyFileSync('scripts/debian/soulm8te-launcher.sh', launcher);
    fs.writeFileSync(path.join(directory, 'soulm8te'), '#!/bin/bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(directory, 'unshare'), '#!/bin/bash\nexit "${TEST_USERNS_STATUS:-1}"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, TEST_USERNS_STATUS: '1' };
    const denied = spawnSync('bash', [launcher], { env, encoding: 'utf8' });
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain('sandbox is unavailable');
    expect(denied.stdout).toBe('');
    const allowed = spawnSync('bash', [launcher, 'https://example.test'], { env: { ...env, TEST_USERNS_STATUS: '0' }, encoding: 'utf8' });
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain('https://example.test');
    expect(allowed.stdout).not.toContain('--no-sandbox');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
