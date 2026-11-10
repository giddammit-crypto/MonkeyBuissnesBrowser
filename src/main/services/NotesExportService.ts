import path from 'node:path';
import { dialog, type BaseWindow } from 'electron';
import type { NoteEntry } from '../../shared/types';
import { writeTextAtomically } from './AtomicTextFile';

export async function exportNotesToFile(
  owner: BaseWindow,
  notes: readonly NoteEntry[],
  documentsDir: string,
  noteId?: string,
): Promise<boolean> {
  const note = noteId === undefined ? undefined : notes.find(entry => entry.id === noteId);
  if (noteId !== undefined && !note) throw new Error('Заметка больше не существует.');
  if (!notes.length) return false;
  const filename = note
    ? (note.title.trim().replace(/[/\\?%*:|"<>\x00-\x1f]/g, '-').slice(0, 60) || 'Заметка') + '.txt'
    : 'soulm8te-notes.json';
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: note ? 'Сохранить заметку' : 'Экспорт всех заметок',
    defaultPath: path.join(documentsDir, filename),
    filters: note ? [{ name: 'Текст', extensions: ['txt'] }] : [{ name: 'Архив заметок JSON', extensions: ['json'] }],
    properties: ['showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return false;
  const content = note
    ? `${note.title ? `${note.title}\n\n` : ''}${note.content}${note.url ? `\n\nИсточник: ${note.url}` : ''}`
    : JSON.stringify({ version: 1, notes }, null, 2) + '\n';
  await writeTextAtomically(filePath, content);
  return true;
}
