import { describe, expect, it } from 'vitest';
import { parseXml, serializeElement, textValue, documentRoot, lookupNamespace } from '../../src/services/xslt/xml';
import { compileXPath, evaluateXPath } from '../../src/services/xslt/xpath';

const ctx = (xml: string, expression: string, namespaces?: Record<string, string>) => {
  const root = parseXml(xml);
  return evaluateXPath(expression, {
    node: documentRoot(root)!, position: 1, size: 1, root,
    namespaces: new Map(Object.entries(namespaces ?? {})),
  });
};

describe('XSLT XML parser', () => {
  it('parses elements, attributes, text, CDATA, comments and processing instructions', () => {
    const root = parseXml(`<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="feed.xsl"?>
      <!-- prolog -->
      <feed><title>A &amp; B</title><entry><![CDATA[<raw>]]></entry><!-- inner --></feed>`);
    expect(root.errors).toEqual([]);
    expect(root.children[0]).toMatchObject({ type: 'pi', target: 'xml-stylesheet', value: 'type="text/xsl" href="feed.xsl"' });
    const feed = documentRoot(root)!;
    expect(feed.localName).toBe('feed');
    expect(textValue(feed.children[0])).toBe('A & B');
    expect(textValue(feed.children[1])).toBe('<raw>');
    expect(feed.children[2]).toMatchObject({ type: 'comment', value: ' inner ' });
  });

  it('decodes numeric entities and declared internal entities without fetching externals', () => {
    const root = parseXml(`<!DOCTYPE doc [<!ENTITY company "Библиотека"><!ENTITY ext SYSTEM "file:///etc/passwd">]>
      <doc>&company; &#1055;&#x440;&#x438;&#x432;&#x435;&#x442; &ext;</doc>`);
    expect(textValue(documentRoot(root)!)).toBe('Библиотека Привет &ext;');
  });

  it('tracks namespace scopes for prefixed names', () => {
    const root = parseXml('<r xmlns:a="urn:a"><a:x a:id="1"><a:y/></a:x></r>');
    const x = documentRoot(root)!.children[0];
    expect(x.localName).toBe('x');
    expect(x.ns).toBe('urn:a');
    expect(lookupNamespace(x, 'a')).toBe('urn:a');
  });

  it('rejects malformed input instead of inventing a document', () => {
    expect(() => parseXml('<a><b></a>')).not.toThrow();
    expect(() => parseXml('plain text')).toThrow(/корневого/);
    expect(() => parseXml('<a>')).toThrow();
  });

  it('round-trips a bounded document through the serializer', () => {
    const root = documentRoot(parseXml('<a x="1"><b>t</b><c/></a>'))!;
    expect(serializeElement(root)).toBe('<a x="1"><b>t</b><c/></a>');
  });

  it('enforces node limits so a hostile document cannot exhaust memory', () => {
    expect(() => parseXml('<r>' + '<i/>'.repeat(2000) + '</r>', { maxNodes: 100 })).toThrow(/узлов/);
  });
});

describe('XSLT XPath subset', () => {
  it('evaluates axes, predicates, functions and arithmetic', () => {
    const xml = '<list><item id="1" price="10">Alpha</item><item id="2" price="20">Beta</item><item id="3" price="30">Gamma</item></list>';
    expect((ctx(xml, 'count(/list/item)') as { value: number }).value).toBe(3);
    expect((ctx(xml, 'string(/list/item[2])') as { value: string }).value).toBe('Beta');
    expect((ctx(xml, 'string(/list/item[@id="3"]/@price)') as { value: string }).value).toBe('30');
    expect((ctx(xml, 'string(/list/item[last()])') as { value: string }).value).toBe('Gamma');
    expect((ctx(xml, 'string(/list/item[position() < 3][2])') as { value: string }).value).toBe('Beta');
    expect((ctx(xml, 'sum(/list/item/@price)') as { value: number }).value).toBe(60);
    expect((ctx(xml, 'contains(string(/list/item[1]), "ph")') as { value: boolean }).value).toBe(true);
    expect((ctx(xml, 'string(2 + 3 * 4)') as { value: string }).value).toBe('14');
    expect((ctx(xml, 'string(/list/item[2]/following-sibling::item[1])') as { value: string }).value).toBe('Gamma');
    expect((ctx(xml, 'string(/list/item[2]/preceding-sibling::item[1])') as { value: string }).value).toBe('Alpha');
    expect((ctx(xml, 'name(//item[@id="2"]/parent::*)') as { value: string }).value).toBe('list');
  });

  it('handles string helpers used by feed stylesheets', () => {
    const xml = '<r><t>  Привет   мир  </t><u>https://example.test/a/b</u></r>';
    expect((ctx(xml, 'normalize-space(/r/t)') as { value: string }).value).toBe('Привет мир');
    expect((ctx(xml, 'substring-before(/r/u, "/a")') as { value: string }).value).toBe('https://example.test');
    expect((ctx(xml, 'substring-after(/r/u, "https://")') as { value: string }).value).toBe('example.test/a/b');
    expect((ctx(xml, 'translate("abc", "abc", "xyz")') as { value: string }).value).toBe('xyz');
    expect((ctx(xml, 'string-length("абв")') as { value: number }).value).toBe(3);
    expect((ctx(xml, 'concat("a", "-", 2)') as { value: string }).value).toBe('a-2');
  });

  it('matches namespaced names only through a declared prefix', () => {
    const xml = '<r xmlns:n="urn:n"><n:item>one</n:item><item>two</item></r>';
    expect((ctx(xml, 'count(/r/n:item)', { n: 'urn:n' }) as { value: number }).value).toBe(1);
    expect((ctx(xml, 'count(/r/item)') as { value: number }).value).toBe(1);
  });

  it('refuses unavailable extension functions', () => {
    expect(() => ctx('<r/>', 'document("file:///etc/passwd")')).toThrow(/document\(\)/);
    expect(() => ctx('<r/>', 'key("k", "v")')).toThrow(/key\(\)/);
    expect(() => compileXPath('count(')).toThrow();
  });
});
