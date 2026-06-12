import path from 'path';

/**
 * Pure wikilink text helpers (arch-review S1).
 *
 * extractLinkedEntities lived in wikilinks.ts; wikilinkFeedback.ts importing
 * it was the only edge closing the wikilinks ⇄ wikilinkFeedback cycle.
 */

/**
 * Extract entities that are already linked in content
 * @param content - Content to scan for existing wikilinks
 * @returns Set of linked entity names (lowercase for comparison)
 */
export function extractLinkedEntities(content: string): Set<string> {
  const linked = new Set<string>();
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  let match;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    linked.add(match[1].toLowerCase());
  }

  return linked;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract wikilinks from content
 * Returns array of { target, displayText?, fullMatch }
 */
export function extractWikilinks(content: string): Array<{ target: string; displayText?: string; fullMatch: string }> {
  const wikilinks: Array<{ target: string; displayText?: string; fullMatch: string }> = [];
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    wikilinks.push({
      target: match[1],
      displayText: match[2],
      fullMatch: match[0],
    });
  }

  return wikilinks;
}

/**
 * Get the title from a file path (filename without .md extension)
 */
export function getTitleFromPath(filePath: string): string {
  return path.basename(filePath, '.md');
}

