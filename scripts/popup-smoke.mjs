import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Native WindowProxy/session checks against local pages; no real OAuth provider
// or account is used and this does not prove a Google account can sign in.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-popup-'));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>Popup fixture</title><h1>Native popup fixture</h1><script>
    window.messages=[];
    addEventListener('message',event=>messages.push({data:event.data,origin:event.origin,
      sourceMatches:event.source===window.opener||event.source===window.popup||event.source===window.blank}));
  </script>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', '--host-resolver-rules=MAP *.popup.test 127.0.0.1',
    `--user-data-dir=${profile}`, '.',
  ] });
  await app.evaluate(()=>{globalThis.__popupMainErrors=[];process.on('unhandledRejection', error=>globalThis.__popupMainErrors.push(String(error)));process.on('uncaughtException', error=>globalThis.__popupMainErrors.push(String(error)));});
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const snapshot = () => invoke('getSnapshot');
  const evaluatePage = (url, expression) => app.evaluate(({ webContents }, { url, expression }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url);
    if (!contents) throw new Error(`Missing fixture ${url}`);
    return contents.executeJavaScript(expression);
  }, { url, expression });
  for (const isPrivate of [false, true]) {
    const mode = isPrivate ? 'private' : 'normal';
    const parent = `http://parent.popup.test:${port}/${mode}-opener`;
    const child = `http://child.popup.test:${port}/${mode}-child`;
    const blankChild = `http://child.popup.test:${port}/${mode}-blank-child`;
    const tab = await invoke('createTab', { url: parent, isPrivate });
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
    await app.evaluate(async ({ webContents }, { parent, mode }) => {
      const contents = webContents.getAllWebContents().find(entry => entry.getURL() === parent);
      await contents.session.cookies.set({ url: parent, domain: '.popup.test', path: '/', name: 'mode', value: mode, sameSite: 'lax' });
    }, { parent, mode });
    assert.equal(await evaluatePage(parent, `window.popup=window.open(${JSON.stringify(child)},'oauth-${mode}'); popup!==null`), true, 'window.open must return a real WindowProxy');
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.url === child)?.isLoading).toBe(false);
    const childTab = (await snapshot()).tabs.find(entry => entry.url === child);
    assert.equal(childTab.isPrivate, isPrivate);
    assert.equal(await evaluatePage(child, 'window.opener!==null'), true);
    assert.equal(await evaluatePage(child, 'typeof window.browserApi'), 'undefined');
    assert((await evaluatePage(child, 'document.cookie')).includes(`mode=${mode}`));
    const security = await app.evaluate(({ webContents }, { parent, child }) => {
      const opener = webContents.getAllWebContents().find(entry => entry.getURL() === parent);
      const popup = webContents.getAllWebContents().find(entry => entry.getURL() === child);
      const preferences = popup.getLastWebPreferences();
      return { sameSession: popup.session === opener.session, persistent: popup.session.isPersistent(),
        nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox };
    }, { parent, child });
    assert.deepEqual(security, { sameSession: true, persistent: !isPrivate, nodeIntegration: false, contextIsolation: true, sandbox: true });
    await evaluatePage(child, `opener.postMessage('ready',${JSON.stringify(new URL(parent).origin)}); true`);
    await expect.poll(() => evaluatePage(parent, 'messages')).toContainEqual({ data: 'ready', origin: new URL(child).origin, sourceMatches: true });
    await evaluatePage(parent, `popup.postMessage('reply',${JSON.stringify(new URL(child).origin)}); true`);
    await expect.poll(() => evaluatePage(child, 'messages')).toContainEqual({ data: 'reply', origin: new URL(parent).origin, sourceMatches: true });
    assert.equal(await invoke('hibernateTab', tab.id), false, 'opener must stay alive while authentication popup uses its WindowProxy');
    await evaluatePage(child, 'window.close(); true');
    await expect.poll(async () => (await snapshot()).tabs.some(entry => entry.id === childTab.id)).toBe(false);
    assert((await evaluatePage(parent, 'document.cookie')).includes(`mode=${mode}`), 'closing one popup must not wipe the shared private session');
    const background = `http://child.popup.test:${port}/${mode}-background`;
    await invoke('activateTab', tab.id);
    await evaluatePage(parent, `document.body.insertAdjacentHTML('beforeend', '<a id="background" target="_blank" rel="opener" href="${background}">Background</a>'); true`);
    const parentPage = app.context().pages().find(page => page.url() === parent);
    await parentPage.locator('#background').click({modifiers:[process.platform==='darwin'?'Meta':'Control']});
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.url === background)?.isLoading).toBe(false);
    const backgroundTab = (await snapshot()).tabs.find(entry => entry.url === background);
    assert.equal(backgroundTab.isPrivate, isPrivate);
    assert.equal((await snapshot()).activeTabId, tab.id, 'background popup must not steal active tab');
    await invoke('closeTab', backgroundTab.id);

    assert.deepEqual(await evaluatePage(parent, `window.blank=window.open('about:blank'); ({exists:blank!==null,opener:blank?.opener===window,bridge:typeof blank?.browserApi})`), { exists: true, opener: true, bridge: 'undefined' });
    await evaluatePage(parent, `blank.location.href=${JSON.stringify(blankChild)}; true`);
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.url === blankChild)?.isLoading).toBe(false);
    assert.equal(await evaluatePage(blankChild, 'window.opener!==null'), true);
    await evaluatePage(blankChild, `opener.postMessage('blank-ready',${JSON.stringify(new URL(parent).origin)}); true`);
    await expect.poll(() => evaluatePage(parent, 'messages.some(message=>message.data==="blank-ready" && message.sourceMatches)')).toBe(true);
    const count = (await snapshot()).tabs.length;
    assert.equal(await evaluatePage(parent, `window.open('app://shell/index.html')===null`), true);
    assert.equal((await snapshot()).tabs.length, count, 'privileged shell URLs must remain blocked');
    await invoke('closeTab', tab.id);
    assert.equal(await evaluatePage(blankChild, 'typeof window.browserApi'), 'undefined', 'independent popup survives opener closing without gaining shell privileges');
    const survivor = (await snapshot()).tabs.find(entry => entry.url === blankChild);
    await invoke('closeTab', survivor.id);
    if (isPrivate) {
      assert.equal((await snapshot()).privacy.privateTabCount, 0);
      assert.equal(JSON.stringify(fs.readFileSync(path.join(profile, 'browser-data', 'history.json'), 'utf8')).includes('/private-'), false);
    }
    console.log(`PASS ${mode}: native opener/postMessage, session/security, about:blank navigation, self-close and cleanup`);
  }
  assert.deepEqual(await app.evaluate(()=>globalThis.__popupMainErrors), [], 'popup lifecycle must not raise main-process errors');
  console.log(JSON.stringify({ ok: true, groups: 2, googleAccountSignInTested: false }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
