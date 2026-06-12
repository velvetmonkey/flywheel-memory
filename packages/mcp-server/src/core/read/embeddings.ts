/**
 * Embeddings facade (arch-review S8).
 *
 * Public surface of the embeddings package dir (house pattern:
 * core/write/writer.ts). The implementation lives in ./embeddings/:
 *   - runtime.ts     — shared state, model config, build state, index queries
 *   - provider.ts    — model init, worker lifecycle, embed cache
 *   - noteStore.ts   — note embedding index build/update/cleanup/loads
 *   - entityStore.ts — entity embeddings + inferred categories
 *   - search.ts      — cosine similarity + semantic search
 *   - diagnosis.ts   — read-only embedding health checks
 *
 * Explicit named re-exports keep the ~20 existing importers valid.
 * Note: reciprocalRankFusion moved to core/search/merge.ts in S8 and is
 * deliberately NOT re-exported here (would create a cycle
 * embeddings → merge → embeddings/search).
 */

export {
  getActiveModelId,
  setEmbeddingsDatabase,
  setEmbeddingsBuildState,
  getStoredTextVersion,
  getStoredEmbeddingModel,
  clearEmbeddingsForRebuild,
  isEmbeddingsBuilding,
  setEmbeddingsBuilding,
  hasEmbeddingsIndex,
  getEmbeddingsCount,
  EMBEDDING_TEXT_VERSION,
} from './embeddings/runtime.js';

export {
  initEmbeddings,
  terminateWorker,
  embedText,
  embedTextCached,
} from './embeddings/provider.js';

export {
  buildNoteEmbeddingText,
  buildEmbeddingsIndex,
  updateEmbedding,
  removeEmbedding,
  removeOrphanedNoteEmbeddings,
  loadAllNoteEmbeddings,
  loadNoteEmbeddingsForPaths,
} from './embeddings/noteStore.js';
export type { BuildProgress } from './embeddings/noteStore.js';

export {
  buildEntityEmbeddingsIndex,
  updateEntityEmbedding,
  removeOrphanedEntityEmbeddings,
  findSemanticallySimilarEntities,
  hasEntityEmbeddingsIndex,
  getEntityEmbeddingsMap,
  getEntityEmbedding,
  getEntityEmbeddingsCount,
  getInferredCategory,
  loadInferredCategories,
  saveInferredCategories,
  classifyUncategorizedEntities,
  loadEntityEmbeddingsToMemory,
} from './embeddings/entityStore.js';

export {
  cosineSimilarity,
  semanticSearch,
  findSemanticallySimilar,
} from './embeddings/search.js';
export type { ScoredNote, EntitySimilarityResult } from './embeddings/search.js';

export { diagnoseEmbeddings } from './embeddings/diagnosis.js';
export type { EmbeddingCheck, EmbeddingDiagnosis } from './embeddings/diagnosis.js';

export type { InferredCategory } from './types.js';
