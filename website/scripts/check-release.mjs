import assert from 'node:assert/strict';
import { FALLBACK_RELEASE, parseRelease } from '../src/useLatestRelease.ts';
const root = 'https://github.com/giddammit-crypto/MonkeyBuissnesBrowser';
const asset = (name, version = '1.0.2') => ({ name, browser_download_url: `${root}/releases/download/v${version}/${name}` });
const release = {
  tag_name: 'v1.0.2', html_url: `${root}/releases/tag/v1.0.2`,
  assets: [asset('soulm8te-1.0.2-linux-arm64.deb'), asset('soulm8te-1.0.2-linux-amd64.deb'), asset('soulm8te-1.0.2-linux-x86_64.AppImage'), asset('SHA256SUMS')],
};
const current = parseRelease(release);
assert.equal(current.version, '1.0.2');
assert.match(current.deb, /amd64\.deb$/);
assert.match(current.appImage, /x86_64\.AppImage$/);
assert.match(current.checksums, /SHA256SUMS$/);
assert.equal(parseRelease({ ...release, draft: true }), undefined);
assert.equal(parseRelease({ ...release, prerelease: true }), undefined);
assert.equal(parseRelease({ ...release, tag_name: 'not-a-version' }), undefined);
assert.equal(parseRelease({ ...release, html_url: 'https://untrusted.invalid/releases/tag/v1.0.2' }), undefined);
assert.equal(parseRelease({ ...release, assets: [asset('soulm8te-1.0.2-linux-arm64.deb')] }).deb, undefined);
assert.equal(parseRelease({ ...release, assets: [asset('soulm8te-1.0.2-linux-amd64.deb')] }).appImage, undefined);
assert.equal(parseRelease({ ...release, assets: [{ name: 'browser-amd64.deb', browser_download_url: 'https://untrusted.invalid/browser-amd64.deb' }] }).deb, undefined);
assert.equal(parseRelease({ ...release, assets: [{ name: 'browser-amd64.deb', browser_download_url: `${root.replace('https://', 'http://')}/releases/download/v1.0.2/browser-amd64.deb` }] }).deb, undefined);
assert.equal(FALLBACK_RELEASE.version, '1.0.1');
assert.match(FALLBACK_RELEASE.deb, /\/v1\.0\.1\//);
console.log('PASS latest-release versions, trusted GitHub asset URLs, x86_64 selection and missing-asset fallback boundaries');
