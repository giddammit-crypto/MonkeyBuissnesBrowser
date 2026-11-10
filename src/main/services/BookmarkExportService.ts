import { dialog, type BaseWindow } from 'electron';
import type { BookmarkEntry } from '../../shared/types';
import { writeTextAtomically } from './AtomicTextFile';

const MAX_BOOKMARKS = 5000;
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** A portable Netscape bookmarks document. Only bookmark fields are serialized. */
export function buildBookmarksHtml(bookmarks: readonly BookmarkEntry[]): { html: string; count: number } {
  if (!Array.isArray(bookmarks) || bookmarks.length > MAX_BOOKMARKS) {
    throw new Error('За один раз можно экспортировать не более 5000 закладок.');
  }
  const links: string[] = [];
  for (const bookmark of bookmarks) {
    if (!bookmark || typeof bookmark.url !== 'string' || bookmark.url.length > 8192) continue;
    let url: URL;
    try { url = new URL(bookmark.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
    const title = typeof bookmark.title === 'string' && bookmark.title.trim()
      ? bookmark.title.slice(0, 2048).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') : url.href;
    const created = typeof bookmark.createdAt === 'number' && Number.isFinite(bookmark.createdAt) && bookmark.createdAt >= 0
      ? ` ADD_DATE="${Math.floor(bookmark.createdAt / 1000)}"` : '';
    links.push(`    <DT><A HREF="${escapeHtml(url.href)}"${created}>${escapeHtml(title)}</A>`);
  }
  return {
    count: links.length,
    html: [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file. -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Закладки</TITLE>', '<H1>Закладки</H1>', '<DL><p>', ...links, '</DL><p>', '',
    ].join('\n'),
  };
}

export { writeTextAtomically as writeBookmarksHtml };

export async function exportBookmarksHtml(
  owner: BaseWindow,
  bookmarks: readonly BookmarkEntry[],
  defaultPath = 'bookmarks.html',
): Promise<{ saved: boolean; count: number; path?: string }> {
  const document = buildBookmarksHtml(bookmarks);
  const picked = await dialog.showSaveDialog(owner, {
    title: 'Экспорт закладок в HTML',
    defaultPath,
    filters: [{ name: 'Закладки HTML', extensions: ['html'] }],
    properties: ['showOverwriteConfirmation'],
  });
  if (picked.canceled || !picked.filePath) return { saved: false, count: 0 };
  await writeTextAtomically(picked.filePath, document.html);
  return { saved: true, count: document.count, path: picked.filePath };
}
