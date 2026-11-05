import { classifyFontConsoleMessage, clipFontDetail, sanitizeFontUrl, type FontIssue } from '../../shared/fontCompat';

const MAX_ISSUES_PER_PAGE = 32;
const FONT_HINTS = ['font', 'woff', 'ttf', 'otf', 'ots '];

const looksLikeFontMessage = (message: string): boolean => {
  if (typeof message !== 'string' || message.length === 0) return false;
  const lower = message.slice(0, 400).toLowerCase();
  return FONT_HINTS.some(hint => lower.indexOf(hint) >= 0);
};
const MAX_TRACKED_PAGES = 64;

/**
 * Bounded evidence log for one renderer's font requests.
 *
 * Chromium hides most font failures from the page: a blocked, CORS-rejected or
 * undecodable font only produces a console line and a silent fallback. Without
 * this log the diagnostics panel can only say "the font is not loaded", which
 * is exactly the useless message the user already sees.
 */
export class SiteFontMonitor {
  private readonly entries = new Map<number, FontIssue[]>();

  private bucket(webContentsId: number): FontIssue[] {
    const existing = this.entries.get(webContentsId);
    if (existing) return existing;
    if (this.entries.size >= MAX_TRACKED_PAGES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const created: FontIssue[] = [];
    this.entries.set(webContentsId, created);
    return created;
  }

  private push(webContentsId: number, issue: FontIssue): void {
    if (!Number.isFinite(webContentsId) || webContentsId <= 0) return;
    const bucket = this.bucket(webContentsId);
    if (bucket.length >= MAX_ISSUES_PER_PAGE) return;
    const key = `${issue.kind}|${issue.url ?? ''}|${issue.detail}`;
    if (bucket.some(entry => `${entry.kind}|${entry.url ?? ''}|${entry.detail}` === key)) return;
    bucket.push({ ...issue, detail: clipFontDetail(issue.detail) });
  }

  noteBlocked(webContentsId: number, rawUrl: string, rule?: string): void {
    this.push(webContentsId, {
      kind: 'blocked',
      url: sanitizeFontUrl(rawUrl),
      detail: rule ? `Запрос шрифта отменён фильтром: ${rule}` : 'Запрос шрифта отменён фильтром содержимого.',
    });
  }

  noteFailure(webContentsId: number, rawUrl: string, error: string): void {
    this.push(webContentsId, {
      kind: 'network',
      url: sanitizeFontUrl(rawUrl),
      detail: error || 'Сетевой запрос шрифта завершился ошибкой.',
    });
  }

  noteHttpStatus(webContentsId: number, rawUrl: string, statusCode: number): void {
    if (statusCode < 400) return;
    this.push(webContentsId, {
      kind: 'http',
      url: sanitizeFontUrl(rawUrl),
      detail: `Сервер ответил HTTP ${statusCode} на запрос шрифта.`,
    });
  }

  noteConsole(webContentsId: number, message: string): void {
    // Fast path: chatty pages produce thousands of console messages. A cheap
    // substring scan avoids running six regular expressions for each of them.
    if (!looksLikeFontMessage(message)) return;
    const kind = classifyFontConsoleMessage(message);
    if (!kind) return;
    this.push(webContentsId, { kind, detail: clipFontDetail(message) });
  }

  snapshot(webContentsId: number): FontIssue[] {
    const entries = this.entries.get(webContentsId);
    return entries ? entries.map(entry => ({ ...entry })) : [];
  }

  clear(webContentsId: number): void {
    this.entries.delete(webContentsId);
  }

  clearAll(): void {
    this.entries.clear();
  }
}

export const siteFontMonitor = new SiteFontMonitor();
