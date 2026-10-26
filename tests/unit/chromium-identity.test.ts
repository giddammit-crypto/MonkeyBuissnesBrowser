import { describe, expect, it } from 'vitest';
import {
  CHROME_FULL_VERSION,
  CHROME_MAJOR_VERSION,
  getChromeUserAgent,
  getChromiumIdentity,
  getClientHintHeaders,
  getPageStealthScript,
} from '../../src/shared/chromiumIdentity';

describe('Chromium / Chrome 134 native identity', () => {
  it('generates Chrome 134 Linux User-Agent and headers without Electron tokens', () => {
    const identity = getChromiumIdentity('linux');
    expect(identity.userAgent).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    expect(identity.userAgent).not.toMatch(/electron|soul-m8te|monkeybuissnes/i);
    expect(identity.appVersion).toBe('5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    expect(identity.platform).toBe('Linux x86_64');
    expect(identity.brandPlatform).toBe('Linux');
    expect(identity.secChUa).toBe('"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"');
    expect(identity.secChUaMobile).toBe('?0');
    expect(identity.secChUaPlatform).toBe('"Linux"');
    expect(identity.brands).toEqual([
      { brand: 'Chromium', version: '134' },
      { brand: 'Google Chrome', version: '134' },
      { brand: 'Not:A-Brand', version: '24' },
    ]);
  });

  it('generates Windows and macOS Chrome 134 user agents and Client Hints', () => {
    const win = getChromiumIdentity('win32');
    expect(win.userAgent).toContain('Windows NT 10.0; Win64; x64');
    expect(win.userAgent).toContain(`Chrome/${CHROME_FULL_VERSION}`);
    expect(win.secChUaPlatform).toBe('"Windows"');
    expect(win.platform).toBe('Win32');

    const mac = getChromiumIdentity('darwin');
    expect(mac.userAgent).toContain('Macintosh; Intel Mac OS X 10_15_7');
    expect(mac.userAgent).toContain(`Chrome/${CHROME_FULL_VERSION}`);
    expect(mac.secChUaPlatform).toBe('"macOS"');
    expect(mac.platform).toBe('MacIntel');
  });

  it('provides Client Hints headers dictionary for webRequest.onBeforeSendHeaders', () => {
    const headers = getClientHintHeaders('linux');
    expect(headers['User-Agent']).toContain(`Chrome/${CHROME_FULL_VERSION}`);
    expect(headers['Sec-CH-UA']).toContain(`"Chromium";v="${CHROME_MAJOR_VERSION}"`);
    expect(headers['Sec-CH-UA']).toContain(`"Google Chrome";v="${CHROME_MAJOR_VERSION}"`);
    expect(headers['Sec-CH-UA-Mobile']).toBe('?0');
    expect(headers['Sec-CH-UA-Platform']).toBe('"Linux"');
  });

  it('generates stealth DOM script that configures navigator.webdriver=false and userAgentData', () => {
    const script = getPageStealthScript('linux');
    expect(script).toContain("Navigator.prototype, 'webdriver'");
    expect(script).toContain("get: () => false");
    expect(script).toContain("Navigator.prototype, 'userAgentData'");
    expect(script).toContain("window.chrome");
    expect(script).not.toContain("Electron");

    // Execute stealth script in mock window/navigator environment
    const NavigatorPrototype: Record<string, unknown> = {};
    const NavigatorConstructor = function () {};
    NavigatorConstructor.prototype = NavigatorPrototype;
    const fakeNavigator = Object.create(NavigatorPrototype);
    fakeNavigator.webdriver = true;
    const fakeWindow: Record<string, unknown> = {};

    const testFn = new Function('window', 'navigator', 'Navigator', script);
    testFn(fakeWindow, fakeNavigator, NavigatorConstructor);

    expect(fakeNavigator.webdriver).toBe(false);
    expect(fakeNavigator.userAgent).toBe(getChromeUserAgent('linux'));
    expect(fakeNavigator.vendor).toBe('Google Inc.');
    const uad = fakeNavigator.userAgentData as {
      brands: Array<{ brand: string; version: string }>;
      mobile: boolean;
      platform: string;
      getHighEntropyValues: (hints: string[]) => Promise<Record<string, unknown>>;
    };
    expect(uad).toBeDefined();
    expect(uad.mobile).toBe(false);
    expect(uad.platform).toBe('Linux');
    expect(uad.brands).toEqual([
      { brand: 'Chromium', version: '134' },
      { brand: 'Google Chrome', version: '134' },
      { brand: 'Not:A-Brand', version: '24' },
    ]);
  });
});
