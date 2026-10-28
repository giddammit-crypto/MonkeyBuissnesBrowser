import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-bookmark-export-'));
const destination = path.join(profile, 'exported-bookmarks.html');
const title = 'Библиотека <script> & "Книги"';
const url = 'https://bookmark.fixture.invalid/books?a=1&b=2';
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const bookmark = await invoke('saveBookmark', { title, url });
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
  }, destination);
  await shell.getByRole('button', { name: 'Закладки', exact: true }).click();
  const manager = shell.getByRole('region', { name: 'Менеджер закладок' });
  await manager.getByRole('button', { name: 'Экспорт HTML', exact: true }).click();
  await expect.poll(() => fs.existsSync(destination)).toBe(true);
  const exported = fs.readFileSync(destination, 'utf8');
  assert(exported.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert(exported.includes('&lt;script&gt;'));
  assert(exported.includes('a=1&amp;b=2'));
  assert(!exported.includes('<script>'));
  assert(!exported.includes('voodooKeys'));
  console.log('PASS native bookmark manager exports escaped portable HTML through the real IPC path');

  await invoke('removeBookmark', bookmark.id);
  assert.equal((await invoke('getSnapshot')).bookmarks.some(entry => entry.id === bookmark.id), false);
  await manager.getByRole('button', { name: 'Импорт HTML', exact: true }).click();
  await expect.poll(async () => (await invoke('getSnapshot')).bookmarks.some(entry => entry.title === title && entry.url === url)).toBe(true);
  console.log('PASS exported HTML imports back through the native file picker and preserves Unicode, title and URL');

  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await manager.getByRole('button', { name: 'Экспорт HTML', exact: true }).click();
  await expect(manager.getByText('Экспорт отменён.', { exact: true })).toBeVisible();
  assert.equal(fs.readFileSync(destination, 'utf8'), exported);
  console.log('PASS cancelling export preserves the existing destination');
  console.log(JSON.stringify({ ok: true, groups: 3 }));
} finally {
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
