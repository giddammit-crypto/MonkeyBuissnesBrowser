const MEDIA_EXTENSIONS = new Set([
  '.apng',
  '.avi',
  '.aac',
  '.avif',
  '.flac',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.m4a',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.m3u',
  '.m3u8',
  '.ogg',
  '.ogv',
  '.png',
  '.svg',
  '.webm',
  '.webp',
  '.wav',
  '.3gp',
  '.ts',
]);

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export type VideoSite = 'youtube' | 'rutube' | 'vk';

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function videoSiteForUrl(rawUrl: string): VideoSite | null {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (isHostOrSubdomain(host, 'youtube.com') || host === 'youtu.be') return 'youtube';
    if (isHostOrSubdomain(host, 'rutube.ru')) return 'rutube';
    if (isHostOrSubdomain(host, 'vk.com') || isHostOrSubdomain(host, 'vkvideo.ru')) return 'vk';
    return null;
  } catch {
    return null;
  }
}

export function isVideoPageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const site = videoSiteForUrl(rawUrl);
    if (!site) return false;
    const pathname = url.pathname.toLowerCase();
    if (site === 'youtube') return url.hostname.toLowerCase().endsWith('youtu.be') || /^\/(?:watch|shorts|live|embed)(?:\/|$)/.test(pathname) || url.searchParams.has('v');
    if (site === 'rutube') return /^\/(?:video|shorts)(?:\/|$)/.test(pathname);
    return /^\/(?:video|clip)(?:\/|$)/.test(pathname) || /(?:^|[?&#])z=(?:video|clip)/i.test(url.search);
  } catch {
    return false;
  }
}

export function mediaKindForMime(mimeType: string): MediaKind {
  const mime = mimeType.toLowerCase().split(';', 1)[0];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export function isSafeMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    // Credentials in a download URL are both unnecessary for Chromium's
    // session-backed downloads and an easy way to accidentally leak secrets
    // into logs/history or a third-party downloader.
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && isLikelyMediaUrl(url);
  } catch {
    return false;
  }
}

export function isLikelyMediaUrl(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  return Array.from(MEDIA_EXTENSIONS).some((extension) => pathname.endsWith(extension));
}

export function mediaKindForUrl(rawUrl: string): MediaKind {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.apng', '.svg'].some((extension) => pathname.endsWith(extension))) {
      return 'image';
    }
    if (['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi', '.3gp', '.ts', '.m3u', '.m3u8'].some((extension) => pathname.endsWith(extension))) {
      return 'video';
    }
    if (['.mp3', '.ogg', '.wav', '.aac', '.flac', '.m4a'].some((extension) => pathname.endsWith(extension))) {
      return 'audio';
    }
  } catch {
    // The caller validates the URL before using this helper.
  }
  return 'file';
}
