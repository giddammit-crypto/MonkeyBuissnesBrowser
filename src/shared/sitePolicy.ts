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

/** YouTube's account hand-off crosses registrable domains. Never allow all Google traffic. */
export function isGoogleYouTubeSignInRequest(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const top = new URL(topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.port || top.port || request.username || request.password || top.username || top.password) return false;
    const topSite = getSiteKey(top.href);
    const accountHost = request.hostname === 'accounts.google.com' || request.hostname === 'accounts.youtube.com';
    if (topSite === 'https://youtube.com' && accountHost) return true;
    if (topSite !== 'https://google.com') return false;
    return request.hostname === 'accounts.youtube.com' ||
      (['youtube.com', 'www.youtube.com'].includes(request.hostname) && request.pathname.startsWith('/accounts/'));
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
  if (!input.isPrivate && input.googleSignInCompatibility !== false && isGoogleYouTubeSignInRequest(input.requestUrl, input.topLevelUrl)) return false;
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
      (input.googleSignInCompatibility !== false && isGoogleYouTubeSignInRequest(request.href, top.href));
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
      message: 'Страница Google сообщает об отказе во входе. Открытие в другом браузере не переносит авторизацию обратно в SOUL-M8TE автоматически.',
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
