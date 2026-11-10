import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChromeUserAgent, getClientHintHeaders } from '../../src/shared/chromiumIdentity';

afterEach(() => vi.unstubAllGlobals());

describe('Chromium runtime identity', () => {
  it('advertises the installed Chromium version without app tokens', () => {
    vi.stubGlobal('process', { platform: 'linux', versions: { chrome: '156.0.8078.48' } });
    expect(getChromeUserAgent()).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
    expect(getClientHintHeaders()['Sec-CH-UA']).toContain('"Chromium";v="156"');
  });

  it('selects platform-specific user agents and reader hints', () => {
    vi.stubGlobal('process', { platform: 'darwin', versions: { chrome: '156.0.8078.48' } });
    expect(getChromeUserAgent()).toContain('Macintosh; Intel Mac OS X 10_15_7');
    expect(getClientHintHeaders()['Sec-CH-UA-Platform']).toBe('"macOS"');
    expect(getChromeUserAgent('win32')).toContain('Windows NT 10.0; Win64; x64');
    expect(getClientHintHeaders('win32')['Sec-CH-UA-Platform']).toBe('"Windows"');
  });
});
