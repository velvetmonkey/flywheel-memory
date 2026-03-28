/**
 * Note Identity Helpers
 *
 * Centralizes path normalization and inbound-target resolution so that
 * all consumers use the same identity bridges between note paths,
 * entity names, and stored link targets.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

/**
 * Normalize a note path to canonical resolved-path form: lowercase, no .md.
 *
 * This is the single source of truth for path normalization. Use it
 * everywhere instead of inline toLowerCase().replace(/\.md$/, '').
 */
export function normalizeResolvedPath(notePath: string): string {
  return notePath.toLowerCase().replace(/\.md$/, '');
}

/**
 * Resolve a note path to all lowercased target strings that could
 * appear in note_links.target for links pointing at this note.
 *
 * Returns targets in identity-strength order:
 *   1. entity name_lower (strongest — canonical entity name)
 *   2. aliases (lowercased)
 *   3. filename stem (weakest — fallback for non-entity notes,
 *      also included for backward compat when entity exists)
 *
 * Falls back to stem only when no entity row exists or stateDb is null.
 *
 * Uses Set<string> internally for dedup.
 */
export function getInboundTargetsForNote(
  stateDb: StateDb | null,
  notePath: string,
): string[] {
  const targets = new Set<string>();
  const stem = notePath.replace(/\.md$/, '').split('/').pop()?.toLowerCase();
  const normalizedPath = normalizeResolvedPath(notePath);

  if (stateDb) {
    try {
      const row = stateDb.db.prepare(
        `SELECT name_lower, aliases_json FROM entities
         WHERE LOWER(REPLACE(path, '.md', '')) = ?`
      ).get(normalizedPath) as { name_lower: string; aliases_json: string | null } | undefined;

      if (row) {
        targets.add(row.name_lower);
        if (row.aliases_json) {
          try {
            for (const alias of JSON.parse(row.aliases_json) as string[]) {
              targets.add(alias.toLowerCase());
            }
          } catch { /* malformed JSON */ }
        }
      }
    } catch { /* best-effort */ }
  }

  // Stem as last-resort fallback (always included for backward compat)
  if (stem) targets.add(stem);

  return [...targets];
}
