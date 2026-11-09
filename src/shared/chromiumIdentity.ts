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
    const nativeFns = new WeakSet();
    const origToString = Function.prototype.toString;
    function markNative(fn, name) {
      if (name) {
        try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch {}
      }
      try { nativeFns.add(fn); } catch {}
      return fn;
    }

    try {
      const patchedToString = function toString() {
        if (nativeFns.has(this)) {
          return 'function ' + (this.name || '') + '() { [native code] }';
        }
        return origToString.call(this);
      };
      nativeFns.add(patchedToString);
      Object.defineProperty(Function.prototype, 'toString', {
        value: patchedToString,
        writable: true,
        configurable: true,
      });
    } catch {}

    function makeWebIdlGetter(targetClass, getterImpl, name) {
      const fn = function () {
        if (targetClass && !(this instanceof targetClass)) {
          throw new TypeError('Illegal invocation');
        }
        return typeof getterImpl === 'function' ? getterImpl.call(this) : getterImpl;
      };
      return markNative(fn, name);
    }

    try {
      delete Navigator.prototype.webdriver;
    } catch {}
    try {
      if (typeof navigator !== 'undefined') {
        delete navigator.webdriver;
      }
    } catch {}
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: makeWebIdlGetter(Navigator, () => false, 'get webdriver'),
        configurable: true,
        enumerable: true,
      });
    } catch {}

    const ua = ${JSON.stringify(identity.userAgent)};
    const appVer = ${JSON.stringify(identity.appVersion)};
    const plat = ${JSON.stringify(identity.platform)};
    const getUa = makeWebIdlGetter(Navigator, () => ua, 'get userAgent');
    const getAppVer = makeWebIdlGetter(Navigator, () => appVer, 'get appVersion');
    const getPlat = makeWebIdlGetter(Navigator, () => plat, 'get platform');
    const getVendor = makeWebIdlGetter(Navigator, () => 'Google Inc.', 'get vendor');

    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: getUa,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: getAppVer,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: getPlat,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: getVendor,
      configurable: true,
      enumerable: true,
    });

    const brands = ${JSON.stringify(identity.brands)};
    const fullVersionList = ${JSON.stringify(identity.fullVersionList)};
    const brandPlatform = ${JSON.stringify(identity.brandPlatform)};
    const platformVersion = ${JSON.stringify(identity.platformVersion)};

    class NavigatorUAData {
      constructor() {
        try { Object.defineProperty(this, Symbol.toStringTag, { value: 'NavigatorUAData', configurable: true }); } catch {}
      }
      get brands() {
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        return brands;
      }
      get mobile() {
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        return false;
      }
      get platform() {
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        return brandPlatform;
      }
      getHighEntropyValues(hints) {
        if (!(this instanceof NavigatorUAData)) return Promise.reject(new TypeError('Illegal invocation'));
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
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        return {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
      }
    }

    try {
      const proto = NavigatorUAData.prototype;
      const brandsDesc = Object.getOwnPropertyDescriptor(proto, 'brands');
      if (brandsDesc && brandsDesc.get) markNative(brandsDesc.get, 'get brands');
      const mobileDesc = Object.getOwnPropertyDescriptor(proto, 'mobile');
      if (mobileDesc && mobileDesc.get) markNative(mobileDesc.get, 'get mobile');
      const platformDesc = Object.getOwnPropertyDescriptor(proto, 'platform');
      if (platformDesc && platformDesc.get) markNative(platformDesc.get, 'get platform');
      if (proto.getHighEntropyValues) markNative(proto.getHighEntropyValues, 'getHighEntropyValues');
      if (proto.toJSON) markNative(proto.toJSON, 'toJSON');
      Object.defineProperty(proto, Symbol.toStringTag, {
        value: 'NavigatorUAData',
        configurable: true,
      });
    } catch {}

    const uaDataInstance = new NavigatorUAData();
    const getUaData = makeWebIdlGetter(Navigator, () => uaDataInstance, 'get userAgentData');
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: getUaData,
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
        getDetails: markNative(function getDetails() { return null; }, 'getDetails'),
        getIsInstalled: markNative(function getIsInstalled() { return false; }, 'getIsInstalled'),
        installState: markNative(function installState(cb) { if (typeof cb === 'function') cb('not_installed'); }, 'installState'),
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = markNative(function csi() {
        return {
          startE: performance.timeOrigin,
          onloadT: performance.timeOrigin,
          pageT: performance.now(),
          tran: 15,
        };
      }, 'csi');
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = markNative(function loadTimes() {
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
      }, 'loadTimes');
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: Object.freeze({
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        }),
        OnRestartRequiredReason: Object.freeze({
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        }),
        PlatformArch: Object.freeze({
          ARM: 'arm',
          ARM64: 'arm64',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        }),
        PlatformNaclArch: Object.freeze({
          ARM: 'arm',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        }),
        PlatformOs: Object.freeze({
          ANDROID: 'android',
          CROS: 'cros',
          FUCHSIA: 'fuchsia',
          LINUX: 'linux',
          MAC: 'mac',
          OPENBSD: 'openbsd',
          WIN: 'win',
        }),
        RequestUpdateCheckStatus: Object.freeze({
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available',
        }),
        connect: markNative(function connect() {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }, 'connect'),
        sendMessage: markNative(function sendMessage() {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }, 'sendMessage'),
        id: undefined,
      };
    }

    try {
      if (typeof Permissions !== 'undefined' && Permissions.prototype && typeof Permissions.prototype.query === 'function') {
        const origQuery = Permissions.prototype.query;
        const patchedQuery = markNative(function query(queryObj) {
          if (queryObj && queryObj.name === 'notifications') {
            return origQuery.call(this, queryObj).then((status) => {
              if (typeof Notification !== 'undefined') {
                const perm = Notification.permission;
                if (perm === 'default' && status.state === 'denied') {
                  return new Proxy(status, {
                    get(target, prop, receiver) {
                      if (prop === 'state') return 'prompt';
                      const val = Reflect.get(target, prop, receiver);
                      return typeof val === 'function' ? val.bind(target) : val;
                    }
                  });
                }
              }
              return status;
            });
          }
          return origQuery.call(this, queryObj);
        }, 'query');
        Object.defineProperty(Permissions.prototype, 'query', {
          value: patchedQuery,
          writable: true,
          configurable: true,
        });
      }
    } catch {}
  } catch {}
})();`;
}
