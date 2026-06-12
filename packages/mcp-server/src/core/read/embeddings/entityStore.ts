/**
 * Entity embedding store — entity index build/update, orphan cleanup,
 * in-memory entity vector access, inferred-category persistence, and
 * centroid classification (arch-review S8).
 * Extracted verbatim from core/read/embeddings.ts.
 */

import type { InferredCategory } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import type { EntityWithType } from '@velvetmonkey/vault-core';
import {
  activeModelConfig,
  contentHash,
  getDb,
  getEmbMap,
  getInferredMap,
  setInferredMap,
  setEmbeddingsBuildState,
} from './runtime.js';
import { initEmbeddings, embedTextCached } from './provider.js';
import { cosineSimilarity, type EntitySimilarityResult } from './search.js';

// =============================================================================
// Types
// =============================================================================

interface EntityEmbeddingRow {
  entity_name: string;
  embedding: Buffer;
  source_hash: string;
  model: string;
  updated_at: number;
}

interface EntityInfo {
  name: string;
  path: string;
  category: string;
  aliases: string[];
}

// =============================================================================
// Entity Embeddings
// =============================================================================

/**
 * Build embedding text for an entity.
 * Format: entityName entityName aliases category first500CharsOfNoteBody
 */
function buildEntityEmbeddingText(entity: EntityInfo, vaultPath: string): string {
  const parts: string[] = [entity.name, entity.name];

  if (entity.aliases.length > 0) {
    parts.push(entity.aliases.join(' '));
  }

  parts.push(entity.category);

  // Read first 500 chars of the entity's backing note
  if (entity.path) {
    try {
      const absPath = path.join(vaultPath, entity.path);
      const content = fs.readFileSync(absPath, 'utf-8');
      parts.push(content.slice(0, 500));
    } catch {
      // Note might not exist
    }
  }

  return parts.join(' ');
}

/**
 * Batch-build all entity embeddings.
 * Skips entities whose source_hash hasn't changed.
 *
 * @returns Count of updated embeddings
 */
export async function buildEntityEmbeddingsIndex(
  vaultPath: string,
  entities: Map<string, EntityInfo>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDb();
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

  await initEmbeddings();
  setEmbeddingsBuildState('building_entities');

  // Load existing hashes for change detection
  const existingHashes = new Map<string, string>();
  const rows = db.prepare('SELECT entity_name, source_hash FROM entity_embeddings').all() as Array<{ entity_name: string; source_hash: string }>;
  for (const row of rows) {
    existingHashes.set(row.entity_name, row.source_hash);
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO entity_embeddings (entity_name, embedding, source_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const total = entities.size;
  let done = 0;
  let updated = 0;
  let skipped = 0;

  for (const [name, entity] of entities) {
    done++;

    try {
      const text = buildEntityEmbeddingText(entity, vaultPath);
      const hash = contentHash(text);

      // Skip if unchanged
      if (existingHashes.get(name) === hash) {
        if (onProgress) onProgress(done, total);
        continue;
      }

      const embedding = await embedTextCached(text);
      const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      upsert.run(name, buf, hash, activeModelConfig.id, Date.now());
      updated++;
    } catch (err) {
      skipped++;
      if (skipped <= 3) {
        console.error(`[Semantic] Failed to embed entity ${name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (onProgress) onProgress(done, total);
  }

  // Remove embeddings for deleted entities
  const deleteStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_name = ?');
  for (const existingName of existingHashes.keys()) {
    if (!entities.has(existingName)) {
      deleteStmt.run(existingName);
    }
  }

  console.error(`[Semantic] Entity embeddings: ${updated} updated, ${total - updated - skipped} unchanged, ${skipped} failed`);
  return updated;
}

/**
 * Update embedding for a single entity.
 */
export async function updateEntityEmbedding(
  entityName: string,
  entity: EntityInfo,
  vaultPath: string
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const text = buildEntityEmbeddingText(entity, vaultPath);
    const hash = contentHash(text);

    // Check if unchanged
    const existing = db.prepare('SELECT source_hash FROM entity_embeddings WHERE entity_name = ?').get(entityName) as { source_hash: string } | undefined;
    if (existing?.source_hash === hash) return;

    const embedding = await embedTextCached(text);
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT OR REPLACE INTO entity_embeddings (entity_name, embedding, source_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(entityName, buf, hash, activeModelConfig.id, Date.now());

    // Update in-memory map
    getEmbMap().set(entityName, embedding);
  } catch (err) {
    console.error(`[Semantic] Failed to update entity embedding ${entityName}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Remove entity embeddings for entities no longer in the provided set.
 * Also cleans up the in-memory entity embeddings map.
 */
export function removeOrphanedEntityEmbeddings(currentEntityNames: Set<string>): number {
  const db = getDb();
  if (!db) return 0;

  const rows = db.prepare('SELECT entity_name FROM entity_embeddings').all() as Array<{ entity_name: string }>;
  const deleteStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_name = ?');
  const embMap = getEmbMap();
  let removed = 0;

  for (const row of rows) {
    if (!currentEntityNames.has(row.entity_name)) {
      deleteStmt.run(row.entity_name);
      embMap.delete(row.entity_name);
      removed++;
    }
  }
  return removed;
}

/**
 * Find entities semantically similar to a query embedding.
 * Uses pre-loaded in-memory entity embeddings for fast (<1ms) cosine search.
 */
export function findSemanticallySimilarEntities(
  queryEmbedding: Float32Array,
  limit: number,
  excludeEntities?: Set<string>
): EntitySimilarityResult[] {
  const scored: EntitySimilarityResult[] = [];

  for (const [entityName, embedding] of getEmbMap()) {
    if (excludeEntities?.has(entityName)) continue;

    const similarity = cosineSimilarity(queryEmbedding, embedding);
    scored.push({ entityName, similarity: Math.round(similarity * 1000) / 1000 });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * Check if entity embeddings are loaded in memory.
 */
export function hasEntityEmbeddingsIndex(): boolean {
  return getEmbMap().size > 0;
}

/** Get the current in-memory entity embeddings map (for VaultScope). */
export function getEntityEmbeddingsMap(): Map<string, Float32Array> {
  return getEmbMap();
}

export function getInferredCategory(entityName: string): InferredCategory | undefined {
  return getInferredMap().get(entityName);
}

function ensureInferredCategoriesTable(): void {
  const db = getDb();
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS inferred_categories (
      entity_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'centroid',
      updated_at INTEGER NOT NULL
    )
  `);
}

export function loadInferredCategories(): Map<string, InferredCategory> {
  const db = getDb();
  const categories = new Map<string, InferredCategory>();
  setInferredMap(categories);
  if (!db) return categories;

  try {
    ensureInferredCategoriesTable();
    const rows = db.prepare(`
      SELECT entity_name, category, confidence
      FROM inferred_categories
      WHERE source = 'centroid'
    `).all() as Array<{ entity_name: string; category: string; confidence: number }>;

    for (const row of rows) {
      categories.set(row.entity_name, {
        entityName: row.entity_name,
        category: row.category,
        confidence: row.confidence,
      });
    }
  } catch {
    setInferredMap(new Map());
  }

  return getInferredMap();
}

export function saveInferredCategories(categories: Map<string, InferredCategory>): void {
  const db = getDb();
  setInferredMap(new Map(categories));
  if (!db) return;

  ensureInferredCategoriesTable();
  const now = Date.now();
  const clearStmt = db.prepare(`DELETE FROM inferred_categories WHERE source = 'centroid'`);
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO inferred_categories
      (entity_name, category, confidence, source, updated_at)
    VALUES (?, ?, ?, 'centroid', ?)
  `);

  const txn = db.transaction(() => {
    clearStmt.run();
    for (const inferred of categories.values()) {
      insertStmt.run(
        inferred.entityName,
        inferred.category,
        inferred.confidence,
        now,
      );
    }
  });
  txn();
}

function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < vector.length; i++) {
    magnitude += vector[i] * vector[i];
  }

  if (magnitude === 0) return vector;

  const normalized = new Float32Array(vector.length);
  const scale = 1 / Math.sqrt(magnitude);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] * scale;
  }
  return normalized;
}

export function classifyUncategorizedEntities(
  entitiesWithTypes: EntityWithType[],
  threshold = 0.45,
): Map<string, InferredCategory> {
  const embeddings = getEmbMap();
  const categoryEmbeddings = new Map<string, Float32Array[]>();

  for (const { entity, category } of entitiesWithTypes) {
    if (category === 'other') continue;
    const embedding = embeddings.get(entity.name);
    if (!embedding) continue;

    const existing = categoryEmbeddings.get(category) ?? [];
    existing.push(embedding);
    categoryEmbeddings.set(category, existing);
  }

  const centroids = new Map<string, Float32Array>();
  for (const [category, vectors] of categoryEmbeddings.entries()) {
    if (vectors.length < 3) continue;

    const centroid = new Float32Array(vectors[0].length);
    for (const vector of vectors) {
      for (let i = 0; i < vector.length; i++) {
        centroid[i] += vector[i];
      }
    }
    for (let i = 0; i < centroid.length; i++) {
      centroid[i] /= vectors.length;
    }
    centroids.set(category, normalizeVector(centroid));
  }

  const inferred = new Map<string, InferredCategory>();
  if (centroids.size === 0) {
    setInferredMap(inferred);
    return inferred;
  }

  for (const { entity, category } of entitiesWithTypes) {
    if (category !== 'other') continue;
    const embedding = embeddings.get(entity.name);
    if (!embedding) continue;

    let bestCategory: string | null = null;
    let bestSimilarity = -1;

    for (const [candidateCategory, centroid] of centroids.entries()) {
      const similarity = cosineSimilarity(embedding, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCategory = candidateCategory;
      }
    }

    if (bestCategory && bestSimilarity >= threshold) {
      inferred.set(entity.name, {
        entityName: entity.name,
        category: bestCategory,
        confidence: Math.round(bestSimilarity * 1000) / 1000,
      });
    }
  }

  setInferredMap(inferred);
  return inferred;
}

/**
 * Load all entity embeddings from DB into memory for fast cosine search.
 */
export function loadEntityEmbeddingsToMemory(): void {
  const db = getDb();
  if (!db) return;

  try {
    const targetMap = getEmbMap();
    const rows = db.prepare('SELECT entity_name, embedding FROM entity_embeddings').all() as EntityEmbeddingRow[];
    targetMap.clear();

    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      targetMap.set(row.entity_name, embedding);
    }

    if (rows.length > 0) {
      console.error(`[Semantic] Loaded ${rows.length} entity embeddings into memory`);
    }
  } catch {
    // Table might not exist yet
  }

  loadInferredCategories();
}

/**
 * Get a preloaded entity embedding from the in-memory map (for MMR diversity).
 * Returns null if not loaded.
 */
export function getEntityEmbedding(entityName: string): Float32Array | null {
  return getEmbMap().get(entityName) ?? null;
}

/**
 * Get the number of entity embeddings in the database.
 */
export function getEntityEmbeddingsCount(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM entity_embeddings').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}
