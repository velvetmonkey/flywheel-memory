/**
 * Semantic Search Embeddings Module
 *
 * Local embedding-based semantic search using @huggingface/transformers
 * with all-MiniLM-L6-v2. Automatic when embeddings have been built via init_semantic.
 *
 * Follows the fts5.ts pattern:
 * - Module-level db handle via setEmbeddingsDatabase()
 * - Lazy initialization: model loads on first semantic search call
 * - Dynamic import of @huggingface/transformers
 */

import type Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { scanVault } from './vault.js';

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

// =============================================================================
// Constants
// =============================================================================

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMS = 384;

/** Directories to exclude from embedding */
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  '.trash',
  '.git',
  'node_modules',
  'templates',
  '.claude',
  '.flywheel',
]);

/** Maximum file size to embed (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// =============================================================================
// Module State
// =============================================================================

let db: Database.Database | null = null;
let pipeline: any = null;
let initPromise: Promise<void> | null = null;

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
 * Load the transformer model. Cached after first call.
 * Downloads ~23MB model on first use to ~/.cache/huggingface/
 */
export async function initEmbeddings(): Promise<void> {
  if (pipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Dynamic import — @huggingface/transformers is an optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const transformers: any = await (Function('specifier', 'return import(specifier)')('@huggingface/transformers'));
      pipeline = await transformers.pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
      });
    } catch (err: unknown) {
      initPromise = null;
      if (err instanceof Error && (
        err.message.includes('Cannot find package') ||
        err.message.includes('MODULE_NOT_FOUND') ||
        err.message.includes("Cannot find module") ||
        err.message.includes('ERR_MODULE_NOT_FOUND')
      )) {
        throw new Error(
          'Semantic search requires @huggingface/transformers. ' +
          'Install it with: npm install @huggingface/transformers'
        );
      }
      throw err;
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

// =============================================================================
// Content Hashing
// =============================================================================

function contentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

// =============================================================================
// Index Building
// =============================================================================

function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => EXCLUDED_DIRS.has(part));
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
  if (!db) {
    throw new Error('Embeddings database not initialized. Call setEmbeddingsDatabase() first.');
  }

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

      const embedding = await embedText(content);
      const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      upsert.run(file.path, buf, hash, MODEL_ID, Date.now());
    } catch {
      progress.skipped++;
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

  console.error(`[Semantic] Indexed ${progress.current - progress.skipped} notes, skipped ${progress.skipped}`);
  return progress;
}

/**
 * Update embedding for a single note (used by file watcher).
 */
export async function updateEmbedding(notePath: string, absolutePath: string): Promise<void> {
  if (!db) return;

  try {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const hash = contentHash(content);

    // Check if unchanged
    const existing = db.prepare('SELECT content_hash FROM note_embeddings WHERE path = ?').get(notePath) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return;

    const embedding = await embedText(content);
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    db.prepare(`
      INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(notePath, buf, hash, MODEL_ID, Date.now());
  } catch {
    // Skip files we can't process
  }
}

/**
 * Remove embedding for a deleted note.
 */
export function removeEmbedding(notePath: string): void {
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
export function hasEmbeddingsIndex(): boolean {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    return row.count > 0;
  } catch {
    return false;
  }
}

/**
 * Get the number of embedded notes.
 */
export function getEmbeddingsCount(): number {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}
