/**
 * Small, allocation-aware XML 1.0 parser used by the XSLT compatibility layer.
 *
 * It deliberately does not resolve external entities, DTD subsets over the
 * network or `xml-stylesheet` includes: XSLT is a scripting surface and the
 * safest replacement for libxslt is one that cannot reach the network on its
 * own. Internal `<!ENTITY name "value">` declarations are expanded locally.
 */

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export interface XmlAttribute {
  type: 'attribute';
  name: string;
  localName: string;
  prefix: string;
  ns: string;
  value: string;
  parent: XmlElement;
  order: number;
}

export interface XmlElement {
  type: 'element';
  name: string;
  localName: string;
  prefix: string;
  ns: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  parent: XmlNode | null;
  order: number;
  /** Namespace prefixes declared on this element only. */
  decls?: Map<string, string>;
}

export interface XmlText {
  type: 'text';
  value: string;
  parent: XmlNode | null;
  order: number;
}

export interface XmlComment {
  type: 'comment';
  value: string;
  parent: XmlNode | null;
  order: number;
}

export interface XmlPi {
  type: 'pi';
  target: string;
  value: string;
  parent: XmlNode | null;
  order: number;
}

export interface XmlDocument {
  type: 'document';
  children: XmlNode[];
  parent: null;
  order: number;
  errors: string[];
}

export type XmlNode = XmlElement | XmlAttribute | XmlText | XmlComment | XmlPi | XmlDocument;

export class XmlParseError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface XmlParseOptions {
  maxNodes?: number;
  maxDepth?: number;
  maxInputLength?: number;
}

const DEFAULT_LIMITS = { maxNodes: 200_000, maxDepth: 256, maxInputLength: 8 * 1024 * 1024 };

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME_START = /[A-Za-z_:\u00C0-\uFFFF]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-\u00B7\u00C0-\uFFFF]/;

const splitName = (name: string): { prefix: string; localName: string } => {
  const colon = name.indexOf(':');
  return colon > 0 ? { prefix: name.slice(0, colon), localName: name.slice(colon + 1) } : { prefix: '', localName: name };
};

export function isXmlNode(value: unknown): value is XmlNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as XmlNode).type === 'string'
    && ['element', 'text', 'comment', 'pi', 'document'].includes((value as XmlNode).type);
}

export function parseXml(source: string, options: XmlParseOptions = {}): XmlDocument {
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (typeof source !== 'string') throw new XmlParseError('XML source must be a string', 0);
  const text = source.replace(/^\uFEFF/, '');
  if (text.length > limits.maxInputLength) throw new XmlParseError('XML документ слишком большой', 0);

  const doc: XmlDocument = { type: 'document', children: [], parent: null, order: 0, errors: [] };
  let order = 1;
  let nodes = 0;

  const entities: Record<string, string> = { ...NAMED_ENTITIES };
  const scopeStack: Array<Map<string, string>> = [new Map([['xml', XML_NAMESPACE]])];
  const elementStack: XmlElement[] = [];
  let index = 0;

  const currentParent = (): XmlNode | null => elementStack.length ? elementStack[elementStack.length - 1] : null;
  const resolvePrefix = (prefix: string): string => {
    for (let depth = scopeStack.length - 1; depth >= 0; depth--) {
      const found = scopeStack[depth].get(prefix);
      if (found !== undefined) return found;
    }
    return '';
  };
  const resolveNs = (prefix: string): string => prefix === '' ? '' : resolvePrefix(prefix);

  const pushChild = (node: XmlNode): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) throw new XmlParseError('XML документ содержит слишком много узлов', index);
    const parent = currentParent();
    if (parent && parent.type === 'element') {
      node.parent = parent;
      parent.children.push(node);
    } else {
      doc.children.push(node);
    }
  };

  const decodeEntities = (raw: string): string => {
    if (raw.indexOf('&') < 0) return raw;
    let out = '';
    let cursor = 0;
    while (cursor < raw.length) {
      const amp = raw.indexOf('&', cursor);
      if (amp < 0) { out += raw.slice(cursor); break; }
      out += raw.slice(cursor, amp);
      const semi = raw.indexOf(';', amp);
      if (semi < 0 || semi - amp > 32) { out += raw.slice(amp); break; }
      const name = raw.slice(amp + 1, semi);
      if (name.startsWith('#x') || name.startsWith('#X')) {
        const code = Number.parseInt(name.slice(2), 16);
        out += Number.isFinite(code) ? safeCodePoint(code) : `&${name};`;
      } else if (name.startsWith('#')) {
        const code = Number.parseInt(name.slice(1), 10);
        out += Number.isFinite(code) ? safeCodePoint(code) : `&${name};`;
      } else if (Object.prototype.hasOwnProperty.call(entities, name)) {
        out += entities[name];
      } else {
        out += `&${name};`;
      }
      cursor = semi + 1;
    }
    return out;
  };

  const skipWhitespace = (): void => {
    while (index < text.length && /\s/.test(text[index])) index++;
  };

  const readName = (): string => {
    const start = index;
    if (index >= text.length || !NAME_START.test(text[index])) throw new XmlParseError('Ожидалось имя элемента', index);
    index++;
    while (index < text.length && NAME_CHAR.test(text[index])) index++;
    return text.slice(start, index);
  };

  const readDoctype = (): void => {
    // <!DOCTYPE ...> possibly with an internal subset. External identifiers are
    // parsed but never fetched.
    let depth = 0;
    let subset = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '[') { depth++; index++; subset = ''; continue; }
      if (char === ']' && depth > 0) { depth--; index++; continue; }
      if (char === '>' && depth === 0) { index++; break; }
      if (depth > 0) subset += char;
      index++;
    }
    const entityPattern = /<!ENTITY\s+([A-Za-z_][\w.\-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
    let match: RegExpExecArray | null;
    while ((match = entityPattern.exec(subset.slice(0, 64 * 1024))) !== null) {
      const value = match[2] ?? match[3] ?? '';
      // One expansion level only: nested entity bombs stay impossible.
      entities[match[1]] = value.replace(/&(#x?[0-9A-Fa-f]+|\w+);/g, (whole, name: string) => {
        if (name.startsWith('#x') || name.startsWith('#X')) {
          const code = Number.parseInt(name.slice(2), 16);
          return Number.isFinite(code) ? safeCodePoint(code) : whole;
        }
        if (name.startsWith('#')) {
          const code = Number.parseInt(name.slice(1), 10);
          return Number.isFinite(code) ? safeCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[name] ?? whole;
      });
    }
  };

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt < 0) {
      if (elementStack.length > 0) {
        const tail = text.slice(index);
        if (tail) pushChild({ type: 'text', value: decodeEntities(tail), parent: null, order: order++ });
      }
      break;
    }
    if (lt > index) {
      const raw = text.slice(index, lt);
      if (elementStack.length > 0) {
        pushChild({ type: 'text', value: decodeEntities(raw), parent: null, order: order++ });
      } else if (raw.trim()) {
        doc.errors.push('Текст вне корневого элемента проигнорирован');
      }
      index = lt;
    }
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) throw new XmlParseError('Незавершённый комментарий', index);
      if (elementStack.length > 0) pushChild({ type: 'comment', value: text.slice(index + 4, end).slice(0, 4000), parent: null, order: order++ });
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end < 0) throw new XmlParseError('Незавершённая секция CDATA', index);
      if (elementStack.length > 0) pushChild({ type: 'text', value: text.slice(index + 9, end), parent: null, order: order++ });
      index = end + 3;
      continue;
    }
    if (text.startsWith('<!DOCTYPE', index) || text.startsWith('<!doctype', index)) {
      readDoctype();
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end < 0) throw new XmlParseError('Незавершённая инструкция обработки', index);
      const body = text.slice(index + 2, end);
      const space = body.search(/[\s]/);
      const target = space < 0 ? body : body.slice(0, space);
      const value = space < 0 ? '' : body.slice(space + 1).trim();
      // The XML declaration is not a processing instruction node.
      if (target.toLowerCase() !== 'xml') {
        pushChild({ type: 'pi', target, value: value.slice(0, 4000), parent: null, order: order++ });
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith('</', index)) {
      index += 2;
      const name = readName();
      skipWhitespace();
      if (text[index] !== '>') throw new XmlParseError('Ожидался символ >', index);
      index++;
      const split = splitName(name);
      let found = -1;
      for (let depth = elementStack.length - 1; depth >= 0; depth--) {
        if (elementStack[depth].name === name || elementStack[depth].localName === split.localName) { found = depth; break; }
      }
      if (found < 0) {
        doc.errors.push(`Лишний закрывающий тег </${name}>`);
        continue;
      }
      if (found !== elementStack.length - 1) doc.errors.push(`Незакрытые элементы перед </${name}>`);
      elementStack.length = found;
      scopeStack.length = Math.max(1, elementStack.length + 1);
      continue;
    }
    // Start tag
    index += 1;
    const name = readName();
    const attributes: Array<{ name: string; value: string }> = [];
    let selfClosing = false;
    for (;;) {
      skipWhitespace();
      if (index >= text.length) throw new XmlParseError(`Незавершённый тег <${name}>`, index);
      if (text.startsWith('/>', index)) { selfClosing = true; index += 2; break; }
      if (text[index] === '>') { index++; break; }
      const attrName = readName();
      skipWhitespace();
      if (text[index] !== '=') throw new XmlParseError(`Атрибут ${attrName} без значения`, index);
      index++;
      skipWhitespace();
      const quote = text[index];
      if (quote !== '"' && quote !== "'") throw new XmlParseError(`Значение атрибута ${attrName} без кавычек`, index);
      const end = text.indexOf(quote, index + 1);
      if (end < 0) throw new XmlParseError(`Незавершённое значение атрибута ${attrName}`, index);
      attributes.push({ name: attrName, value: decodeEntities(text.slice(index + 1, end)) });
      index = end + 1;
    }

    if (elementStack.length + 1 > limits.maxDepth) throw new XmlParseError('XML документ слишком глубоко вложен', index);

    const scope = new Map<string, string>();
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns') scope.set('', attribute.value);
      else if (attribute.name.startsWith('xmlns:')) scope.set(attribute.name.slice(6), attribute.value);
    }
    scopeStack.push(scope);

    const split = splitName(name);
    const element: XmlElement = {
      type: 'element',
      name,
      localName: split.localName,
      prefix: split.prefix,
      ns: resolveNs(split.prefix),
      attributes: [],
      children: [],
      parent: null,
      order: order++,
    };
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      if (element.attributes.some(entry => entry.name === attribute.name)) {
        doc.errors.push(`Повторяющийся атрибут ${attribute.name}`);
        continue;
      }
      const attrSplit = splitName(attribute.name);
      element.attributes.push({
        type: 'attribute',
        name: attribute.name,
        localName: attrSplit.localName,
        prefix: attrSplit.prefix,
        ns: attrSplit.prefix ? resolveNs(attrSplit.prefix) : '',
        value: attribute.value,
        parent: element,
        order: order++,
      });
    }
    if (scope.size > 0) element.decls = scope;
    pushChild(element);
    if (!selfClosing) elementStack.push(element);
    else scopeStack.pop();
  }

  if (elementStack.length > 0) {
    throw new XmlParseError(`Незавершённый элемент <${elementStack[elementStack.length - 1].name}>`, index);
  }
  if (doc.children.filter(node => node.type === 'element').length === 0) {
    throw new XmlParseError('XML документ не содержит корневого элемента', 0);
  }
  const roots = doc.children.filter(node => node.type === 'element');
  if (roots.length > 1) doc.errors.push('Несколько корневых элементов');
  return doc;
}

const safeCodePoint = (code: number): string => {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
};

export const documentRoot = (doc: XmlDocument): XmlElement | null =>
  doc.children.find((node): node is XmlElement => node.type === 'element') ?? null;

export const childElements = (node: XmlNode): XmlElement[] => {
  if (node.type === 'document') return node.children.filter((child): child is XmlElement => child.type === 'element');
  if (node.type !== 'element') return [];
  return node.children.filter((child): child is XmlElement => child.type === 'element');
};

export const textValue = (node: XmlNode): string => {
  switch (node.type) {
    case 'text': return node.value;
    case 'comment': return node.value;
    case 'pi': return node.value;
    case 'attribute': return node.value;
    case 'element': {
      let out = '';
      for (const child of node.children) out += textValue(child);
      return out;
    }
    case 'document': {
      let out = '';
      for (const child of node.children) out += textValue(child);
      return out;
    }
    default: return '';
  }
};

export function nodeToString(node: XmlNode): string {
  switch (node.type) {
    case 'text': return node.value;
    case 'comment': return `<!--${node.value}-->`;
    case 'pi': return `<?${node.target}${node.value ? ` ${node.value}` : ''}?>`;
    case 'attribute': return node.value;
    case 'element': return serializeElement(node, true);
    case 'document': return node.children.map(nodeToString).join('');
    default: return '';
  }
}

export function serializeElement(element: XmlElement, includeSelf = true, html = false): string {
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const isVoid = html && element.prefix === '' && voidElements.has(element.localName.toLowerCase());
  const attributes = element.attributes.map(attribute => ` ${attribute.name}="${escapeXmlAttribute(attribute.value)}"`).join('');
  const open = `<${element.name}${attributes}`;
  if (isVoid) return `${open}${html ? '' : ' /'}>`;
  const inner = element.children.map(child => child.type === 'element' ? serializeElement(child, true, html) : nodeToString(child)).join('');
  if (element.children.length === 0 && !html) return `${open}/>`;
  return `${open}>${inner}</${element.name}>`;
}

export const escapeXmlText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const escapeXmlAttribute = (value: string): string =>
  escapeXmlText(value).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

export const escapeHtmlText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resolves a prefix using the namespace declarations in scope for `element`. */
export function lookupNamespace(element: XmlNode | null, prefix: string): string {
  if (prefix === 'xml') return XML_NAMESPACE;
  let current: XmlNode | null = element;
  while (current) {
    if (current.type === 'element' && current.decls) {
      const found = current.decls.get(prefix);
      if (found !== undefined) return found;
    }
    current = current.parent;
  }
  return '';
}

/** All prefixes usable at `element` (used to emit xmlns declarations on output). */
export function namespaceScope(element: XmlNode | null): Map<string, string> {
  const scope = new Map<string, string>();
  const chain: XmlNode[] = [];
  let current: XmlNode | null = element;
  while (current) { chain.unshift(current); current = current.parent; }
  for (const node of chain) {
    if (node.type !== 'element' || !node.decls) continue;
    for (const [prefix, uri] of node.decls) scope.set(prefix, uri);
  }
  return scope;
}
