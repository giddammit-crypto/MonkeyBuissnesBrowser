import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

// The HTTPS protocol fixture is local and never contacts a real notification
// provider. Native permission dialogs are stubbed only to inspect decisions.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-notifications-'));
let app;
try {
  const launch = async () => electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      `--user-data-dir=${profile}`,
      '.',
    ],
  });
  const setupFixture = async () => {
    await app.evaluate(({ session, dialog }) => {
      const target = session.fromPartition('persist:northstar-default');
      void target.protocol.handle('https', () => new Response(
        '<title>Notification fixture</title><h1>Notification fixture</h1>',
        { headers: { 'content-type': 'text/html' } },
      ));
      globalThis.__notificationPrompts = 0;
      globalThis.__notificationResponse = 0;
      globalThis.__originalNotificationMessageBox = dialog.showMessageBox;
      dialog.showMessageBox = async () => {
        globalThis.__notificationPrompts += 1;
        return { response: globalThis.__notificationResponse, checkboxChecked: false };
      };
    });
  };
  const invoke = (shell, method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const createFixture = async (shell, url) => {
    const tab = await invoke(shell, 'createTab', { url });
    await expect.poll(async () => (await invoke(shell, 'getSnapshot')).tabs.find((entry) => entry.id === tab.id)?.isLoading).toBe(false);
    return tab;
  };
  const requestNotification = (url) => app.evaluate(({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === targetUrl);
    if (!contents) throw new Error(`Missing notification fixture: ${targetUrl}`);
    return contents.executeJavaScript('Notification.requestPermission()');
  }, url);

  app = await launch();
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  await setupFixture();
  const denyUrl = 'https://notify-deny.soul.test/';
  await createFixture(shell, denyUrl);
  const denied = await requestNotification(denyUrl);
  assert.equal(denied, 'denied');
  assert.equal(await app.evaluate(() => globalThis.__notificationPrompts), 1);
  assert.equal(await requestNotification(denyUrl), 'denied');
  assert.equal(await app.evaluate(() => globalThis.__notificationPrompts), 1, 'a denied notification request must not prompt again');

  const allowUrl = 'https://notify-allow.soul.test/';
  await app.evaluate(() => { globalThis.__notificationResponse = 1; });
  await createFixture(shell, allowUrl);
  assert.equal(await requestNotification(allowUrl), 'granted');
  assert.equal(await app.evaluate(() => globalThis.__notificationPrompts), 2);
  assert.equal(await requestNotification(allowUrl), 'granted');
  assert.equal(await app.evaluate(() => globalThis.__notificationPrompts), 2, 'an allowed notification request must not prompt again');

  const stored = JSON.parse(fs.readFileSync(path.join(profile, 'browser-data', 'notification-permissions.json'), 'utf8'));
  assert.deepEqual(stored.map((entry) => [entry.origin, entry.decision]).sort(), [
    ['https://notify-allow.soul.test', 'allow'],
    ['https://notify-deny.soul.test', 'deny'],
  ]);
  await app.close();

  app = await launch();
  const restartedShell = await app.firstWindow();
  await restartedShell.waitForSelector('.app-shell');
  await setupFixture();
  await createFixture(restartedShell, denyUrl);
  assert.equal(await requestNotification(denyUrl), 'denied');
  assert.equal(await app.evaluate(() => globalThis.__notificationPrompts), 0, 'stored decisions must be reused after restart');
  console.log('PASS notification allow/deny decisions persist by origin and suppress repeated prompts');
} finally {
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
