/**
 * Shared search post-processing pipeline (arch-review S6).
 *
 * The multihop-backfill → graph-rerank → bridging → snippet-enhance →
 * observe → (llm: sandwich + section-expand + strip) tail was copy-pasted
 * three times in tools/read/query.ts — once per method branch, with no
 * divergence. Single implementation here; behaviour pinned by the S6
 * search-contract and hybrid-seam suites.
 */

import type { VaultIndex } from '../read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { multiHopBackfill, extractExpansionTerms, expandQuery } from '../read/multihop.js';
import { extractObservedHits } from '../shared/observer.js';
import {
  shouldRunMultiHop,
  applyGraphReranking,
  applySandwichOrdering,
  stripInternalFields,
} from './ranking.js';
import { applyEntityBridging } from './bridging.js';
import { enhanceSnippets, expandToSections } from './assemble.js';

export interface PostProcessOptions {
  query: string;
  index: VaultIndex;
  vaultPath: string;
  stateDb: StateDb | null;
  consumer: 'llm' | 'human';
  limit: number;
  expandN: number;
  /** Observer method tag ('hybrid' | 'fts5') */
  method: string;
}

/**
 * Run the shared post-processing tail over a result list (mutates results).
 * Returns the observer hit capture taken BEFORE the llm-mode strip/reorder.
 */
export async function postProcessSearchResults(
  results: Array<Record<string, unknown>>,
  opts: PostProcessOptions,
): Promise<ReturnType<typeof extractObservedHits>> {
  const { query, index, vaultPath, stateDb, consumer, limit, expandN, method } = opts;

  // Multi-hop backfill — when results suggest bridge structure
  if (shouldRunMultiHop(query, results, index)) {
    const hopResults = multiHopBackfill(results, index, stateDb, { maxBackfill: limit });
    const expansionTerms = extractExpansionTerms(results, query, index);
    const expansionResults = expandQuery(expansionTerms, [...results, ...hopResults], index, stateDb);
    results.push(...hopResults, ...expansionResults);
  }

  // Graph re-ranking + bridging + context engineering (LLM only) + enhanced snippets
  applyGraphReranking(results, stateDb);
  applyEntityBridging(results, stateDb);
  await enhanceSnippets(results, query, vaultPath);
  // Capture scored hits in relevance order BEFORE the llm strip below
  // deletes rrf_score/_combined_score and re-orders for the sandwich.
  const observed = extractObservedHits(results, method);
  if (consumer === 'llm') {
    applySandwichOrdering(results);
    await expandToSections(results, index, vaultPath, expandN);
    stripInternalFields(results);
  }
  return observed;
}
