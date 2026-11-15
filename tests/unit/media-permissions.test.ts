import { describe, expect, it, vi } from 'vitest';
import { captureOrigin, captureKinds, isTrustedCaptureUI, MediaPermissionGrants, requestSystemCapture } from '../../src/main/services/MediaPermissions';

describe('capture permission policy', () => {
  it('accepts HTTPS and loopback secure contexts, rejects insecure and opaque origins', () => {
    for (const url of ['https://site.test/path', 'http://localhost:8000', 'http://dev.localhost:8000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) expect(captureOrigin(url)).toBe(new URL(url).origin);
    for (const url of ['http://site.test', 'http://localhost.evil.test', 'http://192.168.1.2', 'file:///test', 'data:text/plain,hello', 'broken']) expect(captureOrigin(url)).toBeUndefined();
  });
  it('requires trusted contents AND the actual shell requesting origin', () => {
    expect(isTrustedCaptureUI('app://shell/index.html?view=voodoo', true)).toBe(true);
    expect(isTrustedCaptureUI('https://remote.test', true)).toBe(false);
    expect(isTrustedCaptureUI('app://shell/index.html', false)).toBe(false);
    expect(isTrustedCaptureUI('app://other/', true)).toBe(false);
  });
  it('fails closed for unknown capture types and does not confuse media with DRM', () => {
    expect(captureKinds('media', ['audio', 'video', 'audio'])).toEqual(['audio', 'video']);
    expect(captureKinds('media', ['unknown'])).toEqual([]);
    expect(captureKinds('media')).toEqual([]);
    expect(captureKinds('mediaKeySystem', ['audio'])).toEqual([]);
    expect(captureKinds('audioCapture')).toEqual(['audio']);
  });
  it('separates audio/video, embedding origin, requesting origin, and private sessions', () => {
    const grants = new MediaPermissionGrants();
    expect(grants.has('https://top.test', 'https://embed.test', ['audio'])).toBe(false);
    grants.allow('https://top.test/a', 'https://embed.test/b', ['audio']);
    expect(grants.has('https://top.test/c', 'https://embed.test/d', ['audio'])).toBe(true);
    expect(grants.has('https://top.test', 'https://embed.test', ['video'])).toBe(false);
    expect(grants.has('https://top.test', 'https://embed.test', ['audio', 'video'])).toBe(false);
    expect(grants.has('https://other.test', 'https://embed.test', ['audio'])).toBe(false);
    expect(grants.has('https://top.test', 'https://other.test', ['audio'])).toBe(false);
    expect(new MediaPermissionGrants().has('https://top.test', 'https://embed.test', ['audio'])).toBe(false);
    grants.allow('https://top.test', 'https://embed.test', ['video']);
    expect(grants.has('https://top.test', 'https://embed.test', ['audio', 'video'])).toBe(true);
  });
  it('resets only the selected top-level site, all its frames, and invalidates pending decisions', () => {
    const grants = new MediaPermissionGrants();
    const privateGrants = new MediaPermissionGrants();
    grants.allow('https://site.test', 'https://site.test', ['audio']);
    grants.allow('https://site.test', 'https://embed.test', ['video']);
    grants.allow('https://other.test', 'https://embed.test', ['audio']);
    privateGrants.allow('https://site.test', 'https://site.test', ['audio']);
    const revision = grants.revision('https://site.test');
    grants.reset('https://site.test/path');
    expect(grants.has('https://site.test', 'https://site.test', ['audio'])).toBe(false);
    expect(grants.has('https://site.test', 'https://embed.test', ['video'])).toBe(false);
    expect(grants.has('https://other.test', 'https://embed.test', ['audio'])).toBe(true);
    expect(privateGrants.has('https://site.test', 'https://site.test', ['audio'])).toBe(true);
    expect(grants.revision('https://site.test')).toBe(revision + 1);
  });
  it('respects macOS denial and asks only for requested devices', async () => {
    const ask = vi.fn(async () => true);
    expect(await requestSystemCapture(['audio'], 'linux', ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(await requestSystemCapture(['audio'], 'darwin', ask)).toBe(true);
    expect(ask).toHaveBeenCalledExactlyOnceWith('microphone');
    expect(await requestSystemCapture(['video'], 'darwin', async () => false)).toBe(false);
    expect(await requestSystemCapture(['audio'], 'darwin', async () => { throw new Error('unavailable'); })).toBe(false);
  });
});
