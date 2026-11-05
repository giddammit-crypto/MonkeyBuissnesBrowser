/**
 * XPath 1.0 subset: location paths, predicates, comparisons, arithmetic,
 * variables and the functions that real-world XSLT stylesheets use.
 *
 * Not implemented on purpose (they either need the DOM or open the network):
 * `document()`, `key()`, the namespace axis, and extension functions.
 */
import { textValue, type XmlAttribute, type XmlDocument, type XmlElement, type XmlNode } from './xml';

export type XPathValue =
  | { type: 'nodeset'; nodes: XmlNode[] }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean };

export interface XPathContext {
  node: XmlNode;
  position: number;
  size: number;
  root: XmlDocument;
  variables?: Map<string, XPathValue>;
  namespaces?: Map<string, string>;
  current?: XmlNode;
}

export class XPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XPathError';
  }
}

export const nodeset = (nodes: XmlNode[]): XPathValue => ({ type: 'nodeset', nodes });
const stringValue = (value: string): XPathValue => ({ type: 'string', value });
const numberValue = (value: number): XPathValue => ({ type: 'number', value });
const booleanValue = (value: boolean): XPathValue => ({ type: 'boolean', value });

type Axis = 'child' | 'descendant' | 'descendant-or-self' | 'self' | 'parent' | 'ancestor'
  | 'ancestor-or-self' | 'attribute' | 'following-sibling' | 'preceding-sibling' | 'following' | 'preceding';

type NodeTest =
  | { k: 'name'; name: string; prefix: string }
  | { k: 'any' }
  | { k: 'node' }
  | { k: 'text' }
  | { k: 'comment' }
  | { k: 'pi'; target?: string };

interface Step { axis: Axis; test: NodeTest; predicates: Expr[] }

export type Expr =
  | { k: 'path'; absolute: boolean; steps: Step[] }
  | { k: 'pathFrom'; base: Expr; steps: Step[] }
  | { k: 'filter'; base: Expr; predicates: Expr[] }
  | { k: 'binary'; op: string; left: Expr; right: Expr }
  | { k: 'unary'; expr: Expr }
  | { k: 'number'; value: number }
  | { k: 'string'; value: string }
  | { k: 'variable'; name: string }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'union'; parts: Expr[] };

interface Token { type: 'name' | 'number' | 'string' | 'op'; value: string }

const OPERATORS = ['//', '..', '::', '!=', '<=', '>=', '|', '/', '[', ']', '(', ')', '@', ',', '+', '-', '*', '=', '<', '>', '$', '.'];

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const text = expression;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, index + 1);
      if (end < 0) throw new XPathError('Незакрытая строка в XPath');
      tokens.push({ type: 'string', value: text.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
      if (match) { tokens.push({ type: 'number', value: match[0] }); index += match[0].length; continue; }
    }
    let matched = false;
    for (const operator of OPERATORS) {
      if (text.startsWith(operator, index)) {
        tokens.push({ type: 'op', value: operator });
        index += operator.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const nameMatch = /^[A-Za-z_\u00C0-\uFFFF][\w.\-\u00C0-\uFFFF]*(?::[A-Za-z_][\w.\-\u00C0-\uFFFF]*)?/.exec(text.slice(index));
    if (nameMatch) { tokens.push({ type: 'name', value: nameMatch[0] }); index += nameMatch[0].length; continue; }
    throw new XPathError(`Неподдерживаемый символ в XPath: ${char}`);
  }
  return tokens;
}

export class XPathParser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  static parse(expression: string): Expr {
    const parser = new XPathParser(tokenize(expression));
    const expr = parser.parseExpression();
    if (parser.position < parser.tokens.length) throw new XPathError('Лишние символы в XPath');
    return expr;
  }

  private peek(offset = 0): Token | undefined { return this.tokens[this.position + offset]; }
  private isOp(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return Boolean(token && token.type === 'op' && token.value === value);
  }
  private isName(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return Boolean(token && token.type === 'name' && token.value === value);
  }
  private eat(value: string): boolean {
    if (this.isOp(value)) { this.position++; return true; }
    return false;
  }

  parseExpression(): Expr { return this.parseOr(); }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isName('or')) { this.position++; left = { k: 'binary', op: 'or', left, right: this.parseAnd() }; }
    return left;
  }
  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.isName('and')) { this.position++; left = { k: 'binary', op: 'and', left, right: this.parseEquality() }; }
    return left;
  }
  private parseEquality(): Expr {
    let left = this.parseRelational();
    while (this.isOp('=') || this.isOp('!=')) {
      const op = this.tokens[this.position++].value;
      left = { k: 'binary', op, left, right: this.parseRelational() };
    }
    return left;
  }
  private parseRelational(): Expr {
    let left = this.parseAdditive();
    while (this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) {
      const op = this.tokens[this.position++].value;
      left = { k: 'binary', op, left, right: this.parseAdditive() };
    }
    return left;
  }
  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.tokens[this.position++].value;
      left = { k: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }
  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      if (this.isName('div') || this.isName('mod')) {
        const op = this.tokens[this.position++].value;
        left = { k: 'binary', op, left, right: this.parseUnary() };
        continue;
      }
      if (this.isOp('*') && this.starIsOperator()) {
        this.position++;
        left = { k: 'binary', op: '*', left, right: this.parseUnary() };
        continue;
      }
      break;
    }
    return left;
  }
  /** `*` is multiplication only when a value-producing token follows. */
  private starIsOperator(): boolean {
    const next = this.peek(1);
    if (!next) return false;
    if (next.type === 'number' || next.type === 'string') return true;
    if (next.type === 'op') return next.value === '(' || next.value === '$' || next.value === '.' || next.value === '..';
    if (next.type === 'name') return Boolean(this.peek(2) && this.peek(2)!.type === 'op' && this.peek(2)!.value === '(');
    return false;
  }
  private parseUnary(): Expr {
    if (this.isOp('-')) { this.position++; return { k: 'unary', expr: this.parseUnary() }; }
    return this.parseUnion();
  }
  private parseUnion(): Expr {
    let left = this.parsePath();
    while (this.isOp('|')) { this.position++; left = { k: 'union', parts: left.k === 'union' ? [...left.parts, this.parsePath()] : [left, this.parsePath()] }; }
    return left;
  }

  private parsePath(): Expr {
    if (this.isOp('/')) {
      this.position++;
      const steps: Step[] = [];
      if (this.startsStep()) steps.push(this.parseStep());
      while (this.isOp('/') || this.isOp('//')) {
        if (this.tokens[this.position].value === '//') steps.push(descendantOrSelfStep());
        else this.position++;
        steps.push(this.parseStep());
      }
      return { k: 'path', absolute: true, steps };
    }
    if (this.isOp('//')) {
      this.position++;
      const steps: Step[] = [descendantOrSelfStep(), this.parseStep()];
      while (this.isOp('/') || this.isOp('//')) {
        if (this.tokens[this.position].value === '//') steps.push(descendantOrSelfStep());
        else this.position++;
        steps.push(this.parseStep());
      }
      return { k: 'path', absolute: false, steps };
    }
    if (this.startsStep()) {
      const steps: Step[] = [this.parseStep()];
      while (this.isOp('/') || this.isOp('//')) {
        if (this.tokens[this.position].value === '//') steps.push(descendantOrSelfStep());
        else this.position++;
        steps.push(this.parseStep());
      }
      return { k: 'path', absolute: false, steps };
    }
    const primary = this.parseFilter();
    if (this.isOp('/') || this.isOp('//')) {
      const steps: Step[] = [];
      while (this.isOp('/') || this.isOp('//')) {
        if (this.tokens[this.position].value === '//') steps.push(descendantOrSelfStep());
        else this.position++;
        steps.push(this.parseStep());
      }
      return { k: 'pathFrom', base: primary, steps };
    }
    return primary;
  }

  private startsStep(): boolean {
    const token = this.peek();
    if (!token) return false;
    // A name followed by '(' is a function call or a node test, both parsed by parsePrimary.
    if (token.type === 'name') return !(this.peek(1)?.type === 'op' && this.peek(1)?.value === '(');
    if (token.type === 'op') return token.value === '*' || token.value === '@' || token.value === '.' || token.value === '..';
    return false;
  }

  private parseFilter(): Expr {
    let base = this.parsePrimary();
    const predicates: Expr[] = [];
    while (this.isOp('[')) { this.position++; predicates.push(this.parseExpression()); this.expect(']'); }
    if (predicates.length) base = { k: 'filter', base, predicates };
    return base;
  }

  private expect(value: string): void {
    if (!this.eat(value)) throw new XPathError(`Ожидался символ ${value}`);
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (!token) throw new XPathError('Неожиданный конец выражения XPath');
    if (token.type === 'string') { this.position++; return { k: 'string', value: token.value }; }
    if (token.type === 'number') { this.position++; return { k: 'number', value: Number(token.value) }; }
    if (token.type === 'op' && token.value === '$') {
      this.position++;
      const name = this.peek();
      if (!name || name.type !== 'name') throw new XPathError('Ожидалось имя переменной');
      this.position++;
      return { k: 'variable', name: name.value };
    }
    if (token.type === 'op' && token.value === '(') {
      this.position++;
      const expr = this.parseExpression();
      this.expect(')');
      return expr;
    }
    if (token.type === 'op' && token.value === '.') { this.position++; return { k: 'path', absolute: false, steps: [{ axis: 'self', test: { k: 'node' }, predicates: [] }] }; }
    if (token.type === 'op' && token.value === '..') { this.position++; return { k: 'path', absolute: false, steps: [{ axis: 'parent', test: { k: 'node' }, predicates: [] }] }; }
    if (token.type === 'name') {
      if (this.peek(1)?.type === 'op' && this.peek(1)?.value === '(') {
        const name = token.value;
        this.position += 2;
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.parseExpression());
            if (this.eat(',')) continue;
            break;
          }
        }
        this.expect(')');
        if (name === 'text' || name === 'node' || name === 'comment' || name === 'processing-instruction') {
          const test: NodeTest = name === 'processing-instruction'
            ? { k: 'pi', target: args.length && args[0].k === 'string' ? args[0].value : undefined }
            : { k: name };
          return { k: 'path', absolute: false, steps: [{ axis: 'child', test, predicates: [] }] };
        }
        return { k: 'call', name, args };
      }
      const steps: Step[] = [this.parseStep()];
      while (this.isOp('/') || this.isOp('//')) {
        if (this.tokens[this.position].value === '//') steps.push(descendantOrSelfStep());
        else this.position++;
        steps.push(this.parseStep());
      }
      return { k: 'path', absolute: false, steps };
    }
    throw new XPathError('Неподдерживаемое выражение XPath');
  }

  private parseStep(): Step {
    if (this.isOp('.')) { this.position++; return { axis: 'self', test: { k: 'node' }, predicates: [] }; }
    if (this.isOp('..')) { this.position++; return { axis: 'parent', test: { k: 'node' }, predicates: [] }; }
    let axis: Axis = 'child';
    if (this.isOp('@')) { this.position++; axis = 'attribute'; }
    else if (this.peek()?.type === 'name' && this.peek(1)?.type === 'op' && this.peek(1)?.value === '::') {
      axis = this.tokens[this.position++].value as Axis;
      this.position++;
      if (!(axis in AXIS_NAMES)) throw new XPathError(`Неподдерживаемая ось XPath: ${axis}`);
    }
    let test: NodeTest;
    if (this.isOp('*')) {
      this.position++;
      test = { k: 'any' };
    } else {
      const token = this.peek();
      if (!token || token.type !== 'name') throw new XPathError('Ожидалось имя узла в XPath');
      this.position++;
      if (token.value === 'node') test = { k: 'node' };
      else {
        const colon = token.value.indexOf(':');
        test = colon > 0
          ? { k: 'name', prefix: token.value.slice(0, colon), name: token.value.slice(colon + 1) }
          : { k: 'name', prefix: '', name: token.value };
      }
    }
    const predicates: Expr[] = [];
    while (this.isOp('[')) { this.position++; predicates.push(this.parseExpression()); this.expect(']'); }
    return { axis, test, predicates };
  }
}

const AXIS_NAMES: Record<string, true> = {
  child: true, descendant: true, 'descendant-or-self': true, self: true, parent: true,
  ancestor: true, 'ancestor-or-self': true, attribute: true, 'following-sibling': true,
  'preceding-sibling': true, following: true, preceding: true,
};

const descendantOrSelfStep = (): Step => ({ axis: 'descendant-or-self', test: { k: 'node' }, predicates: [] });

const documentOrder = (nodes: XmlNode[]): XmlNode[] => {
  const seen = new Set<XmlNode>();
  const unique: XmlNode[] = [];
  for (const node of nodes) if (!seen.has(node)) { seen.add(node); unique.push(node); }
  return unique.sort((a, b) => a.order - b.order);
};

const childNodes = (node: XmlNode): XmlNode[] => {
  if (node.type === 'document' || node.type === 'element') return node.children;
  return [];
};

const descendantsOf = (node: XmlNode): XmlNode[] => {
  const out: XmlNode[] = [];
  const stack: XmlNode[] = [...childNodes(node)].reverse();
  while (stack.length) {
    const current = stack.pop()!;
    out.push(current);
    const children = childNodes(current);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return out;
};

const parentOf = (node: XmlNode): XmlNode | null => {
  if (node.type === 'attribute') return node.parent;
  return node.parent ?? null;
};

const siblings = (node: XmlNode): XmlNode[] => {
  const parent = node.parent;
  if (!parent) return [];
  if (parent.type === 'document') return parent.children.filter(child => child !== node);
  if (parent.type === 'element') return parent.children.filter(child => child !== node);
  return [];
};

const matchesTest = (node: XmlNode, test: NodeTest, namespaces?: Map<string, string>): boolean => {
  switch (test.k) {
    case 'node': return true;
    case 'text': return node.type === 'text';
    case 'comment': return node.type === 'comment';
    case 'pi': return node.type === 'pi' && (test.target === undefined || node.target === test.target);
    case 'any': return node.type === 'element' || node.type === 'attribute';
    case 'name': {
      if (node.type !== 'element' && node.type !== 'attribute') return false;
      if (node.type === 'attribute' && test.name === 'xmlns') return false;
      if (test.prefix) {
        const uri = namespaces?.get(test.prefix);
        if (uri === undefined) return false;
        return node.ns === uri && node.localName === test.name;
      }
      // Unprefixed names match the null namespace in XPath 1.0.
      return node.localName === test.name && node.ns === '';
    }
    default: return false;
  }
};

const axisNodes = (node: XmlNode, axis: Axis): XmlNode[] => {
  switch (axis) {
    case 'child': return childNodes(node);
    case 'descendant': return descendantsOf(node);
    case 'descendant-or-self': return [node, ...descendantsOf(node)];
    case 'self': return [node];
    case 'parent': { const parent = parentOf(node); return parent ? [parent] : []; }
    case 'ancestor': {
      const out: XmlNode[] = [];
      let current = parentOf(node);
      while (current) { out.push(current); current = parentOf(current); }
      return out;
    }
    case 'ancestor-or-self': {
      const out: XmlNode[] = [node];
      let current = parentOf(node);
      while (current) { out.push(current); current = parentOf(current); }
      return out;
    }
    case 'attribute': return node.type === 'element' ? node.attributes : [];
    case 'following-sibling': {
      const parent = node.parent;
      if (!parent) return [];
      const list = parent.type === 'document' || parent.type === 'element' ? parent.children : [];
      const index = list.indexOf(node);
      return index < 0 ? [] : list.slice(index + 1);
    }
    case 'preceding-sibling': {
      const parent = node.parent;
      if (!parent) return [];
      const list = parent.type === 'document' || parent.type === 'element' ? parent.children : [];
      const index = list.indexOf(node);
      return index <= 0 ? [] : list.slice(0, index);
    }
    case 'following': {
      const all = descendantsOf(nodeRootDocument(node));
      return all.filter(candidate => candidate.order > node.order && !isAncestor(node, candidate));
    }
    case 'preceding': {
      const all = descendantsOf(nodeRootDocument(node));
      return all.filter(candidate => candidate.order < node.order && !isAncestor(candidate, node));
    }
    default: return [];
  }
};

const nodeRootDocument = (node: XmlNode): XmlDocument => {
  let current: XmlNode = node;
  while (current.parent) current = current.parent;
  return current.type === 'document' ? current : { type: 'document', children: [current], parent: null, order: 0, errors: [] };
};

const isAncestor = (ancestor: XmlNode, node: XmlNode): boolean => {
  let current = parentOf(node);
  while (current) { if (current === ancestor) return true; current = parentOf(current); }
  return false;
};

export const toNumber = (value: XPathValue): number => {
  switch (value.type) {
    case 'number': return value.value;
    case 'boolean': return value.value ? 1 : 0;
    case 'string': {
      const trimmed = value.value.trim();
      if (!trimmed) return Number.NaN;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
    case 'nodeset': return value.nodes.length ? toNumber(stringOf(value)) : Number.NaN;
    default: return Number.NaN;
  }
};

export const toStringValue = (value: XPathValue): string => {
  switch (value.type) {
    case 'string': return value.value;
    case 'number': return formatNumber(value.value);
    case 'boolean': return value.value ? 'true' : 'false';
    case 'nodeset': return value.nodes.length ? textValue(value.nodes[0]) : '';
    default: return '';
  }
};

const formatNumber = (value: number): string => {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
};

export const toBoolean = (value: XPathValue): boolean => {
  switch (value.type) {
    case 'boolean': return value.value;
    case 'number': return value.value !== 0 && !Number.isNaN(value.value);
    case 'string': return value.value.length > 0;
    case 'nodeset': return value.nodes.length > 0;
    default: return false;
  }
};

const stringOf = (value: XPathValue): XPathValue => ({ type: 'string', value: toStringValue(value) });

const compareValues = (left: XPathValue, right: XPathValue, op: string): boolean => {
  const compare = (a: number, b: number): boolean => {
    switch (op) {
      case '=': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: return false;
    }
  };
  const compareStrings = (a: string, b: string): boolean => {
    switch (op) {
      case '=': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: return false;
    }
  };
  if (op === '=' || op === '!=') {
    if (left.type === 'nodeset' && right.type === 'nodeset') {
      const rightValues = right.nodes.map(node => textValue(node));
      return left.nodes.some(node => {
        const value = textValue(node);
        return rightValues.some(other => compareStrings(value, other));
      });
    }
    if (left.type === 'nodeset') {
      const target = toStringValue(right);
      return left.nodes.some(node => compareStrings(textValue(node), target));
    }
    if (right.type === 'nodeset') {
      const target = toStringValue(left);
      return right.nodes.some(node => compareStrings(target, textValue(node)));
    }
    if (left.type === 'boolean' || right.type === 'boolean') return compare(toNumber(left), toNumber(right));
    if (left.type === 'number' || right.type === 'number') return compare(toNumber(left), toNumber(right));
    return compareStrings(toStringValue(left), toStringValue(right));
  }
  if (left.type === 'nodeset' && right.type === 'nodeset') {
    return left.nodes.some(node => right.nodes.some(other => compare(Number(textValue(node)), Number(textValue(other)))));
  }
  if (left.type === 'nodeset') {
    const target = toNumber(right);
    return left.nodes.some(node => compare(Number(textValue(node)), target));
  }
  if (right.type === 'nodeset') {
    const target = toNumber(left);
    return right.nodes.some(node => compare(target, Number(textValue(node))));
  }
  return compare(toNumber(left), toNumber(right));
};

const positionFilter = (nodes: XmlNode[], predicate: Expr, context: XPathContext, root: XmlDocument): XmlNode[] => {
  const out: XmlNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const result = evaluate(predicate, {
      node, position: index + 1, size: nodes.length, root,
      variables: context.variables, namespaces: context.namespaces, current: context.current,
    });
    if (result.type === 'number') { if (result.value === index + 1) out.push(node); }
    else if (toBoolean(result)) out.push(node);
  }
  return out;
};

const applySteps = (input: XmlNode[], steps: Step[], context: XPathContext, root: XmlDocument): XmlNode[] => {
  let current = input;
  for (const step of steps) {
    const collected: XmlNode[] = [];
    for (const node of current) {
      let candidates = axisNodes(node, step.axis).filter(candidate => matchesTest(candidate, step.test, context.namespaces));
      for (const predicate of step.predicates) {
        candidates = positionFilter(candidates, predicate, context, root);
      }
      collected.push(...candidates);
    }
    current = documentOrder(collected);
  }
  return current;
};

export const evaluate = (expr: Expr, context: XPathContext): XPathValue => {
  switch (expr.k) {
    case 'number': return numberValue(expr.value);
    case 'string': return stringValue(expr.value);
    case 'variable': {
      const value = context.variables?.get(expr.name);
      if (!value) throw new XPathError(`Неизвестная переменная $${expr.name}`);
      return value;
    }
    case 'unary': return numberValue(-toNumber(evaluate(expr.expr, context)));
    case 'union': {
      const parts = expr.parts.map(part => evaluate(part, context));
      const names: XmlNode[] = [];
      for (const part of parts) {
        if (part.type !== 'nodeset') throw new XPathError('Оператор | требует наборы узлов');
        names.push(...part.nodes);
      }
      return nodeset(documentOrder(names));
    }
    case 'path': {
      const start: XmlNode[] = expr.absolute ? [context.root] : [context.node];
      const nodes = applySteps(start, expr.steps, context, context.root);
      return nodeset(nodes);
    }
    case 'pathFrom': {
      const base = evaluate(expr.base, context);
      if (base.type !== 'nodeset') throw new XPathError('Ожидался набор узлов перед /');
      return nodeset(applySteps(documentOrder(base.nodes), expr.steps, context, context.root));
    }
    case 'filter': {
      const base = evaluate(expr.base, context);
      if (base.type !== 'nodeset') throw new XPathError('Предикат требует набор узлов');
      let nodes = base.nodes;
      for (const predicate of expr.predicates) nodes = positionFilter(nodes, predicate, context, context.root);
      return nodeset(nodes);
    }
    case 'binary': {
      if (expr.op === 'or') return booleanValue(toBoolean(evaluate(expr.left, context)) || toBoolean(evaluate(expr.right, context)));
      if (expr.op === 'and') return booleanValue(toBoolean(evaluate(expr.left, context)) && toBoolean(evaluate(expr.right, context)));
      const left = evaluate(expr.left, context);
      const right = evaluate(expr.right, context);
      if (['=', '!=', '<', '<=', '>', '>='].includes(expr.op)) return booleanValue(compareValues(left, right, expr.op));
      const a = toNumber(left);
      const b = toNumber(right);
      switch (expr.op) {
        case '+': return numberValue(a + b);
        case '-': return numberValue(a - b);
        case '*': return numberValue(a * b);
        case 'div': return numberValue(a / b);
        case 'mod': return numberValue(a % b);
        default: throw new XPathError(`Неподдерживаемый оператор ${expr.op}`);
      }
    }
    case 'call': return callFunction(expr.name, expr.args, context);
    default: throw new XPathError('Неподдерживаемое выражение XPath');
  }
};

function callFunction(name: string, args: Expr[], context: XPathContext): XPathValue {
  const arg = (index: number): XPathValue => evaluate(args[index], context);
  const requireArgs = (min: number, max: number): void => {
    if (args.length < min || args.length > max) throw new XPathError(`Неверное число аргументов функции ${name}()`);
  };
  switch (name) {
    case 'last': requireArgs(0, 0); return numberValue(context.size);
    case 'position': requireArgs(0, 0); return numberValue(context.position);
    case 'count': requireArgs(1, 1); { const value = arg(0); if (value.type !== 'nodeset') throw new XPathError('count() требует набор узлов'); return numberValue(value.nodes.length); }
    case 'name': return stringValue(nodeName(args.length ? arg(0) : nodeset([context.node])));
    case 'local-name': return stringValue(nodeLocalName(args.length ? arg(0) : nodeset([context.node])));
    case 'namespace-uri': return stringValue(nodeNamespace(args.length ? arg(0) : nodeset([context.node])));
    case 'string': return stringOf(args.length ? arg(0) : nodeset([context.node]));
    case 'number': return numberValue(args.length ? toNumber(arg(0)) : toNumber(nodeset([context.node])));
    case 'boolean': requireArgs(1, 1); return booleanValue(toBoolean(arg(0)));
    case 'not': requireArgs(1, 1); return booleanValue(!toBoolean(arg(0)));
    case 'true': requireArgs(0, 0); return booleanValue(true);
    case 'false': requireArgs(0, 0); return booleanValue(false);
    case 'concat': {
      if (args.length < 2) throw new XPathError('concat() требует не менее двух аргументов');
      return stringValue(args.map((_item, index) => toStringValue(arg(index))).join(''));
    }
    case 'starts-with': requireArgs(2, 2); return booleanValue(toStringValue(arg(0)).startsWith(toStringValue(arg(1))));
    case 'contains': requireArgs(2, 2); return booleanValue(toStringValue(arg(0)).includes(toStringValue(arg(1))));
    case 'substring-before': requireArgs(2, 2); {
      const text = toStringValue(arg(0)); const search = toStringValue(arg(1));
      const at = text.indexOf(search);
      return stringValue(at < 0 ? '' : text.slice(0, at));
    }
    case 'substring-after': requireArgs(2, 2); {
      const text = toStringValue(arg(0)); const search = toStringValue(arg(1));
      const at = text.indexOf(search);
      return stringValue(at < 0 ? '' : text.slice(at + search.length));
    }
    case 'substring': {
      requireArgs(2, 3);
      const text = toStringValue(arg(0));
      const start = Math.round(toNumber(arg(1)));
      const length = args.length > 2 ? Math.round(toNumber(arg(2))) : undefined;
      const chars = [...text];
      const from = Math.max(0, start - 1);
      const to = length === undefined ? chars.length : Math.max(0, from + length);
      return stringValue(chars.slice(from, Math.max(0, to)).join(''));
    }
    case 'string-length': return numberValue([...toStringValue(args.length ? arg(0) : nodeset([context.node]))].length);
    case 'normalize-space': return stringValue(toStringValue(args.length ? arg(0) : nodeset([context.node])).replace(/\s+/g, ' ').trim());
    case 'translate': {
      requireArgs(3, 3);
      const text = toStringValue(arg(0));
      const from = [...toStringValue(arg(1))];
      const to = [...toStringValue(arg(2))];
      return stringValue([...text].map(char => {
        const index = from.indexOf(char);
        if (index < 0) return char;
        return to[index] ?? '';
      }).join(''));
    }
    case 'sum': {
      requireArgs(1, 1);
      const value = arg(0);
      if (value.type !== 'nodeset') throw new XPathError('sum() требует набор узлов');
      return numberValue(value.nodes.reduce((total, node) => total + Number(textValue(node)), 0));
    }
    case 'floor': requireArgs(1, 1); return numberValue(Math.floor(toNumber(arg(0))));
    case 'ceiling': requireArgs(1, 1); return numberValue(Math.ceil(toNumber(arg(0))));
    case 'round': requireArgs(1, 1); return numberValue(Math.round(toNumber(arg(0))));
    case 'generate-id': {
      const target = args.length ? arg(0) : nodeset([context.node]);
      if (target.type !== 'nodeset' || !target.nodes.length) return stringValue('');
      return stringValue(`id${target.nodes[0].order}`);
    }
    case 'lang': requireArgs(1, 1); return booleanValue(false);
    case 'document': throw new XPathError('Функция document() отключена политикой безопасности');
    case 'key': throw new XPathError('Функция key() пока не поддерживается');
    default: throw new XPathError(`Неподдерживаемая функция XPath: ${name}()`);
  }
}

const firstNode = (value: XPathValue): XmlNode | undefined =>
  value.type === 'nodeset' ? value.nodes[0] : undefined;

const nodeName = (value: XPathValue): string => {
  const node = firstNode(value);
  if (!node) return '';
  return node.type === 'element' || node.type === 'attribute' ? node.name : '';
};

const nodeLocalName = (value: XPathValue): string => {
  const node = firstNode(value);
  if (!node) return '';
  return node.type === 'element' || node.type === 'attribute' ? node.localName : '';
};

const nodeNamespace = (value: XPathValue): string => {
  const node = firstNode(value);
  if (!node) return '';
  return node.type === 'element' || node.type === 'attribute' ? node.ns : '';
};

const compiled = new Map<string, Expr>();
export function compileXPath(expression: string): Expr {
  const cached = compiled.get(expression);
  if (cached) return cached;
  const expr = XPathParser.parse(expression);
  if (compiled.size > 512) compiled.clear();
  compiled.set(expression, expr);
  return expr;
}

export function evaluateXPath(expression: string, context: XPathContext): XPathValue {
  return evaluate(compileXPath(expression), context);
}

export { documentOrder, matchesTest, descendantsOf, childNodes, parentOf, siblings };
export type { Axis, NodeTest, Step };
export type XmlAttributeNode = XmlAttribute;
export type XmlElementNode = XmlElement;
