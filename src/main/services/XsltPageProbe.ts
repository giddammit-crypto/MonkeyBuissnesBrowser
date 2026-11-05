/**
 * Isolated-world scripts for the XSLT compatibility layer.
 *
 * They run in world 999 (the preload world), never in the page world, and only
 * read the document prolog plus a bounded serialization of the XML source.
 */

export const XSLT_PROBE_SOURCE_LIMIT = 4 * 1024 * 1024;

export const XSLT_PAGE_PROBE = `(() => {
  const notices = [];
  try {
    for (const node of document.childNodes) {
      if (node.nodeType === 7 && String(node.target || '').toLowerCase() === 'xml-stylesheet') {
        notices.push(String(node.data || '').slice(0, 2048));
        if (notices.length >= 8) break;
      }
    }
  } catch { /* A document without a prolog is not an XSLT candidate. */ }
  let xml = '';
  let truncated = false;
  try {
    const serialized = new XMLSerializer().serializeToString(document);
    truncated = serialized.length > ${XSLT_PROBE_SOURCE_LIMIT};
    xml = truncated ? serialized.slice(0, ${XSLT_PROBE_SOURCE_LIMIT}) : serialized;
  } catch { xml = ''; }
  const contentType = typeof document.contentType === 'string' ? document.contentType.slice(0, 120) : '';
  return { instructions: notices, xml, truncated, contentType };
})()`;

export interface XsltProbeResult {
  instructions: string[];
  xml: string;
  truncated: boolean;
  contentType: string;
}

export function sanitizeXsltProbeResult(value: unknown): XsltProbeResult {
  if (!value || typeof value !== 'object') throw new Error('Страница не вернула данные XML для преобразования.');
  const record = value as Record<string, unknown>;
  const instructions = Array.isArray(record.instructions)
    ? record.instructions.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 2048)).slice(0, 8)
    : [];
  const xml = typeof record.xml === 'string' ? record.xml : '';
  return {
    instructions,
    xml,
    truncated: record.truncated === true,
    contentType: typeof record.contentType === 'string' ? record.contentType.slice(0, 120) : '',
  };
}

/**
 * Rewrites the current XML document with the transform result.
 * `document.open()` switches the document to HTML, so the stylesheet output is
 * parsed by Chromium's HTML parser while the address bar keeps the real URL.
 */
export function buildXsltApplyScript(html: string, options: { notice: boolean }): string {
  const payload = JSON.stringify(html);
  const showNotice = options.notice ? 'true' : 'false';
  return `(() => {
  const html = ${payload};
  try {
    document.open();
    document.write(html);
    document.close();
  } catch (error) {
    return { applied: false, message: String(error && error.message || error) };
  }
  if (${showNotice}) {
    try {
      const badge = document.createElement('div');
      badge.setAttribute('data-soul-xslt', 'compat');
      badge.textContent = 'XSLT';
      badge.title = 'XML преобразован встроенным XSLT-совместимым движком soulm8te';
      badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;font:600 11px/1 system-ui,sans-serif;'
        + 'color:#fff;background:rgba(17,24,39,.86);border:1px solid rgba(255,255,255,.28);border-radius:999px;'
        + 'padding:5px 9px;letter-spacing:.06em;cursor:default;user-select:none;pointer-events:none;';
      document.documentElement.appendChild(badge);
      setTimeout(() => badge.remove(), 9000);
    } catch {}
  }
  return { applied: true };
})()`;
}

/** Shows a non-blocking explanation instead of silently rendering raw XML. */
export function buildXsltErrorScript(message: string): string {
  const payload = JSON.stringify(message.slice(0, 300));
  return `(() => {
  try {
    const bar = document.createElement('div');
    bar.setAttribute('data-soul-xslt', 'error');
    bar.textContent = 'XSLT: ' + ${payload};
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;font:12px/1.5 system-ui,sans-serif;'
      + 'color:#fff;background:#7c2d12;border-top:1px solid #ea580c;padding:8px 14px;';
    document.documentElement.appendChild(bar);
  } catch {}
  return true;
})()`;
}
