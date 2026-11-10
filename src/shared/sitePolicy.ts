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

/** Canonical secure origin used for per-site permissions such as notifications. */
export function normalizePermissionOrigin(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.origin;
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
      return /^\/(?:gsi|_|ListAccounts|rotatecookies|o\/oauth2|oauth2|embedded|(?:v3\/)?signin|ServiceLogin|AccountChooser)(?:\/|$)/i.test(request.pathname);
    }
    if (host === 'smartlock.google.com' || host === 'apis.google.com') {
      return true;
    }
    return false;
  } catch { return false; }
}

export function isFederatedSSOSignInRequest(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const top = new URL(topLevelUrl);
    if (request.protocol !== 'https:' || top.protocol !== 'https:' || request.port || top.port || request.username || request.password || top.username || top.password) return false;
    const host = request.hostname.toLowerCase();
    const topHost = top.hostname.toLowerCase();
    if (topHost.endsWith('.test') || topHost.endsWith('.example')) return false;

    // VK ID
    if (host === 'id.vk.com' || host === 'oauth.vk.com' || host === 'vk.com') {
      return /^\/(?:authorize|oauth|auth|widget_auth)(?:\/|$)/i.test(request.pathname);
    }
    // Yandex ID / Passport
    if (host === 'oauth.yandex.ru' || host === 'passport.yandex.ru') {
      return /^\/(?:authorize|auth|am)(?:\/|$)/i.test(request.pathname);
    }
    // Apple ID
    if (host === 'appleid.apple.com') {
      return /^\/auth\//i.test(request.pathname);
    }
    // Telegram OAuth
    if (host === 'oauth.telegram.org') {
      return /^\/auth/i.test(request.pathname);
    }
    // Microsoft Entra / Live ID
    if (host === 'login.microsoftonline.com' || host === 'login.live.com') {
      return /^\/(?:common|consumers|organizations|[a-f0-9-]+)\/oauth2/i.test(request.pathname) || /^\/oauth20_/i.test(request.pathname);
    }
    return false;
  } catch { return false; }
}

/** Check if the request is for Cloudflare Turnstile, Challenge or major CAPTCHA services */
export function isBotVerificationOrCaptchaRequest(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    // Universal Cloudflare challenge platform endpoints hosted on first-party or third-party domains
    if (pathname.includes('/cdn-cgi/challenge-platform/') ||
        pathname.includes('/cdn-cgi/turnstile/') ||
        pathname.includes('/cdn-cgi/challenges/')) {
      return true;
    }

    // Cloudflare domains
    if (hostname === 'challenges.cloudflare.com' ||
        hostname.endsWith('.cloudflare.com') ||
        hostname === 'cloudflarechallenge.com' ||
        hostname.endsWith('.cloudflarechallenge.com')) {
      return true;
    }

    // Google reCAPTCHA
    if ((hostname === 'recaptcha.net' || hostname.endsWith('.recaptcha.net')) ||
        ((hostname === 'google.com' || hostname.endsWith('.google.com') ||
          hostname === 'gstatic.com' || hostname.endsWith('.gstatic.com')) &&
         pathname.includes('/recaptcha/'))) {
      return true;
    }

    // hCaptcha
    if (hostname === 'hcaptcha.com' ||
        hostname.endsWith('.hcaptcha.com') ||
        hostname === 'hmt.im' ||
        hostname.endsWith('.hmt.im')) {
      return true;
    }

    // Yandex SmartCaptcha
    if (hostname === 'smartcaptcha.yandexcloud.net' ||
        hostname === 'captcha-api.yandex.ru' ||
        hostname.endsWith('.captcha-api.yandex.ru') ||
        hostname === 'smartcaptcha.yandex.ru' ||
        hostname.endsWith('.smartcaptcha.yandex.ru')) {
      return true;
    }

    // Arkose Labs / FunCaptcha
    if (hostname === 'arkoselabs.com' ||
        hostname.endsWith('.arkoselabs.com') ||
        hostname === 'arkoselabs.net' ||
        hostname.endsWith('.arkoselabs.net') ||
        hostname === 'funcaptcha.com' ||
        hostname.endsWith('.funcaptcha.com') ||
        hostname === 'arkose.com' ||
        hostname.endsWith('.arkose.com')) {
      return true;
    }

    // GeeTest
    if (hostname === 'geetest.com' ||
        hostname.endsWith('.geetest.com')) {
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
  // Bot verification and CAPTCHA providers (Cloudflare Turnstile/Challenge, reCAPTCHA, hCaptcha, Yandex SmartCaptcha, etc.)
  // rely on session/clearance cookies to verify human presence. Stripping cookies causes verification loops.
  if (isBotVerificationOrCaptchaRequest(input.requestUrl)) return false;
  const requestSite = getSiteKey(input.requestUrl);
  const topSite = getSiteKey(input.topLevelUrl);
  if (!requestSite) return false;
  // An absent/opaque initiator must not silently disable protection.
  if (!topSite) return true;
  if (!input.isPrivate && input.exceptions?.includes(topSite)) return false;
  if (!input.isPrivate && input.googleSignInCompatibility !== false && (
    isGoogleFederatedSignInRequest(input.requestUrl, input.topLevelUrl) ||
    isGoogleYouTubeSignInRequest(input.requestUrl, input.topLevelUrl) ||
    isPinterestSignInOrVerification(input.requestUrl, input.topLevelUrl) ||
    isFederatedSSOSignInRequest(input.requestUrl, input.topLevelUrl)
  )) return false;
  return requestSite !== topSite;
}

/** Only known sign-in frames, bot verification widgets, or a user's explicit site exception can request access. */
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
      isBotVerificationOrCaptchaRequest(request.href) ||
      (input.googleSignInCompatibility !== false && (
        isGoogleFederatedSignInRequest(request.href, top.href) ||
        isGoogleYouTubeSignInRequest(request.href, top.href) ||
        isPinterestSignInOrVerification(request.href, top.href) ||
        isFederatedSSOSignInRequest(request.href, top.href)
      ));
  } catch { return false; }
}

function isRejectedGoogleSignIn(url: URL): boolean {
  return url.origin === 'https://accounts.google.com' && !url.username && !url.password && (
    /\/(?:rejected|deniedsigninrejected)(?:\/|$)/i.test(url.pathname) ||
    /^(?:disallowed_useragent|deniedsigninrejected)$/i.test(url.searchParams.get('error') || '')
  );
}

/** Identify Google's embedded-browser/OAuth restriction. */
export function getGoogleAuthNotice(rawUrl: string): { title: string; message: string } | null {
  const url = URL.parse(rawUrl);
  if (!url || !isRejectedGoogleSignIn(url)) return null;
  return {
    title: 'Google отклонил вход',
    message: 'Продолжите вход в системном браузере. Сессия останется в том браузере, в котором вы войдёте.',
  };
}

const googleSignInDestinations = new Map([
  ['youtube.com', 'https://www.youtube.com/'],
  ['www.youtube.com', 'https://www.youtube.com/'],
  ['m.youtube.com', 'https://www.youtube.com/'],
  ['mail.google.com', 'https://mail.google.com/'],
  ['drive.google.com', 'https://drive.google.com/'],
]);
const googleSignInServices = new Map([
  ['youtube', 'https://www.youtube.com/'],
  ['mail', 'https://mail.google.com/'],
  ['wise', 'https://drive.google.com/'],
]);

/** Start a fresh sign-in at a known Google service after rejection. */
export function getExternalPageUrl(rawUrl: string): string | null {
  const url = URL.parse(rawUrl);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (!isRejectedGoogleSignIn(url)) return url.href;

  const target = URL.parse(url.searchParams.get('continue') || '');
  const continued = target?.protocol === 'https:' && !target.port && !target.username && !target.password
    ? googleSignInDestinations.get(target.hostname)
    : undefined;
  const destination = continued || googleSignInServices.get(url.searchParams.get('service') || '') || 'https://www.google.com/';
  return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(destination)}`;
}
