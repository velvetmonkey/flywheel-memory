/**
 * Embedding provider glue — model init, worker lifecycle, and the LRU embed
 * cache (arch-review S8). Extracted verbatim from core/read/embeddings.ts.
 * The worker spawn itself lives in ../embeddingProvider.ts (untouched).
 */

import { getEmbeddingProvider, resetEmbeddingProvider } from '../embeddingProvider.js';
import { activeModelConfig } from './runtime.js';

/** LRU cache for embedText results (max 500 entries) */
const embeddingCache = new Map<string, Float32Array>();
const EMBEDDING_CACHE_MAX = 500;

export async function initEmbeddings(): Promise<void> {
  const { dims } = await getEmbeddingProvider(activeModelConfig.id).init();
  if (activeModelConfig.dims === 0) {
    activeModelConfig.dims = dims;
    console.error(`[Semantic] Probed model ${activeModelConfig.id}: ${dims} dims`);
  }
}

/**
 * Gracefully terminate the worker thread.
 * Call during server shutdown to clean up resources.
 */
export function terminateWorker(): void {
  resetEmbeddingProvider();
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embedding for a text string via the worker thread.
 * Returns Float32Array of EMBEDDING_DIMS dimensions.
 */
export async function embedText(text: string): Promise<Float32Array> {
  await initEmbeddings();
  return getEmbeddingProvider(activeModelConfig.id).embed(text);
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
