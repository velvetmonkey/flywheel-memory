/**
 * Semantic search over note embeddings — cosine similarity, query search,
 * and note-to-note similarity (arch-review S8).
 * Extracted verbatim from core/read/embeddings.ts.
 */

import { type EmbeddingRow, getDb } from './runtime.js';
import { embedTextCached } from './provider.js';

// =============================================================================
// Types
// =============================================================================

export interface ScoredNote {
  path: string;
  title: string;
  score: number;
}

export interface EntitySimilarityResult {
  entityName: string;
  similarity: number;
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

  const queryEmbedding = await embedTextCached(query);

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
