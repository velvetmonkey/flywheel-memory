/**
 * Protected zones detection for wikilink application
 *
 * AST-first approach: uses mdast for accurate zone detection (nested callouts,
 * tables, multi-line HTML), with regex fallback on parse failure.
 *
 * These are areas in markdown content where wikilinks should NOT be applied:
 * - YAML frontmatter
 * - Code blocks (``` ... ```)
 * - Inline code (` ... `)
 * - Existing wikilinks ([[...]])
 * - Markdown links ([text](url))
 * - URLs (http:// or https://)
 * - Hashtags (#tag)
 * - HTML/XML tags (<tag>)
 * - Obsidian comments (%% ... %%)
 * - Math expressions ($ ... $ and $$ ... $$)
 * - Markdown headers (# to ###### at line start)
 * - Obsidian callouts (> [!type] syntax — entire block, including nested)
 * - Tables (GFM pipe tables)
 */

import type { ProtectedZone, ProtectedZoneType } from './types.js';
import { parseMarkdown } from './parseMarkdown.js';
import { getProtectedZonesFromAst } from './astProtectedZones.js';

/**
 * Find where YAML frontmatter ends
 * @returns Character index after closing ---, or 0 if no frontmatter
 */
export function findFrontmatterEnd(content: string): number {
  if (!content.startsWith('---')) {
    return 0;
  }

  const lines = content.split('\n');
  if (lines.length < 2) {
    return 0;
  }

  // Start after the opening ---
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      // Calculate character position after closing ---
      let pos = 0;
      for (let j = 0; j <= i; j++) {
        pos += lines[j].length + 1; // +1 for newline
      }
      return pos;
    }
  }

  return 0; // No closing --- found
}

/**
 * Find all matches of a pattern and return as protected zones
 */
function findPatternZones(
  content: string,
  pattern: RegExp,
  type: ProtectedZoneType
): ProtectedZone[] {
  const zones: ProtectedZone[] = [];
  let match: RegExpExecArray | null;

  // Ensure global flag is set
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

  while ((match = globalPattern.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      type,
    });
  }

  return zones;
}

/**
 * Get all protected zones using regex-only detection (legacy/fallback).
 * Exported for testing and explicit fallback use.
 */
export function getProtectedZonesRegex(content: string): ProtectedZone[] {
  const zones: ProtectedZone[] = [];

  // 1. YAML frontmatter (must be first)
  const frontmatterEnd = findFrontmatterEnd(content);
  if (frontmatterEnd > 0) {
    zones.push({
      start: 0,
      end: frontmatterEnd,
      type: 'frontmatter',
    });
  }

  // 2. Code blocks (``` ... ```)
  zones.push(...findPatternZones(content, /```[\s\S]*?```/g, 'code_block'));

  // 3. Inline code (` ... `)
  zones.push(...findPatternZones(content, /`[^`]+`/g, 'inline_code'));

  // 4. Existing wikilinks ([[...]])
  zones.push(...findPatternZones(content, /\[\[[^\]]+\]\]/g, 'wikilink'));

  // 5. Markdown links [text](url)
  zones.push(...findPatternZones(content, /\[([^\]]+)\]\(([^\)]+)\)/g, 'markdown_link'));

  // 6. Bare URLs (http:// or https://)
  zones.push(...findPatternZones(content, /https?:\/\/[^\s\)\]]+(?:\([^\)]+\))?[^\s\)\]]*/g, 'url'));

  // 7. Hashtags (#tag)
  zones.push(...findPatternZones(content, /#[\w-]+/g, 'hashtag'));

  // 8. HTML/XML tags (<tag>)
  zones.push(...findPatternZones(content, /<[^>]+>/g, 'html_tag'));

  // 9. Obsidian comments (%% ... %%)
  zones.push(...findPatternZones(content, /%%.*?%%/gs, 'obsidian_comment'));

  // 10. Math expressions ($ ... $ and $$ ... $$)
  zones.push(...findPatternZones(content, /\$\$[\s\S]*?\$\$|\$[^\$]+\$/g, 'math'));

  // 11. Markdown headers (# to ###### at start of line)
  zones.push(...findPatternZones(content, /^#{1,6}\s+.+$/gm, 'header'));

  // 12. Obsidian callouts (> [!type] syntax)
  zones.push(...findPatternZones(content, /^>\s*\[![\w-]+\].*$/gm, 'obsidian_callout'));

  // Sort by start position and merge overlapping zones
  zones.sort((a, b) => a.start - b.start);

  return mergeOverlappingZones(zones);
}

/**
 * Get all protected zones in content where wikilinks should not be applied.
 *
 * AST-first: parses markdown into AST for accurate detection of nested
 * callouts, tables, and HTML comments. Falls back to regex on parse failure.
 */
export function getProtectedZones(content: string): ProtectedZone[] {
  const tree = parseMarkdown(content);
  if (tree) {
    return mergeOverlappingZones(getProtectedZonesFromAst(tree, content));
  }
  console.error('[ProtectedZones] AST parse failed, falling back to regex detection');
  return getProtectedZonesRegex(content);
}

/**
 * Merge overlapping or adjacent protected zones into a single list.
 * Zones that touch (end === start) or overlap are collapsed.
 */
export function mergeOverlappingZones(zones: ProtectedZone[]): ProtectedZone[] {
  if (zones.length <= 1) return zones;
  const sorted = [...zones].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: ProtectedZone[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Check if a position is within any protected zone
 */
export function isInProtectedZone(
  position: number,
  zones: ProtectedZone[]
): boolean {
  return zones.some(zone => position >= zone.start && position < zone.end);
}

/**
 * Check if a range overlaps with any protected zone
 */
export function rangeOverlapsProtectedZone(
  start: number,
  end: number,
  zones: ProtectedZone[]
): boolean {
  return zones.some(zone =>
    (start >= zone.start && start < zone.end) ||
    (end > zone.start && end <= zone.end) ||
    (start <= zone.start && end >= zone.end)
  );
}
