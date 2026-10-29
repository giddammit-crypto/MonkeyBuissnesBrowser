import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-renderer-actions-'));
fs.mkdirSync(path.join(profile, 'browser-data'));
fs.writeFileSync(path.join(profile, 'browser-data/downloads.json'), JSON.stringify([{
  id: 'fixture', filename: 'fixture.pdf', url: 'https://fixture.invalid/file.pdf',
  state: 'interrupted', kind: 'file', receivedBytes: 0, totalBytes: 100, startedAt: Date.now(),
}]));
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
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
  });
  await shell.locator('.download-header-btn').click();
  const retry = shell.getByRole('button', { name: 'Повторить загрузку', exact: true });
  await retry.evaluate(button => { button.click(); button.click(); });
  await expect(retry).toBeDisabled();
  assert.equal(await app.evaluate(() => globalThis.__retryCalls), 1);
  await app.evaluate(() => globalThis.__releaseRetry());
  await expect(shell.getByRole('alert')).toContainText('Тестовый отказ загрузки');
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
  fs.rmSync(profile, { recursive: true, force: true });
}
