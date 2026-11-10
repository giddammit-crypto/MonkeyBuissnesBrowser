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

  const single = path.join(profile, 'note.txt');
  const archive = path.join(profile, 'archive.json');
  await app.evaluate(({ dialog }, destinations) => {
    dialog.showSaveDialog = async (_window, options) => {
      const ext = options.filters[0].extensions[0];
      return { canceled: false, filePath: destinations[ext] };
    };
  }, { txt: single, json: archive });
  await content.fill('Кириллица и незаписанный черновик 📌');
  await drawer.getByRole('button', { name: 'Экспортировать в файл' }).click();
  await expect(drawer.getByRole('status')).toHaveText('Заметка экспортирована');
  assert.equal(fs.readFileSync(single, 'utf8'), 'Alpha note\n\nКириллица и незаписанный черновик 📌');
  await drawer.getByRole('button', { name: 'Экспорт всех заметок в JSON' }).click();
  await expect(drawer.getByRole('status')).toHaveText('Архив заметок экспортирован');
  const savedArchive = fs.readFileSync(archive, 'utf8');
  assert.equal(JSON.parse(savedArchive).version, 1);
  assert.deepEqual(JSON.parse(savedArchive).notes.toSorted((a, b) => a.id.localeCompare(b.id)),
    JSON.parse(JSON.stringify(await invoke('getNotes'))).toSorted((a, b) => a.id.localeCompare(b.id)));
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await drawer.getByRole('button', { name: 'Экспорт всех заметок в JSON' }).click();
  await expect(drawer.getByRole('button', { name: 'Экспорт всех заметок в JSON' })).toBeEnabled();
  await expect(drawer.getByRole('status')).toHaveCount(0);
  assert.equal(fs.readFileSync(archive, 'utf8'), savedArchive);
  console.log('PASS native TXT and JSON exports include the latest draft and cancellation preserves the destination');
  await content.fill('Must never resurrect');
  await drawer.getByTitle('Удалить заметку', { exact: true }).click();
  await expect.poll(async () => (await invoke('getNotes')).some(n => n.id === a.id)).toBe(false);
  // Wait beyond the debounce window to detect delayed resurrection.
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal((await invoke('getNotes')).some(n => n.id === a.id), false);
  assert((await invoke('getNotes')).some(n => n.id === b.id));
  await assert.rejects(invoke('saveNote', { id: a.id, content: 'Stale editor in another window' }), /удалена/);
  assert(!(await invoke('getNotes')).some(note => note.id === a.id));
  console.log('PASS deleted note cannot be recreated by a delayed save from either editor');
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();

  const normalTab = (await invoke('getSnapshot')).activeTabId;
  const privateTab = await invoke('createTab', { url: 'http://127.0.0.1:1/private-note-fixture', isPrivate: true });
  await assert.rejects(invoke('createNoteFromTab', privateTab.id, 'Private selection'), /обычной веб-вкладке/);
  const state = await invoke('getVoodooViewState');
  assert.deepEqual(state.currentTab, { isPrivate: true, url: '', title: '' });
  assert(!('tabs' in state || 'history' in state || 'downloads' in state || 'notes' in state));
  await shell.getByRole('button', { name: 'Быстрые заметки', exact: true }).first().click();
  await drawer.getByRole('button', { name: 'Заметка', exact: true }).click();
  const privateWindowNote = (await invoke('getNotes')).find(note => note.title === 'Новая заметка');
  assert(privateWindowNote && !privateWindowNote.url && !privateWindowNote.tabTitle);
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await invoke('activateTab', normalTab);
  await invoke('closeTab', privateTab.id);
  assert(!('notes' in await invoke('getSnapshot')));
  console.log('PASS notes stay out of routine snapshots and private page addresses stay out of notes and Voodoo');
  await shell.evaluate(async () => {
    const notes = await window.browserApi.getNotes();
    for (let index = notes.length; index < 500; index++) {
      await window.browserApi.saveNote({ title: `Capacity note ${index}`, content: `Preserved ${index}`, color: 'default' });
    }
  });
  const atCapacity = await invoke('getNotes');
  assert.equal(atCapacity.length, 500);
  await shell.getByRole('button', { name: 'Быстрые заметки', exact: true }).first().click();
  await expect(drawer.locator('.notes-count-badge')).toHaveText('500');
  await drawer.getByRole('button', { name: 'Заметка', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('Достигнут лимит 500 заметок');
  assert.deepEqual(await invoke('getNotes'), atCapacity, 'failed creation must preserve every existing note');
  console.log('PASS full notes store shows a visible quota error and preserves all 500 records');

} finally {
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
