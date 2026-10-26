export interface ChromiumIdentity {
  userAgent: string;
  appVersion: string;
  platform: string;
  brandPlatform: string;
  platformVersion: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  brands: Array<{ brand: string; version: string }>;
  fullVersionList: Array<{ brand: string; version: string }>;
}

export const CHROME_MAJOR_VERSION = '134';
export const CHROME_FULL_VERSION = '134.0.0.0';

export function getChromiumIdentity(platform?: string): ChromiumIdentity {
  const nodePlatform = (globalThis as { process?: { platform?: string } }).process?.platform;
  const currentPlatform = platform || (typeof nodePlatform === 'string' ? nodePlatform : 'linux');
  let userAgent: string;
  let navigatorPlatform: string;
  let brandPlatform: string;
  let platformVersion: string;

  if (currentPlatform === 'win32') {
    userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;
    navigatorPlatform = 'Win32';
    brandPlatform = 'Windows';
    platformVersion = '10.0.0';
  } else if (currentPlatform === 'darwin') {
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;
    navigatorPlatform = 'MacIntel';
    brandPlatform = 'macOS';
    platformVersion = '15.0.0';
  } else {
    userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`;
    navigatorPlatform = 'Linux x86_64';
    brandPlatform = 'Linux';
    platformVersion = '6.6.0';
  }

  const appVersion = userAgent.replace(/^Mozilla\//, '');
  const brands = [
    { brand: 'Chromium', version: CHROME_MAJOR_VERSION },
    { brand: 'Google Chrome', version: CHROME_MAJOR_VERSION },
    { brand: 'Not:A-Brand', version: '24' },
  ];
  const fullVersionList = [
    { brand: 'Chromium', version: CHROME_FULL_VERSION },
    { brand: 'Google Chrome', version: CHROME_FULL_VERSION },
    { brand: 'Not:A-Brand', version: '24.0.0.0' },
  ];

  return {
    userAgent,
    appVersion,
    platform: navigatorPlatform,
    brandPlatform,
    platformVersion,
    secChUa: `"Chromium";v="${CHROME_MAJOR_VERSION}", "Google Chrome";v="${CHROME_MAJOR_VERSION}", "Not:A-Brand";v="24"`,
    secChUaMobile: '?0',
    secChUaPlatform: `"${brandPlatform}"`,
    brands,
    fullVersionList,
  };
}

export function getChromeUserAgent(platform?: string): string {
  return getChromiumIdentity(platform).userAgent;
}

export function getClientHintHeaders(platform?: string): Record<string, string> {
  const identity = getChromiumIdentity(platform);
  return {
    'User-Agent': identity.userAgent,
    'Sec-CH-UA': identity.secChUa,
    'Sec-CH-UA-Mobile': identity.secChUaMobile,
    'Sec-CH-UA-Platform': identity.secChUaPlatform,
  };
}

export function getPageStealthScript(platform?: string): string {
  const identity = getChromiumIdentity(platform);
  return `(function() {
  try {
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => false,
        configurable: true,
        enumerable: true,
      });
    } catch {}
    try {
      if (typeof navigator !== 'undefined') {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true,
          enumerable: true,
        });
      }
    } catch {}

    const ua = ${JSON.stringify(identity.userAgent)};
    const appVer = ${JSON.stringify(identity.appVersion)};
    const plat = ${JSON.stringify(identity.platform)};
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => ua,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => appVer,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => plat,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: () => 'Google Inc.',
      configurable: true,
      enumerable: true,
    });

    const brands = ${JSON.stringify(identity.brands)};
    const fullVersionList = ${JSON.stringify(identity.fullVersionList)};
    const brandPlatform = ${JSON.stringify(identity.brandPlatform)};
    const platformVersion = ${JSON.stringify(identity.platformVersion)};

    class NavigatorUAData {
      get brands() { return brands; }
      get mobile() { return false; }
      get platform() { return brandPlatform; }
      getHighEntropyValues(hints) {
        const result = {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
        if (!Array.isArray(hints)) return Promise.resolve(result);
        if (hints.includes('architecture')) result.architecture = 'x86';
        if (hints.includes('bitness')) result.bitness = '64';
        if (hints.includes('model')) result.model = '';
        if (hints.includes('platformVersion')) result.platformVersion = platformVersion;
        if (hints.includes('uaFullVersion')) result.uaFullVersion = ${JSON.stringify(CHROME_FULL_VERSION)};
        if (hints.includes('fullVersionList')) result.fullVersionList = fullVersionList;
        return Promise.resolve(result);
      }
      toJSON() {
        return {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
      }
    }

    try {
      Object.defineProperty(NavigatorUAData.prototype, Symbol.toStringTag, {
        value: 'NavigatorUAData',
        configurable: true,
      });
    } catch {}

    const uaDataInstance = new NavigatorUAData();
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaDataInstance,
      configurable: true,
      enumerable: true,
    });

    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null; },
        getIsInstalled: function() { return false; },
        installState: function(cb) { if (typeof cb === 'function') cb('not_installed'); },
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: performance.timeOrigin,
          onloadT: performance.timeOrigin,
          pageT: performance.now(),
          tran: 15,
        };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          requestTime: performance.timeOrigin / 1000,
          startLoadTime: performance.timeOrigin / 1000,
          commitLoadTime: performance.timeOrigin / 1000,
          finishDocumentLoadTime: performance.timeOrigin / 1000,
          firstPaintTime: performance.timeOrigin / 1000,
          finishLoadTime: performance.timeOrigin / 1000,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }
  } catch {}
})();`;
}
