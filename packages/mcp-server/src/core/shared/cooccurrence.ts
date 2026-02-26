/**
 * Co-occurrence Mining for Entity Association
 *
 * Mines entity co-occurrences from vault notes to build an association map.
 * Entities that frequently appear together in notes are considered related.
 *
 * This enables conceptual suggestions:
 * - Content mentions "AI" → boost "Consciousness" (often appear together)
 * - Content mentions "Flywheel" → boost "MCP" (project-related)
 */

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { tokenize } from './stemmer.js';
import { getRecencyBoost, type RecencyIndex } from './recency.js';

/**
 * Entity associations - maps entity to related entities with co-occurrence counts
 */
export interface EntityAssociations {
  [entityName: string]: Map<string, number>;
}

/**
 * Co-occurrence index for efficient lookups
 */
export interface CooccurrenceIndex {
  /**
   * Maps entity name to its associations
   * associations[entity] = Map<relatedEntity, count>
   */
  associations: EntityAssociations;

  /**
   * Minimum co-occurrence count for boosting
   */
  minCount: number;

  /**
   * Metadata
   */
  _metadata: {
    generated_at: string;
    total_associations: number;
    notes_scanned: number;
  };
}

/**
 * Default minimum co-occurrence score for an association to be considered.
 * With Adamic-Adar weighting, typical values:
 *   - 2 co-occurrences in 4-entity notes: 2 * 1/log2(4) = 1.0
 *   - 3 co-occurrences in 8-entity notes: 3 * 1/log2(8) = 1.0
 *   - 2 co-occurrences in 3-entity notes: 2 * 1/log2(3) = 1.26
 */
const DEFAULT_MIN_COOCCURRENCE = 0.5;

/**
 * Folders to exclude from co-occurrence mining (templates, etc.)
 */
const EXCLUDED_FOLDERS = new Set([
  'templates',
  '.obsidian',
  '.claude',
  '.git',
]);

/**
 * Check if a note contains an entity (case-insensitive word boundary match)
 */
function noteContainsEntity(content: string, entityName: string): boolean {
  // Tokenize entity name
  const entityTokens = tokenize(entityName);
  if (entityTokens.length === 0) return false;

  // Tokenize content
  const contentTokens = new Set(tokenize(content));

  // Check if all entity tokens appear in content
  // For multi-word entities, require all words to be present
  let matchCount = 0;
  for (const token of entityTokens) {
    if (contentTokens.has(token)) {
      matchCount++;
    }
  }

  // Require at least 50% of words to match for multi-word entities
  // or exact match for single-word entities
  if (entityTokens.length === 1) {
    return matchCount === 1;
  }
  return matchCount / entityTokens.length >= 0.5;
}

/**
 * Increment co-occurrence score between two entities.
 * Uses Adamic-Adar weighting: contribution = 1 / log(degree)
 * where degree = number of entities in the note.
 *
 * Notes with few entity mentions provide strong co-occurrence evidence.
 * Daily notes with 50+ mentions provide weak evidence.
 */
function incrementCooccurrence(
  associations: EntityAssociations,
  entityA: string,
  entityB: string,
  weight: number = 1.0,
): void {
  // Initialize map for entityA if needed
  if (!associations[entityA]) {
    associations[entityA] = new Map();
  }

  // Increment by Adamic-Adar weight
  const current = associations[entityA].get(entityB) || 0;
  associations[entityA].set(entityB, current + weight);
}

/**
 * Recursively scan directory for markdown files
 */
async function* walkMarkdownFiles(
  dir: string,
  baseDir: string
): AsyncGenerator<{ path: string; relativePath: string }> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip excluded folders
      const topFolder = relativePath.split(path.sep)[0];
      if (EXCLUDED_FOLDERS.has(topFolder)) {
        continue;
      }

      if (entry.isDirectory()) {
        yield* walkMarkdownFiles(fullPath, baseDir);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        yield { path: fullPath, relativePath };
      }
    }
  } catch {
    // Silently skip directories we can't read
  }
}

/**
 * Mine co-occurrences from vault notes
 *
 * Scans all markdown files in the vault and tracks which entities
 * appear together in the same note.
 *
 * @param vaultPath - Path to the vault
 * @param entities - List of entity names to track
 * @param options - Mining options
 * @returns Co-occurrence index
 */
export async function mineCooccurrences(
  vaultPath: string,
  entities: string[],
  options: { minCount?: number } = {}
): Promise<CooccurrenceIndex> {
  const { minCount = DEFAULT_MIN_COOCCURRENCE } = options;
  const associations: EntityAssociations = {};
  let notesScanned = 0;

  // Filter out very long entity names (article titles, etc.)
  const validEntities = entities.filter(e => e.length <= 30);

  // Scan all markdown files
  for await (const file of walkMarkdownFiles(vaultPath, vaultPath)) {
    try {
      const content = await readFile(file.path, 'utf-8');
      notesScanned++;

      // Find all entities mentioned in this note
      const mentionedEntities: string[] = [];
      for (const entity of validEntities) {
        if (noteContainsEntity(content, entity)) {
          mentionedEntities.push(entity);
        }
      }

      // Track co-occurrences between all pairs of entities
      // Adamic-Adar weight: 1/ln(degree), where degree = mentioned entity count.
      // Notes with few mentions → high weight (focused context).
      // Notes with many mentions → low weight (diffuse context like daily notes).
      // Uses natural log per standard Adamic-Adar index formulation.
      const degree = mentionedEntities.length;
      const adamicAdarWeight = degree >= 3 ? 1 / Math.log(degree) : 1.0;

      for (const entityA of mentionedEntities) {
        for (const entityB of mentionedEntities) {
          if (entityA !== entityB) {
            incrementCooccurrence(associations, entityA, entityB, adamicAdarWeight);
          }
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  // Count total associations above threshold
  let totalAssociations = 0;
  for (const entityAssocs of Object.values(associations)) {
    for (const count of entityAssocs.values()) {
      if (count >= minCount) {
        totalAssociations++;
      }
    }
  }

  return {
    associations,
    minCount,
    _metadata: {
      generated_at: new Date().toISOString(),
      total_associations: totalAssociations,
      notes_scanned: notesScanned,
    },
  };
}

/**
 * Maximum co-occurrence boost to prevent high-connectivity entities
 * from dominating suggestions through accumulated relationships.
 * Cap at 6 = 2 relationships max effect (prevents AD/AG/AI problem)
 */
const MAX_COOCCURRENCE_BOOST = 6;

/**
 * Get co-occurrence score boost for an entity based on matched entities
 *
 * If the content matches entityA, and entityB has a co-occurrence with entityA,
 * entityB gets a score boost based on the co-occurrence count.
 *
 * Boost is capped to prevent high-connectivity entities (like Azure services)
 * from dominating suggestions through accumulated co-occurrence relationships.
 *
 * When recencyIndex is provided, applies a multiplier based on entity recency:
 * - Recent entities (recency boost > 0): 1.5x multiplier
 * - Stale entities (no recency boost): 0.5x multiplier
 *
 * @param entityName - Entity to get boost for
 * @param matchedEntities - Entities that directly matched the content
 * @param cooccurrenceIndex - The co-occurrence index
 * @param recencyIndex - Optional recency index for time-weighted boosting
 * @returns Score boost (0-MAX_COOCCURRENCE_BOOST)
 */
export function getCooccurrenceBoost(
  entityName: string,
  matchedEntities: Set<string>,
  cooccurrenceIndex: CooccurrenceIndex | null,
  recencyIndex?: RecencyIndex | null
): number {
  if (!cooccurrenceIndex) return 0;

  let boost = 0;
  const { associations, minCount } = cooccurrenceIndex;

  // Check each matched entity for co-occurrences with this entity
  for (const matched of matchedEntities) {
    const entityAssocs = associations[matched];
    if (entityAssocs) {
      const count = entityAssocs.get(entityName) || 0;
      if (count >= minCount) {
        // Score boost: 3 points per qualifying co-occurrence
        boost += 3;
      }
    }
  }

  // Apply recency multiplier if recencyIndex is available
  // Recent entities get 1.5x boost, stale entities get 0.5x
  if (boost > 0 && recencyIndex) {
    const recencyBoostVal = getRecencyBoost(entityName, recencyIndex);
    const recencyMultiplier = recencyBoostVal > 0 ? 1.5 : 0.5;
    boost = Math.round(boost * recencyMultiplier);
  }

  // Cap to prevent high-connectivity entities from dominating
  return Math.min(boost, MAX_COOCCURRENCE_BOOST);
}

/**
 * Serialize co-occurrence index to JSON-compatible format
 */
export function serializeCooccurrenceIndex(
  index: CooccurrenceIndex
): Record<string, unknown> {
  const serialized: Record<string, Record<string, number>> = {};

  for (const [entity, assocs] of Object.entries(index.associations)) {
    serialized[entity] = Object.fromEntries(assocs);
  }

  return {
    associations: serialized,
    minCount: index.minCount,
    _metadata: index._metadata,
  };
}

/**
 * Deserialize co-occurrence index from JSON
 */
export function deserializeCooccurrenceIndex(
  data: Record<string, unknown>
): CooccurrenceIndex | null {
  try {
    const associations: EntityAssociations = {};
    const assocData = data.associations as Record<string, Record<string, number>>;

    if (!assocData) return null;

    for (const [entity, assocs] of Object.entries(assocData)) {
      associations[entity] = new Map(Object.entries(assocs));
    }

    return {
      associations,
      minCount: (data.minCount as number) || DEFAULT_MIN_COOCCURRENCE,
      _metadata: data._metadata as CooccurrenceIndex['_metadata'],
    };
  } catch {
    return null;
  }
}
