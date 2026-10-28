import { describe, expect, it } from 'vitest';
import { getFaviconSources, isPrivateHost } from '../../src/renderer/SiteFavicon';

describe('SiteFavicon source resolver & privacy filter', () => {
  it('correctly detects private/local network hosts', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('myserver.local')).toBe(true);
    expect(isPrivateHost('internal.service.internal')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('10.0.0.5')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);

    expect(isPrivateHost('vk.com')).toBe(false);
    expect(isPrivateHost('vk.ru')).toBe(false);
    expect(isPrivateHost('ya.ru')).toBe(false);
    expect(isPrivateHost('music.yandex.ru')).toBe(false);
    expect(isPrivateHost('youtube.com')).toBe(false);
    expect(isPrivateHost('google.com')).toBe(false);
  });

  it('uses provided primary favicon when present', () => {
    const { primarySrc, fallbackSrc } = getFaviconSources('https://vk.ru/', 'https://vk.ru/favicon.ico');
    expect(primarySrc).toBe('https://vk.ru/favicon.ico');
    expect(fallbackSrc).toBeNull();
  });

  it('never sends a visited destination to an external favicon lookup', () => {
    for (const url of ['https://vk.ru/', 'https://music.yandex.ru/',
      'https://www.youtube.com/watch?v=123', 'https://private.example.test/secret',
      'http://[::1]/admin', 'http://intranet/']) {
      expect(getFaviconSources(url)).toEqual({ primarySrc: null, fallbackSrc: null });
    }
  });

  it('suppresses external fallback service for local and private addresses', () => {
    const local = getFaviconSources('http://localhost:3000/dashboard');
    expect(local.primarySrc).toBeNull();
    expect(local.fallbackSrc).toBeNull();

    const router = getFaviconSources('http://192.168.0.1/admin');
    expect(router.primarySrc).toBeNull();
    expect(router.fallbackSrc).toBeNull();
  });
});
