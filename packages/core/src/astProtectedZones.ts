/**
 * AST-based protected zone detection
 *
 * Uses mdast tree to compute ProtectedZone[] more accurately than regex,
 * especially for nested callouts, tables, and multi-line HTML comments.
 *
 * Supplemental regex handles Obsidian-specific syntax not in mdast:
 * [[wikilinks]], bare URLs, #hashtags, %%comments%%
 */

import { visit, SKIP } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node as UnistNode } from 'unist';
import type { ProtectedZone, ProtectedZoneType } from './types.js';

function getOffset(node: UnistNode): { start: number; end: number } | null {
  const pos = node.position;
  if (
    pos?.start &&
    pos?.end &&
    typeof pos.start.offset === 'number' &&
    typeof pos.end.offset === 'number'
  ) {
    return { start: pos.start.offset, end: pos.end.offset };
  }
  return null;
}

function zone(start: number, end: number, type: ProtectedZoneType): ProtectedZone {
  return { start, end, type };
}

/**
 * Check if a blockquote node is an Obsidian callout (> [!type] syntax).
 * If so, protect the entire blockquote — fixes nested callout bugs.
 */
function isObsidianCallout(node: UnistNode): boolean {
  if (node.type !== 'blockquote') return false;
  const children = (node as { children?: UnistNode[] }).children;
  if (!children?.length) return false;

  const firstChild = children[0];
  if (firstChild.type !== 'paragraph') return false;
  const paraChildren = (firstChild as { children?: UnistNode[] }).children;
  if (!paraChildren?.length) return false;

  const firstInline = paraChildren[0];
  if (firstInline.type !== 'text') return false;
  const value = (firstInline as { value?: string }).value;
  if (typeof value !== 'string') return false;

  return /^\[![\w-]+\]/.test(value);
}

/**
 * Extract protected zones from an mdast tree.
 */
export function getProtectedZonesFromAst(tree: Root, content: string): ProtectedZone[] {
  const zones: ProtectedZone[] = [];

  visit(tree, (node: UnistNode) => {
    const off = getOffset(node);
    if (!off) return;

    switch (node.type) {
      case 'yaml':
        // Frontmatter: extend zone to include the --- delimiters and trailing newline
        {
          const fmStart = 0;
          const closingIdx = content.indexOf('---', off.end);
          const fmEnd = closingIdx !== -1 ? closingIdx + 3 : off.end;
          const afterEnd = fmEnd < content.length && content[fmEnd] === '\n' ? fmEnd + 1 : fmEnd;
          zones.push(zone(fmStart, afterEnd, 'frontmatter'));
        }
        break;

      case 'code':
        zones.push(zone(off.start, off.end, 'code_block'));
        break;

      case 'inlineCode':
        zones.push(zone(off.start, off.end, 'inline_code'));
        break;

      case 'link':
        zones.push(zone(off.start, off.end, 'markdown_link'));
        break;

      case 'heading':
        zones.push(zone(off.start, off.end, 'header'));
        break;

      case 'html':
        zones.push(zone(off.start, off.end, 'html_tag'));
        break;

      case 'inlineMath':
      case 'math':
        zones.push(zone(off.start, off.end, 'math'));
        break;

      case 'table':
        zones.push(zone(off.start, off.end, 'table'));
        break;

      case 'blockquote':
        if (isObsidianCallout(node)) {
          zones.push(zone(off.start, off.end, 'obsidian_callout'));
          return SKIP; // Don't recurse into callout children
        }
        break;
    }
  });

  // Supplemental regex for Obsidian-specific syntax not in mdast
  addRegexZones(content, zones);

  // Sort by start position
  zones.sort((a, b) => a.start - b.start);

  return zones;
}

/**
 * Add zones for Obsidian-specific syntax that mdast doesn't parse:
 * - [[wikilinks]]
 * - Bare URLs
 * - #hashtags
 * - %%comments%%
 */
function addRegexZones(content: string, zones: ProtectedZone[]): void {
  const patterns: Array<[RegExp, ProtectedZoneType]> = [
    [/\[\[[^\]]+\]\]/g, 'wikilink'],
    [/https?:\/\/[^\s\)\]]+(?:\([^\)]+\))?[^\s\)\]]*/g, 'url'],
    [/#[\w-]+/g, 'hashtag'],
    [/%%.*?%%/gs, 'obsidian_comment'],
  ];

  for (const [pattern, type] of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      zones.push({
        start: match.index,
        end: match.index + match[0].length,
        type,
      });
    }
  }
}
