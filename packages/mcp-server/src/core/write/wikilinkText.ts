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
