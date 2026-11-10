import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-screenshot-'));
const filePath = path.join(profile, 'crop.png');
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Screenshot fixture</title><style>body { margin:0; background:#1464a0 }</style>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
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
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  await shell.waitForSelector('.app-shell');
  await assert.rejects(invoke('takeTabScreenshot'), /веб-страницу/);
  await assert.rejects(invoke('exportTabScreenshot', 'data:image/png;base64,abc', 'save'), /PNG/);
  const tab = await invoke('createTab', { url });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ title: 'Screenshot fixture', isLoading: false });
  await shell.getByRole('button', { name: 'Меню браузера', exact: true }).click();
  await shell.getByRole('button', { name: /Снимок вкладки/ }).click();
  const panel = shell.getByRole('region', { name: 'Снимок вкладки' });
  const image = panel.getByRole('img', { name: 'Снимок видимой области сайта' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  const source = await image.evaluate(img => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(img, 20, 20, 1, 1, 0, 0, 1, 1);
    return { width: img.naturalWidth, height: img.naturalHeight, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) };
  });
  assert.deepEqual(source.pixel, [20, 100, 160, 255]);

  const save = panel.getByRole('button', { name: 'Сохранить PNG' });
  await expect(save).toBeDisabled();
  const canvas = panel.locator('canvas');
  async function drag(startX, startY, endX, endY) {
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    assert(bounds);
    await shell.mouse.move(bounds.x + bounds.width * startX, bounds.y + bounds.height * startY);
    await shell.mouse.down();
    await shell.mouse.move(bounds.x + bounds.width * endX, bounds.y + bounds.height * endY, { steps: 6 });
    await shell.mouse.up();
  }
  await drag(0.2, 0.2, 0.65, 0.65);
  await expect(save).toBeEnabled();
  await panel.getByRole('button', { name: 'Линия', exact: true }).click();
  await drag(0.3, 0.4, 0.55, 0.4);
  const undo = panel.getByRole('button', { name: 'Отменить штрих' });
  const redo = panel.getByRole('button', { name: 'Повторить штрих' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(undo).toBeEnabled();

  await panel.getByRole('button', { name: 'Копировать' }).click();
  await expect(panel.getByRole('status')).toHaveText('Снимок скопирован');
  assert(await app.evaluate(({ clipboard }) => clipboard.has('image/png')));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filePath);
  await save.click();
  await expect(panel.getByRole('status')).toHaveText('Снимок сохранён');
  const png = fs.readFileSync(filePath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert(width > 2 && width < source.width && height > 2 && height < source.height);
  const annotated = await shell.evaluate(async dataUrl => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return data.some((red, index) => index % 4 === 0 && red > 200 && data[index + 1] < 100);
  }, `data:image/png;base64,${png.toString('base64')}`);
  assert(annotated, 'Saved PNG should include the restored red line');
  await shell.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await app.evaluate(({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl);
    page.focus();
    page.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'shift'] });
  }, url);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading')).toBeFocused();
  await panel.getByRole('button', { name: 'Весь снимок' }).click();
  for (const [index, name] of ['Карандаш', 'Стрелка', 'Прямоугольник', 'Маркер'].entries()) {
    await panel.getByRole('button', { name, exact: true }).click();
    await drag(0.3, 0.25 + index * 0.1, 0.6, 0.3 + index * 0.1);
  }
  await panel.getByRole('button', { name: 'Текст', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Текст подписи' }).fill('Проверка');
  await canvas.click({ position: { x: 25, y: 25 } });
  for (let i = 0; i < 5; i++) await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect(save).toBeEnabled();
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await save.click();
  await expect(save).toBeEnabled();
  await expect(panel.getByRole('status')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Закрыть редактор снимка' }).click();
  await expect(panel).toHaveCount(0);

  // Hotkey when shell is focused
  const shortcutKey = process.platform === 'darwin' ? 'Meta+Shift+KeyS' : 'Control+Shift+KeyS';
  await shell.keyboard.press(shortcutKey);
  await expect(panel).toBeVisible();

  // Toggling hotkey closes the screenshot panel
  await shell.keyboard.press(shortcutKey);
  await expect(panel).toHaveCount(0);

  // Hotkey with Cyrillic layout simulation from webContents
  await app.evaluate(({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl);
    page.emit('before-input-event', { preventDefault() {} }, {
      type: 'keyDown',
      key: 'ы',
      code: '',
      shift: true,
      control: process.platform !== 'darwin',
      meta: process.platform === 'darwin',
      alt: false,
      isAutoRepeat: false,
    });
  }, url);
  await expect(panel).toBeVisible();

  // Close via Escape
  await shell.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Hotkey with Cyrillic layout simulation from renderer DOM
  await shell.evaluate((isMac) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey: true,
      key: 'ы',
      code: '',
      bubbles: true,
    }));
  }, process.platform === 'darwin');
  await expect(panel).toBeVisible();

  // Close via Escape
  await shell.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Hotkey on internal tab shows user-friendly toast error
  const internalTab = await invoke('createTab', { url: 'browser://newtab' });
  await expect.poll(async () => (await invoke('getSnapshot')).activeTabId).toBe(internalTab.id);
  await shell.keyboard.press(shortcutKey);
  const toast = shell.locator('.app-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/веб-страницу/);

  assert.deepEqual(errors, []);
  console.log('Screenshot capture, markup, clipboard, hotkey in Latin and Cyrillic and internal tab warning passed');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
