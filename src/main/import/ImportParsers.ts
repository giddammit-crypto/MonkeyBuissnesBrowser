import type { BookmarkEntry } from '../../shared/types';

export interface PasswordCsvRecord { origin: string; username: string; password: string }
export interface ParsedImport<T> { records: T[]; total: number; warnings: string[] }

function safeUrl(raw: string): URL | undefined {
  try { const url = new URL(raw.trim()); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : undefined; } catch { return undefined; }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, code: string) => {
    const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (!code.startsWith('#')) return names[code.toLowerCase()] ?? original;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : original;
  });
}

/** Parse an exported Netscape bookmarks document without evaluating HTML or scripts. */
export function parseBookmarksHtml(source: string): ParsedImport<BookmarkEntry> {
  if (!/<(?:!DOCTYPE\s+NETSCAPE-Bookmark-file-1|DL\b)/i.test(source)) throw new Error('Выберите HTML-файл экспорта закладок из браузера.');
  const records: BookmarkEntry[] = [];
  let total = 0;
  const clean = source.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  // Attribute tokens account for quotes containing >; browser exports use one A per bookmark.
  const anchors = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([^]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(clean))) {
    total += 1;
    if (total > 20_000) throw new Error('В HTML-файле больше 20 000 закладок. Разделите экспорт на несколько файлов.');
    const attributes: Record<string, string> = {};
    const tokenizer = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = tokenizer.exec(match[1]))) attributes[attribute[1].toLowerCase()] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    const url = safeUrl(attributes.href ?? '');
    if (!url) continue;
    const createdAt = Number(attributes.add_date) * 1000;
    records.push({ id: crypto.randomUUID(), url: url.href, title: decodeEntities(match[2].replace(/<[^>]*>/g, '')).trim().slice(0, 1000) || url.href, createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now() });
  }
  if (!total) throw new Error('В HTML-файле не найдены экспортированные закладки.');
  return { records, total, warnings: records.length < total ? ['Ссылки с неподдерживаемыми схемами и некорректными адресами пропущены.'] : [] };
}

function csvRows(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let afterQuote = false;
  const pushRow = () => { row.push(value); if (row.some((cell) => cell.length)) rows.push(row); row = []; value = ''; afterQuote = false; };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else value += char;
    } else if (char === '"' && !value && !afterQuote) quoted = true;
    else if (char === delimiter) { row.push(value); value = ''; afterQuote = false; }
    else if (char === '\r' || char === '\n') { if (char === '\r' && source[index + 1] === '\n') index += 1; pushRow(); }
    else if (afterQuote && !/\s/.test(char)) throw new Error('Некорректный CSV: лишние символы после закрывающей кавычки.');
    else if (!afterQuote) value += char;
    if (rows.length > 20_000) throw new Error('В CSV-файле больше 20 000 строк. Разделите экспорт на несколько файлов.');
  }
  if (quoted) throw new Error('Некорректный CSV: незакрытая кавычка.');
  if (row.length || value || afterQuote) pushRow();
  return rows;
}

/** RFC4180 quoting, BOM, CRLF and multiline passwords from Chrome/Firefox exports. */
export function parsePasswordsCsv(source: string): ParsedImport<PasswordCsvRecord> {
  const clean = source.replace(/^\uFEFF/, '');
  let rows = csvRows(clean, ',');
  if ((rows[0]?.length ?? 0) < 2 && clean.split(/[\r\n]/, 1)[0].includes(';')) rows = csvRows(clean, ';');
  if (!rows.length) throw new Error('CSV-файл пуст.');
  const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/[\s_-]/g, ''));
  const column = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const urlIndex = column(['url', 'origin', 'hostname', 'loginuri']);
  const usernameIndex = column(['username', 'login', 'loginusername']);
  const passwordIndex = column(['password', 'loginpassword']);
  if ([urlIndex, usernameIndex, passwordIndex].some((index) => index < 0)) throw new Error('CSV должен содержать столбцы url, username и password (экспорт Chrome, Edge или Firefox).');
  const records: PasswordCsvRecord[] = [];
  for (const row of rows.slice(1)) {
    const url = safeUrl(row[urlIndex] ?? '');
    const password = row[passwordIndex];
    if (!url || typeof password !== 'string' || !password.length || row.length !== headers.length) continue;
    records.push({ origin: url.origin, username: row[usernameIndex] ?? '', password });
  }
  const total = rows.length - 1;
  return { records, total, warnings: records.length < total ? ['Пустые пароли, некорректные строки и неподдерживаемые адреса пропущены.'] : [] };
}
