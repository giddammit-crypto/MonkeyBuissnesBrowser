import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Uses only disposable local pages and a disposable browser profile.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-split-view-'));
const server = http.createServer((request, response) => {
  const label = new URL(request.url, 'http://fixture.test').pathname.slice(1);
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<title>Split ${label}</title><h1>Split ${label}</h1><input aria-label="Draft ${label}">`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let app;
const failures = [];
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  shell.on('pageerror', error => failures.push(error.message));
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const snapshot = () => invoke('getSnapshot');
  const create = async (name, isPrivate = false) => {
    const tab = await invoke('createTab', { url: `${base}/${name}`, isPrivate });
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
    return tab;
  };
  const nativePanels = () => app.evaluate(({ BaseWindow }, base) => {
    const window = BaseWindow.getAllWindows()[0];
    return window.contentView.children
      .filter(view => view.getVisible() && view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith(base))
      .map(view => ({ url: view.webContents.getURL(), bounds: view.getBounds() }))
      .sort((first, second) => first.url.localeCompare(second.url));
  }, base);
  const setSize = async (width, height) => {
    await app.evaluate(({ BaseWindow }, { width, height }) => BaseWindow.getAllWindows()[0].setContentSize(width, height), { width, height });
  };
  const expectTwoPanels = async (leftUrl, rightUrl, stacked = false) => {
    await expect.poll(async () => {
      const panels = await nativePanels();
      const first = panels.find(panel => panel.url === leftUrl)?.bounds;
      const second = panels.find(panel => panel.url === rightUrl)?.bounds;
      if (!first || !second || panels.length !== 2 || first.width < 50 || second.width < 50 || first.height < 50 || second.height < 50) return false;
      return stacked
        ? first.x === second.x && first.width === second.width && first.y + first.height <= second.y
        : first.y === second.y && first.height === second.height && first.x + first.width <= second.x;
    }).toBe(true);
  };

  await setSize(1280, 900);
  const first = await create('first');
  const second = await create('second');
  await invoke('activateTab', first.id);
  await invoke('setSplitView', second.id);
  await expect.poll(async () => (await snapshot()).splitView?.secondaryTabId).toBe(second.id);
  await expectTwoPanels(first.url, second.url);
  assert.equal((await snapshot()).activeTabId, first.id);
  assert.equal(await invoke('hibernateTab', second.id), false, 'visible secondary must stay alive');
  console.log('PASS native split displays two live pages and protects the secondary from discard');

  const initialPanels = await nativePanels();
  await invoke('setSplitViewRatio', 0.65);
  await expect.poll(async () => (await snapshot()).splitView?.ratio).toBe(0.65);
  await expect.poll(async () => (await nativePanels()).find(panel => panel.url === first.url)?.bounds.width).toBeGreaterThan(initialPanels.find(panel => panel.url === first.url).bounds.width);
  await invoke('setSplitViewRatio', -1);
  const minimum = (await snapshot()).splitView?.ratio;
  assert(Number.isFinite(minimum) && minimum > 0 && minimum < 1, 'invalid ratio cannot collapse a panel');
  await invoke('setSplitViewRatio', 0.5);
  await setSize(620, 850);
  await expectTwoPanels(first.url, second.url, true);
  await setSize(1280, 900);
  await expectTwoPanels(first.url, second.url);
  console.log('PASS split ratio resizing and narrow-window stacked native layout');

  const panePositions = await nativePanels();
  await invoke('activateTab', second.id);
  await expect.poll(async () => (await snapshot()).splitView?.secondaryTabId).toBe(first.id);
  assert.equal((await snapshot()).activeTabId, second.id);
  await expectTwoPanels(first.url, second.url);
  assert.deepEqual(await nativePanels(), panePositions, 'keyboard focus changes must preserve physical pane positions');
  await app.evaluate(({ webContents }, url) => {
    webContents.getAllWebContents().find(contents => contents.getURL() === url).focus();
  }, first.url);
  await expect.poll(async () => (await snapshot()).activeTabId).toBe(first.id);
  assert.equal((await snapshot()).splitView?.secondaryTabId, second.id);
  assert.deepEqual(await nativePanels(), panePositions, 'native page focus must not move either pane');
  console.log('PASS secondary selection and native focus preserve both physical pane positions');

  const privateTab = await create('private', true);
  await invoke('activateTab', second.id);
  await invoke('setSplitView', first.id);
  await assert.rejects(() => invoke('setSplitView', privateTab.id));
  assert.equal((await snapshot()).splitView?.secondaryTabId, first.id);
  const internal = await invoke('createTab');
  await invoke('activateTab', second.id);
  await invoke('setSplitView', first.id);
  await assert.rejects(() => invoke('setSplitView', internal.id));
  assert.equal((await snapshot()).splitView?.secondaryTabId, first.id);
  const workspace = await invoke('createWorkspace', 'Split isolated workspace');
  await invoke('switchWorkspace', workspace.id);
  const otherWorkspace = await create('other-workspace');
  await invoke('activateTab', second.id);
  await invoke('setSplitView', first.id);
  await assert.rejects(() => invoke('setSplitView', otherWorkspace.id));
  assert.equal((await snapshot()).splitView?.secondaryTabId, first.id);
  await assert.rejects(() => invoke('setSplitView', second.id));
  assert.equal((await snapshot()).splitView?.secondaryTabId, first.id, 'a tab cannot split with itself');
  await expectTwoPanels(second.url, first.url);
  console.log('PASS private, internal, foreign-workspace and self split candidates are rejected');

  await invoke('closeTab', first.id);
  await expect.poll(async () => (await snapshot()).splitView).toBeUndefined();
  await expect.poll(async () => (await nativePanels()).map(panel => panel.url)).toEqual([second.url]);
  const third = await create('third');
  await invoke('activateTab', second.id);
  await invoke('setSplitView', third.id);
  await expectTwoPanels(second.url, third.url);
  await invoke('setSplitView');
  await expect.poll(async () => (await snapshot()).splitView).toBeUndefined();
  await expect.poll(async () => (await nativePanels()).map(panel => panel.url)).toEqual([second.url]);
  await invoke('setSplitView', third.id);
  await invoke('closeTab', second.id);
  await expect.poll(async () => (await snapshot()).splitView).toBeUndefined();
  await expect.poll(async () => (await snapshot()).activeTabId).toBe(third.id);
  await expect.poll(async () => (await nativePanels()).map(panel => panel.url)).toEqual([third.url]);
  assert.deepEqual(failures, []);
  console.log('PASS closing either pane or explicitly exiting restores one full-size native page');
  console.log(JSON.stringify({ ok: true, groups: 5 }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
