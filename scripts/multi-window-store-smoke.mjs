import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-multi-window-stores-'));
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/download')) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fixture.bin"' });
    response.end('multi-window download fixture');
  } else {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>Window fixture ${request.url}</title><h1>Local fixture</h1>`);
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', `--user-data-dir=${profile}`, '.',
  ] });
  const first = await app.firstWindow();
  await first.waitForSelector('.app-shell');
  const invoke = (shell, method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const snapshot = shell => invoke(shell, 'getSnapshot');
  const create = async (shell, pathname, isPrivate = false) => {
    const tab = await invoke(shell, 'createTab', { url: `${base}${pathname}`, isPrivate });
    await expect.poll(async () => (await snapshot(shell)).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
    return tab;
  };
  await create(first, '/old');
  await invoke(first, 'openNewWindow');
  await expect.poll(() => app.windows().filter(window => window.url() === 'app://shell/index.html').length).toBe(2);
  const second = app.windows().find(window => window !== first && window.url() === 'app://shell/index.html');
  await second.waitForSelector('.app-shell');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await invoke(second, 'clearBrowsingHistory');
  assert.deepEqual((await snapshot(first)).history, []);
  await create(first, '/new');
  assert.deepEqual((await snapshot(second)).history.map(entry => entry.url), [`${base}/new`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'browser-data/history.json'), 'utf8')).map(entry => entry.url), [`${base}/new`]);
  console.log('PASS history cleared in another real window stays cleared after a new visit');

  await second.getByRole('button', { name: 'Закладки', exact: true }).click();
  const saved = await invoke(first, 'saveBookmark', { title: 'First bookmark', url: `${base}/saved` });
  assert((await snapshot(second)).bookmarks.some(entry => entry.id === saved.id));
  await expect(second.getByRole('region', { name: 'Менеджер закладок' }).getByRole('button', { name: 'Удалить закладку First bookmark', exact: true })).toBeVisible();
  await invoke(second, 'removeBookmark', saved.id);
  await invoke(first, 'saveBookmark', { title: 'Second bookmark', url: `${base}/second` });
  assert.deepEqual((await snapshot(second)).bookmarks.map(entry => entry.title), ['Second bookmark']);
  console.log('PASS bookmark mutations in two real windows use current shared state');

  const download = async (pathname, name) => {
    const filename = path.join(profile, name);
    await app.evaluate(({ webContents }, { url, filename, base }) => {
      const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url);
      contents.session.once('will-download', (_event, item) => item.setSavePath(filename));
      contents.downloadURL(`${base}/download`);
    }, { url: `${base}${pathname}`, filename, base });
    await expect.poll(async () => (await snapshot(first)).downloads.find(entry => entry.path === filename)?.state).toBe('completed');
    return filename;
  };
  const normalFile = await download('/new', 'normal.bin');
  await expect.poll(async () => (await snapshot(second)).downloads.filter(entry => entry.path === normalFile).length).toBe(1);
  assert.equal((await snapshot(first)).downloads.filter(entry => entry.path === normalFile).length, 1);
  await create(first, '/private', true);
  const privateFile = await download('/private', 'private.bin');
  assert.equal((await snapshot(second)).downloads.some(entry => entry.path === privateFile), false);
  await invoke(second, 'clearFinishedDownloads', false);
  assert.deepEqual((await snapshot(first)).downloads.map(entry => entry.path), [privateFile]);
  assert.equal(fs.readFileSync(normalFile, 'utf8'), 'multi-window download fixture');
  await invoke(first, 'clearFinishedDownloads', true);
  assert.equal((await snapshot(first)).downloads.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'browser-data/downloads.json'), 'utf8')), []);
  console.log('PASS one native download record across two windows, private isolation, deletion synchronization and no resurrection');
  console.log(JSON.stringify({ ok: true, groups: 3 }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
