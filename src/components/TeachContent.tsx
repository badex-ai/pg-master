import { Fragment, type ReactNode } from 'react';

/**
 * Renders the small markdown subset that lesson `teach` content uses:
 *   `## heading`, blank-line-separated paragraphs, **bold**, `inline code`,
 *   ```sql fenced code blocks (any language tag; sql is styled to match the editor),
 *   `- `/`* ` unordered and `1. ` ordered lists, and `> ` blockquotes.
 *
 * Deliberately minimal and dependency-free — lesson content is trusted, typed TS (not user
 * input), and this vocabulary is all it needs. Everything renders as React text nodes; we
 * never use dangerouslySetInnerHTML, so untrusted-looking content could never inject markup.
 *
 * Anything outside the subset (tables, links, images) renders as literal text rather than
 * silently vanishing — if a lesson needs one, add it here on purpose.
 */

/** Split a line into React nodes, honoring **bold** and `inline code` (code wins inside its span). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Alternate matches of `code` (backticks) and **bold**. Backticks are scanned first so a
  // ** inside `...` stays literal code.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-neutral-800">
          {m[1]}
        </code>,
      );
    } else {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-neutral-900">{m[2]}</strong>);
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'para'; text: string };

/** Parse the markdown subset into an ordered list of blocks. */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'para', text: para.join(' ').trim() });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block: ```lang … ``` (consumes lines until the closing fence).
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] || '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang, code: body.join('\n') });
      continue;
    }

    // Heading: ## or ###.
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push({ type: 'heading', level: h[1].length === 3 ? 3 : 2, text: h[2].trim() });
      continue;
    }

    // List: consecutive `- `/`* ` (unordered) or `N. ` (ordered) lines, same ordered-ness.
    const item = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (item) {
      flushPara();
      const ordered = item[2] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
        if (!m || (m[2] !== undefined) !== ordered) break;
        items.push(m[3].trim());
        i += 1;
      }
      i -= 1; // the for-loop will re-increment past the last consumed line
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Blockquote: consecutive `> ` lines, joined into one paragraph.
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const parts: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*>\s?/, '').trim());
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'quote', text: parts.join(' ').trim() });
      continue;
    }

    // Blank line ends a paragraph; otherwise accumulate.
    if (line.trim() === '') {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  return blocks;
}

export function TeachContent({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed text-neutral-700">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return b.level === 2 ? (
            <h2 key={i} className="mt-2 text-lg font-semibold text-neutral-900">
              {inline(b.text, `h${i}`)}
            </h2>
          ) : (
            <h3 key={i} className="mt-1 text-base font-semibold text-neutral-800">
              {inline(b.text, `h${i}`)}
            </h3>
          );
        }
        if (b.type === 'code') {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-800"
              data-lang={b.lang || undefined}
            >
              <code>{b.code}</code>
            </pre>
          );
        }
        if (b.type === 'list') {
          const items = b.items.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>);
          return b.ordered ? (
            <ol key={i} className="ml-5 flex list-decimal flex-col gap-1">
              {items}
            </ol>
          ) : (
            <ul key={i} className="ml-5 flex list-disc flex-col gap-1">
              {items}
            </ul>
          );
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} className="border-l-2 border-neutral-300 pl-3 text-neutral-600 italic">
              {inline(b.text, `q${i}`)}
            </blockquote>
          );
        }
        return (
          <p key={i}>
            <Fragment>{inline(b.text, `p${i}`)}</Fragment>
          </p>
        );
      })}
    </div>
  );
}
