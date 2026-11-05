/**
 * Font compatibility helpers shared by the main process and the renderer.
 *
 * Three independent failure modes make a site look like it "lost its font":
 *  1. the web font request never completes (ad blocker, CSP, CORS, 404, decode),
 *  2. the stylesheet asks for a font that only exists on Windows/macOS,
 *  3. the browser falls back silently, so the user cannot tell why.
 *
 * Everything here is pure and bounded so it can be unit tested without Chromium.
 */

export const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial',
  'unset', 'revert', 'revert-layer', 'default', 'none', 'auto', 'text',
  'caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar',
]);

/** Families that exist on Windows/macOS installations but rarely on Linux. */
export interface FontSubstitutionRule {
  /** CSS `local()` candidates in order of visual closeness. */
  locals: string[];
  /** Generic family used when no candidate is installed. */
  generic: string;
}

export const FONT_SUBSTITUTIONS: Readonly<Record<string, FontSubstitutionRule>> = {
  'monotype corsiva': { locals: ['Monotype Corsiva', 'URW Chancery L', 'Z003', 'Apple Chancery', 'TeX Gyre Chorus'], generic: 'cursive' },
  'monomakh': { locals: ['Monomakh', 'PT Serif', 'Liberation Serif', 'DejaVu Serif'], generic: 'serif' },
  'times new roman': { locals: ['Times New Roman', 'Liberation Serif', 'Tinos', 'Nimbus Roman', 'DejaVu Serif'], generic: 'serif' },
  'times': { locals: ['Times', 'Liberation Serif', 'Nimbus Roman'], generic: 'serif' },
  'arial': { locals: ['Arial', 'Liberation Sans', 'Arimo', 'Nimbus Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'helvetica': { locals: ['Helvetica', 'Liberation Sans', 'Nimbus Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'verdana': { locals: ['Verdana', 'DejaVu Sans', 'Bitstream Vera Sans'], generic: 'sans-serif' },
  'tahoma': { locals: ['Tahoma', 'DejaVu Sans', 'Liberation Sans'], generic: 'sans-serif' },
  'georgia': { locals: ['Georgia', 'Gelasio', 'DejaVu Serif'], generic: 'serif' },
  'calibri': { locals: ['Calibri', 'Carlito', 'Liberation Sans'], generic: 'sans-serif' },
  'cambria': { locals: ['Cambria', 'Caladea', 'Liberation Serif'], generic: 'serif' },
  'candara': { locals: ['Candara', 'Carlito', 'DejaVu Sans'], generic: 'sans-serif' },
  'segoe ui': { locals: ['Segoe UI', 'Selawik', 'Open Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'segoe script': { locals: ['Segoe Script', 'URW Chancery L', 'Z003'], generic: 'cursive' },
  'courier new': { locals: ['Courier New', 'Liberation Mono', 'Cousine', 'DejaVu Sans Mono'], generic: 'monospace' },
  'consolas': { locals: ['Consolas', 'Inconsolata', 'DejaVu Sans Mono'], generic: 'monospace' },
  'lucida console': { locals: ['Lucida Console', 'DejaVu Sans Mono'], generic: 'monospace' },
  'trebuchet ms': { locals: ['Trebuchet MS', 'Fira Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'comic sans ms': { locals: ['Comic Sans MS', 'Comic Neue', 'URW Chancery L'], generic: 'cursive' },
  'garamond': { locals: ['Garamond', 'EB Garamond', 'Gelasio', 'DejaVu Serif'], generic: 'serif' },
  'palatino linotype': { locals: ['Palatino Linotype', 'URW Palladio L', 'P052', 'DejaVu Serif'], generic: 'serif' },
  'palatino': { locals: ['Palatino', 'URW Palladio L', 'DejaVu Serif'], generic: 'serif' },
  'century gothic': { locals: ['Century Gothic', 'URW Gothic', 'Montserrat', 'DejaVu Sans'], generic: 'sans-serif' },
  'franklin gothic medium': { locals: ['Franklin Gothic Medium', 'URW Gothic', 'DejaVu Sans'], generic: 'sans-serif' },
  'impact': { locals: ['Impact', 'Archivo Black', 'DejaVu Sans'], generic: 'sans-serif' },
  'brush script mt': { locals: ['Brush Script MT', 'URW Chancery L', 'Z003'], generic: 'cursive' },
  'lucida sans unicode': { locals: ['Lucida Sans Unicode', 'DejaVu Sans'], generic: 'sans-serif' },
  'ms sans serif': { locals: ['MS Sans Serif', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'pt sans': { locals: ['PT Sans', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'pt serif': { locals: ['PT Serif', 'Liberation Serif', 'DejaVu Serif'], generic: 'serif' },
  'ibm plex sans': { locals: ['IBM Plex Sans', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'roboto': { locals: ['Roboto', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'open sans': { locals: ['Open Sans', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'lato': { locals: ['Lato', 'Liberation Sans', 'DejaVu Sans'], generic: 'sans-serif' },
  'noto sans': { locals: ['Noto Sans', 'DejaVu Sans', 'Liberation Sans'], generic: 'sans-serif' },
  'noto serif': { locals: ['Noto Serif', 'DejaVu Serif', 'Liberation Serif'], generic: 'serif' },
};

const CSS_QUOTES = /^["']|["']$/g;

export function normalizeFontFamily(family: string): string {
  return family.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/** Splits a CSS `font-family` value without breaking quoted names. */
export function parseFontFamilyList(value: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote = '';
  for (const char of value.slice(0, 1024)) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ',') {
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) families.push(current.trim());
  return [...new Set(families.map(family => family.replace(CSS_QUOTES, '').trim()).filter(Boolean))];
}

export function isGenericFontFamily(family: string): boolean {
  return GENERIC_FONT_FAMILIES.has(normalizeFontFamily(family));
}

export function fontSubstitutionFor(family: string): FontSubstitutionRule | undefined {
  return FONT_SUBSTITUTIONS[normalizeFontFamily(family)];
}

/**
 * CSS that maps a missing family onto an installed lookalike. `local()` only
 * succeeds when one of the candidates exists, so a page without any candidate
 * keeps its previous fallback instead of rendering blank text.
 */
export function buildFontSubstitutionCss(families: readonly string[]): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const family of families.slice(0, 24)) {
    const key = normalizeFontFamily(family);
    if (!key || seen.has(key) || isGenericFontFamily(key)) continue;
    seen.add(key);
    const rule = FONT_SUBSTITUTIONS[key];
    if (!rule) continue;
    const locals = rule.locals.map(name => `local("${name.replace(/["\\]/g, '')}")`).join(',');
    rules.push(`@font-face{font-family:"${family.replace(/["\\]/g, '')}";src:${locals};font-display:swap;}`);
  }
  return rules.join('\n');
}

export type FontIssueKind = 'blocked' | 'network' | 'http' | 'decode' | 'cors' | 'csp' | 'missing-local';

export interface FontIssue {
  kind: FontIssueKind;
  /** Host + path without query or credentials, bounded. */
  url?: string;
  detail: string;
}

const ISSUE_DETAIL_LIMIT = 200;

export function clipFontDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, ISSUE_DETAIL_LIMIT);
}

/** Removes credentials, query and fragment so diagnostics never leak tokens. */
export function sanitizeFontUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLowerCase().slice(0, 120);
    return `${host}${url.pathname.slice(0, 120)}`;
  } catch {
    return undefined;
  }
}

/**
 * Chromium reports the actual font failure only in the DevTools console. These
 * are the bounded patterns we recognise; everything else is ignored.
 */
export function classifyFontConsoleMessage(message: string): FontIssueKind | undefined {
  const text = message.slice(0, 400);
  // Decode failures name the font engine but not always the word "font".
  if (/OTS parsing error|Failed to decode downloaded font|invalid font data|Unable to decode/i.test(text)) return 'decode';
  const mentionsFont = /font|woff2?|ttf|otf|eot/i.test(text);
  if (!mentionsFont) return undefined;
  if (/Access-Control-Allow-Origin|CORS policy/i.test(text)) return 'cors';
  if (/Content Security Policy|Refused to load the (?:font|stylesheet)/i.test(text)) return 'csp';
  if (/net::ERR_[A-Z_]+|ERR_CONNECTION|Failed to load resource/i.test(text)) return 'network';
  return undefined;
}

export interface FontHeaderRelaxOptions {
  enabled: boolean;
  resourceType?: string;
  responseUrl: string;
  /** Document origin when Chromium exposes it; unused when unknown. */
  initiatorOrigin?: string;
}

export interface FontHeaderRelaxResult {
  headers: Record<string, string[]>;
  changed: boolean;
}

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * Browser engines older than Chromium used to accept cross-origin web fonts
 * without an `Access-Control-Allow-Origin` header. Many legacy sites (including
 * the typography of old CMS templates) still rely on that. Relaxing only the
 * font response keeps script/style/media CORS checks untouched.
 */
export function relaxFontResponseHeaders(
  headers: Record<string, string[]>,
  options: FontHeaderRelaxOptions,
): FontHeaderRelaxResult {
  if (!options.enabled || options.resourceType !== 'font') return { headers, changed: false };
  if (options.initiatorOrigin && sameOrigin(options.initiatorOrigin, options.responseUrl)) {
    return { headers, changed: false };
  }
  const next: Record<string, string[]> = { ...headers };
  let changed = false;
  const find = (name: string): string | undefined => Object.keys(next).find(key => key.toLowerCase() === name);
  if (!find('access-control-allow-origin')) {
    next['Access-Control-Allow-Origin'] = ['*'];
    changed = true;
  }
  const corpKey = find('cross-origin-resource-policy');
  if (corpKey) {
    const value = (next[corpKey] ?? []).join(',').toLowerCase();
    if (value.includes('same-origin') || value.includes('same-site')) {
      next[corpKey] = ['cross-origin'];
      changed = true;
    }
  }
  return { headers: next, changed };
}

/** Families declared in CSS that are neither a loaded web font nor installed. */
export function detectMissingFamilies(input: {
  computedFonts: ReadonlyArray<{ family: string }>;
  faces: ReadonlyArray<{ family: string; status: string }>;
  availability: ReadonlyArray<{ family: string; webFont: boolean; local: boolean }>;
}): string[] {
  const loadedWebFonts = new Set(
    input.faces.filter(face => face.status === 'loaded' || face.status === 'loading')
      .map(face => normalizeFontFamily(face.family)),
  );
  const availability = new Map(input.availability.map(entry => [normalizeFontFamily(entry.family), entry]));
  const declaredWebFonts = new Set(input.faces.map(face => normalizeFontFamily(face.family)));
  const missing: string[] = [];
  for (const font of input.computedFonts) {
    for (const family of parseFontFamilyList(font.family)) {
      const key = normalizeFontFamily(family);
      if (!key || isGenericFontFamily(key) || missing.includes(family)) continue;
      if (loadedWebFonts.has(key)) continue;
      const entry = availability.get(key);
      if (entry && (entry.local || entry.webFont)) continue;
      // A declared but unloaded/erroring web font is a real failure, not "missing".
      if (declaredWebFonts.has(key)) continue;
      // Without a measurement entry we cannot claim the font is missing.
      if (!entry) continue;
      if (entry.local === false && entry.webFont === false) missing.push(family);
    }
  }
  return missing.slice(0, 24);
}
