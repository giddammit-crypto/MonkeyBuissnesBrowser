import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';
import type { NoteEntry, ReaderSettings } from '../../src/shared/types';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTempStores(): { stores: BrowserStores; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-notes-test-'));
  temporaryDirectories.push(dir);
  fs.mkdirSync(path.join(dir, 'browser-data'), { recursive: true });
  return { stores: new BrowserStores(dir), dir };
}

describe('Notes and Reader Mode persistence', () => {
  it('persists and normalizes readerSettings in settings store', () => {
    const { stores, dir } = createTempStores();
    const defaultReader = stores.settings.get().readerSettings;
    expect(defaultReader).toBeDefined();
    expect(defaultReader?.theme).toBe('light');
    expect(defaultReader?.fontFamily).toBe('sans');
    expect(defaultReader?.fontSize).toBe(18);

    // Update reader settings
    const updatedReader: ReaderSettings = {
      theme: 'sepia',
      fontFamily: 'serif',
      fontSize: 22,
      lineHeight: 1.8,
      maxWidth: 720,
    };
    stores.settings.set({
      ...stores.settings.get(),
      readerSettings: updatedReader,
    });

    const second = new BrowserStores(dir);
    expect(second.settings.get().readerSettings).toEqual(updatedReader);
  });

  it('normalizes corrupted readerSettings gracefully', () => {
    const { dir } = createTempStores();
    fs.writeFileSync(
      path.join(dir, 'browser-data', 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        readerSettings: {
          theme: 'invalid-theme',
          fontFamily: 'invalid-font',
          fontSize: 'not-a-number',
          lineHeight: -5,
          maxWidth: 999999,
        },
      })
    );

    const stores = new BrowserStores(dir);
    const rs = stores.settings.get().readerSettings;
    expect(rs?.theme).toBe('light');
    expect(rs?.fontFamily).toBe('sans');
    expect(rs?.fontSize).toBe(18);
    expect(rs?.lineHeight).toBe(1);
    expect(rs?.maxWidth).toBe(1200);
  });

  it('persists and normalizes notes collection', () => {
    const { stores, dir } = createTempStores();
    expect(stores.notes.get()).toEqual([]);

    const note1: NoteEntry = {
      id: 'note-1',
      title: 'Первая заметка',
      content: 'Текст заметки',
      color: 'yellow',
      url: 'https://example.com/article',
      tabTitle: 'Статья',
      isPinned: true,
      createdAt: 1000,
      updatedAt: 1000,
    };

    stores.notes.set([note1]);
    expect(stores.notes.get()).toHaveLength(1);

    const reloaded = new BrowserStores(dir);
    expect(reloaded.notes.get()).toEqual([note1]);
  });

  it('filters corrupted note entries and sanitizes lengths', () => {
    const { dir } = createTempStores();
    fs.writeFileSync(
      path.join(dir, 'browser-data', 'notes.json'),
      JSON.stringify([
        null,
        {},
        { id: 'good', content: 'Safe content', color: 'blue' },
        { id: 123, content: 'bad id' },
      ])
    );

    const stores = new BrowserStores(dir);
    const notes = stores.notes.get();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('good');
    expect(notes[0].color).toBe('blue');
    expect(notes[0].isPinned).toBe(false);
  });
});
