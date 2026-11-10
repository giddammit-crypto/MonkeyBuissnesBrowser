export interface ChromiumIdentity {
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
}

export function getChromiumIdentity(platform?: string): ChromiumIdentity {
  const runtime = (globalThis as { process?: { platform?: string; versions?: { chrome?: string } } }).process;
  const currentPlatform = platform ?? runtime?.platform ?? 'linux';
  const chromeMajor = runtime?.versions?.chrome?.split('.')[0] ?? '134';
  const reducedVersion = `${chromeMajor}.0.0.0`;
  let userAgent: string;
  let brandPlatform: string;

  if (currentPlatform === 'win32') {
    userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    brandPlatform = 'Windows';
  } else if (currentPlatform === 'darwin') {
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    brandPlatform = 'macOS';
  } else {
    userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    brandPlatform = 'Linux';
  }

  return {
    userAgent,
    secChUa: `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not:A-Brand";v="24"`,
    secChUaMobile: '?0',
    secChUaPlatform: `"${brandPlatform}"`,
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
