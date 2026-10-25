import crypto from 'node:crypto';

export interface ChromiumKeys { v10?: Buffer; v11?: Buffer }

export function deriveChromiumKey(password: string, platform: 'linux' | 'darwin'): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', platform === 'darwin' ? 1003 : 1, 16, 'sha1');
}

/** Supports the documented Linux/macOS CBC format, never Windows/App-Bound keys. */
export function decryptChromiumValue(hexValue: string, keys: ChromiumKeys, cookie?: { host: string; schemaVersion: number }): string | undefined {
  try {
    if (!/^(?:[\da-f]{2})+$/i.test(hexValue)) return undefined;
    const encrypted = Buffer.from(hexValue, 'hex');
    const version = encrypted.subarray(0, 3).toString('ascii');
    if (version !== 'v10' && version !== 'v11') return undefined;
    const key = keys[version];
    if (!key || encrypted.length < 19 || (encrypted.length - 3) % 16) return undefined;
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    // Chromium cookie schema24 binds encrypted values to the exact host_key.
    // https://chromium.googlesource.com/chromium/src/+/HEAD/net/extras/sqlite/sqlite_persistent_cookie_store.cc
    if (cookie && cookie.schemaVersion >= 24) {
      const hash = crypto.createHash('sha256').update(cookie.host).digest();
      if (plain.length < hash.length || !crypto.timingSafeEqual(plain.subarray(0, hash.length), hash)) return undefined;
      plain = plain.subarray(hash.length);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch { return undefined; }
}
