/**
 * Note creation intelligence (arch-review G5, part F2)
 *
 * Preflight checks run before creating a new note: alias collision
 * detection, smart alias suggestions, and duplicate/similarity checks
 * against the entity index (exact, FTS5, semantic).
 */

import {
  getEntityByName,
  getEntitiesByAlias,
  searchEntities as searchEntitiesDb,
} from '@velvetmonkey/vault-core';
import {
  embedTextCached,
  findSemanticallySimilarEntities,
  hasEntityEmbeddingsIndex,
} from '../read/embeddings.js';
import { getWriteStateDb } from './wikilinkState.js';

/** Collision between a note name/alias and existing entities */
export interface AliasCollision {
  term: string;
  source: 'name' | 'alias';
  collidedWith: {
    name: string;
    path: string;
    matchType: 'name' | 'alias';
  };
}

/** Smart alias suggestion with reasoning */
export interface AliasSuggestion {
  alias: string;
  reason: string;
}

/** Result of preflight similarity check */
export interface PreflightResult {
  existingEntity?: { name: string; path: string; category: string };
  similarEntities: Array<{ name: string; path: string; category: string; rank: number }>;
}

/**
 * Detect alias collisions for a new note
 *
 * Checks three collision types:
 * 1. Note name matches an existing entity's alias
 * 2. Provided alias matches an existing entity's primary name
 * 3. Provided alias matches another entity's alias
 *
 * @param noteName - Name of the new note
 * @param aliases - Aliases for the new note
 * @returns Array of collisions found
 */
export function detectAliasCollisions(
  noteName: string,
  aliases: string[] = []
): AliasCollision[] {
  const stateDb = getWriteStateDb();
  if (!stateDb) return [];

  const collisions: AliasCollision[] = [];

  // 1. Note name matches an existing entity's alias
  const nameAsAlias = getEntitiesByAlias(stateDb, noteName);
  for (const entity of nameAsAlias) {
    // Skip self (if this note already exists as an entity)
    if (entity.name.toLowerCase() === noteName.toLowerCase()) continue;
    collisions.push({
      term: noteName,
      source: 'name',
      collidedWith: {
        name: entity.name,
        path: entity.path,
        matchType: 'alias',
      },
    });
  }

  for (const alias of aliases) {
    // 2. Alias matches an existing entity's primary name
    const existingByName = getEntityByName(stateDb, alias);
    if (existingByName && existingByName.name.toLowerCase() !== noteName.toLowerCase()) {
      collisions.push({
        term: alias,
        source: 'alias',
        collidedWith: {
          name: existingByName.name,
          path: existingByName.path,
          matchType: 'name',
        },
      });
    }

    // 3. Alias matches another entity's alias
    const existingByAlias = getEntitiesByAlias(stateDb, alias);
    for (const entity of existingByAlias) {
      // Skip self
      if (entity.name.toLowerCase() === noteName.toLowerCase()) continue;
      // Skip if already reported as name collision
      if (existingByName && existingByName.name.toLowerCase() === entity.name.toLowerCase()) continue;
      collisions.push({
        term: alias,
        source: 'alias',
        collidedWith: {
          name: entity.name,
          path: entity.path,
          matchType: 'alias',
        },
      });
    }
  }

  return collisions;
}

/**
 * Suggest aliases for a new note based on its name and category
 *
 * Category-aware suggestions:
 * - people: First name, last name
 * - technologies/projects: Acronym if 3+ words
 * - any: Unhyphenated form for hyphenated names
 * - any: Acronym for 3+ words
 *
 * Each suggestion is checked against existing entity names to avoid creating new collisions.
 *
 * @param noteName - Name of the new note
 * @param existingAliases - Aliases already provided (to avoid duplicates)
 * @param category - Optional category hint for smarter suggestions
 * @returns Array of alias suggestions with reasoning
 */
export function suggestAliases(
  noteName: string,
  existingAliases: string[] = [],
  category?: string
): AliasSuggestion[] {
  const suggestions: AliasSuggestion[] = [];
  const existingLower = new Set(existingAliases.map(a => a.toLowerCase()));
  const words = noteName.split(/\s+/).filter(w => w.length > 0);

  // Helper: check if alias is safe (not already an entity name, not already provided)
  function isSafe(alias: string): boolean {
    if (existingLower.has(alias.toLowerCase())) return false;
    if (alias.toLowerCase() === noteName.toLowerCase()) return false;
    const db = getWriteStateDb();
    if (!db) return true;
    const existing = getEntityByName(db, alias);
    return !existing;
  }

  // Infer category from path or name if not provided
  const inferredCategory = category || inferCategoryFromName(noteName);

  // People: suggest first name and last name
  if (inferredCategory === 'people' && words.length >= 2) {
    const firstName = words[0];
    const lastName = words[words.length - 1];
    if (firstName.length >= 2 && isSafe(firstName)) {
      suggestions.push({ alias: firstName, reason: 'First name for quick reference' });
    }
    if (lastName.length >= 2 && lastName !== firstName && isSafe(lastName)) {
      suggestions.push({ alias: lastName, reason: 'Last name for quick reference' });
    }
  }

  // Acronym for 3+ word names
  if (words.length >= 3) {
    const acronym = words
      .map(w => w[0])
      .join('')
      .toUpperCase();
    if (acronym.length >= 3 && isSafe(acronym)) {
      suggestions.push({ alias: acronym, reason: `Acronym for "${noteName}"` });
    }
  }

  // Unhyphenated form for hyphenated names
  if (noteName.includes('-')) {
    const unhyphenated = noteName.replace(/-/g, '');
    if (unhyphenated !== noteName && isSafe(unhyphenated)) {
      suggestions.push({ alias: unhyphenated, reason: 'Unhyphenated form' });
    }
    // Also try space-separated form
    const spaced = noteName.replace(/-/g, ' ');
    if (spaced !== noteName && isSafe(spaced)) {
      suggestions.push({ alias: spaced, reason: 'Space-separated form' });
    }
  }

  return suggestions;
}

/**
 * Infer entity category from note name heuristics
 */
function inferCategoryFromName(name: string): string | undefined {
  const words = name.split(/\s+/);

  // People: Two capitalized words (First Last pattern)
  if (words.length === 2 || words.length === 3) {
    const allCapitalized = words.every(w => /^[A-Z][a-z]/.test(w));
    if (allCapitalized) return 'people';
  }

  return undefined;
}

/**
 * Check for similar or duplicate entities before creating a note
 *
 * Checks:
 * 1. Exact name match: Does an entity with this name already exist?
 * 2. FTS5 search: Find entities with similar names
 * 3. Semantic similarity: Find conceptually similar entities via embeddings
 *
 * @param noteName - Name of the note to check
 * @returns Preflight result with existing/similar entities
 */
export async function checkPreflightSimilarity(noteName: string): Promise<PreflightResult> {
  const result: PreflightResult = { similarEntities: [] };

  const stateDb = getWriteStateDb();
  if (!stateDb) return result;

  // 1. Exact name match
  const exact = getEntityByName(stateDb, noteName);
  if (exact) {
    result.existingEntity = {
      name: exact.name,
      path: exact.path,
      category: exact.category,
    };
  }

  // 2. FTS5 search for similar entities
  const ftsNames = new Set<string>();
  try {
    const searchResults = searchEntitiesDb(stateDb, noteName, 5);
    for (const sr of searchResults) {
      // Skip exact match (already reported above)
      if (sr.name.toLowerCase() === noteName.toLowerCase()) continue;
      ftsNames.add(sr.name.toLowerCase());
      result.similarEntities.push({
        name: sr.name,
        path: sr.path,
        category: sr.category,
        rank: sr.rank,
      });
    }
  } catch {
    // FTS5 query may fail on special characters - that's fine
  }

  // 3. Semantic similarity check via entity embeddings
  try {
    if (hasEntityEmbeddingsIndex()) {
      const titleEmbedding = await embedTextCached(noteName);
      const semanticMatches = findSemanticallySimilarEntities(titleEmbedding, 5);

      for (const match of semanticMatches) {
        // Only surface high-confidence semantic duplicates
        if (match.similarity < 0.85) continue;
        // Skip if already found by exact match or FTS5
        if (match.entityName.toLowerCase() === noteName.toLowerCase()) continue;
        if (ftsNames.has(match.entityName.toLowerCase())) continue;

        // Look up entity details from StateDb
        const entity = getEntityByName(stateDb, match.entityName);
        if (entity) {
          result.similarEntities.push({
            name: entity.name,
            path: entity.path,
            category: entity.category,
            rank: match.similarity,
          });
        }
      }
    }
  } catch {
    // Semantic check failure never blocks note creation
  }

  return result;
}
