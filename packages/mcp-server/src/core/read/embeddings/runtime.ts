/**
 * Embeddings runtime — shared state + model configuration (arch-review S8).
 *
 * Module-level fallback state, ALS-scope resolution helpers, the model
 * registry, the build-state machine, version persistence, and index state
 * queries shared by the embeddings package modules. Extracted verbatim from
 * core/read/embeddings.ts; the facade there re-exports the public surface.
 */

import type { InferredCategory } from '../types.js';
import type Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { getActiveScopeOrNull } from '../../../vault-scope.js';

// =============================================================================
// Shared Row Types
// =============================================================================

export interface EmbeddingRow {
  path: string;
  embedding: Buffer;
  content_hash: string;
  model: string;
  updated_at: number;
}

// =============================================================================
// Model Configuration
// =============================================================================

interface ModelConfig {
  id: string;
  dims: number;
}

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'Xenova/all-MiniLM-L6-v2':      { id: 'Xenova/all-MiniLM-L6-v2',      dims: 384 },
  'Xenova/bge-small-en-v1.5':     { id: 'Xenova/bge-small-en-v1.5',     dims: 384 },
  'Xenova/all-MiniLM-L12-v2':     { id: 'Xenova/all-MiniLM-L12-v2',     dims: 384 },
  'nomic-ai/nomic-embed-text-v1': { id: 'nomic-ai/nomic-embed-text-v1', dims: 768 },
};

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

function getModelConfig(): ModelConfig {
  const envModel = process.env.EMBEDDING_MODEL?.trim();
  if (!envModel) return MODEL_REGISTRY[DEFAULT_MODEL];
  if (MODEL_REGISTRY[envModel]) return MODEL_REGISTRY[envModel];
  // Unknown model — dims will be probed from first embedding output
  return { id: envModel, dims: 0 };
}

/** Internal-shared: active model config (dims may be probed/mutated on init). */
export const activeModelConfig = getModelConfig();

/** Get the active embedding model ID. */
export function getActiveModelId(): string {
  return activeModelConfig.id;
}

// =============================================================================
// Module State
// =============================================================================

let db: Database.Database | null = null;
let embeddingsBuilding = false;

/** In-memory entity embeddings for fast cosine search */
const entityEmbeddingsMap = new Map<string, Float32Array>();
let inferredCategoriesMap = new Map<string, InferredCategory>();

/** Resolve DB handle: ALS scope first, fallback to module-level. */
export function getDb(): Database.Database | null {
  return getActiveScopeOrNull()?.stateDb?.db ?? db;
}

/** Resolve entity embeddings map: ALS scope first, fallback to module-level. */
export function getEmbMap(): Map<string, Float32Array> {
  return getActiveScopeOrNull()?.entityEmbeddingsMap ?? entityEmbeddingsMap;
}

/** Resolve inferred categories map: ALS scope first, fallback to module-level. */
export function getInferredMap(): Map<string, InferredCategory> {
  return getActiveScopeOrNull()?.inferredCategoriesMap ?? inferredCategoriesMap;
}

export function setInferredMap(map: Map<string, InferredCategory>): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.inferredCategoriesMap = map;
  } else {
    inferredCategoriesMap = map;
  }
}

// =============================================================================
// Build State Tracking
// =============================================================================

export function getEmbeddingsBuildState(): string {
  const db = getDb();
  if (!db) return 'none';
  const row = db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embeddings_state'`).get() as { value: string } | undefined;
  return row?.value || 'none';
}

export function setEmbeddingsBuildState(state: 'none' | 'building_notes' | 'building_entities' | 'complete'): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`INSERT OR REPLACE INTO fts_metadata (key, value) VALUES ('embeddings_state', ?)`)
    .run(state);
}

// =============================================================================
// Version Persistence
// =============================================================================

/** Read persisted EMBEDDING_TEXT_VERSION from fts_metadata. Returns null if not stored. */
export function getStoredTextVersion(): number | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare(`SELECT value FROM fts_metadata WHERE key = 'embedding_text_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

export function setStoredTextVersion(version: number): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`INSERT OR REPLACE INTO fts_metadata (key, value) VALUES ('embedding_text_version', ?)`)
    .run(String(version));
}

// =============================================================================
// Bulk Operations
// =============================================================================

/** Clear all embeddings and reset build state. Use for model changes or force rebuild. */
export function clearEmbeddingsForRebuild(): void {
  const db = getDb();
  if (!db) return;
  db.exec('DELETE FROM note_embeddings');
  db.exec('DELETE FROM entity_embeddings');
  setEmbeddingsBuildState('none');
}

// =============================================================================
// Database Injection
// =============================================================================

/**
 * Set the embeddings database handle (injected from StateDb).
 * The note_embeddings table must already exist.
 */
export function setEmbeddingsDatabase(database: Database.Database): void {
  db = database;
}

// =============================================================================
// Content Hashing
// =============================================================================

/**
 * Bump this when the embedding text format changes to force a one-time re-embed.
 * The version is mixed into the content hash so existing embeddings with the old
 * format get a different hash and are re-computed on the next index build.
 */
export const EMBEDDING_TEXT_VERSION = 2;

export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content + EMBEDDING_TEXT_VERSION).digest('hex').slice(0, 16);
}

// =============================================================================
// State Queries
// =============================================================================

/**
 * Check if the embeddings index has been built.
 */
export function isEmbeddingsBuilding(): boolean {
  const scope = getActiveScopeOrNull();
  return scope ? scope.embeddingsBuilding : embeddingsBuilding;
}

export function setEmbeddingsBuilding(value: boolean): void {
  const scope = getActiveScopeOrNull();
  if (scope) {
    scope.embeddingsBuilding = value;
  } else {
    embeddingsBuilding = value;
  }
}

/**
 * Check if the embeddings index has been built and is usable.
 *
 * Side effect: if embeddings_state is stuck at building_* from a
 * crashed/interrupted build (no active build in this process), this
 * function repairs it — to 'complete' if rows exist, or 'none' if
 * no rows remain. This prevents a single crash from permanently
 * disabling semantic features.
 */
export function hasEmbeddingsIndex(): boolean {
  const db = getDb();
  if (!db) return false;
  try {
    const state = getEmbeddingsBuildState();
    if (state === 'complete') return true;
    // Backward compat: if no state recorded but embeddings exist, consider it built
    if (state === 'none') {
      const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
      return row.count > 0;
    }
    // State is building_notes or building_entities — stale from crash?
    if (!isEmbeddingsBuilding()) {
      const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
      if (row.count > 0) {
        setEmbeddingsBuildState('complete');
        console.error('[Semantic] Recovered stale embeddings_state → complete');
        return true;
      } else {
        setEmbeddingsBuildState('none');
        console.error('[Semantic] Recovered stale embeddings_state → none (no rows)');
        return false;
      }
    }
    return false; // Active build in progress
  } catch {
    return false;
  }
}

/**
 * Get the model ID stored in existing embeddings (first row of note_embeddings).
 * Returns null if no embeddings exist.
 */
export function getStoredEmbeddingModel(): string | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT model FROM note_embeddings LIMIT 1').get() as { model: string } | undefined;
    return row?.model ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the number of embedded notes.
 */
export function getEmbeddingsCount(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}
