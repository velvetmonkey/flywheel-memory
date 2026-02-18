/**
 * Alias Suggestions — generate candidate aliases (acronyms, short forms) for
 * entities and validate them against vault content via FTS5.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

export interface AliasCandidate {
  candidate: string;
  type: 'acronym' | 'short_form';
}

export interface AliasSuggestion {
  entity: string;
  entity_path: string;
  current_aliases: string[];
  candidate: string;
  type: 'acronym' | 'short_form';
  mentions: number;
}

/**
 * Generate alias candidates (acronyms, short forms) for an entity name,
 * filtering out any that already exist as aliases.
 */
function generateAliasCandidates(entityName: string, existingAliases: string[]): AliasCandidate[] {
  const existing = new Set(existingAliases.map(a => a.toLowerCase()));
  const candidates: AliasCandidate[] = [];
  const words = entityName.split(/[\s-]+/).filter(w => w.length > 0);

  if (words.length >= 2) {
    // Acronym: first letter of each word, uppercase
    const acronym = words.map(w => w[0]).join('').toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 6 && !existing.has(acronym.toLowerCase())) {
      candidates.push({ candidate: acronym, type: 'acronym' });
    }

    // Short form: first word only (for 3+ word names)
    if (words.length >= 3) {
      const short = words[0];
      if (short.length >= 3 && !existing.has(short.toLowerCase())) {
        candidates.push({ candidate: short, type: 'short_form' });
      }
    }
  }

  return candidates;
}

/**
 * Generate alias suggestions for entities, optionally scoped to a folder.
 * Validates each candidate against vault content via FTS5 hit count.
 */
export function suggestEntityAliases(
  stateDb: StateDb,
  folder?: string,
): AliasSuggestion[] {
  const db = stateDb.db;

  // 1. Query entities, optionally filtered by folder
  const entities = folder
    ? db.prepare(
        "SELECT name, path, aliases_json FROM entities WHERE path LIKE ? || '/%'"
      ).all(folder) as Array<{ name: string; path: string; aliases_json: string | null }>
    : db.prepare('SELECT name, path, aliases_json FROM entities').all() as Array<{ name: string; path: string; aliases_json: string | null }>;

  // 2. Build set of all entity names (lowercase) to avoid suggesting existing entities
  const allEntityNames = new Set(
    (db.prepare('SELECT name_lower FROM entities').all() as Array<{ name_lower: string }>)
      .map(r => r.name_lower)
  );

  // 3. For each entity, generate candidates and validate via FTS5
  const suggestions: AliasSuggestion[] = [];
  const countStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM notes_fts WHERE content MATCH ?'
  );

  for (const row of entities) {
    const aliases: string[] = row.aliases_json ? JSON.parse(row.aliases_json) : [];
    const candidates = generateAliasCandidates(row.name, aliases);

    for (const { candidate, type } of candidates) {
      // Skip if candidate matches an existing entity name
      if (allEntityNames.has(candidate.toLowerCase())) continue;

      // Count FTS5 mentions (exact phrase match via double quotes)
      let mentions = 0;
      try {
        const result = countStmt.get(`"${candidate}"`) as { cnt: number } | undefined;
        mentions = result?.cnt ?? 0;
      } catch {
        // FTS5 query error — skip
      }

      suggestions.push({
        entity: row.name,
        entity_path: row.path,
        current_aliases: aliases,
        candidate,
        type,
        mentions,
      });
    }
  }

  // Sort: mentions desc, then alphabetical
  suggestions.sort((a, b) => b.mentions - a.mentions || a.entity.localeCompare(b.entity));
  return suggestions;
}
