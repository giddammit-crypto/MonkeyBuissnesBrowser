import type { WebContents } from 'electron';
import type { PageFontAvailability, PageFontFace, PageFontReport } from '../../shared/types';
import { detectMissingFamilies } from '../../shared/fontCompat';

export const PAGE_FONT_SAMPLE_LIMIT = 150;
export const PAGE_FONT_FACE_LIMIT = 100;
export const PAGE_FONT_FAMILY_LIMIT = 16;

// A constant program in the preload isolated world: no site-owned helper,
// textContent, HTML, request URLs, cookies, downloads or font-loading calls.
// TreeWalker avoids materializing the entire DOM for a bounded sample.
// Font availability is measured with canvas metrics against two generic
// fallbacks, because `document.fonts.check()` returns true for unknown families.
export const PAGE_FONT_PROBE = `(() => {
  const clip = value => String(value || '').slice(0, 256);
  const faces = [];
  let facesTruncated = false;
  const webFonts = new Set();
  for (const face of document.fonts) {
    const family = clip(face.family);
    if (face.status === 'loaded' || face.status === 'loading') webFonts.add(family.toLowerCase());
    if (faces.length >= ${PAGE_FONT_FACE_LIMIT}) { facesTruncated = true; continue; }
    faces.push({ family, style: clip(face.style), weight: clip(face.weight), status: face.status });
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
  const genericFamilies = ['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','math','emoji','fangsong','-apple-system','blinkmacsystemfont','inherit','initial','unset','revert','revert-layer','default','none','auto','text','caption','icon','menu','message-box','small-caption','status-bar'];
  const splitFamilies = value => {
    const out = [];
    let current = '';
    let quote = '';
    for (const char of String(value || '').slice(0, 512)) {
      if (quote) { if (char === quote) quote = ''; else current += char; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === ',') { if (current.trim()) out.push(current.trim()); current = ''; continue; }
      current += char;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  };
  const candidates = [];
  for (const font of computed.values()) {
    for (const family of splitFamilies(font.family)) {
      const key = family.toLowerCase();
      if (!key || genericFamilies.indexOf(key) >= 0) continue;
      if (candidates.indexOf(family) < 0) candidates.push(family);
      if (candidates.length >= ${PAGE_FONT_FAMILY_LIMIT}) break;
    }
    if (candidates.length >= ${PAGE_FONT_FAMILY_LIMIT}) break;
  }
  const familyAvailability = [];
  let context = null;
  try {
    if (typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      context = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    }
  } catch { context = null; }
  let measurable = false;
  const sample = 'mmmmwwwwiiii0123456789ЖЖЖЩЩЮЯ';
  const measure = font => { try { context.font = font; return context.measureText(sample).width; } catch { return -1; } };
  if (context) {
    try {
      const mono = measure('72px monospace');
      const serif = measure('72px serif');
      const sans = measure('72px sans-serif');
      measurable = mono > 0 && serif > 0 && sans > 0 && (mono !== serif || serif !== sans || mono !== sans);
      if (measurable) {
        for (const family of candidates) {
          const quoted = '"' + family.replace(/["\\\\]/g, '') + '"';
          const withMono = measure('72px ' + quoted + ', monospace');
          const withSerif = measure('72px ' + quoted + ', serif');
          familyAvailability.push({
            family,
            webFont: webFonts.has(family.toLowerCase()),
            local: withMono !== mono || withSerif !== serif,
          });
        }
      }
    } catch { measurable = false; }
  }
  return { documentStatus: document.fonts.status, faces, computedFonts: [...computed.values()], sampledElements, facesTruncated, familyAvailability };
})()`;

type FontData = Omit<PageFontReport, 'tabId' | 'sampledAt' | 'issues' | 'compatibility'>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown): string => typeof value === 'string' ? value.slice(0, 256) : '';

function sanitizeAvailability(value: unknown): PageFontAvailability[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PAGE_FONT_FAMILY_LIMIT).filter(record).map(entry => ({
    family: shortString(entry.family),
    webFont: entry.webFont === true,
    local: entry.local === true,
  })).filter(entry => entry.family.length > 0);
}

export function sanitizeFontData(value: unknown): FontData {
  if (!record(value) || !['loaded', 'loading'].includes(String(value.documentStatus))) {
    throw new Error('Не удалось прочитать состояние шрифтов страницы.');
  }
  const faces = Array.isArray(value.faces) ? value.faces : [];
  const computed = Array.isArray(value.computedFonts) ? value.computedFonts : [];
  const sanitizedFaces: PageFontFace[] = faces.slice(0, PAGE_FONT_FACE_LIMIT).filter(record).filter(face => ['unloaded', 'loading', 'loaded', 'error'].includes(String(face.status))).map(face => ({
    family: shortString(face.family), style: shortString(face.style), weight: shortString(face.weight), status: face.status as PageFontFace['status'],
  }));
  const computedFonts = computed.slice(0, PAGE_FONT_SAMPLE_LIMIT).filter(record).map(font => ({
    family: shortString(font.family), style: shortString(font.style), weight: shortString(font.weight),
    count: typeof font.count === 'number' && Number.isFinite(font.count) ? Math.min(PAGE_FONT_SAMPLE_LIMIT, Math.max(0, Math.floor(font.count))) : 0,
  }));
  const familyAvailability = sanitizeAvailability(value.familyAvailability);
  return {
    documentStatus: value.documentStatus as FontData['documentStatus'],
    faces: sanitizedFaces,
    computedFonts,
    sampledElements: typeof value.sampledElements === 'number' && Number.isFinite(value.sampledElements) ? Math.min(PAGE_FONT_SAMPLE_LIMIT, Math.max(0, Math.floor(value.sampledElements))) : 0,
    facesTruncated: value.facesTruncated === true || faces.length > PAGE_FONT_FACE_LIMIT,
    familyAvailability,
    missingFamilies: detectMissingFamilies({ computedFonts, faces: sanitizedFaces, availability: familyAvailability }),
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
