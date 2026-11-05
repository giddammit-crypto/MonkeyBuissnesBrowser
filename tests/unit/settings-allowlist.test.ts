import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `BrowserController.updateSettings` rebuilds the settings object explicitly,
 * so a key that is missing from that object literal is silently discarded
 * even though the renderer sent it. That is how `fontCompatibility`,
 * `xsltSupport`, `autoCheckUpdates` and `voodooSttKey` were lost.
 *
 * This guard fails as soon as a BrowserSettings key is added without being
 * handled (or explicitly listed as managed elsewhere).
 */
const KEYS_MANAGED_OUTSIDE_UPDATE_SETTINGS = new Set([
  'readerSettings', // ReaderService writes its own store
  'voodooBubblePosition', // bubble drag handler persists coordinates directly
  'neverSavePasswordOrigins', // PasswordService owns its own store
]);

const read = (relative: string) => fs.readFileSync(path.resolve(relative), 'utf8');

function settingsKeys(): string[] {
  const source = read('src/shared/types.ts');
  const start = source.indexOf('export interface BrowserSettings');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  return body
    .split('\n')
    .map((line) => /^ {2}([A-Za-z][A-Za-z0-9]*)\??:/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key));
}

function updateSettingsBody(): string {
  const source = read('src/main/tabs/BrowserController.ts');
  const start = source.indexOf('updateSettings(patch: Partial<BrowserSettings>)');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('if (next.theme)', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('BrowserSettings allow-list', () => {
  it('handles every persisted setting that the renderer can send', () => {
    const body = updateSettingsBody();
    // Both `key: value` and the `key,` shorthand count as handled.
    const handled = (key: string) => new RegExp(`(^|\\s)${key}\\s*[:,]`).test(body);
    const missing = settingsKeys().filter((key) => !KEYS_MANAGED_OUTSIDE_UPDATE_SETTINGS.has(key) && !handled(key));
    expect(missing).toEqual([]);
  });

  it('keeps the web-standard toggles switchable', () => {
    const body = updateSettingsBody();
    for (const key of ['fontCompatibility', 'xsltSupport', 'autoCheckUpdates', 'voodooSttKey']) {
      expect(body).toContain(`${key}:`);
    }
  });
});
