import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-notes-race-'));
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const a = await invoke('saveNote', { title: 'Alpha note', content: 'Original A', color: 'yellow' });
  const b = await invoke('saveNote', { title: 'Beta note', content: 'Original B', color: 'yellow' });
  await shell.getByRole('button', { name: 'Быстрые заметки', exact: true }).first().click();
  const drawer = shell.getByRole('complementary', { name: 'Быстрые заметки' });
  const content = drawer.getByPlaceholder('Текст заметки, сниппет кода или список задач…');
  const card = title => drawer.locator('.note-card').filter({ has: shell.locator('.note-card-title', { hasText: title }) });
  await card('Alpha note').click();
  await content.fill('Saved while selecting Beta');
  await card('Beta note').click();
  await expect(content).toHaveValue('Original B');
  await expect.poll(async () => (await invoke('getNotes')).find(n => n.id === a.id)?.content).toBe('Saved while selecting Beta');
  await expect(content).toHaveValue('Original B');
  console.log('PASS note autosave does not revert current selection');
  await card('Alpha note').click();
  await content.fill('Saved and pinned');
  await card('Alpha note').getByTitle('Закрепить вверху', { exact: true }).click();
  await expect.poll(async () => {
    const note = (await invoke('getNotes')).find(n => n.id === a.id);
    return { content: note?.content, pinned: note?.isPinned };
  }).toEqual({ content: 'Saved and pinned', pinned: true });
  console.log('PASS pending note autosave preserves pin mutation');
  await content.fill('Saved on close');
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect.poll(async () => (await invoke('getNotes')).find(n => n.id === a.id)?.content).toBe('Saved on close');
  await shell.getByRole('button', { name: 'Быстрые заметки', exact: true }).first().click();
  await card('Alpha note').click();
  await expect(content).toHaveValue('Saved on close');
  console.log('PASS close and reopen flushes pending note draft');
  await content.fill('Must never resurrect');
  await drawer.getByTitle('Удалить заметку', { exact: true }).click();
  await expect.poll(async () => (await invoke('getNotes')).some(n => n.id === a.id)).toBe(false);
  // Wait beyond the debounce window to detect delayed resurrection.
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal((await invoke('getNotes')).some(n => n.id === a.id), false);
  assert((await invoke('getNotes')).some(n => n.id === b.id));
  console.log('PASS deleted note is not recreated by pending autosave');
} finally {
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
