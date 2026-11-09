import { describe, expect, it } from 'vitest';
import { parseXml } from '../../src/services/xslt/xml';
import { XsltStylesheet, XsltError } from '../../src/services/xslt/processor';
import { normalizeStylesheetDocument } from '../../src/services/xslt/XsltSupport';

const transform = (stylesheet: string, source: string, params?: Record<string, string>) =>
  XsltStylesheet.compile(parseXml(stylesheet)).transform(parseXml(source), new Map(Object.entries(params ?? {})));

const XSL = 'http://www.w3.org/1999/XSL/Transform';

describe('XSLT processor', () => {
  it('renders an RSS feed as HTML with apply-templates, AVT attributes and xsl:if', () => {
    const style = `<?xml version="1.0"?><xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:output method="html" omit-xml-declaration="yes"/>
      <xsl:template match="/"><html><head><title><xsl:value-of select="/rss/channel/title"/></title></head>
        <body><h1><xsl:value-of select="/rss/channel/title"/></h1>
        <ul><xsl:apply-templates select="/rss/channel/item"/></ul></body></html></xsl:template>
      <xsl:template match="item"><li class="entry"><a href="{link}"><xsl:value-of select="title"/></a>
        <xsl:if test="position() = 1"><span class="first">· новый</span></xsl:if></li></xsl:template>
    </xsl:stylesheet>`;
    const source = `<?xml version="1.0" encoding="utf-8"?><rss><channel><title>Библиотека 33</title>
      <item><title>Первая</title><link>https://example.test/1</link></item>
      <item><title>Вторая</title><link>https://example.test/2?a=1&amp;b=2</link></item>
      </channel></rss>`;
    const result = transform(style, source);
    expect(result.method).toBe('html');
    expect(result.output).toContain('<title>Библиотека 33</title>');
    expect(result.output).toContain('<a href="https://example.test/1">Первая</a>');
    expect(result.output).toContain('<a href="https://example.test/2?a=1&amp;b=2">Вторая</a>');
    expect(result.output).toContain('<span class="first">· новый</span>');
    expect(result.output.indexOf('Первая')).toBeLessThan(result.output.indexOf('Вторая'));
  });

  it('sorts, chooses, declares variables and calls named templates with parameters', () => {
    const style = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:output method="html" omit-xml-declaration="yes"/>
      <xsl:template match="/"><xsl:variable name="count" select="count(/list/item)"/>
        <p>Всего: <xsl:value-of select="$count"/></p>
        <xsl:for-each select="/list/item"><xsl:sort select="rank" data-type="number" order="descending"/>
          <xsl:call-template name="row"><xsl:with-param name="label" select="name"/></xsl:call-template>
        </xsl:for-each>
      </xsl:template>
      <xsl:template name="row"><xsl:param name="label"/>
        <xsl:choose>
          <xsl:when test="$label = 'второй'"><b><xsl:value-of select="$label"/></b></xsl:when>
          <xsl:otherwise><i><xsl:value-of select="$label"/></i></xsl:otherwise>
        </xsl:choose>
      </xsl:template>
    </xsl:stylesheet>`;
    const source = '<list><item><name>первый</name><rank>1</rank></item><item><name>второй</name><rank>3</rank></item><item><name>третий</name><rank>2</rank></item></list>';
    const result = transform(style, source);
    expect(result.output).toContain('Всего: 3');
    expect(result.output.indexOf('второй')).toBeLessThan(result.output.indexOf('третий'));
    expect(result.output.indexOf('третий')).toBeLessThan(result.output.indexOf('первый'));
    expect(result.output).toContain('<b>второй</b>');
    expect(result.output).toContain('<i>первый</i>');
  });

  it('supports modes, template priorities, copy-of and disable-output-escaping', () => {
    const style = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:output method="xml" omit-xml-declaration="yes"/>
      <xsl:template match="/"><out><xsl:apply-templates select="//p"/><xsl:apply-templates select="//raw" mode="raw"/></out></xsl:template>
      <xsl:template match="p"><p><xsl:value-of select="."/></p></xsl:template>
      <xsl:template match="p" priority="5"><P><xsl:value-of select="."/></P></xsl:template>
      <xsl:template match="raw" mode="raw"><xsl:value-of select="." disable-output-escaping="yes"/></xsl:template>
    </xsl:stylesheet>`;
    const source = '<doc><p>one</p><p>two</p><raw>&lt;b&gt;bold&lt;/b&gt;</raw></doc>';
    const result = transform(style, source);
    expect(result.output).toContain('<P>one</P>');
    expect(result.output).toContain('<b>bold</b>');
  });

  it('produces text output and escapes markup in xml output', () => {
    const textStyle = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output method="text"/>
      <xsl:template match="/"><xsl:for-each select="/r/i"><xsl:value-of select="."/><xsl:text>&#10;</xsl:text></xsl:for-each></xsl:template></xsl:stylesheet>`;
    const textResult = transform(textStyle, '<r><i>a</i><i>&lt;b&gt;</i></r>');
    expect(textResult.method).toBe('text');
    expect(textResult.output.trim().split('\n')).toEqual(['a', '<b>']);

    const xmlStyle = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output method="xml" omit-xml-declaration="yes"/>
      <xsl:template match="/"><v><xsl:value-of select="/r/i"/></v></xsl:template></xsl:stylesheet>`;
    expect(transform(xmlStyle, '<r><i>a &amp; b</i></r>').output).toBe('<v>a &amp; b</v>');
  });

  it('copies nodes and constructs attributes programmatically', () => {
    const style = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output method="xml" omit-xml-declaration="yes"/>
      <xsl:template match="/"><xsl:element name="wrapper"><xsl:attribute name="count"><xsl:value-of select="count(/r/i)"/></xsl:attribute>
        <xsl:copy-of select="/r/i"/></xsl:element></xsl:template></xsl:stylesheet>`;
    expect(transform(style, '<r><i a="1">x</i><i>y</i></r>').output)
      .toBe('<wrapper count="2"><i a="1">x</i><i>y</i></wrapper>');
  });

  it('accepts simplified stylesheets and rejects unsupported instructions explicitly', () => {
    const simplified = `<html xsl:version="1.0" xmlns:xsl="${XSL}"><body><xsl:value-of select="/doc/t"/></body></html>`;
    const normalized = normalizeStylesheetDocument(parseXml(simplified));
    const result = XsltStylesheet.compile(normalized).transform(parseXml('<doc><t>ok</t></doc>'));
    expect(result.output).toContain('<body>ok</body>');

    const unsupported = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:template match="/"><xsl:apply-imports/></xsl:template></xsl:stylesheet>`;
    expect(() => transform(unsupported, '<r/>')).toThrow(XsltError);
    expect(() => transform(`<xsl:stylesheet version="2.0" xmlns:xsl="${XSL}"/>`, '<r/>')).toThrow(/1\.0/);
  });

  it('never expands external entities or allows document()', () => {
    const style = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:template match="/"><xsl:value-of select="document('/etc/passwd')"/></xsl:template></xsl:stylesheet>`;
    expect(() => transform(style, '<r/>')).toThrow(/document\(\)/);
  });
});
