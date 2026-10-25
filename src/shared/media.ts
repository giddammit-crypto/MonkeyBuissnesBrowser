const MEDIA_EXTENSIONS = new Set([
  '.apng',
  '.avi',
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.ogv',
  '.png',
  '.svg',
  '.webm',
  '.webp',
  '.wav',
]);

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

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
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLikelyMediaUrl(url);
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
    if (['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv', '.avi'].some((extension) => pathname.endsWith(extension))) {
      return 'video';
    }
    if (['.mp3', '.ogg', '.wav'].some((extension) => pathname.endsWith(extension))) {
      return 'audio';
    }
  } catch {
    // The caller validates the URL before using this helper.
  }
  return 'file';
}
