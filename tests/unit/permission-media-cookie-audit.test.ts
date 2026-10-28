import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { createMediaCookieFile } from '../../src/main/services/MediaCookieFile';
import { permissionRequestGuard } from '../../src/main/services/PermissionRequestGuard';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it('exports cookies in a private directory/file without broadening host-only domains', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cookie-test-'));
  directories.push(root);
  const cookie = { domain: 'www.youtube.com', path: '/', name: 'SID', value: 'FAKE-COOKIE', secure: true, hostOnly: true };
  const jar = createMediaCookieFile([cookie, { ...cookie, domain: '.youtube.com', hostOnly: false, name: 'OTHER' }] as Electron.Cookie[], 'www.youtube.com', root);
  const filename = jar.args[1];
  const text = fs.readFileSync(filename, 'utf8');
  expect(text).toContain('www.youtube.com\tFALSE\t/\tTRUE');
  expect(text).toContain('.youtube.com\tTRUE\t/\tTRUE');
  if (process.platform !== 'win32') {
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filename)).mode & 0o777).toBe(0o700);
  }
  jar.cleanup(); jar.cleanup();
  expect(fs.existsSync(filename)).toBe(false);
  expect(fs.readdirSync(root)).toEqual([]);
});

it('rejects injected Netscape rows and creates no secret file for an empty jar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cookie-invalid-'));
  directories.push(root);
  const jar = createMediaCookieFile([{ domain: 'example.test', path: '/', name: 'bad', value: 'FAKE\nINJECTED' }] as Electron.Cookie[], 'example.test', root);
  expect(jar.args).toEqual([]);
  expect(fs.readdirSync(root)).toEqual([]);
});

function page() {
  const emitter = new EventEmitter();
  const mainFrame: any = { url: 'https://site.test/page', detached: false, processId: 8, routingId: 9 };
  mainFrame.framesInSubtree = [mainFrame];
  const contents = Object.assign(emitter, { mainFrame, getURL: () => mainFrame.url, isDestroyed: () => false });
  return { contents: contents as unknown as Electron.WebContents, emitter, mainFrame };
}

it('binds permission approval to the original document, including same-URL reloads', () => {
  const { contents, emitter, mainFrame } = page();
  const guard = permissionRequestGuard(contents, mainFrame.url);
  expect(guard.current()).toBe(true);
  emitter.emit('did-start-navigation', {}, mainFrame.url, false, true, 8, 9);
  expect(guard.current()).toBe(false);
  guard.dispose();
  expect(emitter.eventNames()).toEqual([]);
});

it('rejects a pending permission after navigation away and back or a renderer crash', () => {
  const first = page();
  const guard = permissionRequestGuard(first.contents, first.mainFrame.url);
  const old = first.mainFrame.url;
  first.mainFrame.url = 'https://other.test/';
  expect(guard.current()).toBe(false);
  first.emitter.emit('did-start-navigation', {}, old, false, true, 8, 9);
  first.mainFrame.url = old;
  expect(guard.current()).toBe(false);
  guard.dispose();
  const second = page();
  const crashed = permissionRequestGuard(second.contents, second.mainFrame.url);
  second.emitter.emit('render-process-gone');
  expect(crashed.current()).toBe(false);
  crashed.dispose();
});

it('tracks the exact requesting child frame and refuses ambiguous or detached frames', () => {
  const { contents, emitter, mainFrame } = page();
  const child = { url: 'https://camera.test/embed', detached: false, processId: 11, routingId: 12 };
  mainFrame.framesInSubtree.push(child);
  const guard = permissionRequestGuard(contents, child.url, false);
  expect(guard.current()).toBe(true);
  emitter.emit('did-start-navigation', {}, child.url, false, false, 11, 12);
  expect(guard.current()).toBe(false);
  guard.dispose();
  mainFrame.framesInSubtree.push({ ...child });
  const ambiguous = permissionRequestGuard(contents, child.url, false);
  expect(ambiguous.current()).toBe(false);
  ambiguous.dispose();
});
