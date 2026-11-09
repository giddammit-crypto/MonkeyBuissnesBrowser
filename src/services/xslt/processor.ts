/**
 * XSLT 1.0 processor (subset) that restores client-side transformations
 * removed from Chromium 158.
 *
 * Supported: template match patterns and priorities, modes, apply-templates,
 * call-template with parameters, for-each with sort, if/choose, value-of with
 * disable-output-escaping, copy/copy-of, element/attribute/text/comment/PI
 * construction, variables, numbering, and the `html`/`xml`/`text` output
 * methods. `xsl:include`/`xsl:import` are resolved by XsltSupport before
 * compilation; `document()`, `key()`, `xsl:key` and extension functions are
 * rejected so a stylesheet cannot reach the network or private data.
 */
import {
  childElements,
  escapeHtmlText,
  escapeXmlAttribute,
  escapeXmlText,
  lookupNamespace,
  nodeToString,
  namespaceScope,
  parseXml,
  textValue,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from './xml';
import {
  compileXPath,
  evaluate,
  evaluateXPath,
  nodeset,
  toStringValue,
  toBoolean,
  toNumber,
  type Expr,
  type Step,
  type XPathContext,
  type XPathValue,
} from './xpath';

export const XSLT_NAMESPACE = 'http://www.w3.org/1999/XSL/Transform';
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

export interface XsltOutputSettings {
  method: 'html' | 'xml' | 'text';
  omitXmlDeclaration: boolean;
  doctypePublic?: string;
  doctypeSystem?: string;
  mediaType?: string;
  indent: boolean;
}

export interface XsltTransformResult {
  output: string;
  method: 'html' | 'xml' | 'text';
  mediaType: string;
  title?: string;
}

export class XsltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XsltError';
  }
}

const isXsl = (node: XmlNode, localName?: string): node is XmlElement =>
  node.type === 'element' && node.ns === XSLT_NAMESPACE && (localName === undefined || node.localName === localName);

const attr = (element: XmlElement, name: string): string | undefined =>
  element.attributes.find(attribute => attribute.name === name)?.value;

interface PatternStep { step: Step; descendants: boolean }

interface MatchPattern {
  /** `/` alone matches the document node. */
  documentOnly: boolean;
  absolute: boolean;
  steps: PatternStep[];
}

interface CompiledTemplate {
  patterns: MatchPattern[];
  name?: string;
  mode: string;
  priority: number | undefined;
  order: number;
  body: XmlNode[];
  params: string[];
  namespaces: Map<string, string>;
}

interface OutputElement {
  kind: 'element';
  name: string;
  decls: Array<[string, string]>;
  attributes: Array<{ name: string; value: string }>;
  children: OutputNode[];
}

type OutputNode =
  | OutputElement
  | { kind: 'text'; value: string; disableEscaping: boolean }
  | { kind: 'comment'; value: string }
  | { kind: 'pi'; target: string; value: string };

const HTMLElementVoidTags = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const HTML_RAW_TEXT = new Set(['script', 'style']);

const templateNestingLimit = 512;

export class XsltStylesheet {
  private constructor(
    readonly templates: CompiledTemplate[],
    readonly named: Map<string, CompiledTemplate>,
    readonly output: XsltOutputSettings,
    readonly parameters: Array<{ name: string; select?: Expr; body: XmlNode[]; namespaces: Map<string, string> }>,
    readonly source: XmlDocument,
  ) {}

  static compile(stylesheet: XmlDocument, options: { nestLimit?: number } = {}): XsltStylesheet {
    const root = stylesheet.children.find((node): node is XmlElement => node.type === 'element');
    if (!root) throw new XsltError('Таблица стилей XSLT пуста');
    if (!isXsl(root) || (root.localName !== 'stylesheet' && root.localName !== 'transform')) {
      throw new XsltError('Корневой элемент не является xsl:stylesheet');
    }
    if ((attr(root, 'version') ?? '1.0') !== '1.0') {
      throw new XsltError('Поддерживается только XSLT 1.0');
    }
    const templates: CompiledTemplate[] = [];
    const named = new Map<string, CompiledTemplate>();
    const parameters: XsltStylesheet['parameters'] = [];
    let output: XsltOutputSettings = { method: 'xml', omitXmlDeclaration: false, indent: false };
    let order = 0;
    const nestLimit = options.nestLimit ?? templateNestingLimit;

    for (const child of childElements(root)) {
      if (!isXsl(child)) continue;
      if (child.localName === 'output') {
        const method = (attr(child, 'method') ?? 'xml').toLowerCase();
        output = {
          method: method === 'html' || method === 'text' ? method : 'xml',
          omitXmlDeclaration: attr(child, 'omit-xml-declaration') === 'yes',
          doctypePublic: attr(child, 'doctype-public'),
          doctypeSystem: attr(child, 'doctype-system'),
          mediaType: attr(child, 'media-type'),
          indent: attr(child, 'indent') === 'yes',
        };
        continue;
      }
      if (child.localName === 'param') {
        const name = attr(child, 'name');
        if (!name) continue;
        const select = attr(child, 'select');
        parameters.push({
          name,
          select: select ? compileXPath(select) : undefined,
          body: stripWhitespace(child.children),
          namespaces: namespaceScope(child),
        });
        continue;
      }
      if (child.localName !== 'template') continue;
      const match = attr(child, 'match');
      const name = attr(child, 'name');
      if (!match && !name) continue;
      const compiled: CompiledTemplate = {
        patterns: match ? parseMatchPatterns(match) : [],
        name,
        mode: attr(child, 'mode') ?? '',
        priority: attr(child, 'priority') !== undefined ? Number(attr(child, 'priority')) : undefined,
        order: order++,
        body: stripWhitespace(child.children),
        params: childElements(child).filter(node => isXsl(node, 'param')).map(node => attr(node, 'name') ?? '').filter(Boolean),
        namespaces: namespaceScope(child),
      };
      if (compiled.params.length > nestLimit) throw new XsltError('Слишком много параметров шаблона');
      templates.push(compiled);
      if (name && !named.has(name)) named.set(name, compiled);
    }

    return new XsltStylesheet(templates, named, output, parameters, stylesheet);
  }

  transform(source: XmlDocument, parameters: Map<string, string> = new Map(), maxOutputBytes = 4 * 1024 * 1024): XsltTransformResult {
    const executor = new Executor(this, source, parameters, maxOutputBytes);
    const nodes = executor.run();
    const output = serialize(nodes, this.output);
    return {
      output,
      method: this.output.method,
      mediaType: this.output.mediaType ?? (this.output.method === 'html' ? 'text/html' : this.output.method === 'text' ? 'text/plain' : 'application/xml'),
      title: executor.title,
    };
  }
}

const stripWhitespace = (nodes: XmlNode[]): XmlNode[] =>
  nodes.filter(node => !(node.type === 'text' && !node.value.trim()));

function parseMatchPatterns(pattern: string): MatchPattern[] {
  const alternatives = splitTopLevel(pattern, '|');
  return alternatives.slice(0, 16).map(alternative => {
    const text = alternative.trim();
    if (!text) throw new XsltError('Пустой шаблон сопоставления (match)');
    if (text === '/') return { documentOnly: true, absolute: true, steps: [] };
    const absolute = text.startsWith('/');
    const body = absolute ? text.slice(1) : text;
    const chunks = body.split('/');
    const steps: PatternStep[] = [];
    for (const chunk of chunks) {
      if (chunk === '') { if (steps.length) steps[steps.length - 1].descendants = true; continue; }
      const expr = compileXPath(chunk);
      const step = patternStep(expr, chunk);
      steps.push({ step, descendants: false });
    }
    return { documentOnly: false, absolute, steps };
  });
}

function patternStep(expr: Expr, raw: string): Step {
  if (expr.k === 'path' && expr.steps.length === 1) return expr.steps[0];
  if (expr.k === 'path' && expr.steps.length === 2
    && expr.steps[0].axis === 'descendant-or-self' && expr.steps[0].test.k === 'node') return expr.steps[1];
  throw new XsltError(`Неподдерживаемый шаблон сопоставления: ${raw}`);
}

function splitTopLevel(value: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of value) {
    if (quote) { current += char; if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '(') depth++;
    if (char === ']' || char === ')') depth--;
    if (char === separator && depth === 0) { out.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) out.push(current);
  return out;
}

const defaultPriority = (step: Step): number => {
  if (step.predicates.length > 0) return 0.5;
  switch (step.test.k) {
    case 'name': return 0;
    case 'any': return -0.5;
    default: return -0.5;
  }
};

const nodeMatchesStep = (node: XmlNode, step: Step, root: XmlDocument, namespaces: Map<string, string>, variables: Map<string, XPathValue>): boolean => {
  switch (step.test.k) {
    case 'node':
      return step.axis === 'attribute' ? node.type === 'attribute' : true;
    case 'text': return node.type === 'text';
    case 'comment': return node.type === 'comment';
    case 'pi': return node.type === 'pi' && (step.test.target === undefined || node.target === step.test.target);
    case 'any': return node.type === 'element';
    case 'name': {
      if (node.type !== 'element') return false;
      if (step.test.prefix) {
        const uri = namespaces.get(step.test.prefix) ?? lookupNamespace(null, step.test.prefix);
        return node.ns === uri && node.localName === step.test.name;
      }
      return node.localName === step.test.name && node.ns === '';
    }
    default: return false;
  }
  // unreachable
};

const siblingPosition = (node: XmlNode, step: Step, root: XmlDocument, namespaces: Map<string, string>, variables: Map<string, XPathValue>): { position: number; size: number } => {
  const parent = node.parent;
  const list = parent && (parent.type === 'document' || parent.type === 'element') ? parent.children : [];
  const matching = list.filter(child => nodeMatchesStep(child, step, root, namespaces, variables));
  return { position: Math.max(1, matching.indexOf(node) + 1), size: Math.max(1, matching.length) };
};

function matchPattern(
  pattern: MatchPattern,
  node: XmlNode,
  index: number,
  root: XmlDocument,
  namespaces: Map<string, string>,
  variables: Map<string, XPathValue>,
): boolean {
  if (pattern.documentOnly) return node.type === 'document';
  if (index < 0) {
    if (pattern.absolute) return node.parent === null || node.parent.type === 'document';
    return true;
  }
  const { step, descendants } = pattern.steps[index];
  if (!nodeMatchesStep(node, step, root, namespaces, variables)) return false;
  if (step.predicates.length > 0) {
    const { position, size } = siblingPosition(node, step, root, namespaces, variables);
    const context: XPathContext = { node, position, size, root, variables, namespaces };
    for (const predicate of step.predicates) {
      const result = evaluate(predicate, context);
      if (result.type === 'number' ? result.value !== position : !toBoolean(result)) return false;
    }
  }
  const parent = node.parent;
  if (descendants) {
    let current: XmlNode | null = parent;
    while (current) {
      if (matchPattern(pattern, current, index - 1, root, namespaces, variables)) return true;
      current = current.parent;
    }
    return index - 1 < 0;
  }
  if (!parent) return index - 1 < 0;
  return matchPattern(pattern, parent, index - 1, root, namespaces, variables);
}

class Executor {
  private variables = new Map<string, XPathValue>();
  private output: OutputNode[] = [];
  private readonly openElements: OutputElement[] = [];
  depth = 0;
  title: string | undefined;
  private outputBytes = 0;
  private readonly currentNodes: XmlNode[] = [];

  constructor(
    private readonly stylesheet: XsltStylesheet,
    private readonly root: XmlDocument,
    parameters: Map<string, string>,
    private readonly maxOutputBytes: number,
  ) {
    for (const declared of stylesheet.parameters) {
      const provided = parameters.get(declared.name);
      if (provided !== undefined) {
        this.variables.set(declared.name, { type: 'string', value: provided });
      } else if (declared.select) {
        this.variables.set(declared.name, evaluate(declared.select, {
          node: root, position: 1, size: 1, root, variables: this.variables, namespaces: declared.namespaces,
        }));
      } else {
        this.variables.set(declared.name, { type: 'string', value: textValue({ type: 'document', children: declared.body, parent: null, order: 0, errors: [] }) });
      }
    }
  }

  run(): OutputNode[] {
    this.applyTemplates([this.root], '');
    return this.output;
  }

  private context(node: XmlNode, namespaces: Map<string, string>, position = 1, size = 1): XPathContext {
    return { node, position, size, root: this.root, variables: this.variables, namespaces };
  }

  private select(expression: string | undefined, node: XmlNode, namespaces: Map<string, string>, fallbackChildren = true): XmlNode[] {
    if (!expression) {
      if (!fallbackChildren) return [node];
      if (node.type === 'document' || node.type === 'element') return node.children;
      return [];
    }
    const value = evaluateXPath(expression, this.context(node, namespaces));
    if (value.type !== 'nodeset') throw new XsltError(`Выражение select="${expression}" не вернуло набор узлов`);
    return value.nodes;
  }

  private value(expression: string | undefined, node: XmlNode, namespaces: Map<string, string>): XPathValue {
    if (!expression) return nodeset(node.type === 'document' || node.type === 'element' ? node.children : [node]);
    return evaluateXPath(expression, this.context(node, namespaces));
  }

  private guard(): void {
    if (this.depth > templateNestingLimit) throw new XsltError('Превышена глубина применения шаблонов');
  }

  private push(node: OutputNode): void {
    const parent = this.openElements[this.openElements.length - 1];
    if (parent) parent.children.push(node);
    else this.output.push(node);
    if (node.kind === 'text') {
      this.outputBytes += node.value.length;
      if (this.outputBytes > this.maxOutputBytes) throw new XsltError('Результат XSLT превышает допустимый размер');
    }
  }

  private pushText(value: string, disableEscaping = false): void {
    if (!value) return;
    const parent = this.openElements[this.openElements.length - 1];
    if (parent && parent.children.length) {
      const last = parent.children[parent.children.length - 1];
      if (last.kind === 'text' && last.disableEscaping === disableEscaping) { last.value += value; return; }
    } else if (!parent && this.output.length) {
      const last = this.output[this.output.length - 1];
      if (last.kind === 'text' && last.disableEscaping === disableEscaping) { last.value += value; return; }
    }
    this.push({ kind: 'text', value, disableEscaping });
  }

  applyTemplates(nodes: XmlNode[], mode: string, params: Map<string, XPathValue> = new Map()): void {
    this.guard();
    this.depth++;
    try {
      for (const node of nodes) {
        const template = this.findTemplate(node, mode);
        if (template) this.executeTemplate(template, node, params, 1, 1);
        else this.builtInTemplate(node, mode);
      }
    } finally {
      this.depth--;
    }
  }

  private findTemplate(node: XmlNode, mode: string): CompiledTemplate | undefined {
    let best: CompiledTemplate | undefined;
    let bestPriority = Number.NEGATIVE_INFINITY;
    for (const template of this.stylesheet.templates) {
      if (template.mode !== mode) continue;
      let priority = Number.NEGATIVE_INFINITY;
      for (const pattern of template.patterns) {
        if (!matchPattern(pattern, node, pattern.steps.length - 1, this.root, template.namespaces, this.variables)) continue;
        const declared = template.priority;
        const lastStep = pattern.steps[pattern.steps.length - 1];
        const value = declared !== undefined ? declared : lastStep ? defaultPriority(lastStep.step) : 0.5;
        if (value > priority) priority = value;
      }
      if (priority === Number.NEGATIVE_INFINITY) continue;
      if (priority > bestPriority || (priority === bestPriority && best && template.order > best.order)) {
        best = template;
        bestPriority = priority;
      }
    }
    return best;
  }

  private builtInTemplate(node: XmlNode, mode: string): void {
    if (node.type === 'document' || node.type === 'element') {
      this.applyTemplates(node.children, mode);
      return;
    }
    if (node.type === 'text' || node.type === 'attribute') this.pushText(node.value);
  }

  private executeTemplate(template: CompiledTemplate, node: XmlNode, provided: Map<string, XPathValue>, position: number, size: number): void {
    this.depth++;
    this.guard();
    const savedVariables = this.variables;
    const frame = new Map(savedVariables);
    this.variables = frame;
    this.currentNodes.push(node);
    try {
      for (const [name, value] of provided) frame.set(name, value);
      for (const declared of template.params) {
        if (frame.has(declared)) continue;
        const paramNode = template.body.find((child): child is XmlElement => isXsl(child, 'param') && attr(child, 'name') === declared);
        if (!paramNode) continue;
        const expression = attr(paramNode, 'select');
        frame.set(declared, expression
          ? evaluate(compileXPath(expression), this.context(node, template.namespaces, position, size))
          : { type: 'string', value: textValue(instructionAsFragment(paramNode)) });
      }
      this.executeBody(template.body, node, template.namespaces, position, size);
    } finally {
      this.variables = savedVariables;
      this.currentNodes.pop();
      this.depth--;
    }
  }

  private declareVariable(name: string, value: XPathValue): void {
    this.variables.set(name, value);
  }

  private executeBody(body: XmlNode[], node: XmlNode, namespaces: Map<string, string>, position: number, size: number): void {
    this.guard();
    for (const child of body) this.executeInstruction(child, node, namespaces, position, size);
  }

  /** Stylesheet-only whitespace between instructions is not part of the result. */
  private static templateBody(children: XmlNode[]): XmlNode[] {
    return stripWhitespace(children);
  }

  private executeInstruction(instruction: XmlNode, node: XmlNode, namespaces: Map<string, string>, position: number, size: number): void {
    if (instruction.type === 'text') { this.pushText(instruction.value); return; }
    if (instruction.type !== 'element') return;
    if (instruction.ns !== XSLT_NAMESPACE) { this.literalResultElement(instruction, node, namespaces, position, size); return; }

    switch (instruction.localName) {
      case 'apply-templates': {
        const selected = this.select(attr(instruction, 'select'), node, namespaces);
        const sorted = this.sortNodes(selected, instruction, node, namespaces);
        const params = this.collectParams(instruction, node, namespaces);
        this.applyTemplates(sorted, attr(instruction, 'mode') ?? '', params);
        return;
      }
      case 'call-template': {
        const name = attr(instruction, 'name');
        if (!name) throw new XsltError('xsl:call-template без имени');
        const template = this.stylesheet.named.get(name);
        if (!template) throw new XsltError(`Не найден именованный шаблон ${name}`);
        const params = this.collectParams(instruction, node, namespaces);
        this.executeTemplate(template, node, params, position, size);
        return;
      }
      case 'for-each': {
        const selected = this.sortNodes(this.select(attr(instruction, 'select'), node, namespaces), instruction, node, namespaces);
        this.depth++;
        this.guard();
        try {
          for (let index = 0; index < selected.length; index++) {
            this.executeBody(stripWhitespaceInstructionChildren(instruction.children), selected[index], namespaces, index + 1, selected.length);
          }
        } finally {
          this.depth--;
        }
        return;
      }
      case 'if': {
        const test = attr(instruction, 'test');
        if (!test) throw new XsltError('xsl:if без атрибута test');
        if (toBoolean(evaluateXPath(test, this.context(node, namespaces, position, size)))) {
          this.withScope(() => this.executeBody(Executor.templateBody(instruction.children), node, namespaces, position, size));
        }
        return;
      }
      case 'choose': {
        let matched = false;
        for (const branch of childElements(instruction)) {
          if (!isXsl(branch) || branch.localName !== 'when') continue;
          const test = attr(branch, 'test');
          if (!test) continue;
          if (toBoolean(evaluateXPath(test, this.context(node, namespaces, position, size)))) {
            this.withScope(() => this.executeBody(Executor.templateBody(branch.children), node, namespaces, position, size));
            matched = true;
            break;
          }
        }
        if (!matched) {
          const otherwise = childElements(instruction).find(child => isXsl(child, 'otherwise'));
          if (otherwise) this.withScope(() => this.executeBody(Executor.templateBody(otherwise.children), node, namespaces, position, size));
        }
        return;
      }
      case 'value-of': {
        const value = this.value(attr(instruction, 'select'), node, namespaces);
        this.pushText(toStringValue(value), attr(instruction, 'disable-output-escaping') === 'yes');
        return;
      }
      case 'copy-of': {
        const value = this.value(attr(instruction, 'select'), node, namespaces);
        if (value.type !== 'nodeset') { this.pushText(toStringValue(value)); return; }
        for (const copied of value.nodes) this.copyNode(copied, true);
        return;
      }
      case 'copy': {
        if (node.type === 'element') {
          const element: OutputElement = {
            kind: 'element', name: node.name, decls: [], attributes: [], children: [],
          };
          for (const attribute of node.attributes) element.attributes.push({ name: attribute.name, value: attribute.value });
          this.attach(element);
          this.openElements.push(element);
          try { this.executeBody(Executor.templateBody(instruction.children), node, namespaces, position, size); }
          finally { this.openElements.pop(); }
        } else if (node.type === 'text') {
          this.pushText(node.value);
        }
        return;
      }
      case 'element': {
        const nameValue = attr(instruction, 'name');
        if (!nameValue) throw new XsltError('xsl:element без имени');
        const resolved = resolveAvt(nameValue, node, namespaces, this.variables, this.root);
        if (!/^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/.test(resolved)) throw new XsltError('Недопустимое имя элемента XSLT');
        const element: OutputElement = { kind: 'element', name: resolved, decls: [], attributes: [], children: [] };
        this.attach(element);
        this.openElements.push(element);
        try { this.executeBody(Executor.templateBody(instruction.children), node, namespaces, position, size); }
        finally { this.openElements.pop(); }
        return;
      }
      case 'attribute': {
        const nameValue = attr(instruction, 'name');
        if (!nameValue) throw new XsltError('xsl:attribute без имени');
        const resolved = resolveAvt(nameValue, node, namespaces, this.variables, this.root);
        const value = this.renderFragment(instruction.children, node, namespaces, position, size);
        const parent = this.openElements[this.openElements.length - 1];
        if (!parent) throw new XsltError('xsl:attribute вне элемента результата');
        parent.attributes.push({ name: resolved, value });
        return;
      }
      case 'text': {
        this.pushText(textValue(instruction));
        return;
      }
      case 'comment': {
        this.attach({ kind: 'comment', value: textValue(instruction).replace(/--/g, '- -') });
        return;
      }
      case 'processing-instruction': {
        const target = attr(instruction, 'name') ?? '';
        this.attach({ kind: 'pi', target: target.replace(/[^\w.-]/g, ''), value: textValue(instruction) });
        return;
      }
      case 'variable': {
        const name = attr(instruction, 'name');
        if (!name) throw new XsltError('xsl:variable без имени');
        const select = attr(instruction, 'select');
        const value = select
          ? evaluate(compileXPath(select), this.context(node, namespaces, position, size))
          : { type: 'string' as const, value: this.renderFragment(instruction.children, node, namespaces, position, size) };
        this.declareVariable(name, value);
        return;
      }
      case 'param':
        // Handled by executeTemplate; a stray xsl:param is ignored.
        return;
      case 'number': {
        this.pushText(String(this.countNodes(instruction, node)));
        return;
      }
      case 'message': {
        if (attr(instruction, 'terminate') === 'yes') throw new XsltError(textValue(instruction) || 'xsl:message terminate="yes"');
        return;
      }
      case 'apply-imports':
      case 'next-match':
        throw new XsltError('xsl:apply-imports и xsl:next-match не поддерживаются');
      case 'key':
      case 'fallback':
        return;
      case 'sort':
        // Sorting is handled by the parent instruction.
        return;
      default:
        throw new XsltError(`Неподдерживаемая инструкция xsl:${instruction.localName}`);
    }
  }

  private withScope(run: () => void): void {
    const saved = this.variables;
    const frame = new Map(saved);
    this.variables = frame;
    try { run(); }
    finally { this.variables = saved; }
  }

  renderFragment(body: XmlNode[], node: XmlNode, namespaces: Map<string, string>, position: number, size: number): string {
    const savedOutput = this.output;
    const savedOpen = [...this.openElements];
    this.output = [];
    this.openElements.length = 0;
    try {
      this.executeBody(body, node, namespaces, position, size);
      return serialize(this.output, { method: 'text', omitXmlDeclaration: true, indent: false });
    } finally {
      this.output = savedOutput;
      this.openElements.length = 0;
      this.openElements.push(...savedOpen);
    }
  }

  private attach(node: OutputNode): void {
    if (node.kind === 'element') {
      const title = node.attributes.find(attribute => attribute.name.toLowerCase() === 'title');
      if (title && this.title === undefined) this.title = title.value;
    }
    this.push(node);
  }

  private literalResultElement(element: XmlElement, node: XmlNode, namespaces: Map<string, string>, position: number, size: number): void {
    const elementNamespaces = namespaceScope(element);
    const output: OutputElement = {
      kind: 'element', name: element.name,
      decls: element.decls ? [...element.decls.entries()] : [],
      attributes: [], children: [],
    };
    for (const attribute of element.attributes) {
      if (attribute.name === 'xsl:use-attribute-sets' || attribute.name.startsWith('xsl:')) continue;
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      output.attributes.push({ name: attribute.name, value: resolveAvt(attribute.value, node, namespaces, this.variables, this.root, elementNamespaces) });
    }
    this.attach(output);
    this.openElements.push(output);
    try {
      this.executeBody(Executor.templateBody(element.children), node, namespaces, position, size);
    } finally {
      this.openElements.pop();
    }
  }

  private copyNode(node: XmlNode, deep: boolean): void {
    switch (node.type) {
      case 'text': this.pushText(node.value); return;
      case 'comment': this.attach({ kind: 'comment', value: node.value }); return;
      case 'pi': this.attach({ kind: 'pi', target: node.target, value: node.value }); return;
      case 'element': {
        const element: OutputElement = { kind: 'element', name: node.name, decls: [], attributes: [], children: [] };
        for (const attribute of node.attributes) element.attributes.push({ name: attribute.name, value: attribute.value });
        this.attach(element);
        if (deep) {
          this.openElements.push(element);
          try { for (const child of node.children) this.copyNode(child, true); }
          finally { this.openElements.pop(); }
        }
        return;
      }
      case 'document': for (const child of node.children) this.copyNode(child, deep); return;
      default: return;
    }
  }

  private collectParams(instruction: XmlElement, node: XmlNode, namespaces: Map<string, string>): Map<string, XPathValue> {
    const params = new Map<string, XPathValue>();
    for (const child of childElements(instruction)) {
      if (!isXsl(child, 'with-param')) continue;
      const name = attr(child, 'name');
      if (!name) continue;
      const select = attr(child, 'select');
      params.set(name, select
        ? evaluate(compileXPath(select), this.context(node, namespaces))
        : { type: 'string', value: this.renderFragment(child.children, node, namespaces, 1, 1) });
    }
    return params;
  }

  private sortNodes(nodes: XmlNode[], instruction: XmlElement, node: XmlNode, namespaces: Map<string, string>): XmlNode[] {
    const sorts = childElements(instruction).filter(child => isXsl(child, 'sort'));
    if (sorts.length === 0) return nodes;
    const sorted = [...nodes];
    sorted.sort((left, right) => {
      for (const sort of sorts) {
        const select = attr(sort, 'select');
        const dataType = attr(sort, 'data-type') ?? 'text';
        const order = attr(sort, 'order') ?? 'ascending';
        const valueOf = (candidate: XmlNode): string | number => {
          const context: XPathContext = { node: candidate, position: 1, size: 1, root: this.root, variables: this.variables, namespaces };
          const value = select ? evaluate(compileXPath(select), context) : nodeset(candidate.type === 'element' ? candidate.children : [candidate]);
          return dataType === 'number' ? toNumber(value) : toStringValue(value);
        };
        const a = valueOf(left);
        const b = valueOf(right);
        let comparison = 0;
        if (typeof a === 'number' && typeof b === 'number') comparison = a - b;
        else comparison = String(a).localeCompare(String(b), 'ru');
        if (comparison !== 0) return order === 'descending' ? -comparison : comparison;
      }
      return 0;
    });
    return sorted;
  }

  private countNodes(instruction: XmlElement, node: XmlNode): number {
    const countExpr = attr(instruction, 'count');
    const level = attr(instruction, 'level') ?? 'single';
    const step: Step = countExpr ? patternStep(compileXPath(countExpr), countExpr) : { axis: 'child', test: { k: 'node' }, predicates: [] };
    const matches = (candidate: XmlNode): boolean =>
      candidate.type === 'element' && (step.test.k === 'any' || (step.test.k === 'name' && candidate.localName === step.test.name));
    if (level === 'any') {
      const all = collectDescendants(node);
      return all.filter(matches).length;
    }
    let total = 0;
    let current: XmlNode | null = node;
    while (current) {
      const parent: XmlNode | null = current.parent;
      if (parent && (parent.type === 'element' || parent.type === 'document')) {
        for (const sibling of parent.children) {
          if (matches(sibling)) total++;
          if (sibling === current) break;
        }
      }
      if (level === 'single') break;
      current = parent;
    }
    return total;
  }
}

const collectDescendants = (node: XmlNode): XmlNode[] => {
  const out: XmlNode[] = [];
  const stack: XmlNode[] = [...((node.type === 'element' || node.type === 'document') ? node.children : [])];
  while (stack.length) {
    const current = stack.pop()!;
    out.push(current);
    if (current.type === 'element') stack.push(...current.children);
  }
  return out;
};

const stripWhitespaceInstructionChildren = (nodes: XmlNode[]): XmlNode[] =>
  nodes.filter(node => !(isXsl(node, 'sort')) && !(node.type === 'text' && !node.value.trim()));

const instructionAsFragment = (element: XmlElement): XmlDocument => ({
  type: 'document', children: element.children, parent: null, order: 0, errors: [],
});

/** Attribute value templates: `{expression}` inside literal attribute values. */
function resolveAvt(
  template: string,
  node: XmlNode,
  namespaces: Map<string, string>,
  variables: Map<string, XPathValue>,
  root: XmlDocument,
  fallbackNamespaces?: Map<string, string>,
): string {
  if (!template.includes('{')) return template;
  let out = '';
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf('{', index);
    if (open < 0) { out += template.slice(index); break; }
    out += template.slice(index, open);
    if (template[open + 1] === '{') { out += '{'; index = open + 2; continue; }
    const close = findClosingBrace(template, open);
    if (close < 0) { out += template.slice(open); break; }
    const expression = template.slice(open + 1, close).trim();
    try {
      const value = evaluateXPath(expression, {
        node, position: 1, size: 1, root, variables, namespaces: fallbackNamespaces ?? namespaces,
      });
      out += toStringValue(value);
    } catch {
      out += '';
    }
    index = close + 1;
  }
  return out;
}

function findClosingBrace(template: string, open: number): number {
  let quote = '';
  for (let index = open + 1; index < template.length; index++) {
    const char = template[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '}') return index;
  }
  return -1;
}

function serialize(nodes: OutputNode[], settings: XsltOutputSettings): string {
  if (settings.method === 'text') return nodes.map(collectText).join('');
  const body = nodes.map(node => serializeNode(node, settings)).join('');
  if (settings.method === 'html') {
    const doctype = settings.doctypePublic || settings.doctypeSystem
      ? `<!DOCTYPE html${settings.doctypePublic ? ` PUBLIC "${settings.doctypePublic}"` : ''}${settings.doctypeSystem ? ` "${settings.doctypeSystem}"` : ''}>\n`
      : '';
    return doctype + body;
  }
  const declaration = settings.omitXmlDeclaration ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n';
  return declaration + body;
}

function collectText(node: OutputNode): string {
  switch (node.kind) {
    case 'text': return node.value;
    case 'element': return node.children.map(collectText).join('');
    default: return '';
  }
}

function serializeNode(node: OutputNode, settings: XsltOutputSettings): string {
  switch (node.kind) {
    case 'text':
      if (node.disableEscaping) return node.value;
      return settings.method === 'html' ? escapeHtmlText(node.value) : escapeXmlText(node.value);
    case 'comment': return `<!--${node.value.replace(/--/g, '- -')}-->`;
    case 'pi': return `<?${node.target} ${node.value}?>`;
    case 'element': {
      const isHtml = settings.method === 'html';
      const name = node.name;
      const localName = name.includes(':') ? name.slice(name.indexOf(':') + 1).toLowerCase() : name.toLowerCase();
      const seenPrefixes = new Set<string>();
      const decls = node.decls
        .filter(([prefix]) => { if (seenPrefixes.has(prefix)) return false; seenPrefixes.add(prefix); return true; })
        .map(([prefix, uri]) => ` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escapeXmlAttribute(uri)}"`).join('');
      const attributes = node.attributes.map(attribute => ` ${attribute.name}="${escapeXmlAttribute(attribute.value)}"`).join('');
      const open = `<${name}${decls}${attributes}`;
      const rawText = isHtml && HTML_RAW_TEXT.has(localName);
      if (isHtml && HTMLElementVoidTags.has(localName) && node.children.length === 0) return `${open}>`;
      if (node.children.length === 0) return isHtml ? `${open}></${name}>` : `${open}/>`;
      const inner = rawText
        ? node.children.map(child => child.kind === 'text' ? child.value : serializeNode(child, settings)).join('')
        : node.children.map(child => serializeNode(child, settings)).join('');
      return `${open}>${inner}</${name}>`;
    }
    default: return '';
  }
}

/** Parses a stylesheet from text; kept for tests and `xsl:include` resolution. */
export function compileStylesheetText(text: string): XsltStylesheet {
  return XsltStylesheet.compile(parseXml(text));
}

export { nodeToString, childElements };
