/** Website HTML enters the privileged browser shell only through this allowlist. */
export function sanitizeReaderHtml(html: string, pageUrl: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['P', 'DIV', 'SPAN', 'ARTICLE', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'BLOCKQUOTE', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'FIGURE', 'FIGCAPTION', 'A', 'IMG', 'TIME']);
  const discard = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'TEMPLATE', 'NOSCRIPT']);
  const safeUrl = (raw: string | null): string | null => {
    if (!raw) return null;
    try {
      const url = new URL(raw, pageUrl);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
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
    const href = element.tagName === 'A' ? safeUrl(element.getAttribute('href')) : null;
    const src = element.tagName === 'IMG' ? safeUrl(element.getAttribute('src')) : null;
    const alt = element.tagName === 'IMG' ? element.getAttribute('alt') : null;
    // No website ids, CSS classes, handlers or other executable attributes enter
    // the shell. This also prevents article CSS from impersonating browser UI.
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    if (href) element.setAttribute('href', href);
    if (src) {
      element.setAttribute('src', src);
      element.setAttribute('loading', 'lazy');
      element.setAttribute('referrerpolicy', 'no-referrer');
    }
    if (alt) element.setAttribute('alt', alt);
  }
  return template.innerHTML;
}
