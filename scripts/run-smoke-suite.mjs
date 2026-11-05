#!/usr/bin/env node
/**
 * Runs Electron smoke scripts one by one.
 *
 * CI only exposes the step that failed, and Actions logs are not always
 * reachable, so every script announces itself as a check annotation
 * (`::notice::`) and a failure posts the tail of its output as `::error::`.
 * The exit code is still non-zero on the first failing script.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error('usage: node scripts/run-smoke-suite.mjs <script.mjs> [...]');
  process.exit(2);
}

const escape = (value) => value.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');

for (const script of scripts) {
  console.log(`\n===== ${script} =====`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
    env: process.env,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${result.status}`;
    const tail = output.trimEnd().split('\n').slice(-30).join('\n');
    console.log(`::error title=e2e ${script} failed after ${seconds}s (${reason})::${escape(tail)}`);
    console.error(`\n${script} failed after ${seconds}s: ${reason}`);
    process.exit(1);
  }
  console.log(`::notice title=e2e ${script}::passed in ${seconds}s`);
}
console.log(`\nAll ${scripts.length} smoke scripts passed.`);
