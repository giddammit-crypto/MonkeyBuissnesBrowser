import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Fake devices provide deterministic samples; the real permission handlers still
// run. Never use --use-fake-ui-for-media-stream: it bypasses consent coverage.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-microphone-'));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>Microphone fixture</title><h1>Microphone fixture</h1>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--use-fake-device-for-media-stream', '--no-proxy-server', `--user-data-dir=${profile}`, '.',
    ],
  });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  await app.evaluate(({ dialog }) => {
    globalThis.__microphoneOriginalDialog = dialog.showMessageBox;
    globalThis.__microphonePrompts = [];
    globalThis.__microphoneResponse = 0;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__microphonePrompts.push(options.message);
      return { response: globalThis.__microphoneResponse, checkboxChecked: false };
    };
  });
  const count = () => app.evaluate(() => globalThis.__microphonePrompts.length);
  const answer = (response) => app.evaluate((_, value) => { globalThis.__microphoneResponse = value; }, response);
  const capture = (url, constraints) => app.evaluate(({ webContents }, { url, constraints }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url);
    assertContents(contents);
    function assertContents(value) { if (!value) throw new Error(`Missing microphone fixture: ${url}`); }
    return contents.executeJavaScript(`(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)});
        const tracks = stream.getTracks().map(track => ({ kind: track.kind, state: track.readyState }));
        stream.getTracks().forEach(track => track.stop());
        return { ok: true, tracks };
      } catch (error) { return { ok: false, name: error.name, message: error.message }; }
    })()`);
  }, { url, constraints });

  for (const isPrivate of [false, true]) {
    const url = `${origin}/${isPrivate ? 'private' : 'normal'}`;
    const tab = await invoke('createTab', { url, isPrivate });
    await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
    const before = await count();
    await answer(0);
    const denied = await capture(url, { audio: true });
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.equal(denied.name, 'NotAllowedError');
    assert.equal(await count(), before + 1, 'each session must independently request microphone consent');

    await answer(1);
    const allowed = await capture(url, { audio: true });
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.deepEqual(allowed.tracks, [{ kind: 'audio', state: 'live' }]);
    const afterAllow = await count();
    assert.equal(afterAllow, before + 2);
    assert.equal((await capture(url, { audio: true })).ok, true);
    assert.equal(await count(), afterAllow, 'session microphone grant must suppress repeated prompts');

    await answer(0);
    const camera = await capture(url, { video: true });
    assert.equal(camera.ok, false, 'microphone consent must not grant camera access');
    assert.equal(camera.name, 'NotAllowedError');
    assert.equal(await count(), afterAllow + 1, 'camera must require separate consent');
    assert.equal((await capture(url, { audio: true })).ok, true, 'camera denial must preserve microphone consent');
    assert.equal(await count(), afterAllow + 1);
    await invoke('closeTab', tab.id);
    console.log(`PASS ${isPrivate ? 'private' : 'normal'}: microphone deny/allow, live audio track, session reuse, camera isolation`);
  }
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.__microphoneOriginalDialog; });
  console.log(JSON.stringify({ ok: true, groups: 2 }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
