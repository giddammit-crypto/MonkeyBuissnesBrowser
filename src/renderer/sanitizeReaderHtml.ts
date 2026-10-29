/** Website HTML enters the privileged browser shell only through this allowlist. */
export function sanitizeReaderHtml(html: string, pageUrl: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set([
    'P', 'DIV', 'SPAN', 'ARTICLE', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP',
    'BLOCKQUOTE', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
    'FIGURE', 'FIGCAPTION', 'A', 'IMG', 'TIME', 'PICTURE', 'SOURCE'
  ]);
  const discard = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'IFRAME', 'OBJECT', 'EMBED',
    'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'TEMPLATE', 'NOSCRIPT'
  ]);

  const safeUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('data:image/')) {
      return trimmed;
    }
    try {
      const url = new URL(trimmed, pageUrl);
      return ['https:', 'http:', 'blob:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  };

  const extractBestSrcsetUrl = (srcset: string | null | undefined): string | null => {
    if (!srcset) return null;
    const entries = srcset.split(',').map((s) => s.trim()).filter(Boolean);
    if (entries.length === 0) return null;

    let bestUrl: string | null = null;
    let maxDescriptor = -1;

    for (const entry of entries) {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      if (!url) continue;

      let descriptorVal = 1;
      if (parts[1]) {
        const match = parts[1].match(/^(\d+(?:\.\d+)?)(w|x)$/i);
        if (match) {
          const num = parseFloat(match[1]);
          descriptorVal = match[2].toLowerCase() === 'x' ? num * 1000 : num;
        }
      }

      if (descriptorVal > maxDescriptor) {
        maxDescriptor = descriptorVal;
        bestUrl = url;
      }
    }

    return bestUrl || entries[0].split(/\s+/)[0] || null;
  };

  const sanitizeSrcset = (rawSrcset: string | null | undefined): string | null => {
    if (!rawSrcset) return null;
    const entries = rawSrcset.split(',').map((s) => s.trim()).filter(Boolean);
    const validEntries: string[] = [];

    for (const entry of entries) {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      if (!url) continue;
      const safe = safeUrl(url);
      if (safe) {
        const descriptor = parts.slice(1).join(' ');
        validEntries.push(descriptor ? `${safe} ${descriptor}` : safe);
      }
    }

    return validEntries.length > 0 ? validEntries.join(', ') : null;
  };

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || discard.has(element.tagName)) {
      element.remove();
      continue;
    }
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const tagName = element.tagName;

    // Anchor (A) handling
    const href = tagName === 'A' ? safeUrl(element.getAttribute('href')) : null;

    // Image (IMG) handling
    let imgValidSrc: string | null = null;
    let imgAlt: string | null = null;
    let imgTitle: string | null = null;

    if (tagName === 'IMG') {
      const rawCandidates: (string | null | undefined)[] = [
        element.getAttribute('src'),
        element.getAttribute('data-src'),
        element.getAttribute('data-original'),
        element.getAttribute('data-lazy-src'),
        element.getAttribute('data-actualsrc'),
        element.getAttribute('data-full-src'),
        element.getAttribute('data-orig-file'),
        element.getAttribute('data-url'),
        element.getAttribute('data-image'),
        extractBestSrcsetUrl(element.getAttribute('srcset')),
        extractBestSrcsetUrl(element.getAttribute('data-srcset')),
        extractBestSrcsetUrl(element.getAttribute('data-lazy-srcset')),
      ];

      const firstSrc = element.getAttribute('src');
      const isPlaceholder = firstSrc && (
        (firstSrc.startsWith('data:image/') && firstSrc.length < 200) ||
        firstSrc.includes('blank.gif') ||
        firstSrc.includes('transparent.gif') ||
        firstSrc.includes('spacer.gif')
      );

      const candidateList = (isPlaceholder && rawCandidates.slice(1).some((c) => Boolean(c)))
        ? [...rawCandidates.slice(1), firstSrc]
        : rawCandidates;

      for (const candidate of candidateList) {
        if (!candidate) continue;
        const validated = safeUrl(candidate);
        if (validated) {
          imgValidSrc = validated;
          break;
        }
      }

      imgAlt = element.getAttribute('alt');
      imgTitle = element.getAttribute('title');
    }

    // Source (SOURCE) handling
    let sourceSrcset: string | null = null;
    let sourceType: string | null = null;
    let sourceMedia: string | null = null;

    if (tagName === 'SOURCE') {
      sourceSrcset = sanitizeSrcset(element.getAttribute('srcset'));
      const rawType = element.getAttribute('type');
      if (rawType && /^image\/[a-zA-Z0-9.+_-]+$/i.test(rawType)) {
        sourceType = rawType;
      }
      const rawMedia = element.getAttribute('media');
      if (rawMedia && !/[<>"'`;]/.test(rawMedia)) {
        sourceMedia = rawMedia;
      }
    }

    // Strip all website attributes (prevents injection of scripts, inline CSS, or impersonating browser UI)
    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }

    // Reapply allowed sanitized attributes
    if (tagName === 'A' && href) {
      element.setAttribute('href', href);
    }

    if (tagName === 'IMG') {
      if (imgValidSrc) {
        element.setAttribute('src', imgValidSrc);
        element.setAttribute('loading', 'lazy');
        element.setAttribute('decoding', 'async');
        element.setAttribute('referrerpolicy', 'no-referrer');
        if (imgAlt) element.setAttribute('alt', imgAlt);
        if (imgTitle) element.setAttribute('title', imgTitle);
      } else {
        element.remove();
        continue;
      }
    }

    if (tagName === 'SOURCE') {
      if (sourceSrcset) {
        element.setAttribute('srcset', sourceSrcset);
        if (sourceType) element.setAttribute('type', sourceType);
        if (sourceMedia) element.setAttribute('media', sourceMedia);
      } else {
        element.remove();
        continue;
      }
    }
  }

  return template.innerHTML;
}
