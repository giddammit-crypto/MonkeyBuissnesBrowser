import { useEffect, useState } from 'react';

export const REPOSITORY = 'https://github.com/giddammit-crypto/MonkeyBuissnesBrowser';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/giddammit-crypto/MonkeyBuissnesBrowser/releases/latest';
export interface BrowserRelease {
  version: string;
  releaseUrl: string;
  deb?: string;
  appImage?: string;
  checksums?: string;
}
export const FALLBACK_RELEASE: BrowserRelease = {
  version: '1.0.1',
  releaseUrl: `${REPOSITORY}/releases/tag/v1.0.1`,
  deb: `${REPOSITORY}/releases/download/v1.0.1/soulm8te-1.0.1-linux-amd64.deb`,
  appImage: `${REPOSITORY}/releases/download/v1.0.1/soulm8te-1.0.1-linux-x86_64.AppImage`,
  checksums: `${REPOSITORY}/releases/download/v1.0.1/SHA256SUMS`,
};

function releaseUrl(value: unknown, kind: 'download' | 'tag'): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) return undefined;
    if (!url.pathname.startsWith(`/giddammit-crypto/MonkeyBuissnesBrowser/releases/${kind}/`)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function parseRelease(value: unknown): BrowserRelease | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (data.draft === true || data.prerelease === true || typeof data.tag_name !== 'string'
    || !/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.tag_name) || !Array.isArray(data.assets)) return undefined;
  const page = releaseUrl(data.html_url, 'tag');
  if (!page) return undefined;
  const assets = data.assets.filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === 'object');
  const select = (test: (name: string) => boolean) => {
    const asset = assets.find(asset => typeof asset.name === 'string' && test(asset.name) && releaseUrl(asset.browser_download_url, 'download'));
    return asset ? releaseUrl(asset.browser_download_url, 'download') : undefined;
  };
  const x64 = (name: string) => /(?:^|[-_])(?:amd64|x86_64|x64)(?:[-_.]|$)/i.test(name) && !/arm|aarch/i.test(name);
  return {
    version: data.tag_name.replace(/^v/, ''), releaseUrl: page,
    deb: select(name => /\.deb$/i.test(name) && x64(name)),
    appImage: select(name => /\.AppImage$/i.test(name) && x64(name)),
    checksums: select(name => /^SHA256SUMS(?:\.txt)?$/i.test(name)),
  };
}

export function useLatestRelease() {
  const [release, setRelease] = useState(FALLBACK_RELEASE);
  const [status, setStatus] = useState<'loading' | 'live' | 'fallback'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    void fetch(LATEST_RELEASE_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(async response => {
        if (!response.ok) throw new Error('Release unavailable');
        const parsed = parseRelease(await response.json());
        if (!parsed) throw new Error('Invalid release metadata');
        if (current) { setRelease(parsed); setStatus('live'); }
      }).catch(() => { if (current) setStatus('fallback'); })
      .finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, []);
  return { release, status };
}
