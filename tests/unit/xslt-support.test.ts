import { describe, expect, it, vi } from 'vitest';
import {
  XsltSupport, isXmlContentType, parseXmlStylesheetInstructions, resolveStylesheetUrl,
  supportsXsltContentType, type XsltFetchResponse,
} from '../../src/services/xslt/XsltSupport';

const XSL = 'http://www.w3.org/1999/XSL/Transform';
const STYLE = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output method="html" omit-xml-declaration="yes"/>
  <xsl:template match="/"><h1><xsl:value-of select="/doc/t"/></h1></xsl:template></xsl:stylesheet>`;

const fetcher = (files: Record<string, string>) => vi.fn(async (url: string): Promise<XsltFetchResponse> => ({
  ok: url in files, status: url in files ? 200 : 404, url, contentType: 'text/xsl', text: files[url] ?? '',
}));

describe('XSLT detection', () => {
  it('recognises XML content types but keeps HTML and SVG out of the transform path', () => {
    expect(isXmlContentType('application/xml; charset=utf-8')).toBe(true);
    expect(isXmlContentType('application/rss+xml')).toBe(true);
    expect(isXmlContentType('text/html')).toBe(false);
    expect(supportsXsltContentType('image/svg+xml')).toBe(false);
    expect(supportsXsltContentType('text/xml')).toBe(true);
  });

  it('reads only XSLT processing instructions and ignores CSS ones', () => {
    const xml = `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="style.css"?>
      <?xml-stylesheet type="text/xsl" href="/theme/feed.xsl" title="Лента"?><rss/>`;
    const found = parseXmlStylesheetInstructions(xml);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ href: '/theme/feed.xsl', type: 'text/xsl', title: 'Лента' });
  });

  it('prefers a primary instruction over an alternate one and resolves relative hrefs', () => {
    const xml = `<?xml-stylesheet type="text/xsl" href="a.xsl" alternate="yes"?><?xml-stylesheet type="text/xsl" href="b.xsl"?><r/>`;
    expect(parseXmlStylesheetInstructions(xml)[0].href).toBe('b.xsl');
    expect(resolveStylesheetUrl('../x.xsl', 'https://example.test/a/b/doc.xml')).toBe('https://example.test/a/x.xsl');
    expect(resolveStylesheetUrl('file:///etc/passwd', 'https://example.test/doc.xml')).toBeUndefined();
  });
});

describe('XsltSupport', () => {
  it('transforms an XML document with a same-origin stylesheet', async () => {
    const fetch = fetcher({ 'https://site.test/feed.xsl': STYLE });
    const support = new XsltSupport(fetch);
    const outcome = await support.transform({
      xml: '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="/feed.xsl"?><doc><t>Привет</t></doc>',
      documentUrl: 'https://site.test/feed.xml',
      stylesheetHref: '/feed.xsl',
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.html).toContain('<h1>Привет</h1>');
    expect(outcome.method).toBe('html');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches a stylesheet between transforms', async () => {
    const fetch = fetcher({ 'https://site.test/feed.xsl': STYLE });
    const support = new XsltSupport(fetch);
    const request = { xml: '<doc><t>1</t></doc>', documentUrl: 'https://site.test/a.xml', stylesheetHref: 'https://site.test/feed.xsl' };
    expect((await support.transform(request)).status).toBe('ok');
    expect((await support.transform(request)).status).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses cross-origin stylesheets, cycles and oversized documents', async () => {
    const support = new XsltSupport(fetcher({ 'https://cdn.test/feed.xsl': STYLE }));
    expect((await support.transform({
      xml: '<doc/>', documentUrl: 'https://site.test/a.xml', stylesheetHref: 'https://cdn.test/feed.xsl',
    })).status).toBe('error');

    const cyclic = new XsltSupport(fetcher({
      'https://site.test/a.xsl': `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:include href="b.xsl"/></xsl:stylesheet>`,
      'https://site.test/b.xsl': `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:include href="a.xsl"/></xsl:stylesheet>`,
    }));
    const cycle = await cyclic.transform({ xml: '<doc/>', documentUrl: 'https://site.test/d.xml', stylesheetHref: '/a.xsl' });
    expect(cycle.status).toBe('error');
    if (cycle.status === 'error') expect(cycle.message).toMatch(/Циклическое/);

    const huge = new XsltSupport(fetcher({}));
    expect((await huge.transform({
      xml: 'x'.repeat(4 * 1024 * 1024 + 1), documentUrl: 'https://site.test/a.xml', stylesheetHref: '/a.xsl',
    })).status).toBe('error');
  });

  it('inlines xsl:include and reports a helpful message for a missing stylesheet', async () => {
    const support = new XsltSupport(fetcher({
      'https://site.test/partial.xsl': `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
        <xsl:template match="/"><p><xsl:value-of select="/doc/t"/></p></xsl:template></xsl:stylesheet>`,
      'https://site.test/main.xsl': `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
        <xsl:include href="partial.xsl"/><xsl:output method="html" omit-xml-declaration="yes"/></xsl:stylesheet>`,
    }));
    const outcome = await support.transform({ xml: '<doc><t>ok</t></doc>', documentUrl: 'https://site.test/d.xml', stylesheetHref: '/main.xsl' });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.html).toBe('<p>ok</p>');
      expect(outcome.includes).toBe(1);
    }

    const missing = await support.transform({ xml: '<doc/>', documentUrl: 'https://site.test/d.xml', stylesheetHref: '/none.xsl' });
    expect(missing.status).toBe('error');
    if (missing.status === 'error') expect(missing.message).toMatch(/HTTP 404/);
  });

  it('reports a clear error instead of silently rendering raw XML', async () => {
    const support = new XsltSupport(fetcher({ 'https://site.test/bad.xsl': '<not-a-stylesheet/>' }));
    const outcome = await support.transform({ xml: '<doc/>', documentUrl: 'https://site.test/d.xml', stylesheetHref: '/bad.xsl' });
    expect(outcome.status).toBe('error');
  });
});
