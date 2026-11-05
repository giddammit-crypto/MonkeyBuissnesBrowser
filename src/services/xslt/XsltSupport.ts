/**
 * Orchestration for client-side XSLT: find the `xml-stylesheet` processing
 * instruction, fetch the stylesheet (with `xsl:include`/`xsl:import`), run the
 * transform and return HTML for the tab.
 *
 * Chromium 158 stops rendering XSLT; without this layer an XML page with an
 * `xml-stylesheet` instruction degrades to a wall of raw markup.
 */
import { parseXml, serializeElement, type XmlDocument, type XmlElement } from './xml';
import { XsltError, XsltStylesheet, XSLT_NAMESPACE } from './processor';

export const XSLT_DOCUMENT_LIMIT = 4 * 1024 * 1024;
export const XSLT_STYLESHEET_LIMIT = 1024 * 1024;
export const XSLT_INCLUDE_LIMIT = 16;
export const XSLT_INCLUDE_DEPTH = 8;
export const XSLT_OUTPUT_LIMIT = 8 * 1024 * 1024;

export interface XmlStylesheetInstruction {
  href: string;
  type: string;
  title?: string;
  media?: string;
  alternate: boolean;
}

export interface XsltFetchResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType?: string;
  text: string;
}

export type XsltFetcher = (url: string) => Promise<XsltFetchResponse>;

export interface XsltTransformRequest {
  xml: string;
  documentUrl: string;
  stylesheetHref: string;
  title?: string;
}

export type XsltOutcome =
  | { status: 'ok'; html: string; method: 'html' | 'xml' | 'text'; mediaType: string; title?: string; stylesheetUrl: string; includes: number }
  | { status: 'error'; message: string; stylesheetUrl?: string };

const XML_CONTENT_TYPES = [
  'application/xml', 'text/xml', 'application/rss+xml', 'application/atom+xml',
  'application/rdf+xml', 'application/xhtml+xml', 'image/svg+xml', 'application/xslt+xml',
  'text/xsl', 'application/x-xml',
];

/** XSLT applies to XML documents, never to HTML or images. */
export function isXmlContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const value = contentType.split(';')[0].trim().toLowerCase();
  if (value === 'text/html' || value.startsWith('image/') && value !== 'image/svg+xml') return false;
  return XML_CONTENT_TYPES.includes(value) || value.endsWith('+xml') || value === 'application/xml';
}

/** `image/svg+xml` is XML but Chromium never applied XSLT stylesheets to SVG files. */
export function supportsXsltContentType(contentType: string | undefined): boolean {
  if (!isXmlContentType(contentType)) return false;
  return contentType!.split(';')[0].trim().toLowerCase() !== 'image/svg+xml';
}

/**
 * Parses every `<?xml-stylesheet ...?>` instruction from the document prolog.
 * Only XSLT (`text/xsl`, `application/xml`, `text/xml`) instructions qualify;
 * CSS `xml-stylesheet` keeps working inside Chromium and must be left alone.
 */
export function parseXmlStylesheetInstructionBody(body: string): XmlStylesheetInstruction | undefined {
  const attributes = new Map<string, string>();
  const attributePattern = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attribute: RegExpExecArray | null;
  while ((attribute = attributePattern.exec(body.slice(0, 2048))) !== null) {
    attributes.set(attribute[1].toLowerCase(), attribute[3] ?? attribute[4] ?? '');
  }
  const type = (attributes.get('type') ?? '').trim().toLowerCase();
  const href = (attributes.get('href') ?? '').trim();
  if (!href || href.length > 2048) return undefined;
  if (!['text/xsl', 'application/xml', 'text/xml', 'application/xslt+xml'].includes(type)) return undefined;
  return {
    href,
    type,
    title: attributes.get('title'),
    media: attributes.get('media'),
    alternate: (attributes.get('alternate') ?? '').toLowerCase() === 'yes',
  };
}

/**
 * Parses every `<?xml-stylesheet ...?>` instruction from the document prolog.
 * Only XSLT (`text/xsl`, `application/xml`, `text/xml`) instructions qualify;
 * CSS `xml-stylesheet` keeps working inside Chromium and must be left alone.
 */
export function parseXmlStylesheetInstructions(xml: string): XmlStylesheetInstruction[] {
  const head = xml.slice(0, 8192);
  const instructions: XmlStylesheetInstruction[] = [];
  const pattern = /<\?xml-stylesheet\s+([\s\S]*?)\?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(head)) !== null && instructions.length < 8) {
    const instruction = parseXmlStylesheetInstructionBody(match[1]);
    if (instruction) instructions.push(instruction);
  }
  // A non-alternate instruction is the primary view; alternates only win when
  // no primary instruction exists (matching legacy browser behaviour).
  const primary = instructions.filter(instruction => !instruction.alternate);
  return primary.length ? primary : instructions;
}

export function resolveStylesheetUrl(href: string, documentUrl: string): string | undefined {
  try {
    const resolved = new URL(href, documentUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

/** Simplified stylesheets (`<html xsl:version="1.0">`) become a match="/" template. */
export function normalizeStylesheetDocument(document: XmlDocument): XmlDocument {
  const root = document.children.find((node): node is XmlElement => node.type === 'element');
  if (!root) throw new XsltError('Таблица стилей XSLT пуста');
  if (root.ns === XSLT_NAMESPACE) return document;
  const versionAttribute = root.attributes.find(attribute => attribute.localName === 'version');
  if (!versionAttribute) throw new XsltError('Файл не является таблицей стилей XSLT');
  const declared = /^1\.[0-9]$/.test(versionAttribute.value.trim()) ? versionAttribute.value.trim() : '1.0';
  const literalElement = { ...root, attributes: root.attributes.filter(attribute => attribute.localName !== 'version') };
  const wrapped = `<xsl:stylesheet version="${declared}" xmlns:xsl="${XSLT_NAMESPACE}"><xsl:template match="/">${serializeElement(literalElement)}</xsl:template></xsl:stylesheet>`;
  return parseXml(wrapped);
}

interface CacheEntry { text: string; storedAt: number }

export class XsltSupport {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly cacheLimit: number;

  constructor(
    private readonly fetcher: XsltFetcher,
    options: { cacheTtlMs?: number; cacheLimit?: number } = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
    this.cacheLimit = options.cacheLimit ?? 24;
  }

  clearCache(): void { this.cache.clear(); }

  private origin(url: string): string {
    try { return new URL(url).origin; } catch { return ''; }
  }

  private async load(url: string, budget: { includes: number; visited: Set<string> }, documentOrigin: string, depth: number): Promise<XmlDocument> {
    if (budget.visited.has(url)) throw new XsltError('Циклическое включение xsl:include/xsl:import');
    if (depth > XSLT_INCLUDE_DEPTH) throw new XsltError('Слишком глубокая вложенность xsl:include');
    if (this.origin(url) !== documentOrigin) throw new XsltError('Таблица стилей XSLT должна быть на том же источнике, что и документ');
    budget.visited.add(url);
    let text: string | undefined;
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.storedAt < this.cacheTtlMs) text = cached.text;
    if (text === undefined) {
      const response = await this.fetcher(url);
      if (!response.ok) throw new XsltError(`Не удалось загрузить таблицу стилей (HTTP ${response.status})`);
      if (response.text.length > XSLT_STYLESHEET_LIMIT) throw new XsltError('Таблица стилей XSLT слишком большая');
      text = response.text;
      if (this.cache.size >= this.cacheLimit) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(url, { text, storedAt: Date.now() });
    }

    const parsed = parseXml(text);
    const root = parsed.children.find((node): node is XmlElement => node.type === 'element');
    if (!root) throw new XsltError('Таблица стилей XSLT пуста');
    if (root.ns !== XSLT_NAMESPACE) return parsed;

    // Inline xsl:include / xsl:import in place, in document order.
    const imports = root.children.filter(child => child.type === 'element' && child.ns === XSLT_NAMESPACE
      && (child.localName === 'include' || child.localName === 'import'));
    for (const directive of imports) {
      if (budget.includes >= XSLT_INCLUDE_LIMIT) throw new XsltError('Слишком много директив xsl:include');
      const href = (directive as XmlElement).attributes.find(attribute => attribute.name === 'href')?.value;
      if (!href) throw new XsltError('xsl:include без href');
      const includeUrl = resolveStylesheetUrl(href, url);
      if (!includeUrl) throw new XsltError('Недопустимый href в xsl:include');
      budget.includes += 1;
      const included = await this.load(includeUrl, budget, documentOrigin, depth + 1);
      const includedRoot = included.children.find((node): node is XmlElement => node.type === 'element');
      if (!includedRoot) continue;
      const replacement = includedRoot.children;
      const position = root.children.indexOf(directive as XmlElement);
      if (position >= 0) root.children.splice(position, 1, ...replacement);
    }
    return parsed;
  }

  async transform(request: XsltTransformRequest): Promise<XsltOutcome> {
    const stylesheetUrl = resolveStylesheetUrl(request.stylesheetHref, request.documentUrl);
    if (!stylesheetUrl) return { status: 'error', message: 'Недопустимая ссылка на таблицу стилей XSLT' };
    if (request.xml.length > XSLT_DOCUMENT_LIMIT) {
      return { status: 'error', message: 'XML документ слишком большой для преобразования XSLT', stylesheetUrl };
    }
    try {
      const source = parseXml(request.xml);
      const budget = { includes: 0, visited: new Set<string>() };
      const stylesheetDocument = await this.load(stylesheetUrl, budget, this.origin(request.documentUrl), 0);
      const stylesheet = XsltStylesheet.compile(normalizeStylesheetDocument(stylesheetDocument));
      const result = stylesheet.transform(source, new Map(), XSLT_OUTPUT_LIMIT);
      return {
        status: 'ok',
        html: result.output,
        method: result.method,
        mediaType: result.mediaType,
        title: request.title || result.title,
        stylesheetUrl,
        includes: budget.includes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка XSLT';
      return { status: 'error', message, stylesheetUrl };
    }
  }
}
