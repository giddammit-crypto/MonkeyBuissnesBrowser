import { describe, expect, it } from 'vitest';
import {
  buildFontSubstitutionCss, classifyFontConsoleMessage, detectMissingFamilies,
  fontSubstitutionFor, isGenericFontFamily, parseFontFamilyList, relaxFontResponseHeaders,
  sanitizeFontUrl,
} from '../../src/shared/fontCompat';
import { SiteFontMonitor } from '../../src/main/services/SiteFontMonitor';

describe('font family parsing', () => {
  it('splits quoted family lists without breaking names with spaces or commas', () => {
    expect(parseFontFamilyList('"Monotype Corsiva", Times New Roman, serif')).toEqual(['Monotype Corsiva', 'Times New Roman', 'serif']);
    expect(parseFontFamilyList("'PT Sans',Arial ,  sans-serif")).toEqual(['PT Sans', 'Arial', 'sans-serif']);
    expect(parseFontFamilyList('')).toEqual([]);
  });

  it('recognises generic families and knows lookalikes', () => {
    expect(isGenericFontFamily('SANS-SERIF')).toBe(true);
    expect(isGenericFontFamily('system-ui')).toBe(true);
    expect(isGenericFontFamily('Monomakh')).toBe(false);
    expect(fontSubstitutionFor('monotype corsiva')?.generic).toBe('cursive');
    expect(fontSubstitutionFor('Times New Roman')?.locals).toContain('Liberation Serif');
    expect(fontSubstitutionFor('Some Site Font')).toBeUndefined();
  });
});

describe('font substitution CSS', () => {
  it('emits only local() sources so a missing lookalike keeps the old fallback', () => {
    const css = buildFontSubstitutionCss(['Monotype Corsiva', 'Arial']);
    expect(css).toContain('@font-face{font-family:"Monotype Corsiva";src:local("Monotype Corsiva"),local("URW Chancery L")');
    expect(css).toContain('font-family:"Arial"');
    // No remote src: substitution must never fetch a font from the network.
    expect(css).not.toMatch(/url\(/i);
  });

  it('ignores generics, unknown families, duplicates and injection attempts', () => {
    const css = buildFontSubstitutionCss(['serif', 'Mystery Font', 'Arial', 'arial', 'Arial";}body{display:none}']);
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).not.toContain('body{display:none}');
  });
});

describe('legacy font CORS relaxation', () => {
  const fontHeaders = { 'content-type': ['font/woff2'], 'cross-origin-resource-policy': ['same-origin'] };

  it('adds a wildcard CORS header for font responses only', () => {
    const relaxed = relaxFontResponseHeaders(fontHeaders, { enabled: true, resourceType: 'font', responseUrl: 'https://cdn.test/f.woff2' });
    expect(relaxed.changed).toBe(true);
    expect(relaxed.headers['Access-Control-Allow-Origin']).toEqual(['*']);
    expect(relaxed.headers['cross-origin-resource-policy']).toEqual(['cross-origin']);
    expect(relaxed.headers['content-type']).toEqual(['font/woff2']);

    for (const resourceType of ['script', 'stylesheet', 'image', 'xhr', 'mainFrame', undefined]) {
      expect(relaxFontResponseHeaders(fontHeaders, { enabled: true, resourceType, responseUrl: 'https://cdn.test/x' }).changed).toBe(false);
    }
  });

  it('respects the user setting, same-origin responses and an existing CORS header', () => {
    expect(relaxFontResponseHeaders(fontHeaders, { enabled: false, resourceType: 'font', responseUrl: 'https://cdn.test/f.woff2' }).changed).toBe(false);
    expect(relaxFontResponseHeaders(fontHeaders, {
      enabled: true, resourceType: 'font', responseUrl: 'https://site.test/f.woff2', initiatorOrigin: 'https://site.test',
    }).changed).toBe(false);
    const custom = { 'access-control-allow-origin': ['https://site.test'] };
    const kept = relaxFontResponseHeaders(custom, { enabled: true, resourceType: 'font', responseUrl: 'https://cdn.test/f.woff2' });
    expect(kept.changed).toBe(false);
    expect(kept.headers['access-control-allow-origin']).toEqual(['https://site.test']);
  });

  it('never mutates the caller headers object', () => {
    const original = { 'content-type': ['font/woff2'] };
    relaxFontResponseHeaders(original, { enabled: true, resourceType: 'font', responseUrl: 'https://cdn.test/f.woff2' });
    expect(original).toEqual({ 'content-type': ['font/woff2'] });
  });
});

describe('font failure classification', () => {
  it('maps Chromium console messages to actionable reasons', () => {
    expect(classifyFontConsoleMessage('Failed to decode downloaded font: https://site.test/a.woff2')).toBe('decode');
    expect(classifyFontConsoleMessage('OTS parsing error: invalid version tag')).toBe('decode');
    expect(classifyFontConsoleMessage('Access to font at https://cdn.test/f.woff2 from origin https://site.test has been blocked by CORS policy: No Access-Control-Allow-Origin')).toBe('cors');
    expect(classifyFontConsoleMessage('Refused to load the font data:font because it violates Content Security Policy')).toBe('csp');
    expect(classifyFontConsoleMessage('Failed to load resource: net::ERR_CONNECTION_RESET https://site.test/f.woff2')).toBe('network');
    expect(classifyFontConsoleMessage('Failed to load resource: net::ERR_CONNECTION_RESET')).toBeUndefined();
    expect(classifyFontConsoleMessage('Image failed to load')).toBeUndefined();
    expect(classifyFontConsoleMessage('font-display swap applied')).toBeUndefined();
  });

  it('strips credentials, query strings and fragments from reported URLs', () => {
    expect(sanitizeFontUrl('https://user:pass@cdn.test/f.woff2?token=secret#frag')).toBe('cdn.test/f.woff2');
    expect(sanitizeFontUrl('file:///etc/passwd')).toBeUndefined();
    expect(sanitizeFontUrl('not a url')).toBeUndefined();
  });
});

describe('missing family detection', () => {
  it('reports only families that are neither a web font nor installed', () => {
    const missing = detectMissingFamilies({
      computedFonts: [{ family: 'Monomakh, serif' }, { family: 'Arial, sans-serif' }, { family: 'Inter, sans-serif' }],
      faces: [{ family: 'Inter', status: 'loaded' }, { family: 'SiteFace', status: 'error' }],
      availability: [
        { family: 'Monomakh', webFont: false, local: false },
        { family: 'Arial', webFont: false, local: false },
        { family: 'Inter', webFont: true, local: false },
      ],
    });
    expect(missing).toEqual(['Monomakh', 'Arial']);
  });

  it('does not claim a font is missing without a measurement', () => {
    expect(detectMissingFamilies({ computedFonts: [{ family: 'Unknown Face' }], faces: [], availability: [] })).toEqual([]);
  });
});

describe('SiteFontMonitor', () => {
  it('keeps de-duplicated, human-readable evidence per page and forgets it on demand', () => {
    const monitor = new SiteFontMonitor();
    monitor.noteFailure(7, 'https://cdn.test/missing.woff2', 'net::ERR_FAILED');
    monitor.noteFailure(7, 'https://cdn.test/missing.woff2', 'net::ERR_FAILED');
    monitor.noteBlocked(7, 'https://ads.test/f.woff2', 'правило');
    monitor.noteConsole(7, 'OTS parsing error: bad table');
    monitor.noteConsole(7, 'some unrelated console message');
    const snapshot = monitor.snapshot(7);
    expect(snapshot).toHaveLength(3);
    expect(snapshot.filter(entry => entry.kind === 'network')).toHaveLength(1);
    expect(snapshot.find(entry => entry.kind === 'network')?.url).toBe('cdn.test/missing.woff2');
    expect(snapshot.some(entry => entry.kind === 'decode')).toBe(true);
    expect(snapshot.some(entry => entry.kind === 'blocked')).toBe(true);
    expect(snapshot.every(entry => entry.detail.length <= 200)).toBe(true);
    expect(monitor.snapshot(999)).toEqual([]);
    monitor.clear(7);
    expect(monitor.snapshot(7)).toEqual([]);
  });

  it('bounds the evidence list per page', () => {
    const monitor = new SiteFontMonitor();
    for (let index = 0; index < 60; index++) monitor.noteHttpStatus(7, `https://cdn.test/f${index}.woff2`, 404);
    expect(monitor.snapshot(7)).toHaveLength(32);
  });
});
