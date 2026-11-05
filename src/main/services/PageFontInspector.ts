import type { WebContents } from 'electron';
import type { PageFontFace, PageFontReport } from '../../shared/types';

export const PAGE_FONT_SAMPLE_LIMIT = 150;
export const PAGE_FONT_FACE_LIMIT = 100;

// A constant program in the preload isolated world: no site-owned helper,
// textContent, HTML, request URLs, cookies, downloads or font-loading calls.
// TreeWalker avoids materializing the entire DOM for a bounded sample.
export const PAGE_FONT_PROBE = `(() => {
  const clip = value => String(value || '').slice(0, 256);
  const faces = [];
  let facesTruncated = false;
  for (const face of document.fonts) {
    if (faces.length >= ${PAGE_FONT_FACE_LIMIT}) { facesTruncated = true; break; }
    faces.push({ family: clip(face.family), style: clip(face.style), weight: clip(face.weight), status: face.status });
  }
  const computed = new Map();
  let sampledElements = 0;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node && sampledElements < ${PAGE_FONT_SAMPLE_LIMIT}) {
      const style = getComputedStyle(node);
      const font = { family: clip(style.fontFamily), style: clip(style.fontStyle), weight: clip(style.fontWeight), count: 1 };
      const key = JSON.stringify([font.family, font.style, font.weight]);
      const existing = computed.get(key);
      if (existing) existing.count++; else computed.set(key, font);
      sampledElements++;
      node = walker.nextNode();
    }
  }
  return { documentStatus: document.fonts.status, faces, computedFonts: [...computed.values()], sampledElements, facesTruncated };
})()`;

type FontData = Omit<PageFontReport, 'tabId' | 'sampledAt'>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown): string => typeof value === 'string' ? value.slice(0, 256) : '';

function sanitizeFontData(value: unknown): FontData {
  if (!record(value) || !['loaded', 'loading'].includes(String(value.documentStatus))) {
    throw new Error('Не удалось прочитать состояние шрифтов страницы.');
  }
  const faces = Array.isArray(value.faces) ? value.faces : [];
  const computed = Array.isArray(value.computedFonts) ? value.computedFonts : [];
  return {
    documentStatus: value.documentStatus as FontData['documentStatus'],
    faces: faces.slice(0, PAGE_FONT_FACE_LIMIT).filter(record).filter(face => ['unloaded', 'loading', 'loaded', 'error'].includes(String(face.status))).map(face => ({
      family: shortString(face.family), style: shortString(face.style), weight: shortString(face.weight), status: face.status as PageFontFace['status'],
    })),
    computedFonts: computed.slice(0, PAGE_FONT_SAMPLE_LIMIT).filter(record).map(font => ({
      family: shortString(font.family), style: shortString(font.style), weight: shortString(font.weight),
      count: typeof font.count === 'number' && Number.isFinite(font.count) ? Math.min(PAGE_FONT_SAMPLE_LIMIT, Math.max(0, Math.floor(font.count))) : 0,
    })),
    sampledElements: typeof value.sampledElements === 'number' && Number.isFinite(value.sampledElements) ? Math.min(PAGE_FONT_SAMPLE_LIMIT, Math.max(0, Math.floor(value.sampledElements))) : 0,
    facesTruncated: value.facesTruncated === true || faces.length > PAGE_FONT_FACE_LIMIT,
  };
}

export async function inspectPageFonts(contents: Pick<WebContents, 'executeJavaScriptInIsolatedWorld'>, timeoutMs = 3000): Promise<FontData> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(999, [{ code: PAGE_FONT_PROBE }], false),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Страница не ответила на запрос шрифтов. Повторите попытку.')), timeoutMs);
      }),
    ]);
    return sanitizeFontData(raw);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
