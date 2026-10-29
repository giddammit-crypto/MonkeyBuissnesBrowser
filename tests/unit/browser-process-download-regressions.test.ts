import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }));
vi.mock('electron', () => ({
  app: { getAppMetrics: vi.fn(() => []), getPath: vi.fn(() => os.tmpdir()) }, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { app } from 'electron';
import { BrowserController } from '../../src/main/tabs/BrowserController';

function fixture() {
  const controller = Object.create(BrowserController.prototype) as any;
  vi.mocked(app.getAppMetrics).mockReturnValue([
    { pid: 4242, type: 'Tab' }, { pid: 4343, type: 'Tab' }, { pid: 4444, type: 'Utility' },
  ] as any);
  Object.assign(controller, {
    tabs: new Map(), activeTabId: 'active', disposed: false,
    shellView: { webContents: { isDestroyed: () => false, getOSProcessId: () => 4242 } },
    getTaskManagerMetrics: vi.fn(() => ({ sampledAt: 1, processes: [
      { pid: process.pid, type: 'browser', isKillable: false },
      { pid: 4242, type: 'shell', isKillable: false },
      { pid: 4343, type: 'tab', isKillable: true },
      { pid: 4444, type: 'utility', isKillable: true },
    ] })),
  });
  return controller;
}
afterEach(() => vi.restoreAllMocks());

describe('Browser task manager process authority', () => {
  it.each([0, -1, Number.NaN, 1.5, 99999999])('never sends a signal to an invalid or unowned PID %s', pid => {
    const controller = fixture();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(controller.killProcess(pid)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('protects the shell even when a page shares its renderer process', () => {
    const controller = fixture();
    const crash = vi.fn();
    controller.tabs.set('shared', { view: { webContents: { isDestroyed: () => false, getOSProcessId: () => 4242, forcefullyCrashRenderer: crash } } });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(controller.killProcess(4242)).toBe(false);
    expect(crash).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('only signals an enumerated browser-owned utility process and handles a native failure', () => {
    const controller = fixture();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(controller.killProcess(4444)).toBe(true);
    expect(kill).toHaveBeenCalledExactlyOnceWith(4444);
    kill.mockImplementation(() => { throw new Error('Process exited'); });
    expect(controller.killProcess(4444)).toBe(false);
  });

  it('crashes a known killable page renderer through its owning WebContents', () => {
    const controller = fixture();
    const crash = vi.fn();
    controller.tabs.set('known', { view: { webContents: { isDestroyed: () => false, getOSProcessId: () => 4343, forcefullyCrashRenderer: crash } } });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(controller.killProcess(4343)).toBe(true);
    expect(crash).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });
});


describe('Browser download retry profile isolation', () => {
  function downloadsFixture(isPrivate: boolean, kind = 'file') {
    const controller = fixture();
    const ordinary = { downloadURL: vi.fn() };
    const privateSession = { downloadURL: vi.fn() };
    Object.assign(controller, {
      browserSession: ordinary, privateSession, privateProxyReady: Promise.resolve(),
      downloads: [{ id: 'retry', url: 'https://download.example/file', filename: 'file.bin', state: 'interrupted', isPrivate, kind }],
      downloadWithYtDlp: vi.fn().mockResolvedValue(undefined),
    });
    controller.tabs.set('active', { isPrivate: !isPrivate, view: { webContents: { isDestroyed: () => false, downloadURL: vi.fn() } } });
    return { controller, ordinary, privateSession };
  }

  it('retries an ordinary download in its ordinary session while a private tab is active', () => {
    const { controller, ordinary, privateSession } = downloadsFixture(false);
    controller.retryDownload('retry');
    expect(ordinary.downloadURL).toHaveBeenCalledExactlyOnceWith('https://download.example/file');
    expect(privateSession.downloadURL).not.toHaveBeenCalled();
  });

  it('waits for private proxy readiness and keeps a private retry out of ordinary tabs', async () => {
    const { controller, ordinary, privateSession } = downloadsFixture(true);
    let ready!: () => void;
    controller.privateProxyReady = new Promise<void>(resolve => { ready = resolve; });
    controller.retryDownload('retry');
    expect(privateSession.downloadURL).not.toHaveBeenCalled();
    expect(ordinary.downloadURL).not.toHaveBeenCalled();
    ready();
    await controller.privateProxyReady;
    await Promise.resolve();
    expect(privateSession.downloadURL).toHaveBeenCalledExactlyOnceWith('https://download.example/file');
    expect(ordinary.downloadURL).not.toHaveBeenCalled();
  });

  it('does not recreate an ended private session or replay a queued retry after it closes', async () => {
    const { controller, ordinary, privateSession } = downloadsFixture(true);
    let ready!: () => void;
    controller.privateProxyReady = new Promise<void>(resolve => { ready = resolve; });
    controller.retryDownload('retry');
    controller.privateSession = undefined;
    ready();
    await controller.privateProxyReady;
    await Promise.resolve();
    expect(privateSession.downloadURL).not.toHaveBeenCalled();
    expect(ordinary.downloadURL).not.toHaveBeenCalled();
    expect(() => controller.retryDownload('retry')).toThrow(/сессия завершена/);
    expect(ordinary.downloadURL).not.toHaveBeenCalled();
  });

  it('preserves private ownership when retrying audio and video downloads', () => {
    for (const kind of ['audio', 'video']) {
      const { controller, ordinary, privateSession } = downloadsFixture(true, kind);
      controller.retryDownload('retry');
      expect(controller.downloadWithYtDlp).toHaveBeenCalledExactlyOnceWith('https://download.example/file', 'file.bin', kind === 'audio', true);
      expect(ordinary.downloadURL).not.toHaveBeenCalled();
      expect(privateSession.downloadURL).not.toHaveBeenCalled();
    }
  });

  it('does not replay unsafe saved download URLs', () => {
    const { controller, ordinary, privateSession } = downloadsFixture(false);
    controller.downloads[0].url = 'javascript:alert(1)';
    controller.retryDownload('retry');
    expect(ordinary.downloadURL).not.toHaveBeenCalled();
    expect(privateSession.downloadURL).not.toHaveBeenCalled();
    expect(controller.downloadWithYtDlp).not.toHaveBeenCalled();
  });
});


describe('Download cancellation and deletion integrity', () => {
  it('resumes a stopped downloader before terminating it and escalates if it does not exit', () => {
    vi.useFakeTimers();
    try {
      const controller = fixture();
      const child = Object.assign(new EventEmitter(), { kill: vi.fn(), exitCode: null, signalCode: null });
      const entry = { id: 'video', state: 'progressing', isPaused: true };
      Object.assign(controller, { downloads: [entry], ytDlpProcesses: new Map([['video', { child, isPaused: true }]]), persistDownloads: vi.fn(), emitSnapshot: vi.fn() });
      controller.controlDownload('video', 'cancel');
      expect(child.kill.mock.calls).toEqual([['SIGCONT'], ['SIGTERM']]);
      expect(entry).toMatchObject({ state: 'cancelled', isPaused: false, isLive: false, canResume: false });
      vi.advanceTimersByTime(2000);
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    } finally { vi.useRealTimers(); }
  });
  it('keeps a download entry when file deletion fails', () => {
    const controller = fixture();
    const entry = { id: 'file', path: '/protected/file' };
    Object.assign(controller, { downloads: [entry], ytDlpProcesses: new Map(), liveDownloads: new Map(), persistDownloads: vi.fn(), emitSnapshot: vi.fn() });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EACCES'); });
    expect(() => controller.deleteDownload('file', true)).toThrow(/Запись загрузки сохранена/);
    expect(controller.downloads).toEqual([entry]);
  });
});


it('keeps cancelled state when yt-dlp later emits close with a nonzero exit', async () => {
  const controller = fixture();
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), exitCode: null, signalCode: null });
  vi.mocked(spawn).mockReturnValue(child as never);
  Object.assign(controller, {
    browserSession: {}, downloads: [], ytDlpProcesses: new Map(), mediaCookieCleanup: new Map(),
    emitSnapshot: vi.fn(), persistDownloads: vi.fn(),
    getCookieArgsForUrl: vi.fn(async () => ({ args: [], cleanup: vi.fn() })),
  });
  await controller.downloadWithYtDlp('https://www.youtube.com/watch?v=fixture');
  const entry = controller.downloads[0];
  controller.controlDownload(entry.id, 'cancel');
  child.emit('close', 1);
  expect(entry).toMatchObject({ state: 'cancelled', isLive: false, isPaused: false, canResume: false, error: 'Загрузка отменена.' });
});
