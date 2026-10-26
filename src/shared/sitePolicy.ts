import { getDomain } from 'tldts';

/** Schemeful site with private PSL suffixes (e.g. different github.io tenants). */
export function getSiteKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const domain = getDomain(host, { allowPrivateDomains: true, extractHostname: false }) || host;
    return `${url.protocol}//${domain}`;
  } catch { return null; }
}

export function normalizeCookieExceptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 2048).map(getSiteKey).filter((entry): entry is string => Boolean(entry)))].slice(0, 100);
}

/** Normalize arbitrary input (domain, host, or full URL) into canonical domain key (e.g. "youtube.com") */
export function normalizeSiteKey(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const domain = getDomain(host, { allowPrivateDomains: true, extractHostname: false });
    if (domain) return domain;
    if (host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) {
      return host;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeSiteExceptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 2048)
      .map(normalizeSiteKey)
      .filter((entry): entry is string => Boolean(entry))
  )].slice(0, 500);
}

export function isAdBlockDisabledForSite(pageUrl: string, exceptions?: string[]): boolean {
  if (!pageUrl || !exceptions || exceptions.length === 0) return false;
  const pageSiteKey = normalizeSiteKey(pageUrl);
  if (!pageSiteKey) return false;
  return exceptions.some((exception) => {
    const excSiteKey = normalizeSiteKey(exception);
    return excSiteKey === pageSiteKey;
  });
}

/** Google and YouTube exchange auth state across registrable domains during sign-in. */
export function isGoogleYouTubeSignInRequest(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const top = new URL(topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.port || top.port || request.username || request.password || top.username || top.password) return false;
    const requestSite = getSiteKey(request.href);
    const topSite = getSiteKey(top.href);
    if (topSite === 'https://youtube.com' && requestSite === 'https://google.com') {
      return request.hostname === 'accounts.google.com' ||
        request.hostname === 'myaccount.google.com' ||
        request.hostname === 'apis.google.com' ||
        request.hostname === 'accounts.youtube.com' ||
        request.hostname === 'ogs.google.com' ||
        request.hostname === 'play.google.com' ||
        request.hostname === 'www.google.com';
    }
    if (topSite === 'https://youtube.com' && (requestSite === 'https://googleapis.com' || request.hostname.endsWith('.googleapis.com'))) {
      return request.hostname === 'youtubei.googleapis.com' ||
        request.hostname === 'youtube.googleapis.com';
    }
    if (topSite === 'https://google.com' && requestSite === 'https://youtube.com') {
      return request.hostname === 'accounts.youtube.com' ||
        (['youtube.com', 'www.youtube.com'].includes(request.hostname) &&
          /^\/(?:accounts|youtubei|signin|signin_passive|oops|redirect|service_ajax)(?:\/|$)/i.test(request.pathname));
    }
    return false;
  } catch { return false; }
}

export function isPinterestSignInOrVerification(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const top = new URL(topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.port || top.port || request.username || request.password || top.username || top.password) return false;
    const topHost = top.hostname.toLowerCase();
    if (topHost.endsWith('.test') || topHost.endsWith('.example')) return false;
    const topSite = getSiteKey(top.href);
    const isPinterest = topSite === 'https://pinterest.com' ||
      topSite === 'https://pinterest.ru' ||
      topHost === 'pinterest.com' ||
      topHost.endsWith('.pinterest.com') ||
      topHost === 'pinterest.ru' ||
      topHost.endsWith('.pinterest.ru') ||
      topHost.includes('pinterest.');
    if (!isPinterest) return false;

    const host = request.hostname.toLowerCase();
    // Arkose Labs bot challenge (required by Pinterest login)
    if (host === 'arkoselabs.com' || host.endsWith('.arkoselabs.com')) return true;
    // Google Sign-In and One-Tap on Pinterest
    if (
      host === 'accounts.google.com' ||
      host === 'apis.google.com' ||
      host === 'smartlock.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleapis.com') ||
      host.endsWith('.gstatic.com')
    ) return true;
    // reCAPTCHA on Pinterest
    if (host === 'recaptcha.net' || host.endsWith('.recaptcha.net') || (host === 'www.google.com' && request.pathname.startsWith('/recaptcha/'))) return true;
    // Facebook login on Pinterest
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'connect.facebook.net') return true;
    return false;
  } catch { return false; }
}

export function isGoogleFederatedSignInRequest(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const top = new URL(topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.port || top.port || request.username || request.password || top.username || top.password) return false;
    const host = request.hostname.toLowerCase();
    const topHost = top.hostname.toLowerCase();
    if (topHost.endsWith('.test') || topHost.endsWith('.example')) return false;

    if (host === 'accounts.google.com') {
      return /^\/(?:gsi|_|ListAccounts|rotatecookies|o\/oauth2|oauth2|embedded|signin|ServiceLogin|AccountChooser)(?:\/|$)/i.test(request.pathname);
    }
    if (host === 'smartlock.google.com' || host === 'apis.google.com') {
      return true;
    }
    return false;
  } catch { return false; }
}

export function shouldStripThirdPartyCookies(input: {
  requestUrl: string;
  topLevelUrl: string;
  resourceType: string;
  isPrivate: boolean;
  enabled: boolean;
  exceptions?: string[];
  googleSignInCompatibility?: boolean;
}): boolean {
  // Main navigations must be able to set and send their first-party login cookies.
  if (input.resourceType === 'mainFrame' || (!input.isPrivate && !input.enabled)) return false;
  const requestSite = getSiteKey(input.requestUrl);
  const topSite = getSiteKey(input.topLevelUrl);
  if (!requestSite) return false;
  // An absent/opaque initiator must not silently disable protection.
  if (!topSite) return true;
  if (!input.isPrivate && input.exceptions?.includes(topSite)) return false;
  if (!input.isPrivate && input.googleSignInCompatibility !== false && (
    isGoogleFederatedSignInRequest(input.requestUrl, input.topLevelUrl) ||
    isGoogleYouTubeSignInRequest(input.requestUrl, input.topLevelUrl) ||
    isPinterestSignInOrVerification(input.requestUrl, input.topLevelUrl)
  )) return false;
  return requestSite !== topSite;
}

/** Only known sign-in frames or a user's explicit site exception can request access. */
export function canRequestStorageAccess(input: {
  requestUrl: string; topLevelUrl: string; isPrivate: boolean;
  exceptions?: string[]; googleSignInCompatibility?: boolean;
}): boolean {
  if (input.isPrivate) return false;
  try {
    const request = new URL(input.requestUrl);
    const top = new URL(input.topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.username || request.password || top.username || top.password) return false;
    return Boolean(input.exceptions?.includes(getSiteKey(top.href) || '')) ||
      (input.googleSignInCompatibility !== false && (
        isGoogleFederatedSignInRequest(request.href, top.href) ||
        isGoogleYouTubeSignInRequest(request.href, top.href) ||
        isPinterestSignInOrVerification(request.href, top.href)
      ));
  } catch { return false; }
}

/** Identify Google's documented embedded-browser/OAuth restriction, not a generic network failure. */
export function getGoogleAuthNotice(rawUrl: string): { title: string; message: string } | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'accounts.google.com') return null;
    const denied = /\/(?:rejected|deniedsigninrejected)(?:\/|$)/i.test(url.pathname) || /^(?:disallowed_useragent|deniedsigninrejected)$/i.test(url.searchParams.get('error') || '');
    // A normal sign-in page is not an error. Do not pre-empt the website's flow
    // with an external-browser suggestion before Google has reported rejection.
    if (!denied) return null;
    return {
      title: 'Google ограничил вход в этом браузере',
      message: 'Страница Google сообщает об отказе во входе. Открытие в другом браузере не переносит авторизацию обратно в soulm8te автоматически.',
    };
  } catch { return null; }
}

/** Rejected-login error URLs are not useful entry points in a supported browser. */
export function getExternalPageUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.hostname === 'accounts.google.com' && /\/(?:rejected|deniedsigninrejected)(?:\/|$)/i.test(url.pathname)) {
      let destination = 'https://www.google.com/';
      try {
        const target = new URL(url.searchParams.get('continue') || '');
        if (target.protocol === 'https:' && (target.hostname === 'youtube.com' || target.hostname.endsWith('.youtube.com'))) destination = 'https://www.youtube.com/';
      } catch { /* Use the standard Google landing page. */ }
      return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(destination)}`;
    }
    return url.href;
  } catch { return null; }
}
