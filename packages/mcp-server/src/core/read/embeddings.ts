/**
 * Semantic Search Embeddings Module
 *
 * Local embedding-based semantic search using @huggingface/transformers.
 * Automatic when embeddings have been built via init_semantic.
 *
 * ## Model Configuration
 *
 * Set `EMBEDDING_MODEL` env var to use a different HuggingFace model:
 *   EMBEDDING_MODEL=Xenova/bge-small-en-v1.5
 *
 * Known models (dimensions auto-detected):
 *   - Xenova/all-MiniLM-L6-v2      (384 dims, default)
 *   - Xenova/bge-small-en-v1.5     (384 dims)
 *   - Xenova/all-MiniLM-L12-v2     (384 dims)
 *   - nomic-ai/nomic-embed-text-v1 (768 dims)
 *
 * Unknown model IDs are accepted — dimensions are probed from the first
 * embedding output. Changing models triggers an automatic rebuild.
 *
 * ## Future: Ollama / LM Studio
 *
 * This module currently uses HuggingFace transformers for local inference.
 * To add Ollama or LM Studio support, implement an EmbeddingProvider interface
 * with `embed(text: string): Promise<Float32Array>` and `dims: number`, then
 * select provider based on a `EMBEDDING_PROVIDER` env var (default: "huggingface").
 *
 * Follows the fts5.ts pattern:
 * - Module-level db handle via setEmbeddingsDatabase()
 * - Lazy initialization: model loads on first semantic search call
 * - Dynamic import of @huggingface/transformers
 */

import type Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import type { EntityWithType } from '@velvetmonkey/vault-core';
import { getActiveScopeOrNull } from '../../vault-scope.js';
import * as path from 'path';
import { scanVault } from './vault.js';
import { SYSTEM_EXCLUDED_DIRS } from '../shared/constants.js';

// =============================================================================
// Types
// =============================================================================

export interface ScoredNote {
  path: string;
  title: string;
  score: number;
}

interface EmbeddingRow {
  path: string;
  embedding: Buffer;
  content_hash: string;
  model: string;
  updated_at: number;
}

interface EntityEmbeddingRow {
  entity_name: string;
  embedding: Buffer;
  source_hash: string;
  model: string;
  updated_at: number;
}

export interface EntitySimilarityResult {
  entityName: string;
  similarity: number;
}

export interface InferredCategory {
  entityName: string;
  category: string;
  confidence: number;
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

const activeModelConfig = getModelConfig();

/** Get the active embedding model ID. */
export function getActiveModelId(): string {
  return activeModelConfig.id;
}

// =============================================================================
// Constants
// =============================================================================


/** Maximum file size to embed (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// =============================================================================
// Module State
// =============================================================================

let db: Database.Database | null = null;
let pipeline: any = null;
let initPromise: Promise<void> | null = null;
let embeddingsBuilding = false;

/** LRU cache for embedText results (max 500 entries) */
const embeddingCache = new Map<string, Float32Array>();
const EMBEDDING_CACHE_MAX = 500;

/** In-memory entity embeddings for fast cosine search */
const entityEmbeddingsMap = new Map<string, Float32Array>();
let inferredCategoriesMap = new Map<string, InferredCategory>();

/** Resolve DB handle: ALS scope first, fallback to module-level. */
function getDb(): Database.Database | null {
  return getActiveScopeOrNull()?.stateDb?.db ?? db;
}

/** Resolve entity embeddings map: ALS scope first, fallback to module-level. */
function getEmbMap(): Map<string, Float32Array> {
  return getActiveScopeOrNull()?.entityEmbeddingsMap ?? entityEmbeddingsMap;
}

// =============================================================================
// Build State Tracking
// =============================================================================

function getEmbeddingsBuildState(): string {
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

function setStoredTextVersion(version: number): void {
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
// Lazy Initialization
// =============================================================================

/**
 * Delete the cached ONNX model files for a given model ID.
 * Handles the @huggingface/transformers cache which lives inside the package directory.
 */
function clearModelCache(modelId: string): void {
  try {
    // @huggingface/transformers caches inside its package dir:
    //   node_modules/@huggingface/transformers/.cache/<org>/<model>/
    // Walk up from this file to find node_modules, or resolve from require
    const candidates: string[] = [];

    // Try require.resolve (works in esbuild bundle)
    try {
      const transformersDir = path.dirname(require.resolve('@huggingface/transformers/package.json'));
      candidates.push(path.join(transformersDir, '.cache', ...modelId.split('/')));
    } catch { /* not resolvable */ }

    // Also check common npx cache locations
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      // npx caches under ~/.npm/_npx/*/node_modules/
      const npxDir = path.join(home, '.npm', '_npx');
      if (fs.existsSync(npxDir)) {
        for (const hash of fs.readdirSync(npxDir)) {
          const candidate = path.join(npxDir, hash, 'node_modules', '@huggingface', 'transformers', '.cache', ...modelId.split('/'));
          if (fs.existsSync(candidate)) candidates.push(candidate);
        }
      }
    }

    for (const cacheDir of candidates) {
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        console.error(`[Semantic] Deleted corrupted model cache: ${cacheDir}`);
      }
    }
  } catch (e) {
    console.error(`[Semantic] Could not clear model cache: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Load the transformer model. Cached after first call.
 * Downloads ~23MB model on first use to ~/.cache/huggingface/
 * Retries up to 3 times on network/download failures.
 */
export async function initEmbeddings(): Promise<void> {
  if (pipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 5000, 10000]; // 2s, 5s, 10s
    let cacheCleared = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Dynamic import — @huggingface/transformers is an optional dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const transformers: any = await (Function('specifier', 'return import(specifier)')('@huggingface/transformers'));

        console.error(`[Semantic] Loading model ${activeModelConfig.id} (~23MB, cached after first download)...`);
        pipeline = await transformers.pipeline('feature-extraction', activeModelConfig.id, {
          dtype: 'fp32',
        });
        console.error(`[Semantic] Model loaded successfully`);

        // Probe dimensions for unknown models
        if (activeModelConfig.dims === 0) {
          const probe = await pipeline('test', { pooling: 'mean', normalize: true });
          activeModelConfig.dims = probe.data.length;
          console.error(`[Semantic] Probed model ${activeModelConfig.id}: ${activeModelConfig.dims} dims`);
        }
        return; // Success — exit retry loop
      } catch (err: unknown) {
        // Missing dependency — no point retrying
        if (err instanceof Error && (
          err.message.includes('Cannot find package') ||
          err.message.includes('MODULE_NOT_FOUND') ||
          err.message.includes("Cannot find module") ||
          err.message.includes('ERR_MODULE_NOT_FOUND')
        )) {
          initPromise = null;
          throw new Error(
            'Semantic search requires @huggingface/transformers. ' +
            'Install it with: npm install @huggingface/transformers'
          );
        }

        // Corrupted model cache — delete and retry once
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!cacheCleared && (errMsg.includes('Protobuf parsing failed') || errMsg.includes('onnx'))) {
          console.error(`[Semantic] Corrupted model cache detected: ${errMsg}`);
          clearModelCache(activeModelConfig.id);
          cacheCleared = true;
          pipeline = null;
          continue;
        }

        // Retryable failure (network, download)
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt - 1];
          console.error(`[Semantic] Model load failed (attempt ${attempt}/${MAX_RETRIES}): ${errMsg}`);
          console.error(`[Semantic] Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          pipeline = null; // Reset for retry
        } else {
          console.error(`[Semantic] Model load failed after ${MAX_RETRIES} attempts: ${err instanceof Error ? err.message : err}`);
          console.error(`[Semantic] Semantic search disabled. Keyword search (BM25) remains available.`);
          initPromise = null;
          throw err;
        }
      }
    }
  })();

  return initPromise;
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embedding for a text string.
 * Returns Float32Array of EMBEDDING_DIMS dimensions.
 */
export async function embedText(text: string): Promise<Float32Array> {
  await initEmbeddings();

  // Truncate to ~512 tokens worth of text (~2000 chars is a safe approximation)
  const truncated = text.slice(0, 2000);

  const result = await pipeline(truncated, { pooling: 'mean', normalize: true });

  // result.data is a Float32Array
  return new Float32Array(result.data);
}

/**
 * LRU-cached wrapper around embedText().
 * Avoids re-computing embeddings for repeated text inputs.
 */
export async function embedTextCached(text: string): Promise<Float32Array> {
  const existing = embeddingCache.get(text);
  if (existing) return existing;

  const embedding = await embedText(text);

  // Evict oldest entry if at capacity
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey !== undefined) embeddingCache.delete(firstKey);
  }

  embeddingCache.set(text, embedding);
  return embedding;
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

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content + EMBEDDING_TEXT_VERSION).digest('hex').slice(0, 16);
}

// =============================================================================
// Contextual Embedding Prefix
// =============================================================================

/**
 * Build the text that gets embedded for a note. Prepends document-level context
 * (title + tags) so the embedding carries the note's identity — matching the
 * "contextual retrieval" technique (Anthropic, 2024).
 *
 * Before: raw markdown (starting with frontmatter YAML syntax)
 * After:  "Note: Emma. Tags: person, team-lead.\n\n{body without frontmatter}"
 */
export function buildNoteEmbeddingText(content: string, filePath: string): string {
  const title = filePath.replace(/\.md$/, '').split('/').pop() || '';

  // Strip frontmatter
  const fmMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  const body = fmMatch ? fmMatch[1] : content;
  const frontmatter = fmMatch ? content.slice(0, content.indexOf('---', 3) + 3) : '';

  // Extract tags — handle both array style [a, b] and list style (- a\n- b)
  const tags: string[] = [];
  const arrayMatch = frontmatter.match(/^tags:\s*\[([^\]]*)\]/m);
  if (arrayMatch) {
    tags.push(...arrayMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean));
  } else {
    // List-style: tags:\n  - foo\n  - bar
    const listMatch = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (listMatch) {
      const items = listMatch[1].matchAll(/^\s+-\s+(.+)/gm);
      for (const m of items) tags.push(m[1].trim().replace(/['"]/g, ''));
    }
  }

  // Build context prefix
  const parts = [`Note: ${title}`];
  if (tags.length > 0) parts.push(`Tags: ${tags.slice(0, 5).join(', ')}`);

  return parts.join('. ') + '.\n\n' + body;
}

// =============================================================================
// Index Building
// =============================================================================

function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => SYSTEM_EXCLUDED_DIRS.has(part));
}

export interface BuildProgress {
  total: number;
  current: number;
  skipped: number;
}

/**
 * Build embeddings for all vault notes.
 * Skips notes whose content hasn't changed (by content_hash).
 *
 * @param vaultPath - Absolute path to vault root
 * @param onProgress - Optional progress callback
 */
export async function buildEmbeddingsIndex(
  vaultPath: string,
  onProgress?: (progress: BuildProgress) => void
): Promise<BuildProgress> {
  const db = getDb();
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

  embeddingsBuilding = true;
  setEmbeddingsBuildState('building_notes');
  await initEmbeddings();

  const files = await scanVault(vaultPath);
  const indexable = files.filter(f => shouldIndexFile(f.path));

  // Load existing hashes for change detection
  const existingHashes = new Map<string, string>();
  const rows = db.prepare('SELECT path, content_hash FROM note_embeddings').all() as Array<{ path: string; content_hash: string }>;
  for (const row of rows) {
    existingHashes.set(row.path, row.content_hash);
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const progress: BuildProgress = { total: indexable.length, current: 0, skipped: 0 };

  for (const file of indexable) {
    progress.current++;

    try {
      const stats = fs.statSync(file.absolutePath);
      if (stats.size > MAX_FILE_SIZE) {
        progress.skipped++;
        continue;
      }

      const content = fs.readFileSync(file.absolutePath, 'utf-8');
      const hash = contentHash(content);

      // Skip if unchanged
      if (existingHashes.get(file.path) === hash) {
        progress.skipped++;
        if (onProgress) onProgress(progress);
        continue;
      }

      const embedding = await embedText(buildNoteEmbeddingText(content, file.path));
      const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      upsert.run(file.path, buf, hash, activeModelConfig.id, Date.now());
    } catch (err) {
      progress.skipped++;
      if (progress.skipped <= 3) {
        console.error(`[Semantic] Failed to embed ${file.path}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (onProgress) onProgress(progress);
  }

  // Remove embeddings for deleted notes
  const currentPaths = new Set(indexable.map(f => f.path));
  const deleteStmt = db.prepare('DELETE FROM note_embeddings WHERE path = ?');
  for (const existingPath of existingHashes.keys()) {
    if (!currentPaths.has(existingPath)) {
      deleteStmt.run(existingPath);
    }
  }

  // Persist the text version so startup can detect version changes without loading the model
  setStoredTextVersion(EMBEDDING_TEXT_VERSION);

  embeddingsBuilding = false;
  console.error(`[Semantic] Indexed ${progress.current - progress.skipped} notes, skipped ${progress.skipped}`);
  return progress;
}

/**
 * Update embedding for a single note (used by file watcher).
 */
export async function updateEmbedding(notePath: string, absolutePath: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const hash = contentHash(content);

    // Check if unchanged
    const existing = db.prepare('SELECT content_hash FROM note_embeddings WHERE path = ?').get(notePath) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return;

    const embedding = await embedText(buildNoteEmbeddingText(content, notePath));
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(notePath, buf, hash, activeModelConfig.id, Date.now());
  } catch {
    // Skip files we can't process
  }
}

/**
 * Remove embedding for a deleted note.
 */
export function removeEmbedding(notePath: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('DELETE FROM note_embeddings WHERE path = ?').run(notePath);
}

// =============================================================================
// Cosine Similarity
// =============================================================================

/**
 * Compute cosine similarity between two Float32Arrays.
 * Assumes both are normalized (norm ≈ 1) if coming from the model with normalize:true,
 * but computes full formula for safety.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search notes by semantic similarity to a query.
 */
export async function semanticSearch(
  query: string,
  limit: number = 10
): Promise<ScoredNote[]> {
  const db = getDb();
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

  const queryEmbedding = await embedText(query);

  // Load all embeddings
  const rows = db.prepare('SELECT path, embedding FROM note_embeddings').all() as EmbeddingRow[];

  const scored: ScoredNote[] = [];
  for (const row of rows) {
    const noteEmbedding = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
    const score = cosineSimilarity(queryEmbedding, noteEmbedding);
    // Extract title from path
    const title = row.path.replace(/\.md$/, '').split('/').pop() || row.path;
    scored.push({ path: row.path, title, score: Math.round(score * 1000) / 1000 });
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Find notes semantically similar to a given note.
 */
export async function findSemanticallySimilar(
  sourcePath: string,
  limit: number = 10,
  excludePaths?: Set<string>
): Promise<ScoredNote[]> {
  const db = getDb();
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

  // Get source note embedding
  const sourceRow = db.prepare('SELECT embedding FROM note_embeddings WHERE path = ?').get(sourcePath) as EmbeddingRow | undefined;
  if (!sourceRow) {
    return [];
  }

  const sourceEmbedding = new Float32Array(
    sourceRow.embedding.buffer,
    sourceRow.embedding.byteOffset,
    sourceRow.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
  );

  // Compare against all others
  const rows = db.prepare('SELECT path, embedding FROM note_embeddings WHERE path != ?').all(sourcePath) as EmbeddingRow[];

  const scored: ScoredNote[] = [];
  for (const row of rows) {
    if (excludePaths?.has(row.path)) continue;

    const noteEmbedding = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
    const score = cosineSimilarity(sourceEmbedding, noteEmbedding);
    const title = row.path.replace(/\.md$/, '').split('/').pop() || row.path;
    scored.push({ path: row.path, title, score: Math.round(score * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// =============================================================================
// Hybrid Merge (Reciprocal Rank Fusion)
// =============================================================================

/**
 * Merge two ranked lists using Reciprocal Rank Fusion (RRF).
 * score(doc) = Σ 1/(k + rank_in_list)
 * k=60 is the standard constant from the original paper.
 */
export function reciprocalRankFusion<T extends { path: string }>(
  ...lists: T[][]
): Map<string, number> {
  const k = 60;
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed, so +1
      scores.set(item.path, (scores.get(item.path) || 0) + rrfScore);
    }
  }

  return scores;
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
  embeddingsBuilding = value;
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

// =============================================================================
// Embedding Diagnosis
// =============================================================================

export interface EmbeddingCheck {
  name: string;
  status: 'ok' | 'stale' | 'warning';
  detail: string;
}

export interface EmbeddingDiagnosis {
  healthy: boolean;
  checks: EmbeddingCheck[];
  counts: {
    embedded: number;
    vaultNotes: number;
    orphaned: number;
    orphanedEntities: number;
    missing: number;
  };
}

/**
 * Read-only diagnostic: check all aspects of embedding health.
 * All SQLite reads, no disk I/O, no model loading. <10ms.
 */
export function diagnoseEmbeddings(vaultPath: string): EmbeddingDiagnosis {
  const db = getDb();
  const checks: EmbeddingCheck[] = [];
  const counts = { embedded: 0, vaultNotes: 0, orphaned: 0, orphanedEntities: 0, missing: 0 };

  if (!db) {
    checks.push({ name: 'database', status: 'stale', detail: 'No database available' });
    return { healthy: false, checks, counts };
  }

  // Count embeddings
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    counts.embedded = row.count;
  } catch { /* table may not exist */ }

  if (counts.embedded === 0) {
    checks.push({ name: 'index', status: 'stale', detail: 'No embeddings built' });
    return { healthy: false, checks, counts };
  }

  // Check 1: Model consistency
  const storedModel = getStoredEmbeddingModel();
  if (storedModel && storedModel !== activeModelConfig.id) {
    checks.push({ name: 'model', status: 'stale', detail: `${storedModel} → ${activeModelConfig.id}` });
  } else {
    checks.push({ name: 'model', status: 'ok', detail: storedModel || activeModelConfig.id });
  }

  // Check 2: Text version
  const storedVersion = getStoredTextVersion();
  if (storedVersion !== null && storedVersion !== EMBEDDING_TEXT_VERSION) {
    checks.push({ name: 'text_version', status: 'stale', detail: `v${storedVersion} → v${EMBEDDING_TEXT_VERSION}` });
  } else if (storedVersion === null) {
    checks.push({ name: 'text_version', status: 'warning', detail: 'No version stored (pre-migration)' });
  } else {
    checks.push({ name: 'text_version', status: 'ok', detail: `v${storedVersion}` });
  }

  // Check 3: Dimension sanity (skip if dims unknown)
  if (activeModelConfig.dims > 0) {
    try {
      const sample = db.prepare('SELECT embedding FROM note_embeddings LIMIT 1').get() as { embedding: Buffer } | undefined;
      if (sample) {
        const storedDims = sample.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT;
        if (storedDims !== activeModelConfig.dims) {
          checks.push({ name: 'dimensions', status: 'stale', detail: `stored=${storedDims}, expected=${activeModelConfig.dims}` });
        } else {
          checks.push({ name: 'dimensions', status: 'ok', detail: `${storedDims}` });
        }
      }
    } catch {
      checks.push({ name: 'dimensions', status: 'warning', detail: 'Could not sample' });
    }
  }

  // Check 4: Completeness (embedded vs vault notes via notes_fts)
  try {
    const ftsRow = db.prepare('SELECT COUNT(*) as count FROM notes_fts').get() as { count: number };
    counts.vaultNotes = ftsRow.count;
    counts.missing = Math.max(0, counts.vaultNotes - counts.embedded);
    if (counts.missing > 0) {
      checks.push({ name: 'completeness', status: 'warning', detail: `${counts.embedded}/${counts.vaultNotes} notes embedded (${counts.missing} missing)` });
    } else {
      checks.push({ name: 'completeness', status: 'ok', detail: `${counts.embedded}/${counts.vaultNotes} notes` });
    }
  } catch {
    checks.push({ name: 'completeness', status: 'warning', detail: 'FTS5 index not available' });
  }

  // Check 5: Orphans (embeddings for deleted notes)
  try {
    const embPaths = new Set(
      (db.prepare('SELECT path FROM note_embeddings').all() as Array<{ path: string }>).map(r => r.path)
    );
    const ftsPaths = new Set(
      (db.prepare('SELECT path FROM notes_fts').all() as Array<{ path: string }>).map(r => r.path)
    );
    counts.orphaned = 0;
    for (const p of embPaths) {
      if (!ftsPaths.has(p)) counts.orphaned++;
    }
    if (counts.orphaned > 0) {
      checks.push({ name: 'orphans', status: 'warning', detail: `${counts.orphaned} orphaned embeddings` });
    } else {
      checks.push({ name: 'orphans', status: 'ok', detail: '0 orphaned' });
    }
  } catch {
    checks.push({ name: 'orphans', status: 'warning', detail: 'Could not check' });
  }

  // Check 5b: Entity embedding orphans
  try {
    const embNames = new Set(
      (db.prepare('SELECT entity_name FROM entity_embeddings').all() as Array<{ entity_name: string }>).map(r => r.entity_name)
    );
    const entityNames = new Set(
      (db.prepare('SELECT name FROM entities').all() as Array<{ name: string }>).map(r => r.name)
    );
    counts.orphanedEntities = 0;
    for (const n of embNames) {
      if (!entityNames.has(n)) counts.orphanedEntities++;
    }
    if (counts.orphanedEntities > 0) {
      checks.push({ name: 'entity_orphans', status: 'warning', detail: `${counts.orphanedEntities} orphaned entity embeddings` });
    } else {
      checks.push({ name: 'entity_orphans', status: 'ok', detail: '0 orphaned' });
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('no such table')) {
      checks.push({ name: 'entity_orphans', status: 'ok', detail: 'No entity embeddings table' });
    } else {
      checks.push({ name: 'entity_orphans', status: 'warning', detail: 'Could not check entity orphans' });
    }
  }

  // Check 6: Integrity (NaN/Inf sample)
  try {
    const samples = db.prepare('SELECT embedding FROM note_embeddings ORDER BY RANDOM() LIMIT 3').all() as Array<{ embedding: Buffer }>;
    let corrupt = false;
    for (const s of samples) {
      const arr = new Float32Array(s.embedding.buffer, s.embedding.byteOffset, s.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
      for (let i = 0; i < arr.length; i++) {
        if (!isFinite(arr[i])) { corrupt = true; break; }
      }
      if (corrupt) break;
    }
    checks.push({ name: 'integrity', status: corrupt ? 'stale' : 'ok', detail: corrupt ? 'Corrupted vectors detected' : 'No corruption' });
  } catch {
    checks.push({ name: 'integrity', status: 'warning', detail: 'Could not sample' });
  }

  const healthy = checks.every(c => c.status === 'ok' || c.status === 'warning');
  return { healthy, checks, counts };
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

/**
 * Load all note embeddings from DB as a Map<path, Float32Array>.
 * Used by graph analysis for clustering and bridge detection.
 */
export function loadAllNoteEmbeddings(): Map<string, Float32Array> {
  const db = getDb();
  const result = new Map<string, Float32Array>();
  if (!db) return result;

  try {
    const rows = db.prepare('SELECT path, embedding FROM note_embeddings').all() as EmbeddingRow[];
    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      result.set(row.path, embedding);
    }
  } catch {
    // Table might not exist
  }

  return result;
}

// =============================================================================
// Entity Embeddings
// =============================================================================

interface EntityInfo {
  name: string;
  path: string;
  category: string;
  aliases: string[];
}

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
    entityEmbeddingsMap.set(entityName, embedding);
  } catch (err) {
    console.error(`[Semantic] Failed to update entity embedding ${entityName}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Remove note embeddings whose paths no longer exist in the FTS5 index.
 * Safe to call after fts5Incremental has run.
 */
export function removeOrphanedNoteEmbeddings(): number {
  const db = getDb();
  if (!db) return 0;

  const result = db.prepare(
    'DELETE FROM note_embeddings WHERE path NOT IN (SELECT path FROM notes_fts)'
  ).run();
  return result.changes;
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
  return entityEmbeddingsMap;
}

export function getInferredCategory(entityName: string): InferredCategory | undefined {
  return inferredCategoriesMap.get(entityName);
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
  inferredCategoriesMap = new Map();
  if (!db) return inferredCategoriesMap;

  try {
    ensureInferredCategoriesTable();
    const rows = db.prepare(`
      SELECT entity_name, category, confidence
      FROM inferred_categories
      WHERE source = 'centroid'
    `).all() as Array<{ entity_name: string; category: string; confidence: number }>;

    for (const row of rows) {
      inferredCategoriesMap.set(row.entity_name, {
        entityName: row.entity_name,
        category: row.category,
        confidence: row.confidence,
      });
    }
  } catch {
    inferredCategoriesMap = new Map();
  }

  return inferredCategoriesMap;
}

export function saveInferredCategories(categories: Map<string, InferredCategory>): void {
  const db = getDb();
  inferredCategoriesMap = new Map(categories);
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
    inferredCategoriesMap = inferred;
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

  inferredCategoriesMap = inferred;
  return inferred;
}

/**
 * Load all entity embeddings from DB into memory for fast cosine search.
 */
export function loadEntityEmbeddingsToMemory(): void {
  const db = getDb();
  if (!db) return;

  try {
    const rows = db.prepare('SELECT entity_name, embedding FROM entity_embeddings').all() as EntityEmbeddingRow[];
    entityEmbeddingsMap.clear();

    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      entityEmbeddingsMap.set(row.entity_name, embedding);
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
 * Batch-load note embeddings for a set of paths (for MMR diversity).
 * Returns only embeddings that exist in the database.
 */
export function loadNoteEmbeddingsForPaths(paths: string[]): Map<string, Float32Array> {
  const db = getDb();
  const result = new Map<string, Float32Array>();
  if (!db || paths.length === 0) return result;

  try {
    const stmt = db.prepare('SELECT path, embedding FROM note_embeddings WHERE path = ?');
    for (const p of paths) {
      const row = stmt.get(p) as EmbeddingRow | undefined;
      if (row) {
        const embedding = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
        );
        result.set(p, embedding);
      }
    }
  } catch {
    // Table might not exist
  }

  return result;
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
