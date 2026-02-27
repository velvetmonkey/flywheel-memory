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
import type { StateDb } from '@velvetmonkey/vault-core';

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
   * Document frequency: how many notes each entity appears in.
   * Used for PMI/IDF scoring.
   */
  documentFrequency: Map<string, number>;

  /**
   * Total notes scanned (denominator for PMI/IDF).
   */
  totalNotesScanned: number;

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
  const documentFrequency = new Map<string, number>();
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

      // Track document frequency for each entity found in this note
      for (const entity of mentionedEntities) {
        documentFrequency.set(entity, (documentFrequency.get(entity) || 0) + 1);
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
    documentFrequency,
    totalNotesScanned: notesScanned,
    _metadata: {
      generated_at: new Date().toISOString(),
      total_associations: totalAssociations,
      notes_scanned: notesScanned,
    },
  };
}

/**
 * Maximum co-occurrence boost (PMI-scaled).
 * NPMI ranges [0,1] for positive associations; scale to ~12 max points.
 */
const MAX_COOCCURRENCE_BOOST = 12;

/**
 * Scale factor for converting NPMI [0,1] to score points.
 */
const PMI_SCALE = 12;

/**
 * Compute Normalized Pointwise Mutual Information (NPMI) between two entities.
 *
 * NPMI = PMI / -log(P(x,y))
 * PMI  = log(P(x,y) / (P(x) * P(y)))
 *
 * NPMI ∈ [-1, 1]:
 *   +1 = perfect co-occurrence (always together)
 *    0 = independent (co-occur by chance)
 *   -1 = never co-occur
 *
 * This naturally penalizes popular entities: React appears in many notes
 * so P(React) is high, making PMI low even with high co-occurrence counts.
 *
 * @returns NPMI value, clamped to [0, 1] (we only care about positive association)
 */
export function computeNpmi(
  coocCount: number,
  dfEntity: number,
  dfSeed: number,
  totalNotes: number,
): number {
  if (coocCount === 0 || dfEntity === 0 || dfSeed === 0 || totalNotes === 0) return 0;

  const pxy = coocCount / totalNotes;
  const px = dfEntity / totalNotes;
  const py = dfSeed / totalNotes;

  const pmi = Math.log(pxy / (px * py));
  const negLogPxy = -Math.log(pxy);

  // Avoid division by zero when pxy = 1 (all notes have both)
  if (negLogPxy === 0) return 1;

  const npmi = pmi / negLogPxy;

  // Clamp to [0, 1] — we only boost positive associations
  return Math.max(0, Math.min(1, npmi));
}

/**
 * Get co-occurrence score boost for an entity based on matched entities.
 *
 * Uses NPMI (Normalized Pointwise Mutual Information) instead of flat counting.
 * NPMI naturally penalizes ubiquitous entities — if React appears in 80% of notes,
 * co-occurring with it provides little information. If Bella appears in 5% of notes,
 * co-occurring with it is highly informative.
 *
 * Takes the best (highest NPMI) association across all matched entities,
 * scaled to score points via PMI_SCALE.
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

  const { associations, minCount, documentFrequency, totalNotesScanned } = cooccurrenceIndex;
  const dfEntity = documentFrequency.get(entityName) || 0;
  if (dfEntity === 0 || totalNotesScanned === 0) return 0;

  let bestNpmi = 0;

  // Find the best NPMI across all seed entities
  for (const matched of matchedEntities) {
    const entityAssocs = associations[matched];
    if (!entityAssocs) continue;

    const coocCount = entityAssocs.get(entityName) || 0;
    if (coocCount < minCount) continue;

    const dfSeed = documentFrequency.get(matched) || 0;
    const npmi = computeNpmi(coocCount, dfEntity, dfSeed, totalNotesScanned);
    bestNpmi = Math.max(bestNpmi, npmi);
  }

  if (bestNpmi === 0) return 0;

  let boost = bestNpmi * PMI_SCALE;

  // Apply recency multiplier if recencyIndex is available
  // Recent entities get 1.5x boost, stale entities get 0.5x
  if (recencyIndex) {
    const recencyBoostVal = getRecencyBoost(entityName, recencyIndex);
    const recencyMultiplier = recencyBoostVal > 0 ? 1.5 : 0.5;
    boost = boost * recencyMultiplier;
  }

  // Cap and round
  return Math.min(Math.round(boost), MAX_COOCCURRENCE_BOOST);
}

/**
 * Compute normalized IDF for a token.
 *
 * IDF(t) = log(N / df(t)), normalized to [0, ~2] range.
 * Uses add-1 smoothing to avoid division by zero and log(0).
 * Returns 1.0 when document frequency data is unavailable.
 *
 * @param token - Lowercased token to look up
 * @param coocIndex - Co-occurrence index with document frequency data
 * @returns Normalized IDF weight (higher = more informative)
 */
export function tokenIdf(
  token: string,
  coocIndex: CooccurrenceIndex | null,
): number {
  if (!coocIndex || coocIndex.totalNotesScanned === 0) return 1.0;

  // Look up document frequency — entity names in the DF map may not match
  // individual tokens, so we use a baseline IDF of 1.0 for unknown tokens
  const df = coocIndex.documentFrequency.get(token);
  if (df === undefined) return 1.0;

  const N = coocIndex.totalNotesScanned;
  // IDF with add-1 smoothing, capped at [0.5, 2.5]
  const rawIdf = Math.log((N + 1) / (df + 1));
  return Math.max(0.5, Math.min(2.5, rawIdf));
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
    documentFrequency: Object.fromEntries(index.documentFrequency),
    totalNotesScanned: index.totalNotesScanned,
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

    // Deserialize document frequency (may be absent in old indexes)
    const dfData = data.documentFrequency as Record<string, number> | undefined;
    const documentFrequency = dfData
      ? new Map(Object.entries(dfData).map(([k, v]) => [k, v]))
      : new Map<string, number>();
    const totalNotesScanned = (data.totalNotesScanned as number) || 0;

    return {
      associations,
      minCount: (data.minCount as number) || DEFAULT_MIN_COOCCURRENCE,
      documentFrequency,
      totalNotesScanned,
      _metadata: data._metadata as CooccurrenceIndex['_metadata'],
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Persistence (StateDb)
// =============================================================================

/** Max staleness for cached co-occurrence data (1 hour) */
const COOCCURRENCE_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Save co-occurrence index to StateDb for fast startup.
 */
export function saveCooccurrenceToStateDb(
  stateDb: StateDb,
  index: CooccurrenceIndex,
): void {
  const serialized = serializeCooccurrenceIndex(index);
  const data = JSON.stringify(serialized);
  const entityCount = Object.keys(index.associations).length;
  const associationCount = index._metadata.total_associations;

  stateDb.db.prepare(`
    INSERT OR REPLACE INTO cooccurrence_cache (id, data, built_at, entity_count, association_count)
    VALUES (1, ?, ?, ?, ?)
  `).run(data, Date.now(), entityCount, associationCount);
}

/**
 * Load co-occurrence index from StateDb cache.
 * Returns null if cache is empty or stale (>1h).
 */
export function loadCooccurrenceFromStateDb(
  stateDb: StateDb,
): { index: CooccurrenceIndex; builtAt: number } | null {
  const row = stateDb.db.prepare(
    'SELECT data, built_at FROM cooccurrence_cache WHERE id = 1'
  ).get() as { data: string; built_at: number } | undefined;

  if (!row) return null;

  const ageMs = Date.now() - row.built_at;
  if (ageMs > COOCCURRENCE_CACHE_MAX_AGE_MS) return null;

  try {
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const index = deserializeCooccurrenceIndex(parsed);
    if (!index) return null;
    return { index, builtAt: row.built_at };
  } catch {
    return null;
  }
}
