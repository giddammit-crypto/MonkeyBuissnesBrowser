import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: {}, BaseWindow: class {}, BrowserWindow: class {}, clipboard: {}, dialog: {}, Menu: {},
  nativeImage: {}, nativeTheme: {}, session: {}, shell: {}, WebContentsView: class {}, safeStorage: {},
}));
import { BrowserController } from '../../src/main/tabs/BrowserController';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';
import type { NoteEntry } from '../../src/shared/types';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(count: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-capacity-')); roots.push(root);
  const stores = new BrowserStores(root);
  const notes: NoteEntry[] = Array.from({ length: count }, (_, index) => ({ id: `note-${index}`, title: `Note ${index}`, content: `Unique content ${index}`, color: 'default', isPinned: false, createdAt: index + 1, updatedAt: index + 1 }));
  stores.notes.set(notes);
  const controller = Object.create(BrowserController.prototype) as any;
  Object.assign(controller, { stores, emitSnapshot: vi.fn() });
  return { root, stores, notes, controller, file: path.join(root, 'browser-data', 'notes.json') };
}
describe('note capacity preserves user data', () => {
  it('rejects the 501st note without dropping the oldest note or changing durable storage', async () => {
    const { stores, notes, controller, file, root } = fixture(500);
    const originalFile = fs.readFileSync(file, 'utf8');
    await expect(controller.saveNote({ title: 'New', content: 'Do not replace existing notes' })).rejects.toThrow('лимит 500 заметок');
    expect(stores.notes.get()).toEqual(notes);
    expect(fs.readFileSync(file, 'utf8')).toBe(originalFile);
    expect(new BrowserStores(root).notes.get()).toEqual(notes);
    expect(stores.notes.get().at(-1)?.id).toBe('note-499');
    expect(controller.emitSnapshot).not.toHaveBeenCalled();
  });
  it('allows updating an existing note at capacity and preserves every other note', async () => {
    const { stores, notes, controller, root } = fixture(500);
    const updated = await controller.saveNote({ id: 'note-499', title: 'Updated oldest', content: 'Updated text' });
    expect(updated.id).toBe('note-499');
    expect(stores.notes.get()).toHaveLength(500);
    expect(stores.notes.get().slice(0, 499)).toEqual(notes.slice(0, 499));
    expect(new BrowserStores(root).notes.get()[499]).toMatchObject({ id: 'note-499', content: 'Updated text', createdAt: 500 });
  });
  it('allows creation of the 500th note without replacing any existing record', async () => {
    const { stores, notes, controller } = fixture(499);
    const saved = await controller.saveNote({ title: 'Last available slot', content: 'New text' });
    expect(stores.notes.get()).toHaveLength(500);
    expect(stores.notes.get()[0].id).toBe(saved.id);
    expect(stores.notes.get().slice(1)).toEqual(notes);
  });
});
