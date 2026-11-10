import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-renderer-actions-'));
fs.mkdirSync(path.join(profile, 'browser-data'));
fs.writeFileSync(path.join(profile, 'browser-data/downloads.json'), JSON.stringify([{
  id: 'fixture', filename: 'fixture.pdf', url: 'https://fixture.invalid/file.pdf',
  state: 'interrupted', kind: 'file', receivedBytes: 0, totalBytes: 100, startedAt: Date.now(),
}]));
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<title>Quick action fixture</title><p>Local page</p>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const snapshot = () => shell.evaluate(() => window.browserApi.getSnapshot());
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    globalThis.__retryCalls = 0;
    ipcMain.removeHandler('browser:retry-download');
    ipcMain.handle('browser:retry-download', async () => {
      globalThis.__retryCalls++;
      await new Promise(resolve => { globalThis.__releaseRetry = resolve; });
      throw new Error('Тестовый отказ загрузки');
    });
    ipcMain.removeHandler('browser:execute-clean');
    ipcMain.handle('browser:execute-clean', async () => {
      await new Promise(resolve => { globalThis.__releaseClean = resolve; });
      throw new Error('Тестовая очистка завершена');
    });
    globalThis.__quickActionCalls = [];
    ipcMain.removeHandler('browser:voodoo-trigger-quick-action');
    ipcMain.handle('browser:voodoo-trigger-quick-action', (_event, action) => {
      globalThis.__quickActionCalls.push(action);
      throw new Error('Тестовый отказ действия Вуду');
    });
  });
  const originalWorkspace = (await snapshot()).workspaces[0];
  for (const [name, key] of [['Клавиша Enter', 'Enter'], ['Клавиша Space', 'Space']]) {
    await shell.locator('.workspace-row.new-space').click();
    await shell.getByRole('textbox', { name: 'Название пространства' }).fill(name);
    await shell.getByRole('button', { name: 'Создать пространство' }).click();
    const switchButton = shell.getByRole('button', { name, exact: true });
    await switchButton.press(key);
    await expect(switchButton).toHaveAttribute('aria-pressed', 'true');
    await shell.getByRole('button', { name: 'Личное', exact: true }).click();
    await expect(switchButton).toHaveAttribute('aria-pressed', 'false');
    const deleteButton = shell.getByRole('button', { name: `Удалить пространство ${name}`, exact: true });
    await deleteButton.press(key);
    await expect(deleteButton).toHaveCount(0);
    const next = await snapshot();
    assert.equal(next.tabs.find(tab => tab.id === next.activeTabId)?.workspaceId, originalWorkspace.id);
  }
  console.log('PASS workspace delete buttons activate with Enter and Space without switching workspaces');

  const tab = await shell.evaluate(url => window.browserApi.createTab({ url }), pageUrl);
  await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
  await shell.getByRole('button', { name: 'Суммаризировать страницу', exact: true }).click();
  const voodooError = shell.getByRole('alert').filter({ hasText: 'Тестовый отказ действия Вуду' });
  await expect(voodooError).toBeVisible();
  assert.deepEqual(await app.evaluate(() => globalThis.__quickActionCalls), ['summary']);
  console.log('PASS Voodoo quick action sends summary and shows IPC failure to the user');

  const qrButton = shell.getByRole('button', { name: 'QR-код страницы', exact: true });
  const qr = shell.getByRole('dialog', { name: 'QR-код страницы', exact: true });
  await qrButton.click();
  await expect(qr).toBeVisible();
  await qr.getByRole('button', { name: 'Копировать ссылку', exact: true }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(pageUrl);
  await qrButton.click();
  await expect(qr).toHaveCount(0);
  await qrButton.click();
  await qr.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(qr).toHaveCount(0);
  await qrButton.click();
  await shell.keyboard.press('Escape');
  await expect(qr).toHaveCount(0);
  await qrButton.click();
  await shell.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(qr).toHaveCount(0);
  console.log('PASS QR popup copies the current URL and closes by toggle, close button, Escape and outside click');

  const addBookmark = shell.getByRole('button', { name: 'Добавить закладку', exact: true });
  const removeBookmark = shell.getByRole('button', { name: 'Удалить закладку', exact: true });
  await addBookmark.click();
  await expect(removeBookmark).toBeVisible();
  assert((await snapshot()).bookmarks.some(bookmark => bookmark.url === pageUrl));
  await removeBookmark.click();
  await expect(addBookmark).toBeVisible();
  assert(!(await snapshot()).bookmarks.some(bookmark => bookmark.url === pageUrl));
  console.log('PASS omnibox star adds and removes the active page bookmark');

  await shell.locator('.download-header-btn').click();
  const retry = shell.getByRole('button', { name: 'Повторить загрузку', exact: true });
  await retry.evaluate(button => { button.click(); button.click(); });
  await expect(retry).toBeDisabled();
  assert.equal(await app.evaluate(() => globalThis.__retryCalls), 1);
  await app.evaluate(() => globalThis.__releaseRetry());
  await expect(shell.getByRole('alert').filter({ hasText: 'Тестовый отказ загрузки' })).toBeVisible();
  await expect(retry).toBeEnabled();
  await shell.keyboard.press('Escape');
  await shell.keyboard.press('Control+Shift+Delete');
  const cleaner = shell.getByRole('dialog', { name: 'Click & Clean Очистка следов' });
  await expect(cleaner).toBeVisible();
  await cleaner.getByRole('button', { name: 'Очистить следы', exact: true }).click();
  await expect(cleaner.locator('.click-clean-scanning-overlay')).toBeVisible();
  await shell.keyboard.press('Escape');
  await expect(cleaner).toBeVisible();
  await app.evaluate(() => globalThis.__releaseClean());
  await expect(cleaner.locator('.click-clean-scanning-overlay')).toHaveCount(0);
  await shell.keyboard.press('Escape');
  await expect(cleaner).toHaveCount(0);
  await shell.keyboard.press('Shift+Escape');
  const manager = shell.getByRole('dialog', { name: 'Диспетчер задач', exact: true });
  await expect(manager).toBeVisible();
  const selectors = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
  const visibleControls = manager.locator(selectors).filter({ visible: true });
  await visibleControls.last().focus();
  await shell.keyboard.press('Tab');
  await expect(visibleControls.first()).toBeFocused();
  await shell.keyboard.press('Shift+Tab');
  await expect(visibleControls.last()).toBeFocused();
  assert.deepEqual(errors, []);
  console.log('PASS download errors/deduplication, cleaner Escape guard, modal keyboard containment');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
