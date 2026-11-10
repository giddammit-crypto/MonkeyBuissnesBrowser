import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-site-error-'));
const evidence = process.env.SOUL_EVIDENCE_DIR;
let responding = false;
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/offline/') && !responding) {
    response.destroy();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.end('<!doctype html><title>Network fixture</title><p>Local site is responding.</p>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const offline = `${base}/offline/${'long-address-'.repeat(30)}`;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--no-proxy-server', `--user-data-dir=${profile}`, '.',
    ],
  });
  const shell = await app.firstWindow();
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const snapshot = () => invoke('getSnapshot');
  const errorPage = shell.getByRole('region', { name: 'Не удалось загрузить страницу', exact: true });
  const retry = errorPage.getByRole('button', { name: 'Повторить попытку', exact: true });
  const back = errorPage.getByRole('button', { name: 'Назад', exact: true });
  const newTab = errorPage.getByRole('button', { name: 'Новая вкладка', exact: true });
  const resize = async (width, height) => {
    await app.evaluate(({ BaseWindow }, [width, height]) => BaseWindow.getAllWindows()[0].setContentSize(width, height), [width, height]);
    await expect.poll(() => shell.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  };
  const tab = await invoke('createTab', { url: base + '/start' });
  const waitForTab = state => expect.poll(async () => (await snapshot()).tabs.find(item => item.id === tab.id)).toMatchObject(state);
  const fail = async () => {
    await invoke('navigate', tab.id, offline);
    await waitForTab({ lifecycle: 'crashed', isLoading: false });
    await expect(errorPage).toBeVisible();
  };
  const savedScreenshot = async name => {
    if (!evidence) return;
    fs.mkdirSync(evidence, { recursive: true });
    await shell.screenshot({ path: path.join(evidence, name) });
  };

  await waitForTab({ title: 'Network fixture', isLoading: false });
  await fail();
  const root = shell.locator('html');
  for (const theme of ['light', 'dark', 'graphite']) {
    await resize(theme === 'light' ? 360 : theme === 'graphite' ? 720 : 1280, theme === 'light' ? 640 : 800);
    for (const accentColor of ['blue', 'teal', 'violet', 'rose', 'pink', 'white', 'milk', 'graphite']) {
      await invoke('updateSettings', { theme, accentColor });
      await expect(root).toHaveAttribute('data-theme', theme);
      await expect(root).toHaveAttribute('data-accent', accentColor);
      await expect(retry).toBeVisible();
      await expect(newTab).toBeVisible();
      const layout = await errorPage.evaluate(page => ({
        overflow: page.scrollWidth > page.clientWidth + 1,
        buttonOutside: [...page.querySelectorAll('button')].some(button => {
          const rect = button.getBoundingClientRect();
          return rect.width === 0 || rect.left < 0 || rect.right > innerWidth;
        }),
      }));
      assert.deepEqual(layout, { overflow: false, buttonOutside: false }, `${theme}/${accentColor}`);
      await expect.poll(() => retry.evaluate(button => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const luminance = color => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const style = getComputedStyle(button);
        const levels = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return (levels[0] + 0.05) / (levels[1] + 0.05);
      }), { message: `Retry text contrast in ${theme}/${accentColor}` }).toBeGreaterThanOrEqual(4.5);
      if (accentColor === 'blue') await savedScreenshot(`site-error-${theme}.png`);
    }
  }
  await shell.emulateMedia({ colorScheme: 'light' });
  await invoke('updateSettings', { theme: 'system' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  console.log('PASS site error fits narrow, medium and wide windows across themes and accents');

  await expect(back).toBeVisible();
  await back.click();
  await waitForTab({ url: base + '/start', lifecycle: 'active', isLoading: false });
  await expect(errorPage).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows()[0].contentView.children
    .some(view => view.webContents?.getURL() === url && view.getBounds().height > 0), base + '/start')).toBe(true);

  await fail();
  responding = true;
  await retry.click();
  await waitForTab({ url: offline, title: 'Network fixture', lifecycle: 'active', isLoading: false, canGoBack: true });
  await expect(errorPage).toHaveCount(0);

  await resize(360, 640);
  const bookmark = shell.locator('.bookmark-button');
  await expect(bookmark).toBeInViewport({ ratio: 1 });
  await bookmark.click();
  await expect(bookmark).toHaveClass(/\bactive\b/);
  await bookmark.click();
  await expect(bookmark).not.toHaveClass(/\bactive\b/);
  const menu = shell.getByRole('button', { name: 'Меню браузера', exact: true });
  await menu.click();
  const cleanLink = shell.getByRole('button', { name: 'Копировать ссылку без рекламных меток', exact: true });
  await cleanLink.scrollIntoViewIfNeeded();
  await expect(cleanLink).toBeInViewport();
  await cleanLink.click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(offline);
  console.log('PASS Bookmark and browser menu work at the 360 px minimum width');

  responding = false;
  const privateTab = await invoke('createTab', { url: offline, isPrivate: true });
  await expect(errorPage).toBeVisible();
  await newTab.click();
  await expect.poll(async () => {
    const state = await snapshot();
    return state.tabs.find(item => item.id === state.activeTabId);
  }).toMatchObject({ isInternal: true, isPrivate: true });
  assert((await snapshot()).tabs.some(item => item.id === privateTab.id && item.lifecycle === 'crashed'));
  assert.deepEqual(errors, []);
  console.log('PASS Back restores the web view, Retry reconnects, New tab preserves private mode');
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
