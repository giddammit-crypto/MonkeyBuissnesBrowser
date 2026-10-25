import { describe, expect, it } from 'vitest';
import { isLikelyMediaUrl, isSafeMediaUrl, mediaKindForMime, mediaKindForUrl } from '../../src/shared/media';

describe('media download URL helpers', () => {
  it('accepts direct public media URLs only', () => {
    expect(isSafeMediaUrl('https://images.example.test/photo.webp')).toBe(true);
    expect(isSafeMediaUrl('https://video.example.test/clip.mp4?token=demo')).toBe(true);
    expect(isSafeMediaUrl('https://example.test/watch/123')).toBe(false);
    expect(isSafeMediaUrl('file:///tmp/clip.mp4')).toBe(false);
  });

  it('classifies direct media links', () => {
    expect(mediaKindForUrl('https://example.test/photo.jpg')).toBe('image');
    expect(mediaKindForUrl('https://example.test/clip.webm')).toBe('video');
    expect(mediaKindForUrl('https://example.test/track.mp3')).toBe('audio');
    expect(mediaKindForUrl('https://example.test/archive.zip')).toBe('file');
    expect(isLikelyMediaUrl(new URL('https://example.test/clip.mp4'))).toBe(true);
  });

  it('classifies downloads by the response MIME type', () => {
    expect(mediaKindForMime('image/jpeg')).toBe('image');
    expect(mediaKindForMime('video/mp4; codecs="avc1"')).toBe('video');
    expect(mediaKindForMime('audio/ogg')).toBe('audio');
    expect(mediaKindForMime('application/octet-stream')).toBe('file');
  });
});
