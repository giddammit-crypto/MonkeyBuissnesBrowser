import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-release-ui-'));
const font = fs.readFileSync('src/renderer/assets/fonts/inter-latin.woff2');
const server = http.createServer((_request, response) => {
  if (_request.url.startsWith('/font.woff2')) { response.writeHead(200, { 'content-type': 'font/woff2' }); response.end(font); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>Release fixture</title><style>@font-face{font-family:ReleaseFixture;src:url(/font.woff2)}p{font-family:ReleaseFixture,monospace}</style><p>Local release fixture</p>');
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
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const tabs = [];
  for (const isPrivate of [false, true]) {
    const url = `${base}/${isPrivate ? 'private' : 'normal'}?item=42&utm_source=fixture&gclid=ad#details`;
    const tab = await invoke('createTab', { url, isPrivate });
    tabs.push(tab);
    await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ isLoading: false, title: 'Release fixture' });
    await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      await contents.executeJavaScript(`(async()=>{const cache=await caches.open('release-fixture');await cache.put('/cached-entry',new Response('fixture'));})()`);
    }, url);
  }
  await assert.rejects(() => invoke('executeClean', { serviceWorkers: 'false' }), /Некорректные параметры/);
  await invoke('executeClean', { serviceWorkers: true });
  for (const tab of tabs) {
    const keys = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      return contents.executeJavaScript('caches.keys()');
    }, tab.url);
    assert.deepEqual(keys, [], 'service-worker cleanup also removes CacheStorage in each session');
  }
  console.log('PASS native clean IPC rejects malformed input and removes real CacheStorage in normal/private sessions');

  await invoke('activateTab', tabs[0].id);
  await expect(shell.locator('[data-omnibox]')).toHaveValue(tabs[0].url);
  const cleanerButton = shell.getByRole('button', { name: 'Click & Clean', exact: true });
  await expect(cleanerButton.locator('svg.lucide-broom')).toHaveCount(1);
  await cleanerButton.click();
  const cleaner = shell.getByRole('dialog', { name: 'Click & Clean Очистка следов' });
  await expect(cleaner).toBeVisible();
  await shell.keyboard.press('Escape');
  await shell.locator('button[title="Меню браузера"]').click();
  const cleanMenu = shell.getByRole('button', { name: /Click & Clean.*Ctrl\+Shift\+Del/ });
  await expect(cleanMenu.locator('svg.lucide-broom')).toHaveCount(1);
  await shell.getByRole('button', { name: 'Копировать ссылку без рекламных меток', exact: true }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${base}/normal?item=42#details`);
  console.log('PASS broom toolbar/menu icons and native clipboard copy preserve functional URL parameters/hash');

  await assert.rejects(() => invoke('getPageFonts', tabs[1].id), /Откройте нужную страницу/);
  await shell.locator('button[title="Меню браузера"]').click();
  await shell.getByRole('button', { name: 'Шрифты страницы', exact: true }).click();
  const fontsDialog = shell.getByRole('dialog', { name: 'Шрифты страницы', exact: true });
  await expect(fontsDialog).toBeVisible();
  const webFonts = fontsDialog.getByRole('region', { name: /^Подключённые веб-шрифты/ });
  await expect(webFonts.getByText('ReleaseFixture', { exact: true })).toBeVisible();
  await expect(webFonts.getByText('Загружен', { exact: true })).toBeVisible();
  await fontsDialog.getByRole('textbox', { name: 'Найти шрифт' }).fill('missing-font-fixture');
  await expect(fontsDialog.getByText('Совпадений нет.', { exact: true })).toHaveCount(2);
  await fontsDialog.getByRole('textbox', { name: 'Найти шрифт' }).fill('ReleaseFixture');
  await fontsDialog.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(webFonts.getByText('ReleaseFixture', { exact: true })).toBeVisible();
  const controls = fontsDialog.locator('button:not([disabled]), input:not([disabled])');
  await controls.last().focus();
  await shell.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await shell.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await shell.keyboard.press('Escape');
  await expect(fontsDialog).toHaveCount(0);
  console.log('PASS font diagnostics reads real WOFF2 through IPC, filters, refreshes, traps focus and protects inactive private tabs');


  // Observe the real renderer → IPC boundary without navigating to public
  // search engines; this process-local handler is discarded with the profile.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__releaseNavigations = [];
    ipcMain.removeHandler('browser:navigate');
    ipcMain.handle('browser:navigate', (_event, tabId, url) => { globalThis.__releaseNavigations.push({ tabId, url }); });
    ipcMain.removeHandler('browser:execute-clean');
    ipcMain.handle('browser:execute-clean', () => new Promise((_resolve, reject) => {
      globalThis.__releaseClean = () => reject(new Error('Fixture complete'));
    }));
  });
  const omnibox = shell.locator('[data-omnibox]');
  await omnibox.focus();
  await omnibox.fill(`${base}/composing`);
  const prevented = await omnibox.evaluate(input => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(prevented, true, 'IME confirmation must prevent the form default submission');
  assert.equal(await app.evaluate(() => globalThis.__releaseNavigations.length), 0);
  await omnibox.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__releaseNavigations.length)).toBe(1);
  assert.equal((await app.evaluate(() => globalThis.__releaseNavigations))[0].url, `${base}/composing`);
  await omnibox.focus();
  await omnibox.fill('g release fixture');
  const search = shell.getByRole('option').filter({ hasText: 'google.com' });
  await expect(search).toHaveCount(1);
  await search.dispatchEvent('mousedown');
  await expect.poll(() => app.evaluate(() => globalThis.__releaseNavigations.length)).toBe(2);
  assert.equal((await app.evaluate(() => globalThis.__releaseNavigations))[1].url, 'https://www.google.com/search?q=release%20fixture');
  console.log('PASS IME Enter does not navigate; normal Enter and keyword search suggestion dispatch correct targets');

  await cleanerButton.click();
  await cleaner.getByRole('button', { name: 'Очистить следы', exact: true }).click();
  const overlay = cleaner.locator('.click-clean-scanning-overlay');
  await expect(overlay.locator('svg.lucide-broom')).toHaveCount(1);
  await shell.keyboard.press('Escape');
  await expect(cleaner).toBeVisible();
  await app.evaluate(() => globalThis.__releaseClean());
  await expect(overlay).toHaveCount(0);
  await shell.keyboard.press('Escape');
  await expect(cleaner).toHaveCount(0);
  console.log('PASS cleaning overlay broom and busy Escape guard');

  const privacyReport = await invoke('getPrivacyDashboard', tabs[0].id);
  await app.evaluate(({ ipcMain }, report) => {
    ipcMain.removeHandler('browser:get-privacy-dashboard');
    ipcMain.handle('browser:get-privacy-dashboard', () => new Promise(resolve => {
      globalThis.__releasePrivacy = () => resolve(report);
    }));
  }, privacyReport);
  await shell.locator('.sidebar').getByRole('button', { name: 'Центр приватности', exact: true }).click();
  await expect(shell.getByText('Проверяем соединение…', { exact: true })).toBeVisible();
  await app.evaluate(() => globalThis.__releasePrivacy());
  await expect(shell.locator('.privacy-dashboard-loading')).toHaveCount(0);
  await expect(shell.getByRole('heading', { name: 'Центр приватности', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS privacy dashboard loading → data transition without hook-order errors; no uncaught shell errors');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
