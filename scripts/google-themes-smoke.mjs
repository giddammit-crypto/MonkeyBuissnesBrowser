import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-google-themes-'));
const args = [
  ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--no-proxy-server', `--user-data-dir=${profile}`, '.',
];
const themes = {
  parchment: ['light', '#f6efe3'],
  'arctic-glass': ['light', '#edf5fa'],
  'pine-forest': ['dark', '#111d17'],
  'deep-ocean': ['dark', '#0c1828'],
  'copper-night': ['dark', '#221718'],
};
const launch = () => electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args });
let app;
try {
  app = await launch();
  let shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  const invoke = (method, ...params) => shell.evaluate(({ method, params }) => window.browserApi[method](...params), { method, params });
  const snapshot = () => invoke('getSnapshot');
  const settings = () => shell.locator('.sidebar').getByRole('button', { name: 'Настройки', exact: true }).click();
  await settings();
  const select = shell.getByRole('combobox', { name: 'Тема интерфейса', exact: true });
  const html = shell.locator('html');
  const baseOptions = ['system', 'light', 'dark', 'graphite'];
  assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(option => option.value)), [...baseOptions, ...Object.keys(themes)]);
  const canvas = () => html.evaluate(node => getComputedStyle(node).getPropertyValue('--canvas').trim());
  const accent = shell.getByRole('combobox', { name: 'Акцентный цвет', exact: true });
  await select.selectOption('light');
  const legacyCanvas = await canvas();
  await accent.selectOption('rose');
  const evidence = process.env.SOUL_EVIDENCE_DIR;
  for (const [theme, [scheme, color]] of Object.entries(themes)) {
    await select.selectOption(theme);
    await expect(html).toHaveAttribute('data-palette', theme);
    await expect(html).toHaveAttribute('data-theme', scheme);
    await expect.poll(canvas).toBe(color);
    await expect(accent).toBeDisabled();
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      await shell.screenshot({ path: path.join(evidence, `palette-${theme}.png`) });
    }
  }
  await select.selectOption('light');
  await expect(html).not.toHaveAttribute('data-palette', /.+/);
  await expect.poll(canvas).toBe(legacyCanvas);
  await expect(accent).toHaveValue('rose');
  await expect(accent).toBeEnabled();
  await select.selectOption('copper-night');
  await expect(html).toHaveAttribute('data-palette', 'copper-night');
  await app.close();
  app = await launch();
  shell = await app.firstWindow();
  shell.on('pageerror', error => errors.push(error.message));
  await expect(shell.locator('html')).toHaveAttribute('data-palette', 'copper-night');
  console.log('PASS five distinct palette colors, baseline restoration and persistence after restart');

  await app.evaluate(({ session }) => {
    session.fromPartition('persist:northstar-default').protocol.handle('https',
      () => new Response('<title>Local Google chooser fixture</title>', { headers: { 'content-type': 'text/html' } }));
  });
  const trigger = shell.getByRole('button', { name: 'Аккаунт Google', exact: true });
  const dialog = shell.getByRole('dialog', { name: 'Аккаунт Google', exact: true });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await trigger.click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  const add = async email => {
    await dialog.getByRole('button', { name: 'Вручную', exact: true }).click();
    await dialog.getByPlaceholder('Электронная почта Google').fill(email);
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `Выбрать аккаунт ${email}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  };
  await add('first+fixture@example.test');
  await add('second@example.test');
  const first = dialog.getByRole('button', { name: 'Выбрать аккаунт first+fixture@example.test', exact: true });
  await first.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  for (const [name, target] of [['YouTube', 'https://www.youtube.com/'], ['Gmail', 'https://mail.google.com/'], ['Диск', 'https://drive.google.com/'], ['Поиск', 'https://www.google.com/']]) {
    await dialog.getByRole('button', { name, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const chosen = new URL('https://accounts.google.com/AccountChooser');
    chosen.searchParams.set('Email', 'first+fixture@example.test');
    chosen.searchParams.set('continue', target);
    await expect.poll(async () => {
      const state = await snapshot();
      return state.tabs.find(tab => tab.id === state.activeTabId)?.url;
    }).toBe(chosen.href);
    await trigger.click();
  }
  for (const email of ['second@example.test', 'first+fixture@example.test']) {
    await dialog.getByRole('button', { name: `Удалить аккаунт ${email} из панели`, exact: true }).click();
    await expect(dialog.getByRole('button', { name: `Выбрать аккаунт ${email}`, exact: true })).toHaveCount(0);
  }
  await expect(dialog.getByRole('button', { name: 'Войти через Google', exact: true })).toBeVisible();
  await invoke('createTab', { isPrivate: true });
  await expect(trigger).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS Google panel toggle, selection, four service destinations, removal and private isolation');
} finally {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
