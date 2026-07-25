import type { PageMap, PageNode } from '../types.js';

/**
 * Renders a `PageMap` as the text the model actually reads.
 *
 * The format matters more than almost anything else in this codebase. Two
 * principles drive it:
 *
 *  1. Every actionable thing carries a `[ref]` the model can quote back. If a
 *     line has no ref, the model cannot act on it, and it should not be there.
 *  2. Structure is conveyed by indentation, not by tags. Nesting tells the
 *     model that a button belongs to a dialog, or a field belongs to a form,
 *     which is exactly the context it needs to disambiguate three buttons all
 *     labelled "Continue".
 */

const INTERACTIVE = new Set([
  'link', 'button', 'textbox', 'combobox', 'checkbox',
  'radio', 'slider', 'tab', 'menuitem', 'option',
]);

export interface SerializeOptions {
  /** Drop nodes outside the viewport. Off by default: the model may scroll. */
  viewportOnly?: boolean;
  /** Cap on rendered lines, so a huge page cannot blow the context window. */
  maxLines?: number;
  /** Include non-interactive text nodes for grounding. */
  includeText?: boolean;
}

export function serializePageMap(map: PageMap, options: SerializeOptions = {}): string {
  const { viewportOnly = false, maxLines = 500, includeText = true } = options;

  const lines: string[] = [];
  const header =
    `URL: ${map.url}\n` +
    `Title: ${map.title || '(untitled)'}\n` +
    `Viewport: ${map.viewport.w}x${map.viewport.h} — ` +
    `scrolled ${map.viewport.scrollY}px of ${map.viewport.scrollH}px` +
    (map.busy ? ' — page is still loading' : '');

  let dropped = 0;

  const render = (index: number, depth: number): void => {
    if (lines.length >= maxLines) { dropped++; return; }
    const node = map.nodes[index];
    if (!node) return;

    const keep = shouldRender(node, { viewportOnly, includeText });
    let nextDepth = depth;

    if (keep) {
      lines.push('  '.repeat(Math.min(depth, 12)) + formatNode(node));
      nextDepth = depth + 1;
    }

    for (const child of node.children ?? []) render(child, nextDepth);
  };

  for (const root of map.roots) render(root, 0);

  const body = lines.length ? lines.join('\n') : '(no interactive elements found)';
  const tail = dropped > 0
    ? `\n… ${dropped} further element(s) omitted; scroll or narrow the page to see them.`
    : '';

  const obstacles = map.obstacles.length
    ? '\n\nDetected on this page:\n' +
      map.obstacles.map((o) => `  ! ${o.kind}: ${o.detail}`).join('\n')
    : '';

  return `${header}\n\n${body}${tail}${obstacles}`;
}

function shouldRender(node: PageNode, opts: { viewportOnly: boolean; includeText: boolean }): boolean {
  if (opts.viewportOnly && !node.inViewport) return false;
  if (INTERACTIVE.has(node.role)) return true;
  if (node.role === 'heading' || node.role === 'dialog' || node.role === 'iframe') return true;
  if (node.role === 'text') return opts.includeText && node.name.length > 1;
  return false;
}

function formatNode(node: PageNode): string {
  // Text is the one role with no ref shown: it is context, not a target.
  if (node.role === 'text') return `· ${node.name}`;

  const parts: string[] = [`[${node.ref}]`, node.role];

  if (node.role === 'heading' && node.level) parts[1] = `h${node.level}`;
  if (node.name) parts.push(JSON.stringify(node.name));

  const flags: string[] = [];
  if (node.sensitive) flags.push(`sensitive:${node.sensitive}`);
  else if (node.value) flags.push(`value=${JSON.stringify(node.value)}`);
  if (node.inputType && node.inputType !== 'text' && node.role === 'textbox') {
    flags.push(`type=${node.inputType}`);
  }
  if (node.disabled) flags.push('disabled');
  if (node.required) flags.push('required');
  if (node.checked !== undefined) flags.push(node.checked ? 'checked' : 'unchecked');
  if (node.expanded !== undefined) flags.push(node.expanded ? 'expanded' : 'collapsed');
  if (!node.inViewport) flags.push('offscreen');

  if (flags.length) parts.push(`(${flags.join(', ')})`);
  return parts.join(' ');
}

/**
 * A one-line description of an element, for the human-readable trace.
 * `clicked "Search flights"` reads better than `clicked e42`.
 */
export function describeNode(node: PageNode | undefined, ref: string): string {
  if (!node) return ref;
  if (node.name) return `${node.role} ${JSON.stringify(node.name)}`;
  return `${node.role} ${ref}`;
}

export function findNode(map: PageMap, ref: string): PageNode | undefined {
  return map.nodes.find((n) => n.ref === ref);
}
