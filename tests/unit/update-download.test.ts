import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, shell } from 'electron';
import { GITHUB_REPO, UpdateService } from '../../src/main/services/UpdateService';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), getVersion: () => '1.2.0' },
  net: {},
  shell: { openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() },
}));

const asset = 'soulm8te-fixture.AppImage';
const url = `https://github.com/${GITHUB_REPO}/releases/download/v1.2.1/${asset}`;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function respond(status: number, headers: Record<string, string>, text?: string) {
  const mock = vi.spyOn(https, 'get');
  mock.mockImplementationOnce(((_url: string, options: { signal: AbortSignal }, callback: (response: unknown) => void) => {
    const response = Object.assign(new PassThrough(), { statusCode: status, headers });
    const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: () => response.destroy() });
    options.signal.addEventListener('abort', () => response.destroy(new Error('aborted')), { once: true });
    queueMicrotask(() => {
      callback(response);
      if (text !== undefined) response.end(text);
    });
    return request;
  }) as typeof https.get);
  return mock;
}

describe('update download lifecycle', () => {
  let directory: string;
  let service: UpdateService;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soulm8te-update-test-'));
    vi.mocked(app.getPath).mockReturnValue(directory);
    service = new UpdateService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('preserves an existing asset, verifies the replacement and rejects tampering on open', async () => {
    const original = path.join(directory, asset);
    fs.writeFileSync(original, 'old');
    respond(302, { location: 'https://release-assets.githubusercontent.com/fixture' }, '');
    respond(200, { 'content-length': '3' }, 'new');
    const result = await service.downloadUpdate(url);
    expect(result.success).toBe(true);
    expect(result.filePath).not.toBe(original);
    expect(fs.readFileSync(original, 'utf8')).toBe('old');
    expect(fs.readFileSync(result.filePath!, 'utf8')).toBe('new');
    expect(fs.readdirSync(directory)).toHaveLength(2);
    await expect(service.openDownloadedUpdate(original)).resolves.toBe(false);
    await expect(service.openDownloadedUpdate(result.filePath!)).resolves.toBe(true);
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith(result.filePath);
    fs.writeFileSync(result.filePath!, 'modified');
    await expect(service.openDownloadedUpdate(result.filePath!)).resolves.toBe(false);
  });

  it('cleans up an incomplete response without touching existing downloads', async () => {
    fs.writeFileSync(path.join(directory, asset), 'keep');
    respond(200, { 'content-length': '20' }, 'short');
    await expect(service.downloadUpdate(url)).resolves.toMatchObject({ success: false, error: expect.stringContaining('неполный') });
    expect(fs.readdirSync(directory)).toEqual([asset]);
    expect(fs.readFileSync(path.join(directory, asset), 'utf8')).toBe('keep');
  });

  it('blocks foreign releases and untrusted redirects', async () => {
    const request = respond(302, { location: 'https://untrusted.invalid/package' }, '');
    await expect(service.downloadUpdate(url.replace(GITHUB_REPO, 'other/repo'))).resolves.toMatchObject({ success: false });
    expect(request).not.toHaveBeenCalled();
    await expect(service.downloadUpdate(url)).resolves.toMatchObject({ success: false, error: expect.stringContaining('недоверенный') });
    expect(request).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('checks the official digest and rejects a same-length mismatch', async () => {
    vi.spyOn(service as unknown as { fetchLatestRelease(): Promise<unknown> }, 'fetchLatestRelease').mockResolvedValue({
      tag_name: 'v1.2.1', assets: [{ name: asset, browser_download_url: url, size: 3, digest: `sha256:${hash('abc')}` }],
    });
    await service.checkForUpdates();
    respond(200, { 'content-length': '3' }, 'def');
    await expect(service.downloadUpdate(url)).resolves.toMatchObject({ success: false, error: expect.stringContaining('сумма') });
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('keeps one active download and resolves cancellation without a partial file', async () => {
    const request = respond(200, {});
    const pending = service.downloadUpdate(url);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect(service.downloadUpdate(url)).resolves.toMatchObject({ success: false, error: expect.stringContaining('уже') });
    service.cancelDownload();
    await expect(pending).resolves.toMatchObject({ success: false, error: 'Загрузка отменена.' });
    expect(service.getDownloadProgress().status).toBe('idle');
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
