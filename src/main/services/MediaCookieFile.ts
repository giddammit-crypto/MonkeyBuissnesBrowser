import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Cookie } from 'electron';

export function createMediaCookieFile(cookies: readonly Cookie[], targetHost: string, tempRoot = os.tmpdir()): { args: string[]; cleanup: () => void } {
  const lines = ['# Netscape HTTP Cookie File', '# Temporary browser cookie export'];
  const seen = new Set<string>();
  for (const cookie of cookies) {
    const rawDomain = cookie.domain || targetHost;
    const hostOnly = cookie.hostOnly ?? !rawDomain.startsWith('.');
    const host = rawDomain.replace(/^\./, '');
    const domain = hostOnly ? host : `.${host}`;
    const cookiePath = cookie.path || '/';
    const fields = [domain, cookiePath, cookie.name, cookie.value];
    if (!host || !cookie.name || fields.some(field => /[\t\r\n\0]/.test(field))) continue;
    const key = `${domain}\0${cookiePath}\0${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : Math.floor(Date.now() / 1000 + 86400);
    lines.push([domain, hostOnly ? 'FALSE' : 'TRUE', cookiePath, cookie.secure ? 'TRUE' : 'FALSE', expires, cookie.name, cookie.value].join('\t'));
  }
  if (!seen.size) return { args: [], cleanup: () => {} };
  const directory = fs.mkdtempSync(path.join(tempRoot, 'soulm8te-media-cookies-'));
  const cleanup = () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} };
  try {
    fs.chmodSync(directory, 0o700);
    const filename = path.join(directory, 'cookies.txt');
    fs.writeFileSync(filename, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return { args: ['--cookies', filename], cleanup };
  } catch (error) { cleanup(); throw error; }
}
