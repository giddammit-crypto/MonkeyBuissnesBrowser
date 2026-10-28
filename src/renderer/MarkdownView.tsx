import React from 'react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * Parses inline markdown: bold, italic, strikethrough, inline code, and links.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize by inline patterns
  // 1: `code`
  // 2: **bold** or __bold__
  // 3: *italic* or _italic_
  // 4: ~~strike~~
  // 5: [link text](url)
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `inline-${match.index}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="voodoo-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(
        <strong key={key} className="voodoo-strong">
          {token.slice(2, -2)}
        </strong>
      );
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      nodes.push(
        <em key={key} className="voodoo-em">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={key} className="voodoo-del">
          {token.slice(2, -2)}
        </del>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const linkUrl = linkMatch[2];
        const isSafe = /^https?:\/\//i.test(linkUrl);
        nodes.push(
          <a
            key={key}
            href={isSafe ? linkUrl : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="voodoo-link"
          >
            {linkText}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export default function MarkdownView({ content, className = '' }: MarkdownViewProps): React.JSX.Element {
  if (!content) return <span />;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let currentListItems: string[] = [];
  let isCurrentListOrdered = false;

  const flushList = (key: string) => {
    if (currentListItems.length === 0) return;
    const items = currentListItems.map((item, idx) => (
      <li key={`li-${idx}`} className="voodoo-list-item">
        {renderInlineMarkdown(item)}
      </li>
    ));
    if (isCurrentListOrdered) {
      elements.push(
        <ol key={key} className="voodoo-ordered-list">
          {items}
        </ol>
      );
    } else {
      elements.push(
        <ul key={key} className="voodoo-unordered-list">
          {items}
        </ul>
      );
    }
    currentListItems = [];
    isCurrentListOrdered = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Check code fence (```)
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <div key={`codeblock-${i}`} className="voodoo-code-block-wrapper">
            {codeBlockLang && <span className="voodoo-code-lang">{codeBlockLang}</span>}
            <pre className="voodoo-pre">
              <code>{codeBlockLines.join('\n')}</code>
            </pre>
          </div>
        );
        codeBlockLines = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        flushList(`list-before-code-${i}`);
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      flushList(`list-before-hr-${i}`);
      elements.push(<hr key={`hr-${i}`} className="voodoo-hr" />);
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList(`list-before-h-${i}`);
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        elements.push(
          <h3 key={`h1-${i}`} className="voodoo-h1">
            {renderInlineMarkdown(text)}
          </h3>
        );
      } else if (level === 2) {
        elements.push(
          <h4 key={`h2-${i}`} className="voodoo-h2">
            {renderInlineMarkdown(text)}
          </h4>
        );
      } else {
        elements.push(
          <h5 key={`h3-${i}`} className="voodoo-h3">
            {renderInlineMarkdown(text)}
          </h5>
        );
      }
      continue;
    }

    // Blockquote (> text)
    if (trimmed.startsWith('>')) {
      flushList(`list-before-quote-${i}`);
      const quoteText = trimmed.replace(/^>\s*/, '');
      elements.push(
        <blockquote key={`quote-${i}`} className="voodoo-quote">
          {renderInlineMarkdown(quoteText)}
        </blockquote>
      );
      continue;
    }

    // Unordered list item (•, -, *)
    const ulMatch = trimmed.match(/^(?:•|\*|-)\s+(.+)$/);
    if (ulMatch) {
      if (isCurrentListOrdered && currentListItems.length > 0) {
        flushList(`list-switch-${i}`);
      }
      isCurrentListOrdered = false;
      currentListItems.push(ulMatch[1]);
      continue;
    }

    // Ordered list item (1. text)
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!isCurrentListOrdered && currentListItems.length > 0) {
        flushList(`list-switch-${i}`);
      }
      isCurrentListOrdered = true;
      currentListItems.push(olMatch[1]);
      continue;
    }

    // Empty line
    if (!trimmed) {
      flushList(`list-empty-${i}`);
      continue;
    }

    // Regular paragraph line
    flushList(`list-before-p-${i}`);
    elements.push(
      <p key={`p-${i}`} className="voodoo-paragraph">
        {renderInlineMarkdown(rawLine)}
      </p>
    );
  }

  // Flush remaining list
  flushList('list-end');

  // Flush dangling code block if any
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <div key="codeblock-dangling" className="voodoo-code-block-wrapper">
        <pre className="voodoo-pre">
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      </div>
    );
  }

  return <div className={`voodoo-markdown-body ${className}`}>{elements}</div>;
}
