export interface ParsedWindowFeatures {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  popup?: boolean;
  menubar?: boolean;
  toolbar?: boolean;
  location?: boolean;
  status?: boolean;
  resizable?: boolean;
  scrollbars?: boolean;
}

export function parseWindowFeatures(features?: string): ParsedWindowFeatures {
  if (!features || typeof features !== 'string') return {};
  const result: ParsedWindowFeatures = {};
  const tokens = features.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    const eqIdx = token.indexOf('=');
    let key = token.toLowerCase();
    let val = '';
    if (eqIdx !== -1) {
      key = token.slice(0, eqIdx).trim().toLowerCase();
      val = token.slice(eqIdx + 1).trim().toLowerCase();
    }
    const num = parseInt(val, 10);
    const hasNum = Number.isFinite(num) && num > 0;

    if (key === 'width' || key === 'innerwidth') {
      if (hasNum) result.width = num;
    } else if (key === 'height' || key === 'innerheight') {
      if (hasNum) result.height = num;
    } else if (key === 'left' || key === 'screenx') {
      if (Number.isFinite(num)) result.x = num;
    } else if (key === 'top' || key === 'screeny') {
      if (Number.isFinite(num)) result.y = num;
    } else if (key === 'popup') {
      result.popup = val === '' || val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'menubar') {
      result.menubar = val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'toolbar') {
      result.toolbar = val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'location') {
      result.location = val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'status') {
      result.status = val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'resizable') {
      result.resizable = val === '1' || val === 'yes' || val === 'true';
    } else if (key === 'scrollbars') {
      result.scrollbars = val === '1' || val === 'yes' || val === 'true';
    }
  }
  return result;
}

export function isAuthPopupUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    // Google Sign-In & OAuth
    if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) {
      if (/^\/(?:o\/oauth2|oauth2|signin|servicelogin|accountchooser|v3\/signin|gsi|embedded)(?:\/|$)/i.test(path)) return true;
      if (url.searchParams.has('continue') || url.searchParams.has('client_id')) return true;
      return true;
    }

    // VK ID & OAuth
    if (host === 'oauth.vk.com' || host === 'id.vk.com' || (host.endsWith('.vk.com') && (path.includes('/oauth') || path.includes('/authorize')))) {
      return true;
    }

    // Yandex ID & OAuth
    if (host === 'passport.yandex.ru' || host === 'oauth.yandex.ru' || (host.endsWith('.yandex.ru') && (path.includes('/auth') || path.includes('/oauth')))) {
      return true;
    }

    // Telegram Login Widget
    if (host === 'oauth.telegram.org' || (host === 'telegram.org' && path.startsWith('/auth'))) {
      return true;
    }

    // GitHub OAuth
    if (host === 'github.com' && path.startsWith('/login/oauth')) {
      return true;
    }

    // Apple ID
    if (host === 'appleid.apple.com' && (path.includes('/auth') || path.includes('/sign-in'))) {
      return true;
    }

    // Facebook OAuth Dialog
    if ((host === 'facebook.com' || host === 'www.facebook.com' || host.endsWith('.facebook.com')) && (path.includes('/dialog/oauth') || path.includes('/oauth'))) {
      return true;
    }

    // Twitter / X OAuth
    if ((host === 'twitter.com' || host === 'x.com' || host.endsWith('.twitter.com') || host.endsWith('.x.com')) && path.includes('/oauth')) {
      return true;
    }

    // Discord OAuth
    if (host === 'discord.com' && path.startsWith('/oauth2')) {
      return true;
    }

    // Microsoft / Live / Azure AD
    if (host === 'login.microsoftonline.com' || host === 'login.live.com') {
      return true;
    }

    // Generic OAuth2 patterns (client_id + redirect_uri or response_type)
    if (url.searchParams.has('client_id') && (url.searchParams.has('redirect_uri') || url.searchParams.has('response_type'))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function isPopupWindowRequest(details: {
  url: string;
  disposition?: string;
  features?: string;
}): boolean {
  if (details.disposition === 'new-window') return true;

  const parsed = parseWindowFeatures(details.features);
  if (parsed.width !== undefined || parsed.height !== undefined || parsed.popup) return true;
  if (parsed.menubar === false || parsed.toolbar === false || parsed.location === false || parsed.status === false) return true;

  if (details.disposition !== 'background-tab' && isAuthPopupUrl(details.url)) {
    return true;
  }

  return false;
}

export function computePopupWindowBounds(
  parentBounds: { x: number; y: number; width: number; height: number },
  features: { width?: number; height?: number; x?: number; y?: number }
): { width: number; height: number; x: number; y: number } {
  const defaultWidth = 520;
  const defaultHeight = 640;
  const minWidth = 360;
  const minHeight = 400;

  const rawWidth = features.width ?? defaultWidth;
  const rawHeight = features.height ?? defaultHeight;

  const maxWidth = Math.max(parentBounds.width, 800);
  const maxHeight = Math.max(parentBounds.height, 900);

  const width = Math.min(Math.max(rawWidth, minWidth), maxWidth);
  const height = Math.min(Math.max(rawHeight, minHeight), maxHeight);

  const x = features.x !== undefined && Number.isFinite(features.x)
    ? features.x
    : Math.round(parentBounds.x + Math.max(0, (parentBounds.width - width) / 2));
  const y = features.y !== undefined && Number.isFinite(features.y)
    ? features.y
    : Math.round(parentBounds.y + Math.max(0, (parentBounds.height - height) / 2));

  return { width, height, x, y };
}
