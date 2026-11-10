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

it.skipIf(process.platform !== 'linux')('migrates old DEB installs and removes only its own command link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-deb-layout-'));
  try {
    const app = path.join(root, 'opt/soulm8te');
    const bin = path.join(root, 'usr/bin');
    fs.mkdirSync(app, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    const binary = path.join(app, 'soulm8te');
    const legacy = path.join(app, 'soulm8te-bin');
    const command = path.join(bin, 'soulm8te');
    const launcher = path.join(app, 'soulm8te-launcher.sh');
    fs.writeFileSync(binary, 'binary from the current package', { mode: 0o755 });
    fs.writeFileSync(legacy, 'binary left by an older package', { mode: 0o755 });
    fs.copyFileSync('scripts/debian/soulm8te-launcher.sh', launcher);
    fs.symlinkSync(binary, command);
    const scripts = ['after-install', 'after-remove'].map(name => {
      const input = fs.readFileSync(`scripts/debian/${name}.sh`, 'utf8');
      const file = path.join(root, `${name}.sh`);
      // No script runs against the host filesystem or its desktop databases.
      fs.writeFileSync(file, input.replaceAll('/opt/soulm8te', app).replaceAll('/usr/bin/soulm8te', command).split('# Update desktop')[0]
        .split('if hash update-mime-database')[0]);
      return file;
    });
    const run = (script: string, action: string) => expect(spawnSync('bash', [script, action]).status).toBe(0);
    run(scripts[0], 'configure');
    run(scripts[0], 'configure');
    expect(fs.readFileSync(binary, 'utf8')).toBe('binary from the current package');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readlinkSync(command)).toBe(launcher);
    run(scripts[1], 'upgrade');
    expect(fs.readlinkSync(command)).toBe(launcher);
    run(scripts[1], 'remove');
    expect(fs.existsSync(command)).toBe(false);
    fs.writeFileSync(command, 'user-installed command');
    run(scripts[0], 'configure');
    run(scripts[1], 'purge');
    expect(fs.readFileSync(command, 'utf8')).toBe('user-installed command');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
